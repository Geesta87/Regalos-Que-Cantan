// supabase/functions/regenerate-paid-song-kie/index.ts
//
// Targeted, in-place re-generation of an ALREADY-PAID song pair through
// Kie.ai (Suno) ONLY — used when a customer asks for a small lyric/detail
// edit (e.g. a wrong year) after their song was generated on the Suno
// fallback. Unlike recover-mureka-cap-songs (which picks failed candidates,
// inserts a NEW v2, and emails a "buy for $29.99" preview), this function:
//
//   • edits the two EXISTING rows in place (v1 + v2), preserving paid /
//     paid_at / stripe_session_id / version, so the customer's existing
//     /song/<id> link simply starts playing the corrected song;
//   • sends NO email (the built-in preview email is a buy-prompt, wrong for
//     a paying customer) — the owner reviews the result and notifies the
//     customer separately;
//   • re-uses the proven submitToKie + pollKieUntilDone flow from
//     recover-mureka-cap-songs, plus the gender-prefix / negative-tag /
//     styleWeight tuning from generate-song's callKieProvider so the
//     corrected re-run matches how the original paid song was produced.
//
// Body: { v1Id, v2Id, lyrics, details? }  (lyrics already corrected by caller)
//   - track[0] -> v1Id (version 1), track[1] -> v2Id (version 2)
//
// Invoked manually from admin/CLI (no user JWT) — verify_jwt = false, called
// with the anon/publishable key as Bearer. KIE_API_KEY only exists in the
// edge runtime, which is why this runs as a function rather than a script.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
// V5_5 only — V4_5 failed the 2026-06-12 regional-Mexican bake-off.
const KIE_MODEL = Deno.env.get('KIE_MODEL') || 'V5_5';

// Strip the inline English prosody cue (e.g. "(spoken, no melody, …)") that the
// genre prompts inject on [Hablado] lines. Suno/Mureka treat any parenthetical
// as content and sing it aloud — most audibly at the start of corridos. Legacy
// songs stored before generate-song was fixed still carry the cue, so scrub it
// on regeneration too. Mirrors generate-song's stripSpokenProsodyCue.
function stripSpokenProsodyCue(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/[ \t]*\(\s*spoken[^)]*\)/gi, '')
    // Drop leaked lowercase fill-in placeholders ([lugar], [nombre], …); real
    // section markers are always capitalized, so a lowercase bracket is an
    // instruction artifact the model would otherwise sing. Mirrors generate-song.
    .replace(/[ \t]*\[[a-záéíóúñ][^\]]*\]/g, '')
    .replace(/[ \t]+$/gm, '');
}

// Translate Spanish section markers so Suno recognizes the structure — same
// mapping generate-song applies before sending to Kie.
function englishifyLyricsMarkers(lyrics: string): string {
  if (!lyrics) return lyrics;
  return stripSpokenProsodyCue(lyrics)
    .replace(/\[Verso Final\]/gi, '[Final Verse]')
    .replace(/\[Verso (\d+)\]/gi, '[Verse $1]')
    .replace(/\[Verso\]/gi, '[Verse]')
    .replace(/\[Coro Final\]/gi, '[Final Chorus]')
    .replace(/\[Coro\]/gi, '[Chorus]')
    .replace(/\[Puente\]/gi, '[Bridge]')
    .replace(/\[Pre-Coro\]/gi, '[Pre-Chorus]')
    .replace(/\[Hablado\]/gi, '[Spoken Word]');
}

interface KieTrack {
  id?: string;
  audioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  modelName?: string;
}

// Mirrors generate-song's callKieProvider payload (gender prefix at the front
// of the style for positional priority, opposite-gender negatives, and the
// styleWeight/weirdness/audioWeight tuning) so the corrected re-run sounds like
// the original paid generation rather than the leaner recover-* path.
async function submitToKie(
  lyrics: string,
  title: string,
  styleUsed: string,
  voiceType: string,
  callbackUrl: string,
): Promise<{ taskId: string; styleSent: string }> {
  const vocalGender: 'm' | 'f' = voiceType === 'female' ? 'f' : 'm';
  const genderLabel = vocalGender === 'f'
    ? 'solo female vocalist, female voice'
    : 'solo male vocalist, male voice, masculine vocal';
  const oppositeGenderTags = vocalGender === 'f'
    ? 'male voice, male vocal, baritone, bass voice, deep male voice'
    : 'female voice, female vocal, soprano, female harmony, high female voice';

  // Suno is English-trained and non-deterministic — some takes drift into
  // English ad-libs / English-accented vocals even with all-Spanish lyrics.
  // The site is Spanish-only, so pin the language hard: reinforce in the style
  // AND block English explicitly in the negatives.
  const languageTags = 'Spanish-language vocals, sung entirely in Spanish, letra completamente en español, Mexican Spanish pronunciation';
  const englishNegatives = 'English lyrics, English language, English vocals, English words, spoken English, English ad-libs';

  const style = `${genderLabel}, ${languageTags}, ${styleUsed}`.substring(0, 1000);
  const safeLyrics = englishifyLyricsMarkers(lyrics).substring(0, 5000);

  const payload: Record<string, unknown> = {
    prompt: safeLyrics,
    customMode: true,
    instrumental: false,
    model: KIE_MODEL,
    callBackUrl: callbackUrl,
    style,
    title: title.substring(0, 80),
    vocalGender,
    negativeTags: `${oppositeGenderTags}, ${englishNegatives}`.substring(0, 200),
    styleWeight: 0.85,
    weirdnessConstraint: 0.3,
    audioWeight: 0.7,
  };

  const resp = await fetch('https://api.kie.ai/api/v1/generate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'unknown');
    throw new Error(`kie.ai generate ${resp.status}: ${errText.substring(0, 200)}`);
  }
  const data = await resp.json();
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`kie.ai code=${data.code}: ${data.msg || 'no taskId'}`);
  }
  return { taskId: data.data.taskId, styleSent: style };
}

async function pollKieUntilDone(taskId: string, maxAttempts = 24, intervalMs = 8000): Promise<KieTrack[]> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
    });
    if (!resp.ok) {
      console.warn(`Poll ${attempt}/${maxAttempts}: HTTP ${resp.status}`);
    } else {
      const json = await resp.json();
      const status = json?.data?.status;
      const tracks: KieTrack[] = json?.data?.response?.sunoData ?? [];
      console.log(`Poll ${attempt}/${maxAttempts}: status=${status}, tracks=${tracks.length}`);

      if (status === 'SUCCESS') return tracks;

      if (status === 'GENERATE_AUDIO_FAILED' || status === 'CREATE_TASK_FAILED' || status === 'SENSITIVE_WORD_ERROR' || status === 'CALLBACK_EXCEPTION') {
        throw new Error(`kie.ai task ${taskId} ended in status ${status}`);
      }
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`kie.ai task ${taskId} did not complete within ${(maxAttempts * intervalMs) / 1000}s`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ======================================================================
    // MODE 2 — KIE COMPLETION CALLBACK (this function registers ITSELF as the
    // callBackUrl on the Kie job). Identified by a Kie payload (data.task_id)
    // with no v1Id. Swaps the new audio onto the EXISTING paid rows in place:
    // NO email, and status stays 'completed' so the customer keeps the old
    // audio until the new one lands. This replaces the old synchronous poll,
    // which got killed at the 150s gateway timeout on slow renders and silently
    // left the OLD recording while the DB read "done".
    // ======================================================================
    if (!body?.v1Id && body?.data?.task_id) {
      const taskId: string = body.data.task_id;
      const callbackType: string | undefined = body?.data?.callbackType;
      const tracks: any[] = Array.isArray(body?.data?.data) ? body.data.data : [];

      // Only act on terminal stages (Kie sends text→first→complete).
      if (callbackType !== 'complete' && callbackType !== 'error' && body.code === 200) {
        return new Response(JSON.stringify({ ok: true, action: 'stage_ignored', stage: callbackType }),
          { headers: responseHeaders, status: 200 });
      }

      // The re-sing task_id is unique to the rows we stamped at initiate time.
      const { data: rows } = await supabase
        .from('songs')
        .select('id, version, regenerate_count, original_audio_url')
        .eq('kie_task_id', taskId);

      if (!rows || rows.length === 0) {
        console.warn(`[REGEN-CB] no rows for task ${taskId}`);
        return new Response(JSON.stringify({ ok: true, action: 'no_matching_rows', taskId }),
          { headers: responseHeaders, status: 200 });
      }

      // Re-sing failed on Kie: keep the customer's existing audio untouched.
      if (callbackType === 'error' || body.code !== 200) {
        const errMsg = (body.msg || `kie code=${body.code}`).toString().substring(0, 300);
        for (const r of rows) {
          await supabase.from('songs').update({ error_message: `REGEN failed: ${errMsg}` }).eq('id', r.id);
        }
        console.error(`[REGEN-CB] task ${taskId} failed: ${errMsg} — kept old audio`);
        return new Response(JSON.stringify({ ok: true, action: 'regen_failed', error: errMsg }),
          { headers: responseHeaders, status: 200 });
      }

      // COMPLETE — map track[version-1] -> row and swap in place.
      const results: any[] = [];
      for (const r of rows) {
        const track = tracks[(r.version || 1) - 1];
        if (!track?.audio_url) { results.push({ id: r.id, action: 'no_track' }); continue; }
        // Idempotent: a Kie retry re-delivering the same track is a no-op.
        if (r.original_audio_url === track.audio_url) { results.push({ id: r.id, action: 'already_applied' }); continue; }
        const { error: uErr } = await supabase.from('songs').update({
          audio_url: track.audio_url,
          preview_url: track.audio_url,
          original_audio_url: track.audio_url,
          ...(track.image_url ? { image_url: track.image_url } : {}),
          status: 'completed',
          needs_reupload: true,   // poll-processing-songs re-hosts (upsert) to permanent storage
          kie_payload: JSON.stringify(track),
          provider: 'kie',
          error_message: null,
          regenerate_count: (r.regenerate_count || 0) + 1,
        }).eq('id', r.id);
        results.push({ id: r.id, version: r.version, action: uErr ? `error: ${uErr.message}` : 'swapped' });
      }
      console.log(`[REGEN-CB] task ${taskId} applied: ${JSON.stringify(results)}`);
      return new Response(JSON.stringify({ ok: true, action: 'regen_applied', results }),
        { headers: responseHeaders, status: 200 });
    }

    // ======================================================================
    // MODE 1 — INITIATE re-sing (admin/CLI). Persist corrected lyrics, submit
    // to Kie with THIS function as the callback, stamp the task_id on both rows,
    // and return IMMEDIATELY. No synchronous poll → no 150s timeout, so the
    // audio swap can't be silently lost. The callback (MODE 2) finishes it.
    // ======================================================================
    if (!KIE_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'KIE_API_KEY env var missing on Supabase' }),
        { headers: responseHeaders, status: 200 });
    }

    const v1Id: string | undefined = body?.v1Id;
    const v2Id: string | undefined = body?.v2Id;
    const lyrics: string | undefined = body?.lyrics;
    const details: string | undefined = body?.details;
    if (!v1Id || !lyrics) {
      return new Response(JSON.stringify({ ok: false, error: 'v1Id and lyrics are required' }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- Load the v1 row for style / voice / metadata ----
    const { data: v1, error: v1Err } = await supabase
      .from('songs')
      .select('id, recipient_name, voice_type, style_used, paid')
      .eq('id', v1Id)
      .single();
    if (v1Err || !v1) {
      return new Response(JSON.stringify({ ok: false, error: `v1 lookup failed: ${v1Err?.message || 'not found'}` }),
        { headers: responseHeaders, status: 200 });
    }
    if (!v1.style_used) {
      return new Response(JSON.stringify({ ok: false, error: 'v1 row is missing style_used' }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- Persist the corrected lyrics (+ details) on both rows up front ----
    const lyricEdit: Record<string, unknown> = { lyrics };
    if (typeof details === 'string') lyricEdit.details = details;
    await supabase.from('songs').update(lyricEdit).eq('id', v1Id);
    if (v2Id) await supabase.from('songs').update(lyricEdit).eq('id', v2Id);

    // ---- Submit to Kie with THIS function as the async callback ----
    const title = `Canción para ${v1.recipient_name || 'ti'}`;
    const callbackUrl = `${SUPABASE_URL}/functions/v1/regenerate-paid-song-kie`;
    let taskId: string, styleSent: string;
    try {
      ({ taskId, styleSent } = await submitToKie(lyrics, title, v1.style_used, v1.voice_type, callbackUrl));
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: `kie submit failed: ${e?.message || e}` }),
        { headers: responseHeaders, status: 200 });
    }
    console.log(`[REGEN] initiated task ${taskId} for v1=${v1Id} v2=${v2Id ?? 'none'} (async, awaiting callback)`);

    // ---- Stamp the task on both rows so the callback (MODE 2) finds them.
    // Keep status='completed' — the customer keeps the OLD audio until the swap. ----
    const stamp = { kie_task_id: taskId, task_id: taskId, provider: 'kie', error_message: null };
    await supabase.from('songs').update(stamp).eq('id', v1Id);
    if (v2Id) await supabase.from('songs').update(stamp).eq('id', v2Id);

    return new Response(JSON.stringify({
      ok: true,
      async: true,
      taskId,
      styleSent,
      v1Id,
      v2Id: v2Id ?? null,
      message: 'Re-sing started. The corrected audio swaps in automatically when Suno finishes (~1-3 min); the old audio keeps playing until then.',
      songLink: `https://regalosquecantan.com/song/${v1Id}`,
    }), { headers: responseHeaders, status: 200 });

  } catch (e: any) {
    console.error('[REGEN] error:', e?.message);
    return new Response(JSON.stringify({ ok: false, error: e?.message }),
      { headers: responseHeaders, status: 200 });
  }
});
