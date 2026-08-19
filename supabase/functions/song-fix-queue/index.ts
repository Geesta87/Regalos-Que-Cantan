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
//   3. The owner OR Ivan (assistant) RELEASES it — the swap into the customer's
//      live song, with the same fix_backup undo snapshot the direct Fix Song
//      apply takes. (Release was originally owner-only; owner decision
//      2026-07-27 opened it to both admin_users roles.)
//
// Auth is identical to sms-admin / admin-songs: the platform gateway verifies
// the Supabase Auth JWT (config.toml has [functions.song-fix-queue] verify_jwt =
// true) and the handler requires a row in admin_users. Any admin_users row may
// list / claim / stage / release / reject; only role='admin' may flip the
// auto-fixer switch ('auto-toggle').
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
import { sendWhatsApp } from '../_shared/send-whatsapp.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const EMAIL_SENDER = 'hola@regalosquecantan.com';

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

// Append the new corrections to the ones already on the song (dedup by
// before→after) — same helper as fix-song-section. Every fix keeps the FULL
// list so later fixes can verify none of the earlier ones got reverted.
// deno-lint-ignore no-explicit-any
function mergeCorrections(prevList: unknown, newList: unknown): Array<{ before: string; after: string }> | null {
  const prev = Array.isArray(prevList) ? prevList : [];
  const next = Array.isArray(newList) ? newList : [];
  const out: Array<{ before: string; after: string }> = [];
  const seen = new Set<string>();
  for (const c of [...prev, ...next]) {
    // deno-lint-ignore no-explicit-any
    const before = String((c as any)?.before ?? '').trim();
    // deno-lint-ignore no-explicit-any
    const after = String((c as any)?.after ?? '').trim();
    if (!after) continue;
    const key = `${before}→${after}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ before, after });
  }
  return out.length ? out : null;
}

// Swap a STAGED candidate into the customer's live song, snapshotting the prior
// state for undo — the same mechanics as the direct "Fix Song" apply. When the
// staged audio is an UNTRIMMED whole Kie take, candidate_meta carries
// fixTaskId + fixAudioId and we chain future fixes off that take — without this,
// the next surgical fix re-sings from the PRISTINE original and silently REVERTS
// this one in the audio (2026-08-04: a queue-released Nov-13→14 date fix was
// undone by a later julio→agosto fix on the same songs). Stitched/trimmed audio
// is not a Kie track, so those releases still drop the Kie ids.
// deno-lint-ignore no-explicit-any
async function releaseCandidate(admin: any, reqRow: any, approver: string): Promise<{ audioUrl: string; staleArtifacts: string[] }> {
  const songId = reqRow.song_id;
  const candidateUrl = reqRow.candidate_audio_url;
  if (!songId) throw new Error('This request has no song linked yet.');
  if (!candidateUrl) throw new Error('No staged fix to release.');

  const { data: prev } = await admin
    .from('songs')
    .select('audio_url, preview_url, original_audio_url, image_url, lyrics, kie_task_id, task_id, kie_payload, kie_source, fix_corrections, provider, lyrics_timestamps, fixed_at, fix_count, fix_history, karaoke_url, lyric_video_url, karaoke_video_url, video_url')
    .eq('id', songId)
    .single();

  // Paid audio-derived deliverables the release invalidates but cannot rebuild
  // (no auto-rebuild exists for these) — reported back so staff re-run them by
  // hand. The direct-apply path already did this; queue releases silently left
  // a paid karaoke/lyric video rendered from the OLD audio with nobody told.
  const staleArtifacts: string[] = [];
  if (prev?.karaoke_url) staleArtifacts.push('karaoke');
  if (prev?.lyric_video_url) staleArtifacts.push('lyric_video');
  if (prev?.karaoke_video_url) staleArtifacts.push('karaoke_video');
  if (prev?.video_url) staleArtifacts.push('video_addon');

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
    // Whole-take release: chain future fixes off THIS take (fix-song-section's
    // resolveKieSource tries kie_task_id + kie_payload.id first) so a later
    // surgical fix re-sings from audio that already contains this correction.
    // Trimmed takes chain too — trimAtS marks the live song's true length.
    kie_task_id: meta.fixTaskId && meta.fixAudioId ? String(meta.fixTaskId) : null,
    task_id: meta.fixTaskId && meta.fixAudioId ? String(meta.fixTaskId) : null,
    kie_payload: meta.fixTaskId && meta.fixAudioId
      ? JSON.stringify({ id: String(meta.fixAudioId), audioUrl: candidateUrl, ...(Number(meta.fixTrimAtS) > 0 ? { trimAtS: Number(meta.fixTrimAtS) } : {}) })
      : null,
    // The share video replaces the audio player on the gift page and still has
    // the pre-fix audio baked in. Nulling it re-queues the row for
    // render-share-videos (which only picks up share_video_url IS NULL) so it
    // rebuilds against the released audio. Paid audio-derived upsells
    // (karaoke_url / lyric_video_url / karaoke_video_url) are left alone —
    // they have no auto-rebuild and must be re-run by hand.
    share_video_url: null,
    share_video_status: null,
    share_video_attempts: 0,
    share_video_error: null,
    share_video_dispatched_at: null,
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
  {
    // ACCUMULATE corrections (append new, keep prior) — replacing the list (or
    // leaving it null, as the whole-take path did before 2026-08-06) is what let
    // a later fix silently undo an earlier one.
    const merged = mergeCorrections(prev?.fix_corrections, meta.corrections);
    if (merged) update.fix_corrections = merged;
  }

  const { error } = await admin.from('songs').update(update).eq('id', songId);
  if (error) throw new Error(`release failed: ${error.message}`);

  await admin.from('song_fix_requests').update({
    status: 'done',
    approved_by: approver,
    resolved_at: now,
  }).eq('id', reqRow.id);

  return { audioUrl: candidateUrl, staleArtifacts };
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
      const meta = {
        mode: String(form.get('mode') || 'section'),
        corrections: Array.isArray(corrections) ? corrections : null,
        // Present when the staged audio is a whole Kie take — release uses these
        // to chain future fixes off the corrected take. fixTrimAtS marks where an
        // end-trimmed take was cut (the live song's true length).
        fixTaskId: form.get('fixTaskId') ? String(form.get('fixTaskId')) : null,
        fixAudioId: form.get('fixAudioId') ? String(form.get('fixAudioId')) : null,
        fixTrimAtS: Number(form.get('fixTrimAtS')) > 0 ? Number(form.get('fixTrimAtS')) : null,
      };

      const { data: upRows, error: upErr } = await admin.from('song_fix_requests').update({
        candidate_audio_url: publicUrl,
        candidate_lyrics: form.get('fullLyrics') ? String(form.get('fullLyrics')) : null,
        candidate_summary: form.get('summary') ? String(form.get('summary')) : null,
        candidate_meta: meta,
        ...(reqRow.song_id ? {} : (form.get('songId') ? { song_id: String(form.get('songId')) } : {})),
        status: 'awaiting_approval',
        worked_by: actor,
        staged_at: new Date().toISOString(),
      }).eq('id', requestId).in('status', OPEN_STATUSES).select('id'); // never stage onto a released ('done') request — that resurrects it for a second release
      if (upErr) return json({ success: false, error: upErr.message }, 500);
      if (!upRows?.length) return json({ success: false, error: 'This request was already resolved — nothing to stage onto.' }, 409);
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

    // ── Robot (fix-song-auto) controls — the kill switch used to be SQL-only ──
    if (action === 'auto-state') {
      const { data: st } = await admin.from('fix_auto_state').select('*').eq('id', 1).single();
      return json({ success: true, state: st || null });
    }
    if (action === 'auto-toggle') {
      if (role !== 'admin') return json({ success: false, error: 'Only the owner can switch the auto-fixer on/off.' }, 403);
      const enabled = !!body.enabled;
      const patch: Record<string, unknown> = { enabled, updated_at: new Date().toISOString() };
      // active_since gates which requests the robot may touch (future-only rule).
      // Set it on FIRST enable only — re-enabling keeps the original window. A
      // NULL active_since makes the worker silently process nothing (its cutoff
      // falls back to "now"), so never leave it unset while enabled.
      const { data: st } = await admin.from('fix_auto_state').select('active_since').eq('id', 1).single();
      if (enabled && !st?.active_since) patch.active_since = new Date().toISOString();
      const { error } = await admin.from('fix_auto_state').update(patch).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, enabled });
    }

    // ── SEND TO ACE — hand any open request (back) to the auto pipeline ─────
    // Replaces the SQL-only resets of 2026-08-10: needs_human cards, old
    // manual-era cards, and do-over-after-listening all get a one-tap "have
    // Ace redo it". An optional note becomes extra guidance for his
    // understanding step (e.g. "the intro was too long", "put the new line in
    // Verso 2"). Fully re-plans from scratch with fresh rounds.
    if (action === 'send-to-ace') {
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { data: reqRow } = await admin.from('song_fix_requests').select('id, customer_request, status, auto_plan').eq('id', id).single();
      if (!reqRow) return json({ success: false, error: 'Request not found' }, 404);
      // Any open OR rejected request may be handed to Ace; only released ones can't.
      if (reqRow.status === 'done') return json({ success: false, error: 'Already released — nothing for Ace to redo.' }, 409);
      const note = String(body.note || '').trim();
      const patch: Record<string, unknown> = {
        status: 'pending',
        intake_complete: true,
        auto_status: null,
        auto_round: 0,
        auto_error: null,
        auto_takes: [],
        // PRESERVE THE OWNER'S RESTRICTIONS across the reset (2026-08-17):
        // noAutoFull means the owner approved a SECTION fix and refused a full
        // re-roll. Nulling auto_plan let one 'Have Ace redo it' tap launder that
        // away — Ace re-planned from scratch and could stage the very re-roll
        // the owner said no to. stepPlan merges these flags into its new plan.
        auto_plan: (reqRow.auto_plan?.noAutoFull || reqRow.auto_plan?.handoff)
          ? { ...(reqRow.auto_plan?.noAutoFull ? { noAutoFull: true } : {}), ...(reqRow.auto_plan?.handoff ? { handoff: true } : {}) }
          : null,
        auto_task_id: null,
        fix_spec: null,
        candidate_audio_url: null,
        candidate_lyrics: null,
        candidate_summary: null,
        candidate_meta: null,
        staged_at: null,
        worked_by: null,
        reject_reason: null,
        // The worker only picks up requests newer than fix_auto_state.active_since
        // (future-only rule). A hand-off IS a fresh instruction — re-stamp it.
        created_at: new Date().toISOString(),
      };
      if (note) patch.customer_request = `${reqRow.customer_request || ''}\n\nNOTA DEL DUEÑO (reintento): ${note}`.trim();
      // .neq guards the race with a concurrent Release: resurrecting a row the
      // instant after it went 'done' would put Ace to work on a shipped fix.
      const { data: reset, error } = await admin.from('song_fix_requests').update(patch).eq('id', id).neq('status', 'done').select('id');
      if (error) return json({ success: false, error: error.message }, 500);
      if (!reset?.length) return json({ success: false, error: 'Already released — nothing for Ace to redo.' }, 409);
      return json({ success: true });
    }

    // HAND AN ALREADY-APPROVED PLAN TO THE BACKGROUND WORKER (2026-08-12).
    //
    // Distinct from 'send-to-ace', which is a RESET: that one nulls auto_plan
    // and fix_spec so Ace re-reads the complaint and re-plans from scratch.
    // This one carries the plan the owner just confirmed on screen straight
    // into the worker, seeding auto_status='generating' so Ace skips
    // understanding/planning entirely and goes to work. Reusing send-to-ace
    // here would throw the confirmation away and Ace would generate against a
    // plan the owner never saw.
    //
    // Why it exists: the browser card runs the whole fix inside the tab — close
    // it and the work dies, and it gives up quickly. On 2026-08-12 Kie spent
    // hours failing most requests, and three paid songs needed 16, ~30 and ~20
    // submissions to land. No person sits through that, and no browser tab
    // survives it. Failed Kie jobs cost 0 credits, so the worker can simply
    // out-wait a bad night — see MAX_INFRA_RETRIES in fix-song-auto.
    //
    // The human release gate is untouched: this only ever reaches
    // status='awaiting_approval'. Nothing is applied to a customer's song
    // without a person tapping Release.
    if (action === 'handoff-plan') {
      const songId = body.song_id;
      const approvedLyrics = String(body.approvedLyrics || '').trim();
      if (!songId) return json({ success: false, error: 'song_id required' }, 400);
      if (!approvedLyrics) return json({ success: false, error: 'approvedLyrics required — hand off a CONFIRMED plan, not a blank one.' }, 400);

      const changes = Array.isArray(body.changes) ? body.changes.filter((c: any) => c?.after) : [];

      // WHAT THE WORKER CAN ACTUALLY DO. The browser ladder submits a window,
      // keeps the resulting take, and CHAINS the next round off it — that is how
      // a line sung in two choruses gets fixed, one window per occurrence. The
      // worker has no such ladder: stepGenerate submits one window per round
      // with no sourceTaskId, so it re-sings from the ORIGINAL every time and a
      // repeated line can never satisfy the checklist. An added line can't ride
      // a window at all. Handing either off as `mode:'section'` would burn a
      // night and stage nothing.
      //
      // Re-derived HERE rather than trusted from the caller, because the button
      // sends whichever mode the owner was shown and those rules live in the
      // planner. Owner rule still wins: promoting to a full re-roll is a NEW
      // PERFORMANCE, so we refuse rather than do it silently.
      const timesInLyrics = (line: string): number => {
        const norm = (s: string) => String(s || '').replace(/\r\n/g, '\n').toLowerCase().replace(/\s+/g, ' ').trim();
        const hay = norm(approvedLyrics); const needle = norm(line);
        if (!needle) return 0;
        let n = 0; let i = hay.indexOf(needle);
        while (i !== -1) { n++; i = hay.indexOf(needle, i + needle.length); }
        return n;
      };
      const spots = changes.reduce((n: number, c: any) => n + Math.max(1, timesInLyrics(c.after)), 0);
      const needsLadder = changes.length > 1 || spots > 1;
      const isAddLine = !!body.addLine;
      let mode = body.mode === 'full' ? 'full' : 'section';
      if ((needsLadder || isAddLine) && mode === 'section') {
        if (!body.allowFullReroll) {
          return json({
            success: false,
            needsLadder: true,
            error: isAddLine
              ? 'Una línea NUEVA no cabe en una ventana: solo se puede con "Rehacer canción completa" (misma voz clonada). Ace no puede hacerlo solo — apruébalo aquí o hazlo en esta ventana.'
              : 'Esta corrección toca varios lugares (o una línea que se repite). Ace re-canta UNA ventana por ronda y no encadena, así que no puede terminarla. Hazla en esta ventana, o aprueba rehacer la canción completa.',
          }, 409);
        }
        mode = 'full';   // owner explicitly opted in
      }

      const autoPlan: Record<string, unknown> = {
        approvedLyrics,
        changes,
        // stepGenerate passes these straight to Kie; dropping them silently
        // weakens verification.
        verifyPhrases: Array.isArray(body.verifyPhrases) ? body.verifyPhrases.slice(0, 3) : [],
        mode,
        // Boolean in the worker (it only gates durationPadS), even though the
        // planner returns an object.
        addLine: !!body.addLine,
        summary: String(body.summary || '').slice(0, 500),
        handoff: true,
        // OWNER RULE: a full re-roll is a NEW PERFORMANCE, not an edit. The
        // worker escalates section -> full on its own after two rounds; when the
        // owner approved a SECTION fix, that escalation would hand back
        // something they explicitly did not ask for. Only allow it if the
        // caller opts in.
        ...(body.allowFullReroll ? {} : { noAutoFull: true }),
      };

      const patch: Record<string, unknown> = {
        song_id: songId,
        status: 'pending',
        intake_complete: true,
        auto_status: 'generating',   // skip linking/understanding/planning
        // SEED THE WORKER'S FAIRNESS CLOCK. Its mid-pipeline query is
        // `.order('auto_updated_at', {ascending:true}).limit(3)` and Postgres
        // sorts NULLS LAST on ASC, so an unstamped row sits behind every
        // running one. Until now nothing could reach a mid state without
        // setAuto() stamping it first; this is the first writer that can, and
        // an unstamped row would be starved (silently — a row that never runs
        // never reaches needs_human, so it never pings either).
        auto_updated_at: new Date().toISOString(),
        auto_round: 0,
        auto_error: null,
        auto_takes: [],
        auto_task_id: null,
        auto_plan: autoPlan,
        candidate_audio_url: null,
        candidate_lyrics: null,
        candidate_summary: null,
        candidate_meta: null,
        staged_at: null,
        reject_reason: null,
        worked_by: actor,
      };

      const note = String(body.customer_request || body.note || '').trim();
      // A readable instruction even when the owner typed nothing — the queue
      // card, the WhatsApp ping and any later "give it to Ace" all read
      // customer_request, and a content-free placeholder dead-ends every one of
      // them (send-to-ace re-plans FROM this text).
      const changeText = changes
        .map((c: any) => (c.before ? `"${c.before}" → "${c.after}"` : `agregar: "${c.after}"`))
        .join('; ')
        .slice(0, 900);

      let id = body.request_id || null;
      // ONE SONG, ONE PIPELINE. Without this, fixing the same song twice from
      // the Songs tab leaves two open rows racing on the same audio — both
      // stage, and releasing one silently invalidates the other's chain.
      if (!id) {
        const { data: open } = await admin.from('song_fix_requests')
          .select('id, status')
          .eq('song_id', songId)
          // 'in_progress' excluded (2026-08-17): that row belongs to a human
          // mid-work — silently flipping it to the worker discarded their claim
          // and whatever they were about to stage.
          .in('status', ['pending', 'awaiting_approval'])
          .order('created_at', { ascending: false })
          .limit(1);
        if (open?.length) id = open[0].id;
      }
      if (id) {
        const { data: existing } = await admin.from('song_fix_requests').select('id, customer_request, status').eq('id', id).single();
        if (!existing) return json({ success: false, error: 'Request not found' }, 404);
        if (existing.status === 'done') return json({ success: false, error: 'Already released — nothing to hand off.' }, 409);
        if (note && note !== existing.customer_request) {
          patch.customer_request = `${existing.customer_request || ''}\n\nPLAN APROBADO POR EL DUEÑO: ${note}`.trim();
        }
        // Future-only gate: re-stamp so the worker treats this as fresh work.
        patch.created_at = new Date().toISOString();
        // .neq guards racing a concurrent Release — never resurrect a shipped fix.
        const { data: took, error } = await admin.from('song_fix_requests').update(patch).eq('id', id).neq('status', 'done').select('id');
        if (error) return json({ success: false, error: error.message }, 500);
        if (!took?.length) return json({ success: false, error: 'Already released — start a fresh handoff instead.' }, 409);
      } else {
        patch.customer_request = note || (changeText
          ? `Corrección aprobada por el dueño: ${changeText}`
          : 'Corrección aprobada por el dueño desde Arreglar Canción.');
        patch.created_by = actor;
        // The staged/failed WhatsApp pings name the customer from context.
        const { data: sng } = await admin.from('songs').select('recipient_name, whatsapp_phone').eq('id', songId).single();
        patch.context = {
          source: 'owner-handoff',
          customer_name: sng?.recipient_name || null,
          phone: sng?.whatsapp_phone || null,
        };
        const { data: ins, error } = await admin.from('song_fix_requests').insert(patch).select('id').single();
        if (error) return json({ success: false, error: error.message }, 500);
        id = ins.id;
      }

      // Tell the caller whether the worker is actually switched on — a handoff
      // into a disabled worker looks identical to a handoff into a working one
      // until nothing happens for an hour.
      const { data: st } = await admin.from('fix_auto_state').select('enabled').eq('id', 1).single();
      return json({ success: true, request_id: id, autoEnabled: !!st?.enabled });
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
      const { data: srRows, error } = await admin.from('song_fix_requests').update({
        candidate_audio_url: publicUrl,
        candidate_lyrics: body.fullLyrics || null,
        candidate_summary: body.summary || null,
        candidate_meta: {
          mode: body.mode || 'full',
          corrections,
          // Whole Kie take identity (full re-rolls always are one) — release
          // chains future fixes off the corrected take instead of the pristine.
          fixTaskId: body.fixTaskId ? String(body.fixTaskId) : null,
          fixAudioId: body.fixAudioId ? String(body.fixAudioId) : null,
          fixTrimAtS: Number(body.fixTrimAtS) > 0 ? Number(body.fixTrimAtS) : null,
        },
        ...(reqRow.song_id ? {} : (body.songId ? { song_id: body.songId } : {})),
        status: 'awaiting_approval',
        worked_by: actor,
        staged_at: new Date().toISOString(),
      }).eq('id', id).in('status', OPEN_STATUSES).select('id'); // never stage onto a released request
      if (error) return json({ success: false, error: error.message }, 500);
      if (!srRows?.length) return json({ success: false, error: 'This request was already resolved — nothing to stage onto.' }, 409);
      return json({ success: true, candidate_audio_url: publicUrl });
    }

    if (action === 'release') {
      // Release gate: owner OR Ivan (assistant) — owner decision 2026-07-27.
      // Any admin_users row already passed the auth check above; both roles may
      // listen to the staged candidate and push it live.
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { data: reqRow } = await admin.from('song_fix_requests').select('*').eq('id', id).single();
      if (!reqRow) return json({ success: false, error: 'Request not found' }, 404);
      if (reqRow.status !== 'awaiting_approval') {
        return json({ success: false, error: 'This request is not staged for approval.' }, 409);
      }
      // ATOMIC CLAIM (2026-08-17). The read-check above races: the owner and
      // Ivan both get the "fix ready" ping, and two Release taps seconds apart
      // both passed it. The second releaseCandidate re-snapshotted fix_backup
      // from the ALREADY-FIXED song — destroying the pre-fix original that undo
      // exists to restore — and double-counted/notified. Claim the row with a
      // conditional write first; exactly one caller wins.
      {
        const { data: claimed } = await admin.from('song_fix_requests')
          .update({ status: 'in_progress', worked_by: actor })
          .eq('id', id).eq('status', 'awaiting_approval')
          .select('id');
        if (!claimed?.length) return json({ success: false, error: 'Someone else is releasing this right now.' }, 409);
      }
      try {
        const out = await releaseCandidate(admin, { ...reqRow, status: 'awaiting_approval' }, actor);
        // ── Notify the customer (owner decision 2026-07-27): email + a WhatsApp
        // message INTO their existing chat thread. Best-effort — a notify failure
        // never rolls back the release; it's reported in the response instead.
        const notified: Record<string, unknown> = { email: false, whatsapp: false };
        try {
          const songLink = `https://regalosquecantan.com/song/${reqRow.song_id}`;
          const { data: song } = await admin.from('songs')
            .select('email, recipient_name, payment_status').eq('id', reqRow.song_id).single();
          const recipient = song?.recipient_name || 'tu ser querido';

          // PAID GATE (owner decision 2026-08-18): the /song link is the full
          // paid deliverable. If the song hasn't been paid for, do NOT tell the
          // customer it's fixed — a fix on an unpaid song stays silent and the
          // release response says why. (Two unpaid full versions were sent out
          // this way; the customer had only ever seen the /listen previews.)
          const isPaid = song?.payment_status === 'paid';
          if (!isPaid) notified.skipped = 'song not paid — customer not notified';

          // Email (SendGrid, same pattern as notify-upsell-ready).
          if (isPaid && song?.email && SENDGRID_API_KEY) {
            const html = `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
              <h2 style="color:#4f46e5">🎵 ¡Tu canción ya está corregida!</h2>
              <p>Hicimos el cambio que nos pediste en la canción para <strong>${recipient}</strong>. Ya puedes escucharla aquí:</p>
              <p style="text-align:center;margin:24px 0"><a href="${songLink}" style="background:#4f46e5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Escuchar mi canción</a></p>
              <p style="color:#666;font-size:13px">Gracias por tu paciencia — Regalos Que Cantan 🎶</p></div>`;
            const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SENDGRID_API_KEY}` },
              body: JSON.stringify({
                personalizations: [{ to: [{ email: song.email }] }],
                from: { email: EMAIL_SENDER, name: 'Regalos Que Cantan' },
                subject: `✅ Tu canción para ${recipient} ya está corregida`,
                content: [{ type: 'text/html', value: html }],
                categories: ['song_fix_released'],
              }),
            });
            notified.email = resp.ok;
          }

          // WhatsApp into the existing conversation thread (phone from the
          // request's conversation, falling back to context.phone).
          let phone: string | null = null;
          let convId: string | null = reqRow.conversation_id || null;
          if (convId) {
            const { data: conv } = await admin.from('sms_conversations')
              .select('id, phone').eq('id', convId).single();
            phone = conv?.phone || null;
          }
          if (!phone && reqRow.context?.phone) phone = String(reqRow.context.phone);
          if (isPaid && phone) {
            const waBody = `✅ ¡Listo! Ya corregimos tu canción para ${recipient}. Escúchala aquí: ${songLink} 🎶`;
            const wa = await sendWhatsApp(phone, waBody);
            notified.whatsapp = wa.ok;
            // Log it in the inbox thread so the team sees it in the chat.
            if (wa.ok && convId) {
              try {
                await admin.from('sms_messages').insert({
                  conversation_id: convId,
                  direction: 'outbound',
                  body: waBody,
                  status: wa.status || 'sent',
                  twilio_sid: wa.sid || null,
                  channel: 'whatsapp',
                  ai_generated: true,
                });
              } catch { /* inbox log is best-effort */ }
            }
          }
        } catch (notifyErr) {
          console.error('release notify failed:', notifyErr instanceof Error ? notifyErr.message : notifyErr);
        }
        return json({ success: true, audio_url: out.audioUrl, song_id: reqRow.song_id, notified, stale_artifacts: out.staleArtifacts });
      } catch (e) {
        // The claim succeeded but the release failed — put the row back so the
        // staged candidate isn't stranded in 'in_progress' forever.
        try { await admin.from('song_fix_requests').update({ status: 'awaiting_approval' }).eq('id', id).eq('status', 'in_progress'); } catch { /* best effort */ }
        return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
      }
    }

    if (action === 'reject') {
      const id = body.request_id;
      if (!id) return json({ success: false, error: 'request_id required' }, 400);
      const { data: rjRows, error } = await admin.from('song_fix_requests').update({
        status: 'rejected',
        approved_by: actor,
        reject_reason: body.reason ? String(body.reason).slice(0, 500) : null,
        resolved_at: new Date().toISOString(),
      }).eq('id', id).neq('status', 'done').select('id'); // a released fix is history — rejecting it now would rewrite it
      if (error) return json({ success: false, error: error.message }, 500);
      if (!rjRows?.length) return json({ success: false, error: 'Already released — cannot reject.' }, 409);
      return json({ success: true });
    }

    if (action === 'create') {
      const customerRequest = String(body.customer_request || '').trim();
      if (!customerRequest) return json({ success: false, error: 'customer_request required' }, 400);
      const { data: inserted, error } = await admin.from('song_fix_requests').insert({
        song_id: body.song_id || null,
        conversation_id: body.conversation_id || null,
        customer_request: customerRequest, // the AI summary / what to fix (owner-confirmed)
        candidate_summary: body.summary ? String(body.summary) : null,
        context: {
          source: 'owner', created_by_email: actor,
          source_message: body.source_message ? String(body.source_message) : null, // the FULL chat exchange, for review
          phone: body.phone ? String(body.phone) : null,
          customer_name: body.customer_name ? String(body.customer_name) : null,
        },
        status: 'pending',
        created_by: actor,
      }).select('id').single();
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, id: inserted?.id });
    }

    // ── INTAKE (owner spec 2026-07-27): guided questionnaire before automation ──
    // Find the customer's songs by email or phone, filtered by paid, recent first.
    if (action === 'song-search') {
      const email = String(body.email || '').trim().toLowerCase();
      const digits = String(body.phone || '').replace(/\D/g, '').slice(-10);
      if (!email && !digits) return json({ success: false, error: 'email or phone required' }, 400);
      const paid = body.paid !== false; // default: paid songs
      // IMPORTANT: `songs` has NO `phone` column — querying it made every search
      // 500 with "column songs.phone does not exist" (bug found 2026-08-01).
      // The customer's number lives in `whatsapp_phone`; `phone_number` exists
      // but is empty on every paid row today, so we match BOTH and let either
      // one hit. Same widest-net shape admin-songs already uses for its search.
      // Quoted `%…%` with or()-breaking chars stripped — the exact form already
      // proven in production by admin-songs' song search. Don't "simplify" the
      // quotes or the strip away.
      const orParts: string[] = [];
      const safeEmail = email.replace(/["\\,()]/g, '');
      if (safeEmail) orParts.push(`email.ilike."%${safeEmail}%"`);
      if (digits) orParts.push(`whatsapp_phone.ilike."%${digits}%"`, `phone_number.ilike."%${digits}%"`);
      // Everything stripped away (e.g. an email of just punctuation) — an empty
      // or() would throw, so say what's wrong instead.
      if (!orParts.length) return json({ success: false, error: 'That email/phone has no searchable characters.' }, 400);
      let q = admin.from('songs')
        .select('id, recipient_name, sender_name, genre, genre_name, created_at, paid, version, audio_url, email, whatsapp_phone, phone_number')
        .eq('paid', paid)
        .or(orParts.join(','))
        .order('created_at', { ascending: false })
        .limit(15);
      const { data: songs, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, songs: songs || [] });
    }

    // Create fully-confirmed request(s) — one per selected song (1 or 2 for a
    // bundle), marked intake_complete so the auto-worker may pick them up.
    if (action === 'create-intake') {
      const songIds: string[] = Array.isArray(body.songs) ? body.songs.filter(Boolean).slice(0, 2) : [];
      const confirmed = String(body.confirmed_request || '').trim();
      const email = String(body.email || '').trim() || null;
      const phone = String(body.phone || '').trim() || null;
      if (!songIds.length) return json({ success: false, error: 'Select at least one song.' }, 400);
      if (!confirmed) return json({ success: false, error: 'Confirm what the customer wants fixed.' }, 400);
      if (!email && !phone) return json({ success: false, error: 'email or phone required' }, 400);
      const siblingGroup = crypto.randomUUID();
      const ids: string[] = [];
      for (const songId of songIds) {
        const { data: inserted, error } = await admin.from('song_fix_requests').insert({
          song_id: songId,
          conversation_id: body.conversation_id || null,
          customer_request: confirmed,
          context: {
            source: 'intake', created_by_email: actor,
            source_message: body.source_message ? String(body.source_message) : null,
            phone, customer_name: body.customer_name ? String(body.customer_name) : null,
          },
          intake: { email, phone, paid: body.paid !== false, confirmed_request: confirmed, sibling_group: songIds.length > 1 ? siblingGroup : null },
          intake_complete: true,
          status: 'pending',
          created_by: actor,
        }).select('id').single();
        if (error) return json({ success: false, error: error.message }, 500);
        ids.push(inserted!.id);
      }
      return json({ success: true, ids });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
