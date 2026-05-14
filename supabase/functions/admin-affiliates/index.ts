// supabase/functions/admin-affiliates/index.ts
// Admin-only reader for the affiliate program.
//
// Why this exists: the dashboard used to read `affiliates`, `affiliate_events`,
// and `affiliate_payouts` directly from the browser with the anon key. Those
// tables have RLS enabled with no policies, so the queries returned ZERO rows
// — the admin dashboard could never see partners, sales, or payouts. This
// function runs as service role behind an admin gate (same pattern as
// admin-songs) and returns the per-affiliate stats the dashboard expects.
//
// Both 'admin' and 'assistant' roles can read.
//
// Deploy with: supabase functions deploy admin-affiliates --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userData.user.id)
      .single();
    if (roleErr || !roleRow) {
      return json({ success: false, error: 'No admin access' }, 403);
    }
    const role = roleRow.role as 'admin' | 'assistant';

    // Pull the three datasets in parallel
    const [{ data: affData, error: affError }, { data: events }, { data: payouts }] = await Promise.all([
      admin.from('affiliates').select('*').order('created_at', { ascending: false }),
      admin.from('affiliate_events').select('affiliate_code, event_type, amount, created_at'),
      admin.from('affiliate_payouts')
        .select('id, affiliate_code, amount, method, note, paid_at, recorded_by')
        .order('paid_at', { ascending: false }),
    ]);

    if (affError) return json({ success: false, error: affError.message }, 500);

    const affiliates = affData || [];

    // Build per-affiliate stats — same shape the dashboard already renders.
    const statsMap: Record<string, {
      visits: number;
      checkouts: number;
      sales: number;
      revenue: number;
      commission: number;
      paidOut: number;
      lastSale: string | null;
    }> = {};

    for (const a of affiliates) {
      statsMap[a.code] = {
        visits: 0, checkouts: 0, sales: 0, revenue: 0,
        commission: 0, paidOut: 0, lastSale: null,
      };
    }

    for (const e of (events || [])) {
      const s = statsMap[e.affiliate_code as string];
      if (!s) continue;
      if (e.event_type === 'visit') s.visits++;
      else if (e.event_type === 'checkout') s.checkouts++;
      else if (e.event_type === 'purchase') {
        s.sales++;
        const amt = parseFloat(String(e.amount)) || 0;
        s.revenue += amt;
        const pct = parseFloat(String(affiliates.find(a => a.code === e.affiliate_code)?.commission_pct ?? 20)) || 20;
        s.commission += amt * (pct / 100);
        const dStr = e.created_at as string;
        if (!s.lastSale || dStr > s.lastSale) s.lastSale = dStr;
      } else if (e.event_type === 'refund') {
        // Refunds reverse commission. amount is negative by convention.
        const amt = parseFloat(String(e.amount)) || 0;
        s.revenue += amt;
        const pct = parseFloat(String(affiliates.find(a => a.code === e.affiliate_code)?.commission_pct ?? 20)) || 20;
        s.commission += amt * (pct / 100);
      }
    }

    // Group payouts by affiliate code so the dashboard can render a per-row
    // payout history without a second round-trip.
    const payoutsByCode: Record<string, Array<{
      id: string;
      amount: number;
      method: string | null;
      note: string | null;
      paid_at: string;
      recorded_by: string | null;
    }>> = {};

    for (const p of (payouts || [])) {
      const code = p.affiliate_code as string;
      const s = statsMap[code];
      if (s) s.paidOut += parseFloat(String(p.amount)) || 0;
      if (!payoutsByCode[code]) payoutsByCode[code] = [];
      payoutsByCode[code].push({
        id: p.id as string,
        amount: parseFloat(String(p.amount)) || 0,
        method: (p.method as string) || null,
        note: (p.note as string) || null,
        paid_at: p.paid_at as string,
        recorded_by: (p.recorded_by as string) || null,
      });
    }

    return json({
      success: true,
      role,
      affiliates: affiliates.map(a => ({
        ...a,
        _stats: statsMap[a.code],
        _payouts: payoutsByCode[a.code] || [],
      })),
    });
  } catch (err) {
    console.error('admin-affiliates error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
