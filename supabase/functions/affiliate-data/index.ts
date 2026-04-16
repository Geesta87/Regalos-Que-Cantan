// supabase/functions/affiliate-data/index.ts
// Returns affiliate dashboard stats — scoped strictly to their own data
// Deploy with: supabase functions deploy affiliate-data

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-affiliate-token',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AFFILIATE_JWT_SECRET = Deno.env.get('AFFILIATE_JWT_SECRET') || 'rqc-affiliate-secret-2026';

// 14-day refund window — purchases inside it are "pending", outside it become "available"
const REFUND_WINDOW_DAYS = 14;

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
    // Read affiliate token from custom header (Authorization is consumed by Supabase gateway)
    const token = req.headers.get('x-affiliate-token') || '';

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

    // ===== Affiliate events (visits, checkouts, purchases, refunds) =====
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

    const visits = events?.filter(e => e.event_type === 'visit').length || 0;
    const checkouts = events?.filter(e => e.event_type === 'checkout').length || 0;
    const purchases = events?.filter(e => e.event_type === 'purchase') || [];
    const refunds = events?.filter(e => e.event_type === 'refund') || [];
    const totalPurchases = purchases.length;
    const totalRefunds = refunds.length;
    const totalRevenue = purchases.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const totalRefundAmount = refunds.reduce((sum, e) => sum + Math.abs(parseFloat(e.amount) || 0), 0);
    const netRevenue = totalRevenue - totalRefundAmount;

    // ===== Affiliate metadata =====
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('commission_pct, coupon_code, name')
      .eq('code', affiliateCode)
      .single();

    const commissionPct = affiliate?.commission_pct || 20;
    const totalCommission = netRevenue * (commissionPct / 100);
    const conversionRate = visits > 0 ? ((totalPurchases / visits) * 100).toFixed(1) : '0.0';
    const aov = totalPurchases > 0 ? (totalRevenue / totalPurchases) : 0;

    // ===== Pending vs Available vs Paid commission =====
    // Pending = purchases inside the refund window (not yet eligible for payout)
    // Available = purchases outside the refund window, minus what we've already paid out
    // Paid = sum of payouts table
    const refundWindowCutoff = new Date(Date.now() - REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const pendingPurchaseRevenue = purchases
      .filter(p => new Date(p.created_at) >= refundWindowCutoff)
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const eligiblePurchaseRevenue = purchases
      .filter(p => new Date(p.created_at) < refundWindowCutoff)
      .reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const eligibleAfterRefunds = eligiblePurchaseRevenue - totalRefundAmount;

    const pendingCommission = pendingPurchaseRevenue * (commissionPct / 100);
    const eligibleCommission = Math.max(0, eligibleAfterRefunds * (commissionPct / 100));

    // Sum payouts (all-time, regardless of date filter — they reflect lifetime money in pocket)
    const { data: payouts } = await supabase
      .from('affiliate_payouts')
      .select('amount, paid_at, method')
      .eq('affiliate_code', affiliateCode)
      .order('paid_at', { ascending: false });
    const paidCommission = (payouts || []).reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const availableCommission = Math.max(0, eligibleCommission - paidCommission);

    // ===== Daily breakdown for sparklines =====
    const dailyStats: Record<string, { visits: number; checkouts: number; purchases: number; revenue: number; commission: number }> = {};
    for (const event of (events || [])) {
      const day = event.created_at.split('T')[0];
      if (!dailyStats[day]) dailyStats[day] = { visits: 0, checkouts: 0, purchases: 0, revenue: 0, commission: 0 };
      if (event.event_type === 'visit') dailyStats[day].visits++;
      if (event.event_type === 'checkout') dailyStats[day].checkouts++;
      if (event.event_type === 'purchase') {
        dailyStats[day].purchases++;
        const amt = parseFloat(event.amount) || 0;
        dailyStats[day].revenue += amt;
        dailyStats[day].commission += amt * (commissionPct / 100);
      }
    }

    // ===== Coupon vs Link breakdown =====
    // For sales attributed via the affiliate, look at songs.coupon_code: if it matches
    // the affiliate's coupon, the sale came via the coupon path. Otherwise via the link.
    const purchaseSongIds = purchases.map(p => p.song_id).filter(Boolean);
    let couponSales = 0;
    let linkSales = 0;
    let couponCommission = 0;
    let linkCommission = 0;
    // Map song_id → discount info for the activity table
    const songDiscountMap: Record<string, { discount_code: string | null }> = {};
    if (purchaseSongIds.length > 0) {
      const { data: songs } = await supabase
        .from('songs')
        .select('id, coupon_code, amount_paid')
        .in('id', purchaseSongIds);
      for (const s of (songs || [])) {
        const amt = parseFloat(s.amount_paid) || 0;
        const comm = amt * (commissionPct / 100);
        // Store discount code for activity table (coupon_code on the song = discount applied)
        songDiscountMap[s.id] = {
          discount_code: s.coupon_code || null,
        };
        if (affiliate?.coupon_code && s.coupon_code === affiliate.coupon_code) {
          couponSales++;
          couponCommission += comm;
        } else {
          linkSales++;
          linkCommission += comm;
        }
      }
    } else if (!affiliate?.coupon_code) {
      // No coupon assigned — all sales are link-attributed
      linkSales = totalPurchases;
      linkCommission = totalCommission;
    }

    // ===== Recent activity (purchases + refunds — no customer PII) =====
    const recentActivity = [...purchases, ...refunds].sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const recentPurchases = recentActivity.slice(0, 50).map(e => {
      const disc = e.song_id ? songDiscountMap[e.song_id] : null;
      return {
        date: e.created_at,
        commission: (parseFloat(e.amount) || 0) * (commissionPct / 100),
        type: e.event_type,
        discount_code: disc?.discount_code || null,
      };
    });

    // ===== UTM / per-channel breakdown =====
    // Group purchases by songs.utm_source so the affiliate can see which platform
    // (tiktok, instagram, youtube, email, ...) actually drives sales.
    const utmBreakdown: Record<string, { sales: number; commission: number }> = {};
    if (purchaseSongIds.length > 0) {
      const { data: utmSongs } = await supabase
        .from('songs')
        .select('id, utm_source, amount_paid')
        .in('id', purchaseSongIds);
      for (const s of (utmSongs || [])) {
        const source = (s.utm_source || 'directo').toLowerCase();
        if (!utmBreakdown[source]) utmBreakdown[source] = { sales: 0, commission: 0 };
        const amt = parseFloat(s.amount_paid) || 0;
        utmBreakdown[source].sales++;
        utmBreakdown[source].commission += amt * (commissionPct / 100);
      }
    }

    // ===== Weekly goal =====
    // Simple rule for v1: target = max(10 sales, lastWeekSales * 1.2). Floor at 5.
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const oneWeekAgo = new Date(Date.now() - weekMs);
    const twoWeeksAgo = new Date(Date.now() - 2 * weekMs);
    const thisWeekSales = purchases.filter(p => new Date(p.created_at) >= oneWeekAgo).length;
    const lastWeekSales = purchases.filter(p => {
      const d = new Date(p.created_at);
      return d >= twoWeeksAgo && d < oneWeekAgo;
    }).length;
    const weeklyTarget = Math.max(5, Math.ceil(Math.max(10, lastWeekSales * 1.2)));

    return new Response(
      JSON.stringify({
        success: true,
        stats: {
          visits,
          checkouts,
          totalPurchases,
          totalRefunds,
          totalCommission: Math.round(totalCommission * 100) / 100,
          commissionPct,
          conversionRate,
          // Commission breakdown
          pendingCommission: Math.round(pendingCommission * 100) / 100,
          availableCommission: Math.round(availableCommission * 100) / 100,
          paidCommission: Math.round(paidCommission * 100) / 100,
        },
        // Coupon vs link
        attribution: {
          couponSales,
          linkSales,
          couponCommission: Math.round(couponCommission * 100) / 100,
          linkCommission: Math.round(linkCommission * 100) / 100,
        },
        // Per-platform UTM breakdown — sorted by sales desc
        utmBreakdown: Object.entries(utmBreakdown)
          .map(([source, v]) => ({
            source,
            sales: v.sales,
            commission: Math.round(v.commission * 100) / 100,
          }))
          .sort((a, b) => b.sales - a.sales),
        // Weekly goal
        weeklyGoal: {
          target: weeklyTarget,
          current: thisWeekSales,
          lastWeek: lastWeekSales,
        },
        // Refund window so the frontend can render "available in N days"
        refundWindowDays: REFUND_WINDOW_DAYS,
        recentPurchases,
        // Recent payouts for the "paid history" UI
        recentPayouts: (payouts || []).slice(0, 20).map(p => ({
          amount: parseFloat(p.amount) || 0,
          paid_at: p.paid_at,
          method: p.method
        })),
        dailyStats,
        affiliate: {
          name: affiliate?.name,
          couponCode: affiliate?.coupon_code,
          code: affiliateCode,
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
