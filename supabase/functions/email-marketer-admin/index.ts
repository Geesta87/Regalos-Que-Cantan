// supabase/functions/email-marketer-admin/index.ts
// ===========================================================================
// EMAIL MARKETER — admin (review / test / approve / reject)
// ===========================================================================
// Powers the Creative Studio "Emails" section. Lists the drafted weekly emails,
// sends a TEST to the owner, and on APPROVE snapshots the marketing audience
// (v_marketing_audience, suppression already excluded) into email_recipients
// and flips the email to 'sending' — the email-marketer-send cron does the
// throttled per-recipient delivery.
//
// Admin-only (it triggers a real send). verify_jwt = true.
// Deploy: supabase functions deploy email-marketer-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders, buildUnsubscribeUrl } from '../_shared/unsubscribe.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'Regalos Que Cantan';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

async function sendOne(to: string, subject: string, html: string) {
  if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');
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
      categories: ['marketing_weekly', 'rqc_marketing'],
      headers,
      tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true }, subscription_tracking: { enable: false } },
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {} }
    const action = body.action || 'list';

    if (action === 'list') {
      const { data, error } = await admin.from('email_queue')
        .select('id, week_of, reason, subject, preview_text, body_html, cta_text, status, recipients_total, recipients_sent, sent_at, error, created_at')
        .order('created_at', { ascending: false }).limit(40);
      if (error) return json({ success: false, error: error.message }, 500);
      // audience size for the UI ("will go to N people")
      const { count } = await admin.from('v_marketing_audience').select('email', { count: 'exact', head: true });
      return json({ success: true, role: roleRow.role, emails: data || [], audience_size: count || 0 });
    }

    if (!body.id) return json({ success: false, error: 'Missing id' }, 400);
    const { data: em } = await admin.from('email_queue').select('*').eq('id', body.id).single();
    if (!em) return json({ success: false, error: 'Email not found' }, 404);

    if (action === 'test') {
      const to = (body.email || ud.user.email || '').toString();
      if (!to) return json({ success: false, error: 'No test address' }, 400);
      try { await sendOne(to, `[PRUEBA] ${em.subject}`, em.body_html); }
      catch (e: any) { return json({ success: false, error: e?.message || String(e) }, 502); }
      return json({ success: true, sent_to: to });
    }

    if (action === 'reject') {
      await admin.from('email_queue').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', em.id);
      return json({ success: true, id: em.id, status: 'rejected' });
    }

    if (action === 'approve') {
      if (em.status !== 'pending_approval') return json({ success: false, error: `Not approvable (status=${em.status})` }, 409);
      const { data: count, error: rpcErr } = await admin.rpc('enqueue_marketing_recipients', { qid: em.id });
      if (rpcErr) return json({ success: false, error: rpcErr.message }, 500);
      const now = new Date().toISOString();
      await admin.from('email_queue').update({
        status: 'sending', recipients_total: count || 0, approved_at: now, sending_started_at: now, updated_at: now,
      }).eq('id', em.id);
      return json({ success: true, id: em.id, status: 'sending', recipients_total: count || 0 });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('email-marketer-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
