// supabase/functions/poll-cloned-voice-songs/index.ts
//
// pg_cron sweeper that FINISHES Clone Mi Voz songs server-side.
//
// Why this exists (2026-08-27 audit)
// ----------------------------------
// Rehosting + status flips used to live ONLY in cloned-voice-status, which
// only the customer's browser calls. Close the tab and a paid song sits in
// 'generating_song' forever while its Suno CDN URLs expire (~14 days). The
// 2026-08-08 paid test order (f1a5c72c) lost both full-song MP3s exactly
// this way. This sweeper is the safety net that makes the browser optional.
//
// What each 2-minute tick does
// ----------------------------
//   1. FINISH active rows: status in (generating_song, generating_preview)
//      older than GRACE_MINUTES (fresh rows are left to the browser poller).
//      Polls Kie record-info via the same _shared/cloned-voice-delivery.ts
//      logic cloned-voice-status uses:
//        SUCCESS -> rehost to permanent storage, flip status, and (paid full
//                   songs) send the delivery email.
//        FAILED  -> mark failed; alert the owner if the row is PAID.
//        PENDING -> paid + older than STUCK_ALERT_MINUTES -> alert once.
//                   Anything older than ABANDON_HOURS -> mark failed (task
//                   evaporated / Kie purged it) so it stops looping.
//   2. RESCUE 'paid' rows with no kie_task_id (the webhook's server-to-server
//      generation call died mid-flight): re-trigger generate-cloned-voice-song
//      once (sweeper_retry_count cap), alert the owner either way.
//   3. REHOST RETRY: status='success' but permanent_audio_urls is NULL (the
//      first copy failed). Retry while the Suno URLs still live; if they are
//      already dead on a PAID row, alert the owner once.
//   4. EMAIL BACKFILL: paid + success + no delivery email yet -> send it.
//
// Every row-level step is wrapped so one bad row never blocks the rest.
// All emails/alerts are idempotent (atomic column claims / alert-once
// markers added in 20260827200000_clonamivoz_delivery_pipeline.sql).
//
// Auth: verify_jwt = false (pg_cron calls are headerless) — pinned in
// supabase/config.toml per CLAUDE.md §3.2. The function only reads/repairs
// its own table and is safe to invoke repeatedly.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  pollKieTask,
  mapKieTerminal,
  extractSunoUrls,
  copyToPermanentStorage,
  finalizeFullSongSuccess,
  sendClonedVoiceDeliveryEmail,
} from '../_shared/cloned-voice-delivery.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');

// Owner alerting — same channels/env vars as health-check.
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM');
const ALERT_WHATSAPP_TO = Deno.env.get('ALERT_WHATSAPP_TO');

const GENERATE_SONG_URL = `${SUPABASE_URL}/functions/v1/generate-cloned-voice-song`;

// Leave rows younger than this to the browser poller (it polls every 5s and
// gives the customer live feedback; we are the safety net, not the fast path).
const GRACE_MINUTES = 3;
// A PAID row still pending after this long is worth telling the owner about.
const STUCK_ALERT_MINUTES = 30;
// After this long, a still-pending Kie task is dead (normal generations take
// 2-5 minutes). Mark failed so the row stops looping every tick.
const ABANDON_HOURS = 48;
// Row cap per tick — keeps a backlog from blowing the function timeout.
const MAX_ROWS_PER_TICK = 10;

const ROW_COLUMNS =
  'id, status, paid, customer_email, recipient_name, title, genre_slug, ' +
  'kie_task_id, preview_kie_task_id, suno_audio_urls, permanent_audio_urls, ' +
  'delivery_email_sent_at, sweeper_alerted_at, sweeper_retry_count, ' +
  'created_at, paid_at, completed_at';

// ---------------------------------------------------------------------------
// Owner alerts (WhatsApp + email, fire-and-forget, never throws)
// ---------------------------------------------------------------------------
async function sendOwnerAlert(subject: string, text: string): Promise<void> {
  try {
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_WHATSAPP_FROM && ALERT_WHATSAPP_TO) {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: TWILIO_WHATSAPP_FROM,
          To: ALERT_WHATSAPP_TO,
          Body: `🎤 Clona Mi Voz — ${subject}\n\n${text}`,
        }).toString(),
      });
    }
  } catch (e) {
    console.error('[poll-cloned-voice-songs] WhatsApp alert failed:', e);
  }
  try {
    if (SENDGRID_API_KEY) {
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SENDGRID_API_KEY}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
          from: { email: 'hola@regalosquecantan.com', name: 'RQC Clona Mi Voz' },
          subject: `🎤 Clona Mi Voz — ${subject}`,
          content: [{ type: 'text/plain', value: text }],
          categories: ['clonamivoz_ops_alert', 'rqc'],
        }),
      });
    }
  } catch (e) {
    console.error('[poll-cloned-voice-songs] Email alert failed:', e);
  }
}

/** Alert the owner about a row AT MOST ONCE (sweeper_alerted_at marker). */
async function alertRowOnce(
  supabase: any,
  row: any,
  subject: string,
  text: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('cloned_voice_songs')
    .update({ sweeper_alerted_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('sweeper_alerted_at', null)
    .select('id');
  if (error || !Array.isArray(data) || data.length === 0) return false;
  await sendOwnerAlert(subject, text);
  return true;
}

function ageMinutes(iso: string | null): number {
  if (!iso) return 0;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function rowLabel(row: any): string {
  return `${row.id}\nCustomer: ${row.customer_email || 'no email'}\nFor: ${row.recipient_name || '?'} (${row.genre_slug || '?'})\nPaid: ${row.paid ? 'YES' : 'no'} — created ${ageMinutes(row.created_at)} min ago`;
}

// ---------------------------------------------------------------------------
// Step 1 — finish active generations
// ---------------------------------------------------------------------------
async function sweepActiveRows(supabase: any, summary: Record<string, number>): Promise<void> {
  const graceCutoff = new Date(Date.now() - GRACE_MINUTES * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from('cloned_voice_songs')
    .select(ROW_COLUMNS)
    .in('status', ['generating_song', 'generating_preview'])
    .lt('created_at', graceCutoff)
    // Paid full songs first — they are the ones that cost real money to lose.
    .order('paid', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS_PER_TICK);

  if (error) {
    console.error('[poll-cloned-voice-songs] Active-row query failed:', error);
    return;
  }

  for (const row of rows || []) {
    try {
      const isPreview = row.status === 'generating_preview';
      const taskId = isPreview ? row.preview_kie_task_id : row.kie_task_id;
      const age = ageMinutes(row.created_at);

      if (!taskId) {
        // Active status but no task id: the submit call died before Kie
        // answered. Old enough -> fail it so it stops showing as active.
        if (age > 60) {
          await supabase
            .from('cloned_voice_songs')
            .update({
              status: 'failed',
              error_message: 'Generation was never submitted to Kie (no task id). Swept by poll-cloned-voice-songs.',
              completed_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          summary.abandoned++;
          if (row.paid) {
            await alertRowOnce(supabase, row, 'PAID song has no Kie task', rowLabel(row));
          }
        }
        continue;
      }

      const kieResponse = await pollKieTask(taskId);
      if (!kieResponse || kieResponse.code !== 200) {
        // Network hiccup or Kie can't find the task. Give young rows more
        // ticks; abandon rows past the ceiling so they stop looping.
        if (age > ABANDON_HOURS * 60) {
          await supabase
            .from('cloned_voice_songs')
            .update({
              status: 'failed',
              error_message: `Kie task ${taskId} unresolvable after ${ABANDON_HOURS}h (code ${kieResponse?.code ?? 'network'}). Swept by poll-cloned-voice-songs.`,
              completed_at: new Date().toISOString(),
            })
            .eq('id', row.id);
          summary.abandoned++;
          if (row.paid) {
            await alertRowOnce(supabase, row, 'PAID song abandoned — Kie task unresolvable', rowLabel(row));
          }
        }
        continue;
      }

      const kieData = kieResponse.data || {};
      const terminal = mapKieTerminal(kieData.status);

      if (terminal === 'pending') {
        summary.stillPending++;
        if (row.paid && age > STUCK_ALERT_MINUTES) {
          await alertRowOnce(
            supabase,
            row,
            `PAID song still generating after ${age} min`,
            rowLabel(row)
          );
          summary.alerted++;
        }
        continue;
      }

      if (terminal === 'failed') {
        const errorMessage =
          kieData.errorMessage ||
          `Kie returned status ${kieData.status} (code ${kieData.errorCode ?? 'n/a'}).`;
        await supabase
          .from('cloned_voice_songs')
          .update({
            status: 'failed',
            error_message: errorMessage,
            completed_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        summary.markedFailed++;
        if (row.paid) {
          await alertRowOnce(
            supabase,
            row,
            'PAID song generation FAILED',
            `${rowLabel(row)}\nKie error: ${errorMessage}`
          );
          summary.alerted++;
        }
        continue;
      }

      // ---- SUCCESS ----
      const sunoUrls = extractSunoUrls(kieData);
      if (sunoUrls.length === 0) {
        const failMsg = 'Kie devolvió SUCCESS pero sin URLs de audio.';
        await supabase
          .from('cloned_voice_songs')
          .update({
            status: 'failed',
            error_message: failMsg,
            completed_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        summary.markedFailed++;
        if (row.paid) {
          await alertRowOnce(supabase, row, 'PAID song SUCCESS with no audio', rowLabel(row));
        }
        continue;
      }

      if (isPreview) {
        const permUrl = await copyToPermanentStorage(supabase, sunoUrls[0], row.id, 'preview');
        await supabase
          .from('cloned_voice_songs')
          .update({
            status: 'preview_ready',
            preview_audio_url: permUrl || sunoUrls[0],
            completed_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        summary.previewsFinished++;
      } else {
        const { permanentUrls } = await finalizeFullSongSuccess(supabase, row.id, sunoUrls);
        summary.songsFinished++;
        if (row.paid) {
          const emailed = await sendClonedVoiceDeliveryEmail(supabase, {
            ...row,
            permanent_audio_urls: permanentUrls.length > 0 ? permanentUrls : null,
            suno_audio_urls: sunoUrls,
          });
          if (emailed) summary.deliveryEmails++;
        }
      }
    } catch (e) {
      console.error(`[poll-cloned-voice-songs] Row ${row.id} sweep failed:`, e);
      summary.rowErrors++;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — rescue paid rows whose generation trigger died
// ---------------------------------------------------------------------------
async function rescuePaidRows(supabase: any, summary: Record<string, number>): Promise<void> {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from('cloned_voice_songs')
    .select(ROW_COLUMNS + ', voice_sample_id, occasion, relationship, story, language, lyrics, emotional_modifiers, lyrics_model_used')
    .eq('status', 'paid')
    .lt('paid_at', cutoff)
    .limit(5);

  if (error) {
    console.error('[poll-cloned-voice-songs] Paid-rescue query failed:', error);
    return;
  }

  for (const row of rows || []) {
    try {
      if (row.sweeper_retry_count >= 1) {
        // Already retried once — alert (once) and leave it for a human.
        await alertRowOnce(
          supabase,
          row,
          'PAID song stuck in status=paid after auto-retry',
          rowLabel(row)
        );
        continue;
      }
      await supabase
        .from('cloned_voice_songs')
        .update({ sweeper_retry_count: row.sweeper_retry_count + 1 })
        .eq('id', row.id);

      // Same server-to-server call the Stripe webhook makes.
      const genResp = await fetch(GENERATE_SONG_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          cloned_voice_song_id: row.id,
          voice_sample_id: row.voice_sample_id,
          recipient_name: row.recipient_name,
          occasion: row.occasion,
          relationship: row.relationship,
          story: row.story,
          genre_slug: row.genre_slug,
          language: row.language || 'es',
          title: row.title,
          lyrics: row.lyrics,
          emotional_modifiers: row.emotional_modifiers,
          lyrics_model_used: row.lyrics_model_used,
          customer_email: row.customer_email,
        }),
      });
      if (genResp.ok) {
        summary.retriggered++;
        console.log(`[poll-cloned-voice-songs] Re-triggered generation for paid row ${row.id}`);
      } else {
        const errText = await genResp.text().catch(() => '');
        console.error(
          `[poll-cloned-voice-songs] Re-trigger failed for ${row.id}: ${genResp.status} ${errText.slice(0, 200)}`
        );
        await alertRowOnce(
          supabase,
          row,
          'PAID song re-trigger FAILED',
          `${rowLabel(row)}\nHTTP ${genResp.status}`
        );
      }
    } catch (e) {
      console.error(`[poll-cloned-voice-songs] Rescue of ${row.id} failed:`, e);
      summary.rowErrors++;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3 — retry failed rehosts while the Suno URLs still live
// ---------------------------------------------------------------------------
async function retryRehosts(supabase: any, summary: Record<string, number>): Promise<void> {
  const { data: rows, error } = await supabase
    .from('cloned_voice_songs')
    .select(ROW_COLUMNS)
    .eq('status', 'success')
    .is('permanent_audio_urls', null)
    .not('suno_audio_urls', 'is', null)
    .limit(5);

  if (error) {
    console.error('[poll-cloned-voice-songs] Rehost-retry query failed:', error);
    return;
  }

  for (const row of rows || []) {
    try {
      const sunoUrls: string[] = row.suno_audio_urls || [];
      if (sunoUrls.length === 0) continue;
      const permanentUrls: string[] = [];
      for (let i = 0; i < sunoUrls.length; i++) {
        const permUrl = await copyToPermanentStorage(supabase, sunoUrls[i], row.id, `v${i + 1}`);
        if (permUrl) permanentUrls.push(permUrl);
      }
      if (permanentUrls.length > 0) {
        await supabase
          .from('cloned_voice_songs')
          .update({ permanent_audio_urls: permanentUrls })
          .eq('id', row.id);
        summary.rehosted++;
      } else if (row.paid) {
        // Suno URLs are already dead and we never got a permanent copy —
        // the audio is unrecoverable. A human needs to re-run + comp.
        await alertRowOnce(
          supabase,
          row,
          'PAID song audio LOST (Suno URLs dead, no permanent copy)',
          rowLabel(row)
        );
        summary.alerted++;
      }
    } catch (e) {
      console.error(`[poll-cloned-voice-songs] Rehost retry for ${row.id} failed:`, e);
      summary.rowErrors++;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 4 — backfill missing delivery emails
// ---------------------------------------------------------------------------
async function backfillDeliveryEmails(supabase: any, summary: Record<string, number>): Promise<void> {
  const { data: rows, error } = await supabase
    .from('cloned_voice_songs')
    .select(ROW_COLUMNS)
    .eq('status', 'success')
    .eq('paid', true)
    .is('delivery_email_sent_at', null)
    .not('customer_email', 'is', null)
    .limit(5);

  if (error) {
    console.error('[poll-cloned-voice-songs] Email-backfill query failed:', error);
    return;
  }

  for (const row of rows || []) {
    try {
      const hasAudio =
        (row.permanent_audio_urls && row.permanent_audio_urls.length > 0) ||
        (row.suno_audio_urls && row.suno_audio_urls.length > 0);
      if (!hasAudio) continue; // nothing to deliver — step 3 alerts on these
      const emailed = await sendClonedVoiceDeliveryEmail(supabase, row);
      if (emailed) summary.deliveryEmails++;
    } catch (e) {
      console.error(`[poll-cloned-voice-songs] Email backfill for ${row.id} failed:`, e);
      summary.rowErrors++;
    }
  }
}

// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (!KIE_API_KEY) {
    console.error('[poll-cloned-voice-songs] KIE_API_KEY not configured');
    return new Response(JSON.stringify({ error: 'config_error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const summary: Record<string, number> = {
    songsFinished: 0,
    previewsFinished: 0,
    markedFailed: 0,
    abandoned: 0,
    stillPending: 0,
    retriggered: 0,
    rehosted: 0,
    deliveryEmails: 0,
    alerted: 0,
    rowErrors: 0,
  };

  await sweepActiveRows(supabase, summary);
  await rescuePaidRows(supabase, summary);
  await retryRehosts(supabase, summary);
  await backfillDeliveryEmails(supabase, summary);

  const anyWork = Object.entries(summary).some(([k, v]) => k !== 'stillPending' && v > 0);
  if (anyWork) {
    console.log('[poll-cloned-voice-songs] Sweep summary:', JSON.stringify(summary));
  }

  return new Response(
    JSON.stringify({ ok: true, ...summary, execution_ms: Date.now() - started }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
});
