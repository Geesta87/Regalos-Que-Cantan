// supabase/functions/affiliate-data/index.ts
// Returns affiliate dashboard stats — scoped strictly to their own data
// Deploy with: supabase functions deploy affiliate-data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AFFILIATE_JWT_SECRET = Deno.env.get('AFFILIATE_JWT_SECRET') || 'rqc-affiliate-secret-2026';

async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, sig] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(AFFILIATE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    const payload = await verifyToken(token);
    if (!payload) {
      return new Response(
        JSON.stringify({ success: false, error: 'Token inválido o expirado' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const affiliateCode = payload.code as string;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse optional date range from query params
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get('days') || '0');
    const dateFilter = days > 0
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Query affiliate events — strictly filtered by this affiliate's code
    let eventsQuery = supabase
      .from('affiliate_events')
      .select('*')
      .eq('affiliate_code', affiliateCode);

    if (dateFilter) {
      eventsQuery = eventsQuery.gte('created_at', dateFilter);
    }

    const { data: events, error: eventsError } = await eventsQuery
      .order('created_at', { ascending: false });

    if (eventsError) throw eventsError;

    // Aggregate stats
    const visits = events?.filter(e => e.event_type === 'visit').length || 0;
    const checkouts = events?.filter(e => e.event_type === 'checkout').length || 0;
    const purchases = events?.filter(e => e.event_type === 'purchase') || [];
    const refunds = events?.filter(e => e.event_type === 'refund') || [];
    const totalPurchases = purchases.length;
    const totalRefunds = refunds.length;
    const totalRevenue = purchases.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalRefundAmount = refunds.reduce((sum, e) => sum + Math.abs(parseFloat(e.amount) || 0), 0);
    const netRevenue = totalRevenue - totalRefundAmount;

    // Get affiliate info for commission rate
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('commission_pct, coupon_code, name')
      .eq('code', affiliateCode)
      .single();

    const commissionPct = affiliate?.commission_pct || 20;
    const totalCommission = netRevenue * (commissionPct / 100);
    const conversionRate = visits > 0 ? ((totalPurchases / visits) * 100).toFixed(1) : '0.0';

    // Recent activity (purchases + refunds — no customer PII)
    const recentActivity = [...purchases, ...refunds].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const recentPurchases = recentActivity.slice(0, 50).map(e => ({
      date: e.created_at,
      amount: parseFloat(e.amount) || 0,
      commission: (parseFloat(e.amount) || 0) * (commissionPct / 100),
      type: e.event_type
    }));

    // Daily breakdown for chart
    const dailyStats: Record<string, { visits: number; checkouts: number; purchases: number; revenue: number }> = {};
    for (const event of (events || [])) {
      const day = event.created_at.split('T')[0];
      if (!dailyStats[day]) dailyStats[day] = { visits: 0, checkouts: 0, purchases: 0, revenue: 0 };
      if (event.event_type === 'visit') dailyStats[day].visits++;
      if (event.event_type === 'checkout') dailyStats[day].checkouts++;
      if (event.event_type === 'purchase') {
        dailyStats[day].purchases++;
        dailyStats[day].revenue += parseFloat(event.amount) || 0;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          visits,
          checkouts,
          totalPurchases,
          totalRefunds,
          totalRevenue: Math.round(netRevenue * 100) / 100,
          totalRefundAmount: Math.round(totalRefundAmount * 100) / 100,
          totalCommission: Math.round(totalCommission * 100) / 100,
          commissionPct,
          conversionRate
        },
        recentPurchases,
        dailyStats,
        affiliate: {
          name: affiliate?.name,
          couponCode: affiliate?.coupon_code
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Affiliate data error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
