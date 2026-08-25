// supabase/functions/_shared/kie-recovery.ts
// Kie mid-generation failure recovery: retry once on Kie, then hand the order
// to Mureka (useapi). Operates on the whole TASK (both v1+v2 sibling rows) so
// a single resubmission replaces both takes — mirroring how generate-song and
// the callbacks treat siblings.
//
// Used by:
//   - song-callback (event-driven: the moment Kie's failure callback arrives)
//   - poll-processing-songs (backstop: record-info failures, stale callback
//     markers, and the 30-min age guard)
//
// Safe to call twice for the same task: the Kie retry / Mureka handoff swaps
// task_id on the sibling rows, so a second call for the old taskId finds no
// processing siblings and returns 'no_siblings'.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY') || '';

export const KIE_FAILED_STATUSES = new Set([
  'CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR', 'FAILED',
]);

// ---- Kie outage circuit-breaker -------------------------------------------
// Every terminal failure and every completed Kie song is recorded in
// kie_health_events. When recent failures dominate, the ladder SKIPS the
// retry-on-Kie step and hands orders to Mureka on their FIRST terminal
// failure. Rationale (2026-08-25 Suno outage): Kie takes 10-25 min to report
// each failure, so the two-failure ladder meant ~35 min before any song
// reached Mureka. The breaker closes by itself once successes come back or
// the failures age out of the window — there is nothing to reset manually.
const BREAKER_WINDOW_MIN = Number(Deno.env.get('KIE_BREAKER_WINDOW_MIN') || 15);
const BREAKER_MIN_FAILURES = Number(Deno.env.get('KIE_BREAKER_MIN_FAILURES') || 3);

export async function recordKieHealthEvent(supabase: any, event: 'failure' | 'success', taskId?: string) {
  try {
    const { error } = await supabase.from('kie_health_events').insert({ event, task_id: taskId || null });
    if (error) console.warn(`kie_health_events insert failed: ${error.message}`);
  } catch (e: any) {
    console.warn(`kie_health_events insert threw: ${e.message}`);
  }
}

// Never throws — a broken breaker must degrade to the normal ladder, not block recovery.
export async function isKieOutage(supabase: any): Promise<boolean> {
  try {
    const since = new Date(Date.now() - BREAKER_WINDOW_MIN * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('kie_health_events')
      .select('event')
      .gte('created_at', since);
    if (error || !data) return false;
    const failures = data.filter((r: any) => r.event === 'failure').length;
    // Count ONLY 'success' rows — the table also holds 'alert' dedup rows,
    // which must not read as Kie health.
    const successes = data.filter((r: any) => r.event === 'success').length;
    const open = failures >= BREAKER_MIN_FAILURES && failures >= successes * 2;
    if (open) console.log(`KIE BREAKER OPEN: ${failures} failures vs ${successes} successes in last ${BREAKER_WINDOW_MIN} min — skipping Kie retries, going straight to Mureka`);
    return open;
  } catch {
    return false;
  }
}

export function englishifyMarkersForProvider(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/\[Verso Final\]/gi, '[Final Verse]')
    .replace(/\[Verso (\d+)\]/gi, '[Verse $1]')
    .replace(/\[Verso\]/gi, '[Verse]')
    .replace(/\[Coro Final\]/gi, '[Final Chorus]')
    .replace(/\[Coro\]/gi, '[Chorus]')
    .replace(/\[Puente\]/gi, '[Bridge]')
    .replace(/\[Pre-Coro\]/gi, '[Pre-Chorus]')
    .replace(/\[Hablado\]/gi, '[Spoken Word]');
}

export async function handleKieTerminalFailure(supabase: any, taskId: string, kieStatus: string): Promise<string> {
  // Load ALL sibling rows still processing for this task, with retry fields
  const { data: siblings } = await supabase
    .from('songs')
    .select('id, version, recipient_name, lyrics, style_used, voice_type, genre, sub_genre, regenerate_count, kie_payload')
    .eq('task_id', taskId)
    .eq('status', 'processing');
  if (!siblings || siblings.length === 0) return 'no_siblings';

  await recordKieHealthEvent(supabase, 'failure', taskId);

  const attempt = Math.max(...siblings.map((s: any) => s.regenerate_count || 0));
  const failAll = async (msg: string) => {
    for (const s of siblings) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: msg.substring(0, 500),
      }).eq('id', s.id);
    }
  };
  // Infra-level double failure (both providers down/unreachable): park the
  // order in 'queued_retry' instead of killing it. retry-queued-songs (cron,
  // every 5 min) resubmits until a provider recovers, then the normal
  // completion email goes out. The customer-facing page already has a
  // "singer is napping, we'll email you" state for this status. Only for
  // transient failures — deterministic rejections still failAll, or the
  // queue would spin forever.
  const queueAll = async (msg: string, murekaPayloadJson: string | null) => {
    for (const s of siblings) {
      await supabase.from('songs').update({
        status: 'queued_retry',
        ...(murekaPayloadJson ? { mureka_payload: murekaPayloadJson } : {}),
        error_message: msg.substring(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);
    }
  };

  // ---- Attempt 1: resubmit the SAME job to Kie ----
  // Skipped when the breaker is open: during a Kie/Suno outage the retry just
  // burns another 10-25 min waiting for Kie to admit failure again.
  if (attempt === 0 && KIE_API_KEY && !(await isKieOutage(supabase))) {
    // The submit payload is stored on processing rows by generate-song
    // (completed rows get it overwritten with the track object — guard on .prompt)
    let submitPayload: any = null;
    for (const s of siblings) {
      try {
        const p = s.kie_payload ? JSON.parse(s.kie_payload) : null;
        if (p?.prompt) { submitPayload = p; break; }
      } catch { /* ignore */ }
    }
    if (submitPayload) {
      submitPayload.callBackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;
      try {
        const r = await fetch('https://api.kie.ai/api/v1/generate', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(submitPayload),
          signal: AbortSignal.timeout(20000),
        });
        const data = await r.json().catch(() => ({}));
        const newTaskId = data?.data?.taskId;
        if (data.code === 200 && newTaskId) {
          for (const s of siblings) {
            await supabase.from('songs').update({
              task_id: newTaskId,
              kie_task_id: newTaskId,
              regenerate_count: (s.regenerate_count || 0) + 1,
              error_message: `kie ${kieStatus} — auto-retried on kie`,
              updated_at: new Date().toISOString(),
            }).eq('id', s.id);
          }
          console.log(`Kie task ${taskId} failed (${kieStatus}) — RETRIED on Kie as ${newTaskId}`);
          return 'kie_retried';
        }
        console.warn(`Kie retry submit failed for ${taskId}: code=${data.code} ${data.msg || ''}`);
      } catch (e: any) {
        console.warn(`Kie retry network error for ${taskId}: ${e.message}`);
      }
    }
    // fall through to Mureka if the Kie retry could not be submitted
  }

  // ---- Attempt 2 (or Kie-retry unavailable): hand the order to Mureka ----
  const USEAPI_TOKEN_2 = Deno.env.get('USEAPI_TOKEN');
  const MUREKA_ACCOUNT = Deno.env.get('MUREKA_ACCOUNT');
  const USEAPI_WEBHOOK_SECRET = Deno.env.get('USEAPI_WEBHOOK_SECRET') || '';
  const base = siblings[0];
  if (!USEAPI_TOKEN_2 || !MUREKA_ACCOUNT || !base?.lyrics || !base?.style_used) {
    // Can't hand to Mureka — but if a Kie submit payload exists, the retry
    // queue can keep re-trying Kie itself until it recovers.
    const hasKiePayload = siblings.some((s: any) => {
      try { return !!JSON.parse(s.kie_payload || 'null')?.prompt; } catch { return false; }
    });
    if (hasKiePayload) {
      await queueAll(`kie.ai task ${kieStatus} — no Mureka fallback available, queued for Kie retry`, null);
      return 'queued_no_fallback';
    }
    await failAll(`kie.ai task ${kieStatus} — no Mureka fallback available`);
    return 'failed_no_fallback';
  }

  const genderLabel = base.voice_type === 'female'
    ? 'solo female lead vocal, single female singer'
    : 'solo male lead vocal, single male singer';
  const desc = `${genderLabel}, ${base.style_used}`.substring(0, 1000);
  const model = base.genre === 'norteno'
    ? (Deno.env.get('MUREKA_NORTENO_MODEL') || 'V7.6')
    : (base.genre === 'corrido' && base.sub_genre === 'tradicional')
      ? (Deno.env.get('MUREKA_CORRIDO_MODEL') || 'V7.6')
      : (Deno.env.get('MUREKA_MODEL') || 'V9');
  const callbackBase = `${SUPABASE_URL}/functions/v1/mureka-useapi-callback`;
  const murekaPayload = {
    account: MUREKA_ACCOUNT,
    lyrics: englishifyMarkersForProvider(base.lyrics).substring(0, 5000),
    title: `Canción para ${base.recipient_name || 'ti'}`.substring(0, 50),
    desc,
    model,
    vocal_gender: base.voice_type === 'female' ? 'female' : 'male',
    replyUrl: USEAPI_WEBHOOK_SECRET ? `${callbackBase}?token=${USEAPI_WEBHOOK_SECRET}` : callbackBase,
  };

  try {
    // Timeout is load-bearing: on 2026-08-25 this fetch hung with no signal,
    // the worker was killed mid-recovery with zero logs, and only the poll
    // backstop rescued the order. A hang now resolves in 30s → queued_retry.
    const r = await fetch('https://api.useapi.net/v1/mureka/music/create-advanced', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${USEAPI_TOKEN_2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(murekaPayload),
      signal: AbortSignal.timeout(30000),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.jobid) {
      for (const s of siblings) {
        await supabase.from('songs').update({
          task_id: data.jobid,
          mureka_job_id: data.jobid,
          provider: 'mureka-useapi',
          mureka_payload: JSON.stringify(murekaPayload),
          regenerate_count: (s.regenerate_count || 0) + 1,
          error_message: `kie ${kieStatus} — handed to Mureka`,
          updated_at: new Date().toISOString(),
        }).eq('id', s.id);
      }
      console.log(`Kie task ${taskId} failed twice — HANDED TO MUREKA as ${data.jobid}`);
      return 'mureka_handoff';
    }
    // 4xx (except 429) = Mureka deterministically rejected this payload —
    // retrying the same thing forever would spin, so fail for real. Anything
    // else (429, 5xx, weird body) is transient: queue for auto-retry.
    if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      await failAll(`kie ${kieStatus}; Mureka handoff failed: ${r.status} ${JSON.stringify(data).substring(0, 150)}`);
      return 'failed_handoff_error';
    }
    await queueAll(
      `kie ${kieStatus}; Mureka handoff ${r.status} — queued for auto-retry`,
      JSON.stringify(murekaPayload),
    );
    return 'queued_handoff_error';
  } catch (e: any) {
    await queueAll(
      `kie ${kieStatus}; Mureka handoff network error (${e.message}) — queued for auto-retry`.substring(0, 400),
      JSON.stringify(murekaPayload),
    );
    return 'queued_handoff_network';
  }
}
