// supabase/functions/_shared/dead-audio-heal.ts
//
// Dead-audio auto-heal (2026-08-28 Kie CDN incident): a COMPLETED song whose
// audio file the provider can no longer serve gets rescued automatically.
// Owner-approved ladder (2026-08-28):
//
//   1. Kie gets exactly ONE in-place re-sing (regenerate-paid-song-kie —
//      same lyrics/style/voice, full Suno quality, ~2-3 min). Skipped
//      entirely when the Kie outage breaker is open (kie-recovery.ts:
//      >=3 failures in 15 min → every heal goes straight to Mureka).
//   2. If that re-sing fails or ALSO comes back dead → Mureka, no more Kie
//      attempts. The rows flip back to 'processing' and ride the proven
//      handleKieTerminalFailure Mureka handoff (mureka-useapi-callback then
//      completes them through the normal delivery flow).
//   3. The owner is ALWAYS notified by SMS (throttled to one per hour so an
//      incident pages once, not once per song).
//
// PAID songs are never auto-regenerated — a re-sing is a new performance and
// voice, which is an owner decision. They still trigger the SMS.
//
// Callers: song-callback (dead file detected seconds after generation),
// poll-processing-songs (sweeper backstop), playback-beacon (a real customer
// just hit a dead player).
//
// Attempt state lives in error_message markers on the song rows:
//   'AUTO-HEAL:'         — Kie re-sing submitted (attempt 1 in flight)
//   'REGEN failed:'      — Kie re-sing rejected (stamped by regenerate-paid-song-kie)
//   'AUTO-HEAL-MUREKA:'  — handed to Mureka (terminal for this module)

import { handleKieTerminalFailure, isKieOutage, recordKieHealthEvent } from './kie-recovery.ts';
import { sendSms, isSmsConfigured } from './send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALERT_SMS_TO = Deno.env.get('ALERT_SMS_TO');

const MAX_HEAL_AGE_DAYS = 7;    // beacon can arrive from an old recovery email
const SMS_THROTTLE_HOURS = 1;

// One SMS per hour per reason bucket, via the same ops_alert_state table
// health-check's shouldAlert uses.
async function throttledOwnerSms(supabase: any, key: string, message: string) {
  try {
    if (!ALERT_SMS_TO || !isSmsConfigured()) return;
    const { data } = await supabase
      .from('ops_alert_state')
      .select('last_alerted_at')
      .eq('key', key)
      .maybeSingle();
    if (data && Date.now() - new Date(data.last_alerted_at).getTime() < SMS_THROTTLE_HOURS * 3600 * 1000) return;
    await supabase.from('ops_alert_state').upsert({ key, last_alerted_at: new Date().toISOString() });
    const r = await sendSms(ALERT_SMS_TO, message);
    if (!r.ok) console.warn(`[DEAD-AUDIO] owner SMS failed: ${r.error}`);
  } catch (e: any) {
    console.warn(`[DEAD-AUDIO] owner SMS threw: ${e?.message}`);
  }
}

/**
 * Rescue a completed song whose audio URL is dead. Pass ANY row of the pair —
 * the ladder always operates on the v1 sibling and replaces both takes.
 * Returns a short action string for the caller's logs/results.
 */
export async function healDeadAudio(
  supabase: any,
  songId: string,
  httpStatus: number,
  source: 'birth' | 'sweeper' | 'beacon',
): Promise<string> {
  try {
    const { data: row } = await supabase
      .from('songs')
      .select('id, session_id, version, status, paid, lyrics, style_used, recipient_name, created_at, regenerate_count, error_message, task_id, kie_task_id, audio_url')
      .eq('id', songId)
      .single();
    if (!row || row.status !== 'completed') return 'not_completed';

    // Resolve the pair: heal is driven from v1 so one trigger = one re-sing.
    let v1 = row;
    let v2: any = null;
    if (row.session_id) {
      const { data: sibs } = await supabase
        .from('songs')
        .select('id, version, status, paid, lyrics, style_used, recipient_name, created_at, regenerate_count, error_message, task_id, kie_task_id, audio_url, needs_reupload')
        .eq('session_id', row.session_id)
        .in('version', [1, 2]);
      for (const s of sibs || []) {
        if (s.version === 1) v1 = s;
        if (s.version === 2) v2 = s;
      }
    }

    // ---- Guards -----------------------------------------------------------
    if (v1.paid || v2?.paid) {
      await throttledOwnerSms(supabase, 'dead_audio_paid_sms',
        `RQC ALERTA: cancion PAGADA sin audio (${v1.recipient_name || v1.id}, HTTP ${httpStatus}, via ${source}). ` +
        `No se regenera sola — decide en /admin o pide regenerarla. Mas detalle en el email de health-check.`);
      return 'paid_needs_human';
    }
    const ageMs = Date.now() - new Date(v1.created_at).getTime();
    if (ageMs > MAX_HEAL_AGE_DAYS * 24 * 3600 * 1000) return 'too_old';
    if (!v1.lyrics || !v1.style_used) return 'missing_lyrics_or_style';

    const em = String(v1.error_message || '');
    if (em.startsWith('AUTO-HEAL-MUREKA')) return 'already_on_mureka';

    // Only a provider refusal (4xx) proves the file is gone; a 5xx/timeout is
    // a transient the sweeper should just retry.
    if (!(httpStatus >= 400 && httpStatus < 500)) return 'transient_not_healed';

    // A Kie re-sing submitted <10 min ago is still rendering — don't escalate
    // while it's in flight (the v2 sibling and every sweep cycle re-enter here).
    // Past 10 min with no swap, treat the re-sing as hung and move to Mureka.
    if (em.startsWith('AUTO-HEAL:')) {
      const m = em.match(/(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)/);
      const submittedAt = m ? new Date(m[1]).getTime() : 0;
      if (submittedAt && Date.now() - submittedAt < 10 * 60 * 1000) return 'kie_resing_in_flight';
    }

    const kieAlreadyTried =
      em.startsWith('AUTO-HEAL') || em.startsWith('REGEN failed') || (Number(v1.regenerate_count) || 0) > 0;

    // ---- Attempt 1: ONE Kie re-sing (skipped when the breaker is open) ----
    if (!kieAlreadyTried && !(await isKieOutage(supabase))) {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/regenerate-paid-song-kie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ v1Id: v1.id, v2Id: v2?.id, lyrics: v1.lyrics }),
        signal: AbortSignal.timeout(25000),
      });
      const out = await resp.json().catch(() => ({} as any));
      // A dead delivered file is a Kie failure signal — feed the breaker so a
      // pattern (3 in 15 min) sends every subsequent heal straight to Mureka.
      await recordKieHealthEvent(supabase, 'failure', v1.kie_task_id || v1.task_id || undefined);
      if (out?.ok) {
        const marker = `AUTO-HEAL: dead audio (HTTP ${httpStatus}, ${source}), kie re-sing ${out.taskId} ${new Date().toISOString()}`;
        await supabase.from('songs').update({ error_message: marker }).eq('id', v1.id);
        if (v2?.id) await supabase.from('songs').update({ error_message: marker }).eq('id', v2.id);
        console.log(`[DEAD-AUDIO] ${v1.id} (${source}) → kie re-sing ${out.taskId}`);
        await throttledOwnerSms(supabase, 'dead_audio_heal_sms',
          `RQC: audio muerto detectado (${source}, HTTP ${httpStatus}) — auto-regenerando via Kie. ` +
          `Si Kie sigue fallando, el sistema pasa solo a Mureka. Detalle: health-check email.`);
        return 'kie_resing_submitted';
      }
      console.warn(`[DEAD-AUDIO] kie re-sing submit failed for ${v1.id}: ${out?.error || resp.status} — falling to Mureka`);
      // fall through to Mureka
    }

    // ---- Attempt 2 / breaker open: Mureka, no more Kie ---------------------
    // Flip the pair back to 'processing' so the proven ladder + Mureka
    // callback own the rest of the delivery (email included).
    const murekaMarker = `AUTO-HEAL-MUREKA: dead audio (HTTP ${httpStatus}, ${source}) ${new Date().toISOString()}`;
    for (const s of [v1, v2].filter(Boolean)) {
      await supabase.from('songs').update({
        status: 'processing',
        error_message: murekaMarker,
        updated_at: new Date().toISOString(),
      }).eq('id', s.id);
    }
    const action = await handleKieTerminalFailure(supabase, v1.task_id || v1.kie_task_id, 'DEAD_AUDIO');
    console.log(`[DEAD-AUDIO] ${v1.id} (${source}) → mureka path: ${action}`);
    await throttledOwnerSms(supabase, 'dead_audio_heal_sms',
      `RQC: audio muerto (${source}) — Kie no disponible o ya fallo, cancion pasada a MUREKA (${action}). ` +
      `Detalle: health-check email.`);
    return `mureka_${action}`;
  } catch (e: any) {
    console.error(`[DEAD-AUDIO] heal failed for ${songId}: ${e?.message}`);
    return 'heal_error';
  }
}
