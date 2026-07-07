// supabase/functions/song-fix-queue/index.ts
//
// Backs the "Pending fixes" queue at the top of the admin dashboard "Fix Song"
// tab (src/pages/AdminDashboard.jsx → FixQueue). It is the second, OWNER-ONLY
// approval gate for customer-requested song changes:
//
//   1. The CS AI agent proposes a fix on its draft; the owner approving that
//      draft in the Messages inbox inserts a song_fix_requests row (see
//      sms-admin approve-draft). The request lands here as status='pending'.
//   2. The owner OR an assistant (Ivan) claims it and does the fix in the
//      existing Fix Song workflow, then STAGES the result here: the corrected
//      audio is hosted in the `audio` bucket and recorded on the request, but
//      the customer's live song is NOT touched (status='awaiting_approval').
//   3. Only the OWNER (role='admin') can RELEASE it — that is the swap into the
//      customer's live song, with the same fix_backup undo snapshot the direct
//      Fix Song apply takes. Assistants can prepare fixes but never release them.
//
// Auth is identical to sms-admin / admin-songs: the platform gateway verifies
// the Supabase Auth JWT (config.toml has [functions.song-fix-queue] verify_jwt =
// true) and the handler requires a row in admin_users. 'assistant' may list /
// claim / stage / reject; 'release' requires role='admin'.
//
// Actions (POST JSON unless noted):
//   GET or { action:'list' }                         → { success, role, requests }
//   { action:'claim',   request_id }                 → status pending→in_progress
//   { action:'unclaim', request_id }                 → status in_progress→pending
//   { action:'link-song', request_id, song_id }      → attach the song to fix
//   multipart: request_id + audio + fullLyrics + summary + corrections + mode
//                                                    → STAGE a surgical (spliced) fix
//   { action:'stage-remote', request_id, remote_audio_url, fullLyrics, summary,
//     corrections, mode }                            → STAGE a full re-roll (re-hosts the URL)
//   { action:'release', request_id }   (admin only)  → swap the staged audio live
//   { action:'reject',  request_id, reason }         → close without changing the song
//   { action:'create',  song_id?, conversation_id?, customer_request } → add manually
//
// Deploy with: supabase functions deploy song-fix-queue --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const AUDIO_BUCKET = 'audio';
const OPEN_STATUSES = ['pending', 'in_progress', 'awaiting_approval'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Host raw MP3 bytes in the `audio` bucket and return a stable public URL.
// deno-lint-ignore no-explicit-any
async function hostAudio(admin: any, requestId: string, bytes: Uint8Array): Promise<string> {
  const objectPath = `songs/fix-request-${requestId}-${Date.now()}.mp3`;
  const up = await admin.storage.from(AUDIO_BUCKET).upload(objectPath, bytes, {
    contentType: 'audio/mpeg',
    upsert: true,
  });
  if (up.error) throw new Error(`upload failed: ${up.error.message}`);
  return admin.storage.from(AUDIO_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

// Swap a STAGED candidate into the customer's live song, snapshotting the prior
// state for undo — the same mechanics as the direct "Fix Song" apply. The
// applied audio is a hosted MP3 (not a Kie track), so we drop the Kie ids: a
// future fix on this song re-rolls fresh rather than editing a stale section.
// deno-lint-ignore no-explicit-any
async function releaseCandidate(admin: any, reqRow: any, approver: string): Promise<{ audioUrl: string }> {
  const songId = reqRow.song_id;
  const candidateUrl = reqRow.candidate_audio_url;
  if (!songId) throw new Error('This request has no song linked yet.');
  if (!candidateUrl) throw new Error('No staged fix to release.');

  const { data: prev } = await admin
    .from('songs')
    .select('audio_url, preview_url, original_audio_url, image_url, lyrics, kie_task_id, task_id, kie_payload, kie_source, fix_corrections, provider, lyrics_timestamps, fixed_at, fix_count, fix_history')
    .eq('id', songId)
    .single();

  const now = new Date().toISOString();
  const meta = reqRow.candidate_meta || {};
  const mode = meta.mode === 'full' ? 'full' : 'section';
  const prevHistory = Array.isArray(prev?.fix_history) ? prev.fix_history : [];
  const update: Record<string, unknown> = {
    audio_url: candidateUrl,
    preview_url: candidateUrl,
    original_audio_url: candidateUrl,
    status: 'completed',
    needs_reupload: true,
    error_message: null,
    lyrics_timestamps: null,
    kie_task_id: null,
    task_id: null,
    kie_payload: null,
    fixed_at: now,
    fix_count: (Number(prev?.fix_count) || 0) + 1,
    fix_history: [...prevHistory, {
      at: now,
      note: reqRow.candidate_summary || 'Customer-requested fix',
      mode,
      via: 'fix-queue',
    }],
    // kie_source intentionally preserved (not in `update`) so a future surgical
    // fix can still re-sing from the original voice-track.
    fix_backup: prev ? { ...prev, backed_up_at: now } : null,
  };
  if (reqRow.candidate_lyrics && String(reqRow.candidate_lyrics).trim()) {
    update.lyrics = reqRow.candidate_lyrics;
  }
  if (Array.isArray(meta.corrections)) update.fix_corrections = meta.corrections;

  const { error } = await admin.from('songs').update(update).eq('id', songId);
  if (error) throw new Error(`release failed: ${error.message}`);

  await admin.from('song_fix_requests').update({
    status: 'done',
    approved_by: approver,
    resolved_at: now,
  }).eq('id', reqRow.id);

  return { audioUrl: candidateUrl };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Auth: JWT + admin_users role (same as sms-admin / admin-songs) ──────
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userData.user.id)
      .single();
    if (roleErr || !roleRow) return json({ success: false, error: 'No admin access' }, 403);
    const role = roleRow.role as 'admin' | 'assistant';
    const actor = userData.user.email || userData.user.id;

    // ── Multipart = STAGE a surgical (browser-spliced) fix ──────────────────
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      let form: FormData;
      try { form = await req.formData(); } catch (e) {
        return json({ success: false, error: `bad multipart: ${e instanceof Error ? e.message : e}` }, 400);
      }
      const requestId = String(form.get('request_id') || '');
      const file = form.get('audio');
      if (!requestId || !file || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
        return json({ success: false, error: 'request_id and audio are required' }, 400);
      }
      const { data: reqRow } = await admin.from('song_fix_requests').select('id, song_id').eq('id', requestId).single();
      if (!reqRow) return json({ success: false, error: 'Request not found' }, 404);

      const bytes = new Uint8Array(await (file as Blob).arrayBuffer());
      if (!bytes.length) return json({ success: false, error: 'empty audio' }, 400);
      const publicUrl = await hostAudio(admin, requestId, bytes);

      let corrections: unknown = null;
      if (form.get('corrections')) { try { corrections = JSON.parse(String(form.get('corrections'))); } catch { corrections = null; } }
      const meta = { mode: String(form.get('mode') || 'section'), corrections: Array.isArray(corrections) ? corrections : null };

      const { error: upErr } = await admin.from('song_fix_requests').update({
        candidate_audio_url: publicUrl,
        candidate_lyrics: form.get('fullLyrics') ? String(form.get('fullLyrics')) : null,
        candidate_summary: form.get('summary') ? String(form.get('summary')) : null,
        candidate_meta: meta,
        ...(reqRow.song_id ? {} : (form.get('songId') ? { song_id: String(form.get('songId')) } : {})),
        status: 'awaiting_approval',
        worked_by: actor,
        staged_at: new Date().toISOString(),
      }).eq('id', requestId);
      if (upErr) return json({ success: false, error: upErr.message }, 500);
      return json({ success: true, candidate_audio_url: publicUrl });
    }

    // ── JSON actions ────────────────────────────────────────────────────────
    let body: Record<string, any> = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const action = body.action || 'list';

    if (action === 'list') {
      const { data: open } = await admin
        .from('song_fix_requests')
        .select('*')
        .in('status', OPEN_STATUSES)
        .order('created_at', { ascending: false })
        .limit(200);
      const { data: recent } = await admin
        .from('song_fix_requests')
        .select('*')
        .in('status', ['done', 'rejected'])
        .order('resolved_at', { ascending: false })
        .limit(25);
      const requests = [...(open || []), ...(recent || [])];

      // Merge in a little song info for display (recipient, current audio, etc).
      const songIds = [...new Set(requests.map((r) => r.song_id).filter(Boolean))];
      let songsById: Record<string, unknown> = {};
      if (songIds.length) {
        const { data: songs } = await admin
          .from('songs')
          .select('id, recipient_name, sender_name, email, genre, genre_name, audio_url, created_at, fixed_at, fix_count')
          .in('id', songIds);
        songsById = (songs || []).reduce((acc: Record<string, unknown>, s) => { acc[String(s.id)] = s; return acc; }, {});
      }
      const enriched = requests.map((r) => ({ ...r, song: r.song_id ? (songsById[String(r.song_id)] || null) : null }));
      return json({ success: true, role, requests: enriched });
    }

    if (action === 'claim') {
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { error } = await admin.from('song_fix_requests')
        .update({ status: 'in_progress', worked_by: actor })
        .eq('id', id).eq('status', 'pending');
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    if (action === 'unclaim') {
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { error } = await admin.from('song_fix_requests')
        .update({ status: 'pending' })
        .eq('id', id).eq('status', 'in_progress');
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    if (action === 'link-song') {
      const id = body.request_id;
      const songId = body.song_id;
      if (!id || !songId) return json({ success: false, error: 'request_id and song_id required' }, 400);
      const { error } = await admin.from('song_fix_requests').update({ song_id: songId }).eq('id', id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // STAGE a full re-roll: re-host the (temporary) Kie track URL so it survives
    // until the owner releases it.
    if (action === 'stage-remote') {
      const id = body.request_id;
      const remoteUrl = body.remote_audio_url;
      if (!id || !remoteUrl) return json({ success: false, error: 'request_id and remote_audio_url required' }, 400);
      const { data: reqRow } = await admin.from('song_fix_requests').select('id, song_id').eq('id', id).single();
      if (!reqRow) return json({ success: false, error: 'Request not found' }, 404);

      const resp = await fetch(remoteUrl);
      if (!resp.ok) return json({ success: false, error: `could not fetch audio (${resp.status})` }, 502);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      if (!bytes.length) return json({ success: false, error: 'fetched audio is empty' }, 502);
      const publicUrl = await hostAudio(admin, id, bytes);

      const corrections = Array.isArray(body.corrections) ? body.corrections : null;
      const { error } = await admin.from('song_fix_requests').update({
        candidate_audio_url: publicUrl,
        candidate_lyrics: body.fullLyrics || null,
        candidate_summary: body.summary || null,
        candidate_meta: { mode: body.mode || 'full', corrections },
        ...(reqRow.song_id ? {} : (body.songId ? { song_id: body.songId } : {})),
        status: 'awaiting_approval',
        worked_by: actor,
        staged_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, candidate_audio_url: publicUrl });
    }

    if (action === 'release') {
      // OWNER-ONLY gate. Assistants can prepare fixes but never push them live.
      if (role !== 'admin') return json({ success: false, error: 'Only the owner can release a fix to the customer.' }, 403);
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { data: reqRow } = await admin.from('song_fix_requests').select('*').eq('id', id).single();
      if (!reqRow) return json({ success: false, error: 'Request not found' }, 404);
      if (reqRow.status !== 'awaiting_approval') {
        return json({ success: false, error: 'This request is not staged for approval.' }, 409);
      }
      try {
        const out = await releaseCandidate(admin, reqRow, actor);
        return json({ success: true, audio_url: out.audioUrl, song_id: reqRow.song_id });
      } catch (e) {
        return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (action === 'reject') {
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { error } = await admin.from('song_fix_requests').update({
        status: 'rejected',
        approved_by: actor,
        reject_reason: body.reason ? String(body.reason).slice(0, 500) : null,
        resolved_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    if (action === 'create') {
      const customerRequest = String(body.customer_request || '').trim();
      if (!customerRequest) return json({ success: false, error: 'customer_request required' }, 400);
      const { data: inserted, error } = await admin.from('song_fix_requests').insert({
        song_id: body.song_id || null,
        conversation_id: body.conversation_id || null,
        customer_request: customerRequest,
        context: { source: 'owner', created_by_email: actor },
        status: 'pending',
        created_by: actor,
      }).select('id').single();
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, id: inserted?.id });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
