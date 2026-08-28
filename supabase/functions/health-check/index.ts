// supabase/functions/health-check/index.ts
// Platform Health Check System for RegalosQueCantan & MadeYouASong
// Runs every 10 minutes via pg_cron
// Checks: stuck songs, payment sync, WhatsApp capture rate, failed songs spike
// Alerts via: Email (SendGrid) + WhatsApp (Twilio)
// Deploy with: supabase functions deploy health-check --project-ref yzbvajungshqcpusfiia --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');

// Twilio WhatsApp config (optional — skips if not set)
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM'); // e.g. whatsapp:+14155238886
const ALERT_WHATSAPP_TO = Deno.env.get('ALERT_WHATSAPP_TO');       // e.g. whatsapp:+1XXXXXXXXXX
// Owner's cell for plain-SMS alerts (E.164). SMS has no WhatsApp 24h-window
// restriction, so it's the reliable urgent channel. Sent via _shared/send-sms.ts
// (A2P Messaging Service).
const ALERT_SMS_TO = Deno.env.get('ALERT_SMS_TO');

// Where to send email alerts
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RQC Health Check';

// Thresholds
const STUCK_SONG_MINUTES = 7;          // Songs generating > 7 min are stuck
const FAILED_SPIKE_THRESHOLD = 5;      // 5+ failures in last hour = alert
const WHATSAPP_CAPTURE_MIN_PCT = 50;   // Alert if < 50% of last 24h songs have phone
const PAYMENT_SYNC_LOOKBACK_HOURS = 6; // Check last 6 hours for payment mismatches

// Supervisor alarm — AI staff monitoring
const DAILY_AGENT_MAX_AGE_HOURS = 26;   // Daily agents must have an ok run within 26h
const WEEKLY_AGENT_MAX_AGE_DAYS = 8;    // Weekly agents within 8 days
const SMS_DRAFT_MAX_AGE_HOURS = 24;     // CS drafts older than this need attention
const EMAIL_APPROVAL_MAX_AGE_HOURS = 72;  // Marketing emails waiting longer than this
const CREATIVE_GENERATING_MAX_MINUTES = 60; // creative_queue rows stuck in 'generating'

// ============================================================================
// NOTIFICATION HELPERS
// ============================================================================

async function sendEmailAlert(subject: string, htmlContent: string) {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set, skipping email alert');
    return null;
  }
  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SENDGRID_API_KEY}`
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
        from: { email: SENDER_EMAIL, name: SENDER_NAME },
        reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
        subject,
        content: [{ type: 'text/html', value: htmlContent }],
        categories: ['health_check', 'rqc_internal'],
        tracking_settings: {
          click_tracking: { enable: false },
          open_tracking: { enable: false },
          subscription_tracking: { enable: false }
        }
      })
    });
    if (!response.ok) {
      console.error('SendGrid alert error:', response.status, await response.text());
    } else {
      console.log('Email alert sent:', subject);
    }
    return response;
  } catch (e) {
    console.error('Email alert error:', e);
    return null;
  }
}

async function sendWhatsAppAlert(message: string) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ALERT_WHATSAPP_TO) {
    console.log('Twilio WhatsApp not configured, skipping WhatsApp alert');
    return null;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

    const body = new URLSearchParams({
      From: TWILIO_WHATSAPP_FROM,
      To: ALERT_WHATSAPP_TO,
      Body: message
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!response.ok) {
      console.error('Twilio WhatsApp error:', response.status, await response.text());
    } else {
      console.log('WhatsApp alert sent');
    }
    return response;
  } catch (e) {
    console.error('WhatsApp alert error:', e);
    return null;
  }
}

async function sendAlert(title: string, details: string, severity: 'critical' | 'warning' | 'info') {
  const emoji = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🔵';
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  // WhatsApp — short and urgent
  const whatsappMsg = `${emoji} ${title}\n\n${details}\n\n⏰ ${timestamp}`;

  // Email — detailed HTML
  const emailHtml = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5;">
      <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <div style="background:${severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#f59e0b' : '#3b82f6'};padding:20px 30px;">
          <h1 style="color:white;margin:0;font-size:20px;">${emoji} Health Check Alert</h1>
        </div>
        <div style="padding:30px;">
          <h2 style="color:#1a1a1a;margin:0 0 15px;">${title}</h2>
          <div style="background:#f8f8f8;padding:16px;border-radius:8px;border-left:4px solid ${severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#f59e0b' : '#3b82f6'};">
            <pre style="margin:0;white-space:pre-wrap;font-size:14px;color:#333;">${details}</pre>
          </div>
          <p style="color:#999;font-size:12px;margin:20px 0 0;">RQC Health Check • ${timestamp}</p>
        </div>
      </div>
    </body>
    </html>
  `;

  // Send all channels in parallel (SMS is the reliable urgent one).
  await Promise.allSettled([
    sendEmailAlert(`${emoji} ${title}`, emailHtml),
    sendWhatsAppAlert(whatsappMsg),
    ALERT_SMS_TO
      ? sendSms(ALERT_SMS_TO, whatsappMsg).then((r) => {
          if (!r.ok) console.warn('SMS alert not sent:', r.error);
        })
      : Promise.resolve(),
  ]);
}

// ============================================================================
// HEALTH CHECKS
// ============================================================================

interface CheckResult {
  name: string;
  status: 'ok' | 'alert' | 'error';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  details?: any;
}

/**
 * CHECK 1: Songs stuck in generating/processing for more than 7 minutes
 */
async function checkStuckSongs(supabase: any): Promise<CheckResult> {
  try {
    const cutoff = new Date(Date.now() - STUCK_SONG_MINUTES * 60 * 1000).toISOString();
    // Lower bound: only look at the last 24h. Without it, permanently-stuck
    // zombie rows (e.g. the Mar–May 2026 batch cleaned on 2026-08-05) keep this
    // check in a constant alert state, and real incidents — like the 08-05 Suno
    // outage — no longer stand out.
    const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: stuckSongs, error } = await supabase
      .from('songs')
      .select('id, recipient_name, email, status, created_at, platform, provider')
      .in('status', ['generating', 'processing', 'pending', 'callback_received', 'pending_upload'])
      .lt('created_at', cutoff)
      .gt('created_at', windowStart)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (stuckSongs && stuckSongs.length > 0) {
      const details = stuckSongs.map((s: any) => {
        const mins = Math.round((Date.now() - new Date(s.created_at).getTime()) / 60000);
        return `• ${s.recipient_name || 'Unknown'} (${s.status}) — stuck ${mins} min — ${s.email || 'no email'}`;
      }).join('\n');

      return {
        name: 'Stuck Songs',
        status: 'alert',
        severity: 'critical',
        message: `${stuckSongs.length} song(s) stuck for more than ${STUCK_SONG_MINUTES} minutes`,
        details: `${stuckSongs.length} stuck song(s):\n\n${details}`
      };
    }

    return {
      name: 'Stuck Songs',
      status: 'ok',
      severity: 'info',
      message: 'No stuck songs'
    };
  } catch (e) {
    return {
      name: 'Stuck Songs',
      status: 'error',
      severity: 'critical',
      message: `Check failed: ${e.message}`
    };
  }
}

/**
 * CHECK 2: Payment sync — songs with stripe_session_id but not marked paid
 * Checks Stripe API to confirm if payment was actually completed
 */
async function checkPaymentSync(supabase: any): Promise<CheckResult> {
  try {
    const lookbackTime = new Date(Date.now() - PAYMENT_SYNC_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    // Find songs that have a Stripe session but aren't marked as paid
    const { data: unpaidWithStripe, error } = await supabase
      .from('songs')
      .select('id, recipient_name, email, stripe_session_id, created_at, paid, payment_status, platform')
      .not('stripe_session_id', 'is', null)
      .eq('paid', false)
      .gte('created_at', lookbackTime)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!unpaidWithStripe || unpaidWithStripe.length === 0) {
      return {
        name: 'Payment Sync',
        status: 'ok',
        severity: 'info',
        message: 'All recent payments synced correctly'
      };
    }

    // Verify each with Stripe API
    if (!STRIPE_SECRET_KEY) {
      return {
        name: 'Payment Sync',
        status: 'alert',
        severity: 'warning',
        message: `${unpaidWithStripe.length} song(s) with Stripe session but not marked paid (can't verify — no Stripe key)`,
        details: unpaidWithStripe.map((s: any) => `• ${s.recipient_name} — ${s.email}`).join('\n')
      };
    }

    const mismatches: any[] = [];
    for (const song of unpaidWithStripe) {
      try {
        const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${song.stripe_session_id}`, {
          headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` }
        });
        if (res.ok) {
          const session = await res.json();
          if (session.payment_status === 'paid') {
            mismatches.push({
              ...song,
              stripe_status: session.payment_status,
              amount: session.amount_total
            });
          }
        }
      } catch (e) {
        console.error(`Stripe check failed for ${song.stripe_session_id}:`, e);
      }
    }

    if (mismatches.length > 0) {
      const details = mismatches.map((s: any) => {
        const amount = s.amount ? `$${(s.amount / 100).toFixed(2)}` : 'unknown';
        return `• ${s.recipient_name || 'Unknown'} — ${s.email || 'no email'} — ${amount} PAID in Stripe but NOT in DB`;
      }).join('\n');

      return {
        name: 'Payment Sync',
        status: 'alert',
        severity: 'critical',
        message: `${mismatches.length} payment(s) completed in Stripe but NOT marked paid in database!`,
        details: `REVENUE AT RISK:\n\n${details}\n\nThese customers paid but may not have received their song.`
      };
    }

    return {
      name: 'Payment Sync',
      status: 'ok',
      severity: 'info',
      message: `${unpaidWithStripe.length} unpaid session(s) checked — none are paid in Stripe`
    };
  } catch (e) {
    return {
      name: 'Payment Sync',
      status: 'error',
      severity: 'critical',
      message: `Check failed: ${e.message}`
    };
  }
}

/**
 * CHECK 3: Failed songs spike — too many failures in the last hour
 */
async function checkFailedSongsSpike(supabase: any): Promise<CheckResult> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentFailed, error, count } = await supabase
      .from('songs')
      .select('id, recipient_name, email, error_message, provider, platform', { count: 'exact' })
      .eq('status', 'failed')
      .gte('updated_at', oneHourAgo)
      .not('error_message', 'ilike', 'Ops cleanup%'); // bulk zombie closures are not real failures

    if (error) throw error;

    const failCount = count || 0;

    if (failCount >= FAILED_SPIKE_THRESHOLD) {
      const details = (recentFailed || []).slice(0, 10).map((s: any) => {
        const errMsg = s.error_message ? s.error_message.substring(0, 80) : 'No error message';
        return `• ${s.recipient_name || 'Unknown'} — ${errMsg}`;
      }).join('\n');

      return {
        name: 'Failed Songs Spike',
        status: 'alert',
        severity: 'critical',
        message: `${failCount} song(s) failed in the last hour (threshold: ${FAILED_SPIKE_THRESHOLD})`,
        details: `${failCount} failures in the last hour:\n\n${details}${failCount > 10 ? `\n\n... and ${failCount - 10} more` : ''}`
      };
    }

    return {
      name: 'Failed Songs Spike',
      status: 'ok',
      severity: 'info',
      message: `${failCount} failure(s) in the last hour — within normal range`
    };
  } catch (e) {
    return {
      name: 'Failed Songs Spike',
      status: 'error',
      severity: 'warning',
      message: `Check failed: ${e.message}`
    };
  }
}

/**
 * CHECK 4: WhatsApp phone capture rate — are we losing lead data?
 */
async function checkWhatsAppCaptureRate(supabase: any): Promise<CheckResult> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Total songs in last 24h (only RQC platform — MadeYouASong may not collect WhatsApp)
    const { count: totalCount } = await supabase
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', twentyFourHoursAgo)
      .or('platform.eq.regalos_que_cantan,platform.is.null');

    // Songs WITH whatsapp phone
    const { count: withPhoneCount } = await supabase
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', twentyFourHoursAgo)
      .or('platform.eq.regalos_que_cantan,platform.is.null')
      .not('whatsapp_phone', 'is', null);

    const total = totalCount || 0;
    const withPhone = withPhoneCount || 0;

    if (total === 0) {
      return {
        name: 'WhatsApp Capture Rate',
        status: 'ok',
        severity: 'info',
        message: 'No songs in last 24 hours to check'
      };
    }

    const captureRate = Math.round((withPhone / total) * 100);

    if (captureRate < WHATSAPP_CAPTURE_MIN_PCT) {
      return {
        name: 'WhatsApp Capture Rate',
        status: 'alert',
        severity: 'warning',
        message: `WhatsApp phone capture rate is ${captureRate}% (${withPhone}/${total}) — below ${WHATSAPP_CAPTURE_MIN_PCT}% threshold`,
        details: `Only ${withPhone} out of ${total} songs in the last 24 hours have a WhatsApp phone number.\n\nCapture rate: ${captureRate}%\nThreshold: ${WHATSAPP_CAPTURE_MIN_PCT}%\n\nPossible causes:\n• RLS policy may be blocking updates again\n• Auto-save code may have a bug\n• Users are skipping the phone field`
      };
    }

    return {
      name: 'WhatsApp Capture Rate',
      status: 'ok',
      severity: 'info',
      message: `Capture rate: ${captureRate}% (${withPhone}/${total} songs) — healthy`
    };
  } catch (e) {
    return {
      name: 'WhatsApp Capture Rate',
      status: 'error',
      severity: 'warning',
      message: `Check failed: ${e.message}`
    };
  }
}

// ============================================================================
// SUPERVISOR ALARM — AI staff monitoring
/**
 * CHECK: Mureka fallback readiness. Mureka-via-useapi is the ONLY safety net
 * when Kie/Suno fails (see _shared/kie-recovery.ts), and the useapi↔Mureka
 * login expires roughly monthly — if it lapses during a Suno outage, songs
 * stop falling back and just fail. Two detectors:
 *   1. ACTIVE: hit useapi with the token. Only 401/403 alarms (auth dead);
 *      any other response proves the token is being accepted.
 *   2. PASSIVE: any song in the last hour whose error shows the handoff
 *      itself failed ("Mureka handoff failed/network error" or "no Mureka
 *      fallback available") — this is exactly how session expiry surfaces.
 * Both alarms are throttled to once per 6h via ops_alert_state.
 */
async function checkMurekaFallback(supabase: any): Promise<CheckResult> {
  const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');
  try {
    const problems: string[] = [];

    if (!USEAPI_TOKEN) {
      problems.push('USEAPI_TOKEN secret is not set — Mureka fallback cannot run at all');
    } else {
      try {
        const r = await fetch('https://api.useapi.net/v1/mureka/jobs/', {
          headers: { 'Authorization': `Bearer ${USEAPI_TOKEN}` },
        });
        if (r.status === 401 || r.status === 403) {
          problems.push(`useapi rejected the token (HTTP ${r.status}) — re-login at useapi.net needed`);
        }
      } catch (e: any) {
        // Network blip ≠ expired session; log only, the passive check still guards.
        console.warn('useapi active probe network error:', e.message);
      }
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: handoffFails } = await supabase
      .from('songs')
      .select('id, recipient_name, error_message')
      .gte('updated_at', oneHourAgo)
      .or('error_message.ilike.%Mureka handoff failed%,error_message.ilike.%Mureka handoff network error%,error_message.ilike.%no Mureka fallback available%');
    if (handoffFails && handoffFails.length > 0) {
      const sample = handoffFails.slice(0, 5).map((s: any) =>
        `• ${s.recipient_name || 'Unknown'} — ${(s.error_message || '').substring(0, 100)}`).join('\n');
      problems.push(`${handoffFails.length} Mureka handoff failure(s) in the last hour:\n${sample}`);
    }

    if (problems.length > 0) {
      const fire = await shouldAlert(supabase, 'mureka_fallback_broken', 6);
      return {
        name: 'Mureka Fallback Readiness',
        status: fire ? 'alert' : 'ok',
        severity: 'critical',
        message: `Mureka fallback may be BROKEN${fire ? '' : ' (already alerted, suppressed)'}`,
        details: `The Kie→Mureka safety net is not healthy. If Suno fails now, songs will NOT fall back.\n\n${problems.join('\n\n')}\n\nFix: log in again at useapi.net (session expires ~monthly), then verify with a test song.`
      };
    }

    return {
      name: 'Mureka Fallback Readiness',
      status: 'ok',
      severity: 'info',
      message: 'useapi token accepted; no handoff failures in the last hour'
    };
  } catch (e: any) {
    return {
      name: 'Mureka Fallback Readiness',
      status: 'error',
      severity: 'warning',
      message: `Check failed: ${e.message}`
    };
  }
}

// ============================================================================

/**
 * CHECK 9: Meta CAPI token canary (added 2026-08-27 after the token expired
 * silently on 08-25 and every server-side Purchase event failed for ~24h with
 * no alert). Validates the EXACT credential stripe-webhook's CAPI sender uses
 * (same env fallback chain) with a cheap read of the pixel object. An OAuth
 * error here means purchases are not reaching Meta server-side right now.
 * Throttled to once per 6h via ops_alert_state so a dead token pages once a
 * shift, not every 10 minutes.
 */
const CAPI_META_PIXEL_ID = Deno.env.get('META_PIXEL_ID') || '';
const CAPI_META_TOKEN =
  Deno.env.get('META_CAPI_ACCESS_TOKEN') ||
  Deno.env.get('META_ACCESS_TOKEN') ||
  Deno.env.get('META_CONVERSIONS_API_TOKEN') ||
  '';

async function checkMetaCapiToken(supabase: any): Promise<CheckResult> {
  const name = 'Meta CAPI Token';
  try {
    if (!CAPI_META_PIXEL_ID || !CAPI_META_TOKEN) {
      if (await shouldAlert(supabase, 'meta_capi_token_unset', 24)) {
        return {
          name, status: 'alert', severity: 'warning',
          message: 'META_PIXEL_ID / CAPI token not configured — server-side purchase events are OFF',
          details: 'stripe-webhook is skipping every Meta CAPI Purchase send because the pixel id or access token secret is unset. Set META_CAPI_ACCESS_TOKEN and redeploy stripe-webhook + create-checkout.'
        };
      }
      return { name, status: 'ok', severity: 'info', message: 'not configured (already alerted)' };
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    let resp: Response;
    try {
      resp = await fetch(
        `https://graph.facebook.com/v19.0/${CAPI_META_PIXEL_ID}?fields=id&access_token=${encodeURIComponent(CAPI_META_TOKEN)}`,
        { signal: ctrl.signal }
      );
    } finally {
      clearTimeout(t);
    }

    if (resp.ok) {
      return { name, status: 'ok', severity: 'info', message: 'token valid' };
    }

    const body = await resp.json().catch(() => ({} as any));
    const err = body?.error || {};
    const isOAuth = err?.code === 190 || err?.type === 'OAuthException';
    const detail = String(err?.message || `HTTP ${resp.status}`).slice(0, 300);

    if (isOAuth) {
      if (await shouldAlert(supabase, 'meta_capi_token_dead', 6)) {
        return {
          name, status: 'alert', severity: 'critical',
          message: 'Meta access token EXPIRED/INVALID — purchases are NOT reaching Meta server-side',
          details: `Meta rejected the CAPI credential: "${detail}"\n\nEvery server-side Purchase/InitiateCheckout/relay event is failing right now (campaign optimization is running on browser-pixel data only).\n\nFix:\n1. Events Manager → Regalos Que Cantan 2026 → Settings → Conversions API → Generate access token (a System User token never expires)\n2. supabase secrets set META_CAPI_ACCESS_TOKEN=<token> --project-ref yzbvajungshqcpusfiia\n3. Redeploy stripe-webhook, create-checkout, meta-capi-relay to force fresh instances\n4. Verify "[meta-capi] Purchase sent" lines return in the function logs`
        };
      }
      return { name, status: 'ok', severity: 'info', message: 'token dead (already alerted this window)' };
    }

    // Non-OAuth failure (permissions change, Meta hiccup) — warn, longer throttle.
    if (await shouldAlert(supabase, 'meta_capi_token_other', 12)) {
      return {
        name, status: 'alert', severity: 'warning',
        message: `Meta CAPI credential check failed (HTTP ${resp.status})`,
        details: `Graph API refused the pixel read the CAPI sender depends on: "${detail}". If this persists, server-side events may be failing — check stripe-webhook logs for [meta-capi] errors.`
      };
    }
    return { name, status: 'ok', severity: 'info', message: `non-OAuth failure (already alerted): ${detail.slice(0, 80)}` };
  } catch (e: any) {
    // Network blip from the canary itself — don't page on our own timeout.
    return { name, status: 'ok', severity: 'info', message: `canary fetch failed (${String(e?.message || e).slice(0, 60)}) — will retry next run` };
  }
}

/**
 * Throttle helper: returns true (and stamps the state row) only if we have NOT
 * alerted on this key within the last `hours`. Prevents a persistent condition
 * from re-alerting on every 10-minute run.
 */
async function shouldAlert(supabase: any, key: string, hours: number): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('ops_alert_state')
      .select('last_alerted_at')
      .eq('key', key)
      .maybeSingle();
    if (data && Date.now() - new Date(data.last_alerted_at).getTime() < hours * 3600 * 1000) {
      return false;
    }
    await supabase.from('ops_alert_state').upsert({ key, last_alerted_at: new Date().toISOString() });
    return true;
  } catch (e) {
    console.warn('ops_alert_state check failed, alerting anyway:', e.message);
    return true;
  }
}

// agent_runs.agent value → the pg_cron job that should be running it
const DAILY_AGENTS = [
  { agent: 'media-buyer', job: 'media-buyer-daily' },
  { agent: 'chief-of-staff', job: 'chief-of-staff-daily' },
  { agent: 'creative-studio', job: 'creative-studio-daily' },
];
const WEEKLY_AGENTS = [
  { agent: 'email-marketer', job: 'email-marketer-weekly' },
  { agent: 'competitor-scan', job: 'competitor-scan' },
  { agent: 'affiliate-recruiter', job: 'affiliate-recruiter' },
];

/**
 * CHECK 5: AI agent health — did each agent run on schedule, did its last run
 * error, and is its cron job still enabled? (This is the check that would have
 * caught creative-studio-daily being silently disabled for 4 days.)
 */
async function checkAgentHealth(supabase: any): Promise<CheckResult> {
  try {
    const issues: string[] = [];

    // Cron job status via SECURITY DEFINER function (cron schema isn't
    // reachable through PostgREST directly).
    const cronByName: Record<string, any> = {};
    const { data: cronJobs, error: cronErr } = await supabase.rpc('get_agent_cron_status');
    if (cronErr) {
      console.warn('get_agent_cron_status failed:', cronErr.message);
    } else {
      for (const j of cronJobs || []) cronByName[j.jobname] = j;
    }

    // Recent agent runs (9 days covers the weekly agents' window).
    const nineDaysAgo = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
    const { data: runs, error: runsErr } = await supabase
      .from('agent_runs')
      .select('agent, status, ok, error, started_at')
      .gte('started_at', nineDaysAgo)
      .order('started_at', { ascending: false })
      .limit(300);
    if (runsErr) throw runsErr;

    const latestRun: Record<string, any> = {};
    const latestOkRun: Record<string, any> = {};
    for (const r of runs || []) {
      if (!latestRun[r.agent]) latestRun[r.agent] = r;
      if (!latestOkRun[r.agent] && r.status === 'ok') latestOkRun[r.agent] = r;
    }

    const checkAgent = (agent: string, job: string, maxAgeMs: number, label: string) => {
      const cron = cronByName[job];
      if (cron && cron.active === false) {
        issues.push(`⏸️ ${job} cron is DISABLED — ${agent} is not running at all`);
        return; // can't be stale if it's switched off; the line above says it all
      }
      if (cron && cron.last_status === 'failed') {
        issues.push(`❌ ${job} cron's last trigger FAILED at the scheduler level`);
      }
      const last = latestRun[agent];
      if (last && last.status !== 'ok') {
        const err = (last.error || '').substring(0, 120);
        issues.push(`❌ ${agent}: last run ERRORED (${new Date(last.started_at).toISOString().slice(0, 16)}Z)${err ? ` — ${err}` : ''}`);
      }
      const lastOk = latestOkRun[agent];
      if (!lastOk) {
        issues.push(`🕳️ ${agent}: no successful run in the last 9 days (expected ${label})`);
      } else if (Date.now() - new Date(lastOk.started_at).getTime() > maxAgeMs) {
        const hrs = Math.round((Date.now() - new Date(lastOk.started_at).getTime()) / 3600000);
        issues.push(`⌛ ${agent}: last successful run was ${hrs}h ago (expected ${label})`);
      }
    };

    for (const a of DAILY_AGENTS) checkAgent(a.agent, a.job, DAILY_AGENT_MAX_AGE_HOURS * 3600 * 1000, 'daily');
    for (const a of WEEKLY_AGENTS) checkAgent(a.agent, a.job, WEEKLY_AGENT_MAX_AGE_DAYS * 24 * 3600 * 1000, 'weekly');

    if (issues.length > 0) {
      const fire = await shouldAlert(supabase, 'agent-health', 20);
      return {
        name: 'AI Agent Health',
        status: fire ? 'alert' : 'ok',
        severity: 'warning',
        message: `${issues.length} agent issue(s)${fire ? '' : ' (already alerted, suppressed)'}`,
        details: `AI staff supervisor found:\n\n${issues.join('\n')}`
      };
    }

    return { name: 'AI Agent Health', status: 'ok', severity: 'info', message: 'All agents ran on schedule' };
  } catch (e) {
    return { name: 'AI Agent Health', status: 'error', severity: 'warning', message: `Check failed: ${e.message}` };
  }
}

/**
 * CHECK 6: Stale approvals — AI work sitting in a queue waiting for the owner.
 * (SMS drafts to customers, marketing emails pending approval.)
 */
async function checkStaleApprovals(supabase: any): Promise<CheckResult> {
  try {
    const issues: string[] = [];

    const draftCutoff = new Date(Date.now() - SMS_DRAFT_MAX_AGE_HOURS * 3600 * 1000).toISOString();
    const { count: staleDrafts } = await supabase
      .from('sms_messages')
      .select('id', { count: 'exact', head: true })
      .eq('direction', 'outbound')
      .eq('status', 'draft')
      .lt('created_at', draftCutoff);
    if ((staleDrafts || 0) > 0) {
      issues.push(`💬 ${staleDrafts} customer repl${staleDrafts === 1 ? 'y' : 'ies'} drafted >24h ago still waiting in the SMS inbox — customers are getting no answer`);
    }

    const emailCutoff = new Date(Date.now() - EMAIL_APPROVAL_MAX_AGE_HOURS * 3600 * 1000).toISOString();
    const { count: staleEmails } = await supabase
      .from('email_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending_approval')
      .lt('created_at', emailCutoff);
    if ((staleEmails || 0) > 0) {
      issues.push(`📧 ${staleEmails} marketing email(s) waiting for approval for 3+ days — this week's campaigns are not going out`);
    }

    if (issues.length > 0) {
      const fire = await shouldAlert(supabase, 'stale-approvals', 12);
      return {
        name: 'Stale Approvals',
        status: fire ? 'alert' : 'ok',
        severity: 'warning',
        message: `${issues.length} approval queue(s) going stale${fire ? '' : ' (already alerted, suppressed)'}`,
        details: issues.join('\n')
      };
    }

    return { name: 'Stale Approvals', status: 'ok', severity: 'info', message: 'No stale approval queues' };
  } catch (e) {
    return { name: 'Stale Approvals', status: 'error', severity: 'warning', message: `Check failed: ${e.message}` };
  }
}

/**
 * CHECK 7: Creative pipeline stuck — poll-creative-queue normally fails a job
 * after 20 min, so anything still 'generating' after an hour means the poller
 * itself is broken.
 */
async function checkCreativePipeline(supabase: any): Promise<CheckResult> {
  try {
    const cutoff = new Date(Date.now() - CREATIVE_GENERATING_MAX_MINUTES * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('creative_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'generating')
      .lt('created_at', cutoff);

    if ((count || 0) > 0) {
      const fire = await shouldAlert(supabase, 'creative-pipeline', 6);
      return {
        name: 'Creative Pipeline',
        status: fire ? 'alert' : 'ok',
        severity: 'warning',
        message: `${count} creative(s) stuck in 'generating' >${CREATIVE_GENERATING_MAX_MINUTES} min${fire ? '' : ' (already alerted, suppressed)'}`,
        details: `${count} creative_queue row(s) have been 'generating' for over ${CREATIVE_GENERATING_MAX_MINUTES} minutes.\n\npoll-creative-queue should have finished or failed them at 20 min — the poller may be broken or its cron disabled.`
      };
    }

    return { name: 'Creative Pipeline', status: 'ok', severity: 'info', message: 'No stuck creative jobs' };
  } catch (e) {
    return { name: 'Creative Pipeline', status: 'error', severity: 'warning', message: `Check failed: ${e.message}` };
  }
}

/**
 * CHECK 8: Clona Mi Voz pipeline — PAID cloned-voice songs that are stuck,
 * failed, or missing their permanent audio copy. The poll-cloned-voice-songs
 * sweeper (every 2 min) normally finishes/alerts these itself; this check is
 * the backstop for the sweeper being broken or its cron disabled. Suno CDN
 * URLs expire in ~14 days, so a stuck paid row is a countdown to lost audio
 * (it already happened once: the 2026-08-08 paid test order).
 */
async function checkClonamivozPipeline(supabase: any): Promise<CheckResult> {
  try {
    const stuckCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const windowStart = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [stuckRes, failedRes, unhostedRes] = await Promise.all([
      supabase
        .from('cloned_voice_songs')
        .select('id', { count: 'exact', head: true })
        .eq('paid', true)
        .in('status', ['paid', 'generating_song'])
        .lt('paid_at', stuckCutoff)
        .gt('paid_at', windowStart),
      supabase
        .from('cloned_voice_songs')
        .select('id', { count: 'exact', head: true })
        .eq('paid', true)
        .eq('status', 'failed')
        .gt('paid_at', windowStart),
      supabase
        .from('cloned_voice_songs')
        .select('id', { count: 'exact', head: true })
        .eq('paid', true)
        .eq('status', 'success')
        .is('permanent_audio_urls', null)
        .gt('paid_at', windowStart),
    ]);

    const stuck = stuckRes.count || 0;
    const failed = failedRes.count || 0;
    const unhosted = unhostedRes.count || 0;

    if (stuck + failed + unhosted > 0) {
      const fire = await shouldAlert(supabase, 'clonamivoz-pipeline', 6);
      const parts: string[] = [];
      if (stuck) parts.push(`${stuck} paid song(s) stuck >30 min`);
      if (failed) parts.push(`${failed} paid song(s) FAILED`);
      if (unhosted) parts.push(`${unhosted} paid song(s) without permanent audio copy`);
      return {
        name: 'Clona Mi Voz Pipeline',
        status: fire ? 'alert' : 'ok',
        severity: 'critical',
        message: `${parts.join(', ')}${fire ? '' : ' (already alerted, suppressed)'}`,
        details:
          `Clona Mi Voz paid orders need attention (last 14 days):\n\n• ${parts.join('\n• ')}\n\n` +
          `Check /admin?tab=clonamivoz and the poll-cloned-voice-songs sweeper (cron 'poll-cloned-voice-songs-tick'). ` +
          `Suno CDN URLs expire ~14 days after generation — unhosted successes are on a countdown.`,
      };
    }

    return { name: 'Clona Mi Voz Pipeline', status: 'ok', severity: 'info', message: 'No paid cloned-voice orders need attention' };
  } catch (e) {
    return { name: 'Clona Mi Voz Pipeline', status: 'error', severity: 'warning', message: `Check failed: ${e.message}` };
  }
}

/**
 * CHECK 11: Audio liveness — songs completed/updated in the last 30 min must
 * actually SERVE audio, not just have a URL. 2026-08-28: Kie's musicfile.kie.ai
 * CDN went signed-URL-only and every fresh song 403'd for ~2 hours; the first
 * signal we got was a customer complaint. This probe would have paged at the
 * first 10-minute run instead.
 */
async function checkAudioLiveness(supabase: any): Promise<CheckResult> {
  const name = 'Audio Liveness';
  try {
    const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recent, error } = await supabase
      .from('songs')
      .select('id, recipient_name, audio_url, paid, updated_at')
      .eq('status', 'completed')
      .gt('updated_at', windowStart)
      .not('audio_url', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    if (!recent || recent.length === 0) {
      return { name, status: 'ok', severity: 'info', message: 'no completions in the last 30 min to probe' };
    }

    const probe = async (s: any) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch(s.audio_url, { headers: { Range: 'bytes=0-256' }, signal: ctrl.signal });
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const ok = (r.status === 200 || r.status === 206) &&
          (ct.startsWith('audio') || ct.includes('mpeg') || ct.includes('octet-stream'));
        return ok ? null : { ...s, http: r.status, ct: ct || 'none' };
      } catch (e: any) {
        // A single network blip shouldn't page; fetch errors still count as
        // dead because the customer's browser hits the same wall.
        return { ...s, http: 0, ct: String(e?.message || e).slice(0, 40) };
      } finally {
        clearTimeout(t);
      }
    };
    const dead = (await Promise.all(recent.map(probe))).filter(Boolean) as any[];
    if (dead.length === 0) {
      return { name, status: 'ok', severity: 'info', message: `${recent.length} recent song(s) all serving audio` };
    }

    const paidDead = dead.filter((d) => d.paid).length;
    if (await shouldAlert(supabase, 'audio_liveness_dead', 1)) {
      const sample = dead.slice(0, 8)
        .map((d) => `• ${d.recipient_name || d.id} — HTTP ${d.http} (${d.ct}) — ${String(d.audio_url).slice(0, 70)}`)
        .join('\n');
      return {
        name, status: 'alert', severity: 'critical',
        message: `${dead.length}/${recent.length} recently completed song(s) serve NO audio${paidDead ? ` — ${paidDead} PAID` : ''}`,
        details:
          `Customers are hitting play and getting silence RIGHT NOW.\n\n${sample}\n\n` +
          `If the failing host is Kie's (musicfile.kie.ai / tempfile.aiquickdraw.com): their CDN broke again ` +
          `(2026-08-28 incident) — check poll-processing-songs [RE-UPLOAD] logs; unpaid songs auto-regenerate ` +
          `after 15 min, PAID songs need a manual decision (regenerate loses the voice).\n` +
          `If the failing host is OUR storage (supabase.co): storage itself is down — check the audio bucket immediately.`,
      };
    }
    return { name, status: 'ok', severity: 'info', message: `${dead.length} dead audio URL(s) (already alerted this hour)` };
  } catch (e: any) {
    return { name, status: 'error', severity: 'warning', message: `Check failed: ${e.message}` };
  }
}

/**
 * CHECK 12: Player errors — customer browsers report <audio> failures via the
 * playback-beacon function (src/utils/playbackBeacon.js). Catches whatever the
 * server-side probe can't see: regional CDN failures, mixed-content, expired
 * links on OLD songs a customer just opened. Threshold of 3 distinct songs in
 * 30 min so one customer's flaky wifi never pages.
 */
async function checkPlaybackErrors(supabase: any): Promise<CheckResult> {
  const name = 'Player Errors';
  try {
    const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: rows, error } = await supabase
      .from('playback_errors')
      .select('song_id, audio_host, page')
      .gt('created_at', windowStart)
      .limit(500);
    if (error) throw error;

    const distinct = new Set((rows || []).map((r: any) => r.song_id));
    if (distinct.size < 3) {
      return { name, status: 'ok', severity: 'info', message: `${rows?.length || 0} beacon(s) / ${distinct.size} song(s) in 30 min` };
    }

    if (await shouldAlert(supabase, 'playback_errors_spike', 1)) {
      const byHost: Record<string, number> = {};
      for (const r of rows || []) byHost[r.audio_host || 'unknown'] = (byHost[r.audio_host || 'unknown'] || 0) + 1;
      const hosts = Object.entries(byHost).map(([h, n]) => `${h}: ${n}`).join(', ');
      return {
        name, status: 'alert', severity: 'critical',
        message: `${distinct.size} different songs failed to play in customers' browsers (last 30 min)`,
        details:
          `${rows!.length} playback-error beacon(s) from real customers across ${distinct.size} songs.\n` +
          `Failing hosts: ${hosts}\n\n` +
          `This is measured on customer devices — whatever the cause (CDN, storage, DNS), buyers are hearing silence. ` +
          `Cross-check the Audio Liveness alert; recent rows: SELECT * FROM playback_errors ORDER BY created_at DESC LIMIT 50;`,
      };
    }
    return { name, status: 'ok', severity: 'info', message: `${distinct.size} failing song(s) (already alerted this hour)` };
  } catch (e: any) {
    return { name, status: 'error', severity: 'warning', message: `Check failed: ${e.message}` };
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      }
    });
  }

  const startTime = Date.now();
  console.log('🏥 Health check started at', new Date().toISOString());

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Run all checks in parallel
  const results = await Promise.all([
    checkStuckSongs(supabase),
    checkPaymentSync(supabase),
    checkFailedSongsSpike(supabase),
    checkWhatsAppCaptureRate(supabase),
    checkAgentHealth(supabase),
    checkStaleApprovals(supabase),
    checkCreativePipeline(supabase),
    checkMurekaFallback(supabase),
    checkMetaCapiToken(supabase),
    checkClonamivozPipeline(supabase),
    checkAudioLiveness(supabase),
    checkPlaybackErrors(supabase),
  ]);

  // Filter for alerts
  const alerts = results.filter(r => r.status === 'alert' || r.status === 'error');

  // Send alerts for each issue found
  for (const alert of alerts) {
    await sendAlert(
      `${alert.name}: ${alert.message}`,
      alert.details || alert.message,
      alert.severity
    );
  }

  // Log summary to health_check_log table (if it exists)
  try {
    await supabase.from('health_check_log').insert({
      checked_at: new Date().toISOString(),
      results: JSON.stringify(results),
      alerts_count: alerts.length,
      all_ok: alerts.length === 0,
      execution_ms: Date.now() - startTime
    });
  } catch (e) {
    // Table might not exist yet — that's fine
    console.log('Could not log to health_check_log table:', e.message);
  }

  const summary = results.map(r => {
    const icon = r.status === 'ok' ? '✅' : r.status === 'alert' ? '🚨' : '❌';
    return `${icon} ${r.name}: ${r.message}`;
  }).join('\n');

  console.log(`\n🏥 Health Check Summary:\n${summary}`);
  console.log(`\nCompleted in ${Date.now() - startTime}ms — ${alerts.length} alert(s)`);

  return new Response(
    JSON.stringify({
      status: alerts.length === 0 ? 'healthy' : 'alerts',
      alerts_count: alerts.length,
      results,
      execution_ms: Date.now() - startTime,
      timestamp: new Date().toISOString()
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    }
  );
});
