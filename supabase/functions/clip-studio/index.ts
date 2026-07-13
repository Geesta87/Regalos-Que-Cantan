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
//   create_project { title, ext }               -> row + signed upload URL
//   ingest        { project_id }                -> kick prepare (audio+duration) after upload
//   render_clip   { project_id, start_sec, end_sec, aspect, style, label }
//   delete_clip   { clip_id }
//   delete_project{ project_id }
//
// Auth: verify_jwt = true (admin JWT). Caller must be in admin_users — same
// pattern as admin-videos. Service-role for data.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RENDERER_URL = Deno.env.get('INHOUSE_RENDERER_URL');
const RENDER_TOKEN = Deno.env.get('RENDER_TOKEN') || '';

const BUCKET = 'clip-studio';
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/clip-studio-callback`;
const ASPECTS = ['9:16', '1:1', '16:9'];
const STYLES = ['boldpop', 'goldglow', 'cleanbox'];

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

async function dispatchRenderer(path: string, job: Record<string, unknown>) {
  if (!RENDERER_URL) throw new Error('INHOUSE_RENDERER_URL not configured');
  const res = await fetch(`${RENDERER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-render-token': RENDER_TOKEN },
    body: JSON.stringify(job),
  });
  if (res.status !== 202) throw new Error(`renderer ${path} replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
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
      const { data: proj, error } = await admin.from('clip_projects')
        .insert({ title, status: 'uploaded' }).select().single();
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

    if (action === 'render_clip') {
      const { project_id, start_sec, end_sec, aspect, style, label } = body;
      if (!project_id) throw new Error('Missing project_id');
      if (!ASPECTS.includes(aspect)) throw new Error(`aspect must be one of ${ASPECTS.join(', ')}`);
      if (!STYLES.includes(style)) throw new Error(`style must be one of ${STYLES.join(', ')}`);

      const { data: proj, error: pe } = await admin.from('clip_projects')
        .select('id, source_url, duration_sec, transcript, status').eq('id', project_id).single();
      if (pe || !proj) throw new Error('project not found');
      if (proj.status !== 'ready') throw new Error(`project is '${proj.status}', not ready`);
      const words = proj.transcript?.words;
      if (!Array.isArray(words) || words.length === 0) throw new Error('project has no transcript words');

      const start = Math.max(0, Number(start_sec) || 0);
      const end = Math.min(Number(end_sec) || Number(proj.duration_sec) || 0, Number(proj.duration_sec) || Infinity);
      if (end - start < 0.5) throw new Error('clip range too short');
      if (end - start > 180) throw new Error('Phase 1 caps clips at 3 minutes — pick a shorter range');

      const { data: clip, error: ce } = await admin.from('clips').insert({
        project_id, start_sec: start, end_sec: end, aspect, style,
        label: label ? String(label).slice(0, 120) : null, status: 'rendering',
      }).select().single();
      if (ce) throw new Error(ce.message);

      try {
        const outPath = `${project_id}/clips/${clip.id}.mp4`;
        const { data: signed, error: se } = await admin.storage.from(BUCKET).createSignedUploadUrl(outPath, { upsert: true });
        if (se) throw new Error(`sign output: ${se.message}`);
        await dispatchRenderer('/clip-render', {
          clip_id: clip.id, project_id, source_url: proj.source_url,
          start_sec: start, end_sec: end, aspect, style, words,
          bucket: BUCKET, callback_url: CALLBACK_URL,
          output_upload_url: signed.signedUrl, output_path: outPath,
          output_public_url: admin.storage.from(BUCKET).getPublicUrl(outPath).data.publicUrl,
        });
      } catch (e) {
        await admin.from('clips').update({ status: 'failed', error_message: (e as Error).message, updated_at: new Date().toISOString() }).eq('id', clip.id);
        throw e;
      }
      return json({ success: true, clip });
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
