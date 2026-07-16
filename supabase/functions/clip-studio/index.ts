// supabase/functions/clip-studio/index.ts
// Deploy with: supabase functions deploy clip-studio --project-ref yzbvajungshqcpusfiia
//
// Clip Studio (Phase 1) — admin API for the auto-caption tool. Standalone by
// design: its own tables (clip_projects / clips) + its own storage bucket
// ('clip-studio'), no ties to songs/orders, so it can be lifted into its own
// project later. Heavy work runs on the in-house Cloud Run renderer
// (INHOUSE_RENDERER_URL /clip-prepare + /clip-render); results come back via
// the clip-studio-callback function.
//
// Actions:
//   list                                        -> projects (with clips)
//   create_project { title, ext, auto_pilot }   -> row + signed upload URL
//   ingest        { project_id }                -> kick prepare (audio+duration) after upload
//   render_clip   { project_id, start_sec, end_sec, aspect, style, label, options }
//   retry_clip    { clip_id }                   -> re-dispatch a failed render
//   get_words     { project_id }                -> word-timed transcript for the caption editor
//   update_transcript { project_id, edits }     -> fix misheard words before rendering
//   music_delete  { name }                      -> remove a track from the music library
//   delete_clip   { clip_id }
//   delete_project{ project_id }
//
// Shared AI + dispatch logic lives in _shared/clip-studio-lib.ts (also used by
// clip-studio-callback for auto-pilot and clip-studio-watchdog for recovery).
//
// Auth: verify_jwt = true (admin JWT). Caller must be in admin_users — same
// pattern as admin-videos. Service-role for data.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  BUCKET, CALLBACK_URL, ASPECTS, STYLES,
  dispatchRenderer, dispatchClip, proposeClips, tagEmphasis, tagEmoji, translateCaptionGroups, nowIso,
} from '../_shared/clip-studio-lib.ts';
import { brandContext } from '../_shared/brand-brief.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const CLIP_AI_MODEL = Deno.env.get('CLIP_AI_MODEL') || 'claude-sonnet-5';
const PEXELS_API_KEY = Deno.env.get('PEXELS_API_KEY');

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// B-roll: Claude reads the clip's transcript and proposes 2-4 short visual
// moments with a stock-footage search query each; Pexels supplies the videos.
async function pickBrollCuts(words: Array<{ word: string; start: number; end: number }>, start: number, end: number) {
  if (!ANTHROPIC_API_KEY) return [];
  const listing = words.map((w) => `${w.start.toFixed(1)}|${w.word.trim()}`).join('\n');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLIP_AI_MODEL,
      max_tokens: 700,
      system:
        'You add B-ROLL to a talking-head social clip. From the timestamped transcript, pick 2-4 moments where cutting to stock footage of WHAT IS BEING DESCRIBED makes the clip more visual. ' +
        `Rules: each cut 2.0-4.0 seconds; the first cut must start after ${(start + 3).toFixed(1)} (keep the hook on the speaker); the last must end before ${(end - 2).toFixed(1)}; ` +
        'leave at least 4 seconds of speaker between cuts; never cover a moment where the speaker says something personal/direct-to-camera. ' +
        'query = a concrete 2-4 word ENGLISH stock-video search for what is described (visual nouns: "kids rehearsing stage", "volunteers church hall"). Call the tool.',
      messages: [{ role: 'user', content: `Each line is "start|word":\n\n${listing.slice(0, 20000)}` }],
      tools: [{
        name: 'broll',
        description: 'Propose b-roll cuts.',
        input_schema: {
          type: 'object',
          properties: {
            cuts: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  t_start: { type: 'number' }, t_end: { type: 'number' },
                  query: { type: 'string', description: '2-4 word English stock search' },
                },
                required: ['t_start', 't_end', 'query'],
              },
            },
          },
          required: ['cuts'],
        },
      }],
      tool_choice: { type: 'tool', name: 'broll' },
    }),
  });
  if (!resp.ok) throw new Error(`broll pick ${resp.status}`);
  const data = await resp.json();
  const cuts = (data.content || []).find((b: any) => b.type === 'tool_use')?.input?.cuts;
  if (!Array.isArray(cuts)) return [];
  return cuts
    .map((c: any) => ({ start: Number(c.t_start), end: Number(c.t_end), query: String(c.query || '').slice(0, 60) }))
    .filter((c) => !Number.isNaN(c.start) && !Number.isNaN(c.end) && c.query &&
      c.start >= start + 2.5 && c.end <= end - 1.5 && c.end - c.start >= 1.5 && c.end - c.start <= 5)
    .slice(0, 4);
}

async function searchPexelsVideo(query: string, aspect: string): Promise<string | null> {
  const orientation = aspect === '9:16' ? 'portrait' : aspect === '1:1' ? 'square' : 'landscape';
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${orientation}&per_page=3&size=medium`,
    { headers: { Authorization: PEXELS_API_KEY! } },
  );
  if (!res.ok) throw new Error(`pexels ${res.status}`);
  const data = await res.json();
  for (const video of data.videos || []) {
    const files = (video.video_files || [])
      .filter((f: any) => f.file_type === 'video/mp4' && Math.min(f.width || 0, f.height || 0) >= 700)
      .sort((a: any, b: any) => (a.width * a.height) - (b.width * b.height));
    if (files.length) return files[0].link;
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (o: unknown, code = 200) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: code });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ success: false, error: 'Missing Authorization' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: ue } = await userClient.auth.getUser();
    if (ue || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (!roleRow) return json({ success: false, error: 'Not authorized' }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'list';

    if (action === 'list') {
      const { data: projects, error } = await admin.from('clip_projects')
        .select('*').order('created_at', { ascending: false }).limit(30);
      if (error) throw new Error(error.message);
      const ids = (projects || []).map((p: any) => p.id);
      let clips: any[] = [];
      if (ids.length) {
        const { data } = await admin.from('clips').select('*').in('project_id', ids).order('created_at', { ascending: false });
        clips = data || [];
      }
      // Transcripts can be huge; the list view only needs word_count + text preview.
      const slim = (projects || []).map((p: any) => ({
        ...p,
        transcript: undefined,
        transcript_text: p.transcript?.text?.slice(0, 4000) || null,
        word_count: Array.isArray(p.transcript?.words) ? p.transcript.words.length : 0,
        clips: clips.filter((c) => c.project_id === p.id),
      }));
      return json({ success: true, projects: slim });
    }

    if (action === 'create_project') {
      const title = String(body.title || 'Untitled video').slice(0, 120);
      const ext = String(body.ext || 'mp4').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'mp4';
      // auto_pilot: once the transcript lands, segment the whole video into
      // complete clips and render them hands-free (callback + watchdog).
      // auto_pilot_config carries the owner's preset so those renders wear it.
      const autoPilot = !!body.auto_pilot;
      const apc = body.auto_pilot_config && typeof body.auto_pilot_config === 'object' ? body.auto_pilot_config : null;
      const { data: proj, error } = await admin.from('clip_projects')
        .insert({
          title, status: 'uploaded', auto_pilot: autoPilot,
          auto_pilot_state: autoPilot ? 'pending' : null,
          auto_pilot_config: autoPilot ? apc : null,
        }).select().single();
      if (error) throw new Error(error.message);
      const sourcePath = `${proj.id}/source.${ext}`;
      const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(sourcePath, { upsert: true });
      if (se) throw new Error(`sign: ${se.message}`);
      return json({ success: true, project_id: proj.id, signed_url: signed.signedUrl, path: sourcePath });
    }

    if (action === 'ingest') {
      const { project_id, path: sourcePath } = body;
      if (!project_id || !sourcePath) throw new Error('Missing project_id or path');
      const source_url = admin.storage.from(BUCKET).getPublicUrl(sourcePath).data.publicUrl;
      const { error } = await admin.from('clip_projects')
        .update({ source_path: sourcePath, source_url, status: 'preparing', error_message: null, updated_at: new Date().toISOString() })
        .eq('id', project_id);
      if (error) throw new Error(error.message);
      // Cloud Run holds no Supabase key (house pattern, same as the Animado
      // builder) — hand it a pre-signed PUT URL for the audio it extracts.
      const audioPath = `${project_id}/audio.mp3`;
      const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(audioPath, { upsert: true });
      if (se) throw new Error(`sign audio: ${se.message}`);
      await dispatchRenderer('/clip-prepare', {
        project_id, source_url, bucket: BUCKET, callback_url: CALLBACK_URL,
        audio_upload_url: signed.signedUrl, audio_path: audioPath,
        audio_public_url: admin.storage.from(BUCKET).getPublicUrl(audioPath).data.publicUrl,
      });
      return json({ success: true, status: 'preparing' });
    }

    if (action === 'song_search') {
      const q = String(body.q || '').trim();
      let query = admin.from('songs')
        .select('id, recipient_name, genre, genre_name, occasion, created_at, image_url')
        .eq('paid', true).not('audio_url', 'is', null)
        .order('created_at', { ascending: false }).limit(15);
      if (q) query = query.ilike('recipient_name', `%${q}%`);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return json({
        success: true,
        songs: (data || []).map((s: any) => ({
          id: s.id, recipient_name: s.recipient_name, genre: s.genre_name || s.genre,
          occasion: s.occasion, created_at: s.created_at, has_cover: !!s.image_url,
        })),
      });
    }

    if (action === 'create_teaser_project') {
      const { song_id } = body;
      if (!song_id) throw new Error('Missing song_id');
      const { data: song, error: se } = await admin.from('songs')
        .select('id, recipient_name, genre, genre_name, audio_url, image_url, lyrics, lyrics_timestamps')
        .eq('id', song_id).single();
      if (se || !song) throw new Error('song not found');
      if (!song.audio_url) throw new Error('song has no audio yet');

      // Kie's aligned words include section markers ([Intro], [Verse 1], …)
      // as "words" — strip them so they never reach the captions.
      // ("[Verse 1]" arrives as TWO tokens "[Verse" and "1]" — match either bracket edge)
      const stripTags = (ws: any[]) => (ws || []).filter((w: any) => !/^\[|\]$/.test(String(w.word || '').trim()));
      const cachedWords = stripTags(song.lyrics_timestamps?.words || []);
      const timed = cachedWords.length > 0;
      const title = `Teaser — ${song.recipient_name || 'canción'} (${song.genre_name || song.genre || 'song'})`;
      const { data: proj, error: pe } = await admin.from('clip_projects').insert({
        kind: 'song_teaser',
        title,
        source_url: song.audio_url,
        status: timed ? 'ready' : 'transcribing',
        transcript: timed ? { words: cachedWords, text: song.lyrics || '', duration: song.lyrics_timestamps.duration } : null,
        duration_sec: timed ? song.lyrics_timestamps.duration : null,
        meta: { song_id: song.id, cover_url: song.image_url, recipient: song.recipient_name },
      }).select('id').single();
      if (pe) throw new Error(pe.message);

      if (!timed) {
        // Kie aligned-words (fast, free) with Whisper fallback — transcribe-song
        // caches onto the song row; we copy the result onto the project.
        const run = async () => {
          try {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-song`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ songId: song.id }),
            });
            const out = await r.json();
            if (!out.success || !Array.isArray(out.words)) throw new Error(out.error || 'no words');
            const cleanWords = stripTags(out.words);
            if (!cleanWords.length) throw new Error('no sung words after filtering section tags');
            await admin.from('clip_projects').update({
              transcript: { words: cleanWords, text: song.lyrics || '', duration: out.duration },
              duration_sec: out.duration, status: 'ready', updated_at: new Date().toISOString(),
            }).eq('id', proj.id);
          } catch (e) {
            await admin.from('clip_projects').update({
              status: 'error', error_message: `Could not get word timing for this song: ${(e as Error).message}`,
              updated_at: new Date().toISOString(),
            }).eq('id', proj.id);
          }
        };
        // deno-lint-ignore no-explicit-any
        if (typeof (globalThis as any).EdgeRuntime !== 'undefined') (globalThis as any).EdgeRuntime.waitUntil(run()); else run();
      }
      return json({ success: true, project_id: proj.id });
    }

    if (action === 'pool_add') {
      const { song_id, note } = body;
      if (!song_id) throw new Error('Missing song_id');
      const { error } = await admin.from('marketing_song_pool')
        .upsert({ song_id, note: note ? String(note).slice(0, 200) : null, active: true }, { onConflict: 'song_id' });
      if (error) throw new Error(error.message);
      return json({ success: true });
    }

    if (action === 'suggest_clips') {
      const { project_id } = body;
      if (!project_id) throw new Error('Missing project_id');
      const { data: proj, error: pe } = await admin.from('clip_projects')
        .select('id, duration_sec, transcript, status, kind, meta').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length < 20) throw new Error('Not enough speech in this video to pick clips from');

      const isTeaser = proj.kind === 'song_teaser';
      const suggestions = await proposeClips(words, Number(proj.duration_sec) || words[words.length - 1].end, {
        mode: isTeaser ? 'teaser' : 'best', recipient: proj.meta?.recipient,
      });
      const ai_suggestions = { generated_at: new Date().toISOString(), model: CLIP_AI_MODEL, suggestions };
      await admin.from('clip_projects').update({ ai_suggestions, updated_at: new Date().toISOString() }).eq('id', project_id);
      return json({ success: true, ai_suggestions });
    }

    if (action === 'render_clip') {
      const { project_id, start_sec, end_sec, aspect, style, label } = body;
      if (!project_id) throw new Error('Missing project_id');
      if (!ASPECTS.includes(aspect)) throw new Error(`aspect must be one of ${ASPECTS.join(', ')}`);
      if (!STYLES.includes(style)) throw new Error(`style must be one of ${STYLES.join(', ')}`);

      const { data: proj, error: pe } = await admin.from('clip_projects')
        .select('id, source_url, source_purged_at, duration_sec, transcript, status, kind, meta').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      if (proj.kind !== 'song_teaser' && (proj.source_purged_at || !proj.source_url)) {
        throw new Error('The original video was cleaned up after 14 days of inactivity — upload it again to make new clips');
      }
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length === 0) throw new Error('project has no transcript words');

      // Song teasers take a simpler path: audio window over the cover art.
      if (proj.kind === 'song_teaser') {
        const tStart = Math.max(0, Number(start_sec) || 0);
        const tEnd = Math.min(Number(end_sec) || 0, Number(proj.duration_sec) || Infinity);
        if (tEnd - tStart < 10) throw new Error('Teaser windows need at least 10 seconds');
        if (tEnd - tStart > 45) throw new Error('Teasers work best under 45 seconds — pick a shorter window');
        const tLabel = label ? String(label).slice(0, 120) : null;
        const render_job = {
          mode: 'teaser',
          audio_src: proj.source_url, bg_image_url: proj.meta?.cover_url || null,
          start_sec: tStart, end_sec: tEnd, aspect, style,
          options: { hook_title_text: tLabel },
          endcard_text: 'regalosquecantan.com',
        };
        const { data: clip, error: ce } = await admin.from('clips').insert({
          project_id, start_sec: tStart, end_sec: tEnd, aspect, style,
          label: tLabel, status: 'rendering',
          options: { teaser: true, hook_title: !!tLabel },
          render_job, dispatched_at: nowIso(),
        }).select().single();
        if (ce) throw new Error(ce.message);
        try {
          await dispatchClip(admin, proj, clip);
        } catch (e) {
          await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: nowIso() }).eq('id', clip.id);
          throw e;
        }
        return json({ success: true, clip });
      }

      const start = Math.max(0, Number(start_sec) || 0);
      const end = Math.min(Number(end_sec) || Number(proj.duration_sec) || 0, Number(proj.duration_sec) || Infinity);
      if (end - start < 0.5) throw new Error('clip range too short');
      if (end - start > 180) throw new Error('Phase 1 caps clips at 3 minutes — pick a shorter range');

      // Phase 3 render options (all optional, validated here).
      const rawOpts = body.options || {};
      const cleanLabel = label ? String(label).slice(0, 120) : null;
      const options = {
        framing: ['auto', 'wide', 'left', 'center', 'right'].includes(rawOpts.framing) ? rawOpts.framing : 'center',
        remove_silences: !!rawOpts.remove_silences,
        zoom: !!rawOpts.zoom,
        hook_title: !!rawOpts.hook_title,
        emphasis: rawOpts.emphasis !== false,
        music: !!rawOpts.music,
        broll: !!rawOpts.broll,
        transitions: rawOpts.transitions !== false,
        clean_audio: !!rawOpts.clean_audio,
        outro: !!rawOpts.outro,
        punch_zooms: !!rawOpts.punch_zooms,
        progress_bar: !!rawOpts.progress_bar,
        watermark: !!rawOpts.watermark,
        emoji: !!rawOpts.emoji,
        sfx_emphasis: !!rawOpts.sfx_emphasis,
        // Specific track from the music library ('' / null = random pick)
        music_track: typeof rawOpts.music_track === 'string' && rawOpts.music_track
          ? rawOpts.music_track.replace(/[^a-z0-9._-]/gi, '_').slice(0, 80) : null,
      };
      if (options.hook_title && !cleanLabel) throw new Error('Give the clip a name to use as the title overlay');

      // Emphasis words (best-effort — a failure just means plain captions).
      let emphasis_starts: number[] = [];
      if (options.emphasis) {
        const inRange = (words as any[]).filter((w) => w.end > start + 0.05 && w.start < end - 0.05);
        try { emphasis_starts = await tagEmphasis(inRange); } catch (e) { console.warn('emphasis tagging failed:', (e as Error).message); }
      }

      // Emoji captions (best-effort).
      let emoji_starts: Array<{ t: number; e: string }> = [];
      if (options.emoji) {
        const inRange = (words as any[]).filter((w) => w.end > start + 0.05 && w.start < end - 0.05);
        try { emoji_starts = await tagEmoji(inRange); } catch (e) { console.warn('emoji tagging failed:', (e as Error).message); }
      }

      // EN caption version: translate the clip's caption groups up front and
      // hand the renderer pre-timed English lines instead of karaoke words.
      let caption_groups: Array<{ start: number; end: number; text: string }> | null = null;
      if (body.translate_to === 'en') {
        const inRange = (words as any[]).filter((w) => w.end > start + 0.05 && w.start < end - 0.05);
        caption_groups = await translateCaptionGroups(inRange, start, 'English');
      }

      // B-roll: Claude picks the moments + queries, Pexels supplies footage.
      // Best-effort per cut — a failed search just means fewer cuts.
      const broll: Array<{ start: number; end: number; url: string }> = [];
      if (options.broll) {
        if (!PEXELS_API_KEY) throw new Error('B-roll needs the Pexels key (PEXELS_API_KEY) configured');
        const inRange = (words as any[]).filter((w) => w.end > start + 0.05 && w.start < end - 0.05);
        try {
          const cuts = await pickBrollCuts(inRange, start, end);
          for (const cut of cuts) {
            try {
              const url = await searchPexelsVideo(cut.query, aspect);
              if (url) broll.push({ start: cut.start, end: cut.end, url });
            } catch (e) { console.warn(`pexels search "${cut.query}" failed:`, (e as Error).message); }
          }
        } catch (e) { console.warn('broll picking failed:', (e as Error).message); }
      }

      // Whoosh SFX for b-roll entries — only if the owner uploaded one.
      let sfx_url: string | null = null;
      if (options.transitions && broll.length) {
        const { data: sfx } = await admin.storage.from(BUCKET).list('sfx');
        const whoosh = (sfx || []).find((f: any) => /^whoosh.*\.(mp3|m4a|aac)$/i.test(f.name || ''));
        if (whoosh) sfx_url = admin.storage.from(BUCKET).getPublicUrl(`sfx/${whoosh.name}`).data.publicUrl;
      }

      // Music bed: the chosen library track, or a random one if none picked.
      let music_url: string | null = null;
      if (options.music) {
        const { data: tracks } = await admin.storage.from(BUCKET).list('music');
        const mp3s = (tracks || []).filter((f: any) => /\.(mp3|m4a|aac)$/i.test(f.name || ''));
        if (!mp3s.length) throw new Error('The music library is empty — use "Music library" on the Clip Studio home screen to upload an MP3 first');
        let pick = mp3s[Math.floor(Math.random() * mp3s.length)];
        if (options.music_track) {
          const chosen = mp3s.find((f: any) => f.name === options.music_track);
          if (!chosen) throw new Error(`"${options.music_track}" is no longer in the music library — pick another track`);
          pick = chosen;
        }
        music_url = admin.storage.from(BUCKET).getPublicUrl(`music/${pick.name}`).data.publicUrl;
      }

      // The stable payload is stored on the row so the watchdog / Retry button
      // can re-dispatch without re-resolving music, b-roll, or emphasis.
      const render_job = {
        source_url: proj.source_url,
        start_sec: start, end_sec: end, aspect, style,
        options: { ...options, hook_title_text: options.hook_title ? cleanLabel : null, emphasis_starts, emoji_starts },
        music_url, broll, sfx_url,
        ...(caption_groups ? { caption_groups } : {}),
      };
      const { data: clip, error: ce } = await admin.from('clips').insert({
        project_id, start_sec: start, end_sec: end, aspect, style,
        label: caption_groups ? `EN — ${cleanLabel || 'clip'}` : cleanLabel,
        ai_score: Number(body.ai_score) || null,
        ai_reason: body.ai_reason ? String(body.ai_reason).slice(0, 300) : null,
        status: 'rendering', options,
        render_job, dispatched_at: nowIso(),
      }).select().single();
      if (ce) throw new Error(ce.message);

      try {
        await dispatchClip(admin, proj, clip);
      } catch (e) {
        await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: nowIso() }).eq('id', clip.id);
        throw e;
      }
      return json({ success: true, clip });
    }

    // Re-dispatch a failed render. Everything needed is on the clip row
    // (render_job) or rebuildable for pre-v2 clips; attempts resets so the
    // watchdog gives it a fresh timeout cycle.
    if (action === 'retry_clip') {
      const { clip_id } = body;
      if (!clip_id) throw new Error('Missing clip_id');
      const { data: clip } = await admin.from('clips').select('*').eq('id', clip_id).single();
      if (!clip) throw new Error('clip not found');
      if (clip.status === 'ready') throw new Error('Clip already rendered');
      const { data: proj } = await admin.from('clip_projects').select('*').eq('id', clip.project_id).single();
      if (!proj) throw new Error('project not found');
      if (proj.kind !== 'song_teaser' && (proj.source_purged_at || !proj.source_url)) {
        throw new Error('The original video was cleaned up after 14 days of inactivity — upload it again to make new clips');
      }
      await admin.from('clips').update({
        status: 'rendering', error_message: null, attempts: 0, dispatched_at: nowIso(), updated_at: nowIso(),
      }).eq('id', clip_id);
      try {
        await dispatchClip(admin, proj, clip);
      } catch (e) {
        await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: nowIso() }).eq('id', clip_id);
        throw e;
      }
      return json({ success: true });
    }

    // Word-timed transcript for the caption editor.
    if (action === 'get_words') {
      const { project_id } = body;
      if (!project_id) throw new Error('Missing project_id');
      const { data: proj } = await admin.from('clip_projects').select('transcript').eq('id', project_id).single();
      if (!proj) throw new Error('project not found');
      return json({ success: true, words: proj.transcript?.words || [] });
    }

    // Fix misheard words (names!) or CROSS WORDS OUT before rendering.
    // Text edits patch word text only — timings stay untouched so caption
    // sync is preserved. `cut: true` marks a word for removal from audio,
    // video and captions of every clip rendered after the save. Rendered
    // clips keep their old edit; every render after this uses the new state.
    if (action === 'update_transcript') {
      const { project_id, edits } = body;
      if (!project_id) throw new Error('Missing project_id');
      if (!Array.isArray(edits) || !edits.length) throw new Error('No edits given');
      if (edits.length > 500) throw new Error('Too many edits in one save');
      const { data: proj } = await admin.from('clip_projects').select('transcript').eq('id', project_id).single();
      if (!proj?.transcript?.words) throw new Error('project has no transcript');
      const wordsArr = [...proj.transcript.words];
      let applied = 0;
      for (const e of edits) {
        const i = Number(e?.i);
        if (!Number.isInteger(i) || i < 0 || i >= wordsArr.length) continue;
        const word = String(e?.word ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
        const hasCut = typeof e?.cut === 'boolean';
        if (!word && !hasCut) continue;
        const next: any = { ...wordsArr[i] };
        if (word) next.word = word;
        if (hasCut) { if (e.cut) next.cut = true; else delete next.cut; }
        wordsArr[i] = next;
        applied++;
      }
      if (!applied) throw new Error('No valid edits to apply');
      const text = wordsArr.filter((w: any) => !w.cut).map((w: any) => String(w.word).trim()).join(' ');
      const { error: te } = await admin.from('clip_projects').update({
        transcript: { ...proj.transcript, words: wordsArr, text },
        updated_at: nowIso(),
      }).eq('id', project_id);
      if (te) throw new Error(te.message);
      return json({ success: true, applied });
    }

    // ---- presets: save / list / delete the owner's looks -----------------
    if (action === 'preset_save') {
      const name = String(body.name || '').trim().slice(0, 60);
      const config = body.config && typeof body.config === 'object' ? body.config : null;
      if (!name || !config) throw new Error('Preset needs a name and a config');
      const { data, error } = await admin.from('clip_presets').insert({ name, config }).select('id, name').single();
      if (error) throw new Error(error.message);
      return json({ success: true, preset: data });
    }
    if (action === 'preset_list') {
      const { data } = await admin.from('clip_presets').select('id, name, config').order('created_at', { ascending: true }).limit(20);
      return json({ success: true, presets: data || [] });
    }
    if (action === 'preset_delete') {
      if (!body.id) throw new Error('Missing id');
      await admin.from('clip_presets').delete().eq('id', body.id);
      return json({ success: true });
    }

    // ---- script studio: real customer questions + AI scripts -------------
    // Top questions customers actually asked in the last 14 days, straight
    // from the SMS/WhatsApp inbox.
    if (action === 'week_questions') {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
      const { data: msgs } = await admin.from('sms_messages')
        .select('body')
        .eq('direction', 'inbound')
        .gte('created_at', since)
        .not('body', 'is', null)
        .order('created_at', { ascending: false })
        .limit(400);
      const bodies = (msgs || []).map((m: any) => String(m.body).trim()).filter((b: string) => b.length > 8);
      if (bodies.length < 5) return json({ success: true, questions: [] });
      if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          system:
            'These are real inbound customer messages for a personalized-song gift business. ' +
            'Extract the 5-8 most common QUESTIONS or DOUBTS customers have (in Spanish, phrased as a customer would ask them), with a rough count of how many messages touch each. ' +
            'Ignore order-specific chatter (names, links, thanks). Call the tool.',
          messages: [{ role: 'user', content: bodies.join('\n---\n').slice(0, 40000) }],
          tools: [{
            name: 'questions',
            description: 'The common customer questions.',
            input_schema: {
              type: 'object',
              properties: {
                questions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { q: { type: 'string' }, count: { type: 'number' } },
                    required: ['q', 'count'],
                  },
                },
              },
              required: ['questions'],
            },
          }],
          tool_choice: { type: 'tool', name: 'questions' },
        }),
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}`);
      const data = await resp.json();
      const qs = (data.content || []).find((b: any) => b.type === 'tool_use')?.input?.questions;
      return json({
        success: true,
        questions: (Array.isArray(qs) ? qs : [])
          .map((x: any) => ({ q: String(x.q || '').slice(0, 200), count: Number(x.count) || 1 }))
          .filter((x: any) => x.q).slice(0, 8),
      });
    }

    // 60-second on-camera script in the brand voice, with 3 hook options.
    if (action === 'write_script') {
      const topic = String(body.topic || '').trim().slice(0, 300);
      if (!topic) throw new Error('Missing topic');
      if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: CLIP_AI_MODEL,
          max_tokens: 1500,
          system:
            brandContext() + '\n\n' +
            'You write 60-second ON-CAMERA scripts the OWNER reads to a phone camera for TikTok/Reels — warm, direct, natural spoken Spanish (not ad-speak). ' +
            'Structure: hook (first line must stop the scroll), the answer/story in plain words, one soft call-to-action at the end. ' +
            '140-170 words total so it reads in 55-70 seconds. Short sentences — this is read from a teleprompter. ' +
            'Give 3 alternative HOOK first-lines plus the full script. The script MUST start with hook #1 on its own first line (so the app can swap hooks). Call the tool.',
          messages: [{ role: 'user', content: `Topic / customer question: ${topic}` }],
          tools: [{
            name: 'script',
            description: 'The hooks and the script.',
            input_schema: {
              type: 'object',
              properties: {
                hooks: { type: 'array', items: { type: 'string' } },
                script: { type: 'string' },
              },
              required: ['hooks', 'script'],
            },
          }],
          tool_choice: { type: 'tool', name: 'script' },
        }),
      });
      if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json();
      const out = (data.content || []).find((b: any) => b.type === 'tool_use')?.input;
      if (!out?.script) throw new Error('No script returned');
      return json({
        success: true,
        hooks: (Array.isArray(out.hooks) ? out.hooks : []).map((h: unknown) => String(h).slice(0, 160)).slice(0, 3),
        script: String(out.script).slice(0, 2500),
      });
    }

    if (action === 'music_delete') {
      const name = String(body.name || '').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
      if (!name || !/\.(mp3|m4a|aac)$/i.test(name)) throw new Error('Invalid track name');
      const { error: de } = await admin.storage.from(BUCKET).remove([`music/${name}`]);
      if (de) throw new Error(de.message);
      return json({ success: true });
    }

    if (action === 'sign_music') {
      const name = String(body.filename || 'track.mp3').replace(/[^a-z0-9._-]/gi, '_').slice(0, 80);
      if (!/\.(mp3|m4a|aac)$/i.test(name)) throw new Error('Music must be an MP3/M4A file');
      const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(`music/${name}`, { upsert: true });
      if (se) throw new Error(`sign: ${se.message}`);
      return json({ success: true, signed_url: signed.signedUrl, path: `music/${name}` });
    }

    if (action === 'music_list') {
      const { data: tracks } = await admin.storage.from(BUCKET).list('music');
      return json({ success: true, tracks: (tracks || []).map((f: any) => f.name).filter((n: string) => /\.(mp3|m4a|aac)$/i.test(n)) });
    }

    if (action === 'send_to_creative') {
      const { clip_id } = body;
      if (!clip_id) throw new Error('Missing clip_id');
      const { data: clip } = await admin.from('clips').select('id, project_id, label, video_url, status, aspect, start_sec, end_sec').eq('id', clip_id).single();
      if (!clip) throw new Error('clip not found');
      if (clip.status !== 'ready' || !clip.video_url) throw new Error('Clip is not ready yet');
      const { data: proj } = await admin.from('clip_projects').select('title, transcript').eq('id', clip.project_id).single();
      const name = clip.label || proj?.title || 'Clip Studio clip';

      // Auto description: Claude writes the post caption + hashtags from what
      // is actually said in the clip. Falls back to the clip name on failure.
      let caption = name;
      let hashtags: string[] | null = null;
      try {
        const words = (proj?.transcript?.words || []) as Array<{ word: string; start: number; end: number }>;
        const said = words
          .filter((w) => w.end > Number(clip.start_sec) && w.start < (clip.end_sec != null ? Number(clip.end_sec) : Infinity))
          .map((w) => w.word.trim()).join(' ').slice(0, 2500);
        if (ANTHROPIC_API_KEY && said.length > 40) {
          const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 400,
              system:
                'You write social post captions for Regalos Que Cantan (personalized song gifts, warm Spanish-speaking brand). ' +
                'Given what is said in a short video clip, write ONE caption in the language of the clip: a scroll-stopping first line, 1-2 short warm sentences, no links, no emoji spam (max 2 emoji). ' +
                'Also give 4-6 relevant hashtags (no # in the strings). Call the tool.',
              messages: [{ role: 'user', content: `Clip title: ${name}\nWhat is said:\n${said}` }],
              tools: [{
                name: 'post',
                description: 'The caption and hashtags.',
                input_schema: {
                  type: 'object',
                  properties: {
                    caption: { type: 'string' },
                    hashtags: { type: 'array', items: { type: 'string' } },
                  },
                  required: ['caption', 'hashtags'],
                },
              }],
              tool_choice: { type: 'tool', name: 'post' },
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            const out = (data.content || []).find((b: any) => b.type === 'tool_use')?.input;
            if (out?.caption) caption = String(out.caption).slice(0, 900);
            if (Array.isArray(out?.hashtags)) hashtags = out.hashtags.map((h: unknown) => String(h).replace(/^#/, '').slice(0, 40)).slice(0, 6);
          }
        }
      } catch (e) { console.warn('auto description failed:', (e as Error).message); }

      const { error: qe } = await admin.from('creative_queue').insert({
        kind: 'video',
        status: 'ready',
        // Must be 'social' or 'ad' — the Creative Studio review views filter on
        // exactly these (an earlier 'organic' made sent clips invisible).
        intended_use: 'social',
        batch_date: new Date().toISOString().slice(0, 10),
        concept: `Clip Studio — ${name}`,
        caption,
        ...(hashtags ? { hashtags } : {}),
        media_url: clip.video_url,
        design: { source: 'clip-studio', clip_id: clip.id, aspect: clip.aspect },
      });
      if (qe) throw new Error(qe.message);
      // Mark the clip so the UI shows it's already in the approval queue.
      await admin.from('clips').update({ sent_to_creative_at: nowIso(), updated_at: nowIso() }).eq('id', clip_id);
      return json({ success: true });
    }

    if (action === 'delete_clip') {
      const { clip_id } = body;
      if (!clip_id) throw new Error('Missing clip_id');
      const { data: clip } = await admin.from('clips').select('id, storage_path').eq('id', clip_id).single();
      if (clip?.storage_path) await admin.storage.from(BUCKET).remove([clip.storage_path]).catch?.(() => {});
      await admin.from('clips').delete().eq('id', clip_id);
      return json({ success: true });
    }

    if (action === 'delete_project') {
      const { project_id } = body;
      if (!project_id) throw new Error('Missing project_id');
      // best-effort storage cleanup: source + audio + rendered clips
      const paths: string[] = [];
      const { data: root } = await admin.storage.from(BUCKET).list(project_id);
      (root || []).forEach((f: any) => { if (f.name) paths.push(`${project_id}/${f.name}`); });
      const { data: sub } = await admin.storage.from(BUCKET).list(`${project_id}/clips`);
      (sub || []).forEach((f: any) => { if (f.name) paths.push(`${project_id}/clips/${f.name}`); });
      if (paths.length) await admin.storage.from(BUCKET).remove(paths);
      await admin.from('clip_projects').delete().eq('id', project_id); // clips cascade
      return json({ success: true });
    }

    return json({ success: false, error: 'unknown action' }, 400);
  } catch (e: any) {
    console.error('clip-studio error:', e.message);
    return json({ success: false, error: e.message }, 500);
  }
});
