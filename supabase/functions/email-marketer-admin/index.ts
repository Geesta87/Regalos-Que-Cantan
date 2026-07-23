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
import { buildEmailParts } from '../_shared/email.ts';
import { addUtm } from '../_shared/utm.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'Regalos Que Cantan';

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

// Valid audience segments — must match the CASE in enqueue_marketing_recipients
// and the SEGMENTS list in the Email Studio + Emails UI.
const VALID_SEGMENTS = ['all', 'buyers_7d', 'buyers_30d', 'recent', 'winback', 'video_buyers', 'no_video', 'nonbuyers', 'everyone_all'];

async function sendOne(to: string, subject: string, html: string, preheader = '') {
  if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');
  const resolved = html.replace(/\{\{UNSUB_URL\}\}/g, await buildUnsubscribeUrl(to));
  const parts = buildEmailParts(resolved, preheader); // multipart text+html, preheader, CAN-SPAM address
  const headers = await buildUnsubscribeHeaders(to);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      // RFC 2046: text/plain MUST come before text/html.
      content: [{ type: 'text/plain', value: parts.text }, { type: 'text/html', value: parts.html }],
      categories: ['marketing_weekly', 'rqc_marketing'],
      headers,
      tracking_settings: { click_tracking: { enable: true }, open_tracking: { enable: true }, subscription_tracking: { enable: false } },
    }),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// SendGrid Category Stats — sum opens/clicks/unsub/spam per category over a
// window. Categories are batched (max 10 per call). Returns { key: metrics }.
// Fails soft: returns {} on any error so revenue+delivery still render.
async function sgCategoryStats(keys: string[], startDate: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  if (!SENDGRID_API_KEY || keys.length === 0) return out;
  const end = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < keys.length; i += 10) {
    const chunk = keys.slice(i, i + 10);
    const qs = new URLSearchParams({ start_date: startDate, end_date: end, aggregated_by: 'day' });
    for (const c of chunk) qs.append('categories', c);
    try {
      const res = await fetch(`https://api.sendgrid.com/v3/categories/stats?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${SENDGRID_API_KEY}` },
      });
      if (!res.ok) continue;
      const days = await res.json(); // [{ date, stats: [{ name, metrics }] }]
      for (const day of days || []) {
        for (const st of day.stats || []) {
          const m = st.metrics || {};
          const acc = out[st.name] || {};
          for (const k of Object.keys(m)) acc[k] = (acc[k] || 0) + (Number(m[k]) || 0);
          out[st.name] = acc;
        }
      }
    } catch { /* fail soft */ }
  }
  return out;
}

// Shape one email_queue row + its SendGrid metrics + attributed revenue into a
// flat stats object for the UI.
function shapeStats(em: any, metrics: Record<string, any>, rev?: { orders: number; revenue: number }) {
  const m = (em.campaign_key && metrics[em.campaign_key]) || {};
  const delivered = Number(m.delivered || 0);
  return {
    id: em.id,
    subject: em.subject,
    subject_b: em.subject_b || null,
    segment: em.segment || 'all',
    status: em.status,
    campaign_key: em.campaign_key || null,
    sent_at: em.sent_at,
    created_at: em.created_at,
    recipients_total: em.recipients_total || 0,
    recipients_sent: em.recipients_sent || 0,
    delivered,
    opens: Number(m.unique_opens || 0),
    clicks: Number(m.unique_clicks || 0),
    unsubscribes: Number(m.unsubscribes || 0),
    spam_reports: Number(m.spam_reports || 0),
    bounces: Number(m.bounces || 0),
    blocks: Number(m.blocks || 0),
    orders: rev?.orders || 0,
    revenue: rev?.revenue || 0,
  };
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
        .select('id, week_of, reason, subject, subject_b, segment, campaign_key, preview_text, body_html, cta_text, status, recipients_total, recipients_sent, sent_at, error, created_at')
        .order('created_at', { ascending: false }).limit(40);
      if (error) return json({ success: false, error: error.message }, 500);
      // Live size of every segment for the UI ("will go to N people").
      const { data: counts } = await admin.rpc('marketing_segment_counts');
      const segmentCounts = counts || { all: 0 };
      return json({ success: true, role: roleRow.role, emails: data || [], audience_size: segmentCounts.all || 0, segment_counts: segmentCounts });
    }

    // ---- Results: overview (table of all campaigns) ----
    if (action === 'results_overview') {
      const { data: rows } = await admin.from('email_queue')
        .select('id, subject, subject_b, segment, campaign_key, status, recipients_total, recipients_sent, sent_at, approved_at, created_at')
        .not('campaign_key', 'is', null).in('status', ['sending', 'sent'])
        .order('created_at', { ascending: false }).limit(60);
      const campaigns = rows || [];
      const keys = campaigns.map((c: any) => c.campaign_key).filter(Boolean);
      const earliest = campaigns.reduce((min: string, c: any) => {
        const d = (c.approved_at || c.created_at || '').slice(0, 10);
        return d && (!min || d < min) ? d : min;
      }, '') || new Date().toISOString().slice(0, 10);
      const { data: revRows } = await admin.rpc('email_campaign_revenue');
      const revByKey: Record<string, { orders: number; revenue: number }> = {};
      for (const r of revRows || []) revByKey[r.campaign_key] = { orders: Number(r.orders), revenue: Number(r.revenue) };
      const metrics = await sgCategoryStats(keys, earliest);
      const results = campaigns.map((c: any) => shapeStats(c, metrics, revByKey[c.campaign_key]));
      return json({ success: true, role: roleRow.role, results });
    }

    if (!body.id) return json({ success: false, error: 'Missing id' }, 400);
    const { data: em } = await admin.from('email_queue').select('*').eq('id', body.id).single();
    if (!em) return json({ success: false, error: 'Email not found' }, 404);

    if (action === 'test') {
      const to = (body.email || ud.user.email || '').toString();
      if (!to) return json({ success: false, error: 'No test address' }, 400);
      try { await sendOne(to, `[PRUEBA] ${em.subject}`, em.body_html, em.preview_text || ''); }
      catch (e: any) { return json({ success: false, error: e?.message || String(e) }, 502); }
      return json({ success: true, sent_to: to });
    }

    // ---- Results: one campaign, with A/B variant breakdown ----
    if (action === 'results_detail') {
      if (!em.campaign_key) return json({ success: true, stats: null });
      const start = (em.approved_at || em.created_at || new Date().toISOString()).slice(0, 10);
      const [{ data: revRows }, metrics] = await Promise.all([
        admin.rpc('email_campaign_revenue'),
        sgCategoryStats([em.campaign_key, `${em.campaign_key}_a`, `${em.campaign_key}_b`], start),
      ]);
      const rev = (revRows || []).find((r: any) => r.campaign_key === em.campaign_key);
      const stats = shapeStats(em, metrics, rev ? { orders: Number(rev.orders), revenue: Number(rev.revenue) } : undefined);
      const variantMetrics = (v: string) => {
        const m = metrics[`${em.campaign_key}_${v}`] || {};
        return { delivered: Number(m.delivered || 0), opens: Number(m.unique_opens || 0), clicks: Number(m.unique_clicks || 0) };
      };
      // Per-variant recipient counts from the ledger.
      const variantCount = async (v: string) => {
        const { count } = await admin.from('email_recipients')
          .select('id', { count: 'exact', head: true }).eq('email_queue_id', em.id).eq('variant', v);
        return count || 0;
      };
      const ab = em.subject_b
        ? { a: { subject: em.subject, recipients: await variantCount('a'), ...variantMetrics('a') },
            b: { subject: em.subject_b, recipients: await variantCount('b'), ...variantMetrics('b') } }
        : null;
      return json({ success: true, stats: { ...stats, ab } });
    }

    if (action === 'reject') {
      await admin.from('email_queue').update({ status: 'rejected', updated_at: new Date().toISOString() }).eq('id', em.id);
      return json({ success: true, id: em.id, status: 'rejected' });
    }

    // Change the target list of a draft WITHOUT sending — lets the owner pick the
    // audience (buyers, non-buyers, last-7-days, etc.) right on the Emails screen.
    if (action === 'set_segment') {
      if (em.status !== 'pending_approval') return json({ success: false, error: `Not editable (status=${em.status})` }, 409);
      const segment = (body.segment || '').toString();
      if (!VALID_SEGMENTS.includes(segment)) return json({ success: false, error: `Unknown segment ${segment}` }, 400);
      await admin.from('email_queue').update({ segment, updated_at: new Date().toISOString() }).eq('id', em.id);
      return json({ success: true, id: em.id, segment });
    }

    if (action === 'approve') {
      if (em.status !== 'pending_approval') return json({ success: false, error: `Not approvable (status=${em.status})` }, 409);
      // Stamp a unique campaign key + UTM tags on the CTA links so purchases
      // attribute back to this exact email (songs.utm_campaign, via checkout).
      const key = em.campaign_key
        || `em_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${em.id.replace(/-/g, '').slice(0, 6)}`;
      const taggedHtml = addUtm(em.body_html, key);
      // The owner can retarget the list at approval time; fall back to the draft's
      // stored segment. Validate before it reaches the enqueue RPC.
      const requested = (body.segment ?? em.segment ?? 'all').toString();
      const segment = VALID_SEGMENTS.includes(requested) ? requested : 'all';
      await admin.from('email_queue').update({ body_html: taggedHtml, campaign_key: key, segment, updated_at: new Date().toISOString() }).eq('id', em.id);
      const { data: count, error: rpcErr } = await admin.rpc('enqueue_marketing_recipients', { qid: em.id, seg: segment });
      if (rpcErr) return json({ success: false, error: rpcErr.message }, 500);
      const now = new Date().toISOString();
      await admin.from('email_queue').update({
        status: 'sending', recipients_total: count || 0, approved_at: now, sending_started_at: now, updated_at: now,
      }).eq('id', em.id);
      return json({ success: true, id: em.id, status: 'sending', recipients_total: count || 0, segment });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('email-marketer-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
