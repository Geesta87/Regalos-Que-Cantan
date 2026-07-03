// supabase/functions/cos-morning-digest/index.ts
// Sofía's morning digest — ONE WhatsApp message (plus email copy) every morning
// with yesterday's numbers, everything waiting on the owner's approval, and a
// one-line health status for each AI staff member.
//
// v1 is deliberately deterministic (no LLM call): numbers straight from the
// database, so it can never hallucinate and costs nothing to run.
// Trigger: pg_cron daily (cos-morning-digest job) — verify_jwt = false in config.toml.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM');
const ALERT_WHATSAPP_TO = Deno.env.get('ALERT_WHATSAPP_TO');
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const SENDER_EMAIL = 'hola@regalosquecantan.com';

// Owner's day is US Pacific (matches the Chief of Staff's reporting timezone).
const OWNER_TZ = 'America/Los_Angeles';

// Yesterday's [start, end) in UTC for the owner's timezone, plus a label.
function ownerDayBounds(daysAgo: number): { startISO: string; endISO: string; label: string } {
  const now = new Date();
  // Wall-clock time in OWNER_TZ, re-parsed as if it were UTC (edge runtime is UTC).
  const wall = new Date(now.toLocaleString('en-US', { timeZone: OWNER_TZ }));
  const offsetMs = now.getTime() - wall.getTime();
  const start = new Date(wall);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysAgo);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const label = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return {
    startISO: new Date(start.getTime() + offsetMs).toISOString(),
    endISO: new Date(end.getTime() + offsetMs).toISOString(),
    label,
  };
}

// agent_runs.agent → short display name for the team status line
const TEAM = [
  { agent: 'media-buyer', job: 'media-buyer-daily', name: 'MediaBuyer', cadenceHours: 26 },
  { agent: 'chief-of-staff', job: 'chief-of-staff-daily', name: 'Sofía', cadenceHours: 26 },
  { agent: 'creative-studio', job: 'creative-studio-daily', name: 'ArtDirector', cadenceHours: 26 },
  { agent: 'email-marketer', job: 'email-marketer-weekly', name: 'EmailMkt', cadenceHours: 8 * 24 },
  { agent: 'competitor-scan', job: 'competitor-scan', name: 'CompScan', cadenceHours: 8 * 24 },
  { agent: 'affiliate-recruiter', job: 'affiliate-recruiter', name: 'Recruiter', cadenceHours: 8 * 24 },
];

async function sendWhatsApp(message: string): Promise<boolean> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ALERT_WHATSAPP_TO) {
    console.log('Twilio WhatsApp not configured, skipping');
    return false;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
  const body = new URLSearchParams({ From: TWILIO_WHATSAPP_FROM, To: ALERT_WHATSAPP_TO, Body: message });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) console.error('Twilio error:', res.status, await res.text());
  return res.ok;
}

async function sendEmail(subject: string, text: string): Promise<boolean> {
  if (!SENDGRID_API_KEY) return false;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
      from: { email: SENDER_EMAIL, name: 'Sofía — Morning Digest' },
      subject,
      content: [{ type: 'text/plain', value: text }],
      categories: ['morning_digest', 'rqc_internal'],
      tracking_settings: {
        click_tracking: { enable: false },
        open_tracking: { enable: false },
        subscription_tracking: { enable: false },
      },
    }),
  });
  if (!res.ok) console.error('SendGrid error:', res.status, await res.text());
  return res.ok;
}

Deno.serve(async (_req: Request) => {
  const started = Date.now();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const day = ownerDayBounds(1); // yesterday

  // --- Yesterday's money (RQC funnel: platform='es', dedupe per Stripe session,
  // MAX(amount_paid) because 2-packs stamp the full total on both rows) ---
  const { data: paidRows } = await supabase
    .from('songs')
    .select('stripe_session_id, amount_paid')
    .eq('platform', 'es')
    .eq('paid', true)
    .not('stripe_session_id', 'is', null)
    .gte('created_at', day.startISO)
    .lt('created_at', day.endISO);

  const bySession = new Map<string, number>();
  for (const r of paidRows || []) {
    const amt = Number(r.amount_paid) || 0;
    const prev = bySession.get(r.stripe_session_id) || 0;
    if (amt > prev) bySession.set(r.stripe_session_id, amt);
  }
  const orders = bySession.size;
  const revenue = Array.from(bySession.values()).reduce((a, b) => a + b, 0);

  const { count: demos } = await supabase
    .from('songs')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'es')
    .gte('created_at', day.startISO)
    .lt('created_at', day.endISO);

  const convPct = demos ? ((orders / demos) * 100).toFixed(1) : '0.0';

  // --- Everything waiting on the owner ---
  const dayAgoISO = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const [emailsPending, smsDrafts, smsDraftsOld, cosActions, creativesReady] = await Promise.all([
    supabase.from('email_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval'),
    supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('direction', 'outbound').eq('status', 'draft'),
    supabase.from('sms_messages').select('id', { count: 'exact', head: true }).eq('direction', 'outbound').eq('status', 'draft').lt('created_at', dayAgoISO),
    supabase.from('cos_pending_actions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('creative_queue').select('id', { count: 'exact', head: true }).eq('status', 'ready'),
  ]);

  const waiting: string[] = [];
  if ((emailsPending.count || 0) > 0) waiting.push(`• ${emailsPending.count} marketing email(s) to approve`);
  if ((smsDrafts.count || 0) > 0) {
    const old = smsDraftsOld.count || 0;
    waiting.push(`• ${smsDrafts.count} SMS draft(s) to review${old ? ` (${old} older than 24h!)` : ''}`);
  }
  if ((cosActions.count || 0) > 0) waiting.push(`• ${cosActions.count} Sofía action(s) to confirm`);
  if ((creativesReady.count || 0) > 0) waiting.push(`• ${creativesReady.count} creative(s) ready for review`);

  // --- Team status line ---
  const cronByName: Record<string, any> = {};
  const { data: cronJobs } = await supabase.rpc('get_agent_cron_status');
  for (const j of cronJobs || []) cronByName[j.jobname] = j;

  const nineDaysAgo = new Date(Date.now() - 9 * 24 * 3600 * 1000).toISOString();
  const { data: runs } = await supabase
    .from('agent_runs')
    .select('agent, status, started_at')
    .gte('started_at', nineDaysAgo)
    .order('started_at', { ascending: false })
    .limit(300);

  const latestRun: Record<string, any> = {};
  const latestOk: Record<string, any> = {};
  for (const r of runs || []) {
    if (!latestRun[r.agent]) latestRun[r.agent] = r;
    if (!latestOk[r.agent] && r.status === 'ok') latestOk[r.agent] = r;
  }

  const team = TEAM.map((m) => {
    const cron = cronByName[m.job];
    if (cron && cron.active === false) return `${m.name} ⏸`;
    if (latestRun[m.agent] && latestRun[m.agent].status !== 'ok') return `${m.name} ❌`;
    const ok = latestOk[m.agent];
    if (!ok || Date.now() - new Date(ok.started_at).getTime() > m.cadenceHours * 3600 * 1000) return `${m.name} ⌛`;
    return `${m.name} ✅`;
  }).join(' · ');

  // --- Compose ---
  const lines = [
    `☀️ RQC Morning Digest — ${day.label}`,
    ``,
    `💰 Yesterday: $${revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })} · ${orders} orders · ${demos || 0} demos (${convPct}% buy)`,
    ``,
    waiting.length ? `📋 Waiting on you:` : `📋 Nothing waiting on you — all queues clear.`,
    ...waiting,
    ``,
    `🤖 Team: ${team}`,
  ];
  const message = lines.join('\n');

  const [wa, mail] = await Promise.all([
    sendWhatsApp(message),
    sendEmail(`☀️ Morning Digest — ${day.label}`, message),
  ]);

  console.log(`Digest sent (whatsapp=${wa}, email=${mail}) in ${Date.now() - started}ms\n${message}`);

  return new Response(
    JSON.stringify({ ok: true, whatsapp_sent: wa, email_sent: mail, digest: message, execution_ms: Date.now() - started }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
