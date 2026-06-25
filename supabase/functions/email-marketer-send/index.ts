// supabase/functions/email-marketer-send/index.ts
// ===========================================================================
// EMAIL MARKETER — sender (cron)
// ===========================================================================
// Runs every minute via pg_cron. For the oldest email_queue row in 'sending',
// delivers the next batch of pending recipients — one SendGrid call each, with
// per-recipient one-click unsubscribe + a defensive suppression re-check. Marks
// the email 'sent' when its recipient list is drained. Resumable + idempotent
// (each recipient flips pending → sent/failed). Batch is small enough that a run
// finishes well under the 60s cron interval, so runs never overlap.
//
// verify_jwt = false (pg_cron). Reads SENDGRID_API_KEY + UNSUBSCRIBE_SECRET.
// Deploy: supabase functions deploy email-marketer-send --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders, buildUnsubscribeUrl, isMarketingSuppressed } from '../_shared/unsubscribe.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'Regalos Que Cantan';
const BATCH = Number(Deno.env.get('EMAIL_SEND_BATCH') || '150');
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

async function sgSend(to: string, subject: string, html: string) {
  const body = html.replace(/\{\{UNSUB_URL\}\}/g, await buildUnsubscribeUrl(to));
  const headers = await buildUnsubscribeHeaders(to);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject, content: [{ type: 'text/html', value: body }],
      categories: ['marketing_weekly', 'rqc_marketing'], headers,
      tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true }, subscription_tracking: { enable: false } },
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (!SENDGRID_API_KEY) return json(200, { success: false, skipped: true, reason: 'SENDGRID_API_KEY missing' });

  try {
    const { data: q } = await supabase.from('email_queue')
      .select('id, subject, body_html, status').eq('status', 'sending')
      .order('sending_started_at', { ascending: true }).limit(1).maybeSingle();
    if (!q) return json(200, { success: true, idle: true });

    const { data: pending } = await supabase.from('email_recipients')
      .select('id, email').eq('email_queue_id', q.id).eq('status', 'pending').limit(BATCH);

    if (!pending || pending.length === 0) {
      await supabase.from('email_queue').update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', q.id);
      return json(200, { success: true, completed: q.id });
    }

    let sent = 0, failed = 0;
    for (const r of pending) {
      try {
        if (await isMarketingSuppressed(supabase, r.email)) {
          await supabase.from('email_recipients').update({ status: 'failed', error: 'suppressed', sent_at: new Date().toISOString() }).eq('id', r.id);
          failed++; continue;
        }
        await sgSend(r.email, q.subject, q.body_html);
        await supabase.from('email_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id);
        sent++;
      } catch (e: any) {
        await supabase.from('email_recipients').update({ status: 'failed', error: String(e?.message || e).slice(0, 300), sent_at: new Date().toISOString() }).eq('id', r.id);
        failed++;
      }
    }

    // Update progress counter.
    const { count } = await supabase.from('email_recipients')
      .select('id', { count: 'exact', head: true }).eq('email_queue_id', q.id).eq('status', 'sent');
    await supabase.from('email_queue').update({ recipients_sent: count || 0, updated_at: new Date().toISOString() }).eq('id', q.id);

    return json(200, { success: true, email: q.id, sent, failed, total_sent: count || 0 });
  } catch (e: any) {
    console.error('[email-marketer-send] error:', e?.message || e);
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
