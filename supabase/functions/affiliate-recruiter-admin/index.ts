// supabase/functions/affiliate-recruiter-admin/index.ts
// ===========================================================================
// AFFILIATE RECRUITER — admin (list / scan / status / convert)
// ===========================================================================
// Powers the "Recruit Partners" tab. Lists ranked prospects, triggers a scan,
// tracks outreach status, and converts a prospect into a real affiliate by
// forwarding the admin's session to the existing create-affiliate function.
// Admin-only. verify_jwt = true.
//
// Deploy: supabase functions deploy affiliate-recruiter-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function slug(s: string) { return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'partner'; }
function rand(n: number) { const c = 'abcdefghjkmnpqrstuvwxyz23456789'; let o = ''; for (let i = 0; i < n; i++) o += c[Math.floor(Math.random() * c.length)]; return o; }

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
    // Recruiting is the assistant's job — allow role 'assistant' as well as 'admin'.
    // (The convert path forwards this same session to create-affiliate, which also
    // now accepts 'assistant'.)
    if (!['admin', 'assistant'].includes(roleRow.role)) return json({ success: false, error: 'No recruiter access' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {} }
    const action = body.action || 'list';

    if (action === 'list') {
      const { data, error } = await admin.from('affiliate_prospects')
        .select('id, platform, handle, display_name, profile_url, followers, videos, likes, verified, niche, fit_score, fit_reason, suggested_commission, outreach_draft, status, affiliate_code, scanned_at, contacted_at, bio, external_url, business_email')
        .neq('status', 'dismissed').order('fit_score', { ascending: false, nullsFirst: false }).order('followers', { ascending: false, nullsFirst: false }).limit(80);
      if (error) return json({ success: false, error: error.message }, 500);
      const { data: lastRun } = await admin.from('agent_runs').select('status, summary, started_at').eq('agent', 'affiliate-recruiter').order('started_at', { ascending: false }).limit(1).maybeSingle();
      return json({ success: true, role: roleRow.role, prospects: data || [], last_scan: lastRun || null });
    }

    if (action === 'scan') {
      // Forward the owner's search criteria (from the "Filtros" panel) to the
      // recruiter; it falls back to env defaults for anything omitted.
      const fwd: any = {};
      if (body.min_followers != null && body.min_followers !== '') fwd.min_followers = body.min_followers;
      if (body.max_followers != null && body.max_followers !== '') fwd.max_followers = body.max_followers;
      if (Array.isArray(body.niches) && body.niches.length) fwd.niches = body.niches;
      if (body.platform === 'tiktok' || body.platform === 'instagram') fwd.platform = body.platform;
      fetch(`${SUPABASE_URL}/functions/v1/affiliate-recruiter`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fwd) }).catch(() => {});
      return json({ success: true, started: true });
    }

    // --- Scheduled Calls sub-tab (partner_call_bookings, written by the
    // public book-partner-call function from /partners) ---
    if (action === 'calls_list') {
      const { data, error } = await admin.from('partner_call_bookings')
        .select('id, created_at, name, phone, preferred_date, preferred_time, status, notes')
        .neq('status', 'cancelled')
        .order('preferred_date', { ascending: true }).order('created_at', { ascending: true }).limit(200);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, calls: data || [] });
    }

    if (action === 'call_update') {
      if (!body.call_id) return json({ success: false, error: 'Missing call_id' }, 400);
      const next = ['pending', 'confirmed', 'done', 'no_show', 'cancelled'].includes(body.status) ? body.status : null;
      if (!next) return json({ success: false, error: 'Bad status' }, 400);
      const { error } = await admin.from('partner_call_bookings').update({ status: next }).eq('id', body.call_id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, id: body.call_id, status: next });
    }

    // Availability panel (partner_call_settings row id=1)
    const CANDIDATE_TIMES = ['9:00 AM', '10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM'];

    if (action === 'settings_get') {
      const { data } = await admin.from('partner_call_settings')
        .select('days, slots, blocked_dates').eq('id', 1).maybeSingle();
      return json({
        success: true,
        settings: {
          days: data?.days?.length ? data.days : [1, 2, 3, 4, 5],
          slots: data?.slots?.length ? data.slots : ['10:00 AM', '11:00 AM', '12:00 PM', '2:00 PM', '4:00 PM', '5:00 PM', '6:00 PM'],
          blocked_dates: (data?.blocked_dates || []).map(String),
        },
        candidate_times: CANDIDATE_TIMES,
      });
    }

    if (action === 'settings_save') {
      const days = Array.isArray(body.days) ? [...new Set(body.days.map(Number).filter((n: number) => n >= 1 && n <= 7))] : [];
      const slots = CANDIDATE_TIMES.filter((t) => Array.isArray(body.slots) && body.slots.includes(t));
      const blocked = Array.isArray(body.blocked_dates)
        ? [...new Set(body.blocked_dates.map(String).filter((d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)))]
        : [];
      if (!days.length) return json({ success: false, error: 'Pick at least one day of the week' }, 400);
      if (!slots.length) return json({ success: false, error: 'Pick at least one time slot' }, 400);
      const { error } = await admin.from('partner_call_settings')
        .upsert({ id: 1, days, slots, blocked_dates: blocked, updated_at: new Date().toISOString() });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    if (!body.id) return json({ success: false, error: 'Missing id' }, 400);
    const { data: p } = await admin.from('affiliate_prospects').select('*').eq('id', body.id).single();
    if (!p) return json({ success: false, error: 'Prospect not found' }, 404);

    if (action === 'status') {
      const next = ['new', 'contacted', 'responded', 'dismissed'].includes(body.status) ? body.status : null;
      if (!next) return json({ success: false, error: 'Bad status' }, 400);
      // Stamp when they were first contacted so the tab can build a "follow up"
      // list (contacted N+ days ago with no reply). Only set it once.
      const patch: Record<string, unknown> = { status: next };
      if (next === 'contacted' && !p.contacted_at) patch.contacted_at = new Date().toISOString();
      await admin.from('affiliate_prospects').update(patch).eq('id', p.id);
      return json({ success: true, id: p.id, status: next, contacted_at: patch.contacted_at ?? p.contacted_at ?? null });
    }

    if (action === 'convert') {
      const email = (body.email || '').toString().trim().toLowerCase();
      if (!email) return json({ success: false, error: 'Email is required to create the affiliate' }, 400);
      const code = `${slug(p.handle)}${Math.floor(100 + Math.random() * 900)}`;
      const password = rand(10);
      const couponCode = code.toUpperCase();
      // Reuse the existing create-affiliate flow (mints the row + coupon + emails
      // credentials). Forward the admin's session so its admin gate passes.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-affiliate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
        body: JSON.stringify({ name: p.display_name || p.handle, email, code, couponCode, password }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.success) return json({ success: false, error: out.error || `create-affiliate ${res.status}` }, 502);
      await admin.from('affiliate_prospects').update({ status: 'converted', affiliate_code: code }).eq('id', p.id);
      return json({ success: true, id: p.id, status: 'converted', code, coupon: couponCode });
    }

    return json({ success: false, error: `Unknown action ${action}` }, 400);
  } catch (err) {
    console.error('affiliate-recruiter-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
