// supabase/functions/delete-affiliate/index.ts
// Admin-only: remove an affiliate. Two modes:
//   - mode = 'deactivate' : flips affiliates.active = false (and deactivates the
//                           matching coupon) so their link/code stop working but
//                           all history is preserved. Reversible.
//   - mode = 'delete'     : HARD delete. Removes the affiliate row, ALL of their
//                           affiliate_events and affiliate_payouts, and their
//                           coupon. There are no FK constraints from those tables
//                           back to affiliates, so we clean them up explicitly to
//                           avoid orphan rows. Intended for clearing out test
//                           accounts. Irreversible.
//
// Money-history guard: a hard delete is refused (409, requiresForce:true) when the
// affiliate already has recorded payouts, unless the caller passes force:true. This
// stops a real partner's paid-commission history from being erased by accident.
//
// AUTH: same pattern as admin-record-payout / create-affiliate. Caller passes their
// Supabase Auth user JWT in `Authorization: Bearer …`; the gateway validates it
// (verify_jwt = true in config.toml) and the handler requires admin_users.role = 'admin'.

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
    // ── ADMIN AUTH ───────────────────────────────────────────────────────
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
    if (roleErr || !roleRow || roleRow.role !== 'admin') {
      return json({ success: false, error: 'Admin access required' }, 403);
    }
    // ── END AUTH ────────────────────────────────────────────────────────

    const body = await req.json().catch(() => ({}));
    const affiliateCode = String(body?.affiliateCode || body?.affiliate_code || '').toLowerCase().trim();
    const mode = String(body?.mode || 'delete').toLowerCase().trim();
    const force = body?.force === true;

    if (!affiliateCode) return json({ success: false, error: 'affiliateCode is required' }, 400);
    if (mode !== 'delete' && mode !== 'deactivate') {
      return json({ success: false, error: "mode must be 'delete' or 'deactivate'" }, 400);
    }

    // Confirm the affiliate exists and grab its coupon.
    const { data: affiliate, error: affErr } = await admin
      .from('affiliates')
      .select('id, code, name, email, coupon_code, active')
      .eq('code', affiliateCode)
      .maybeSingle();
    if (affErr) return json({ success: false, error: affErr.message }, 500);
    if (!affiliate) return json({ success: false, error: 'No such affiliate code' }, 404);

    // ── DEACTIVATE ───────────────────────────────────────────────────────
    if (mode === 'deactivate') {
      const { error: deErr } = await admin
        .from('affiliates')
        .update({ active: false })
        .eq('code', affiliateCode);
      if (deErr) return json({ success: false, error: deErr.message }, 500);

      // Turn off their coupon too so it stops applying discounts.
      if (affiliate.coupon_code) {
        await admin.from('coupons').update({ active: false }).eq('code', affiliate.coupon_code);
      }

      console.log(`[delete-affiliate] deactivated ${affiliateCode} by ${userData.user.id}`);
      return json({ success: true, mode: 'deactivate', affiliate: { code: affiliate.code, name: affiliate.name } });
    }

    // ── HARD DELETE ──────────────────────────────────────────────────────
    // Money-history guard: refuse if there are recorded payouts unless forced.
    const { count: payoutCount } = await admin
      .from('affiliate_payouts')
      .select('id', { count: 'exact', head: true })
      .eq('affiliate_code', affiliateCode);

    if ((payoutCount || 0) > 0 && !force) {
      return json({
        success: false,
        requiresForce: true,
        payoutCount: payoutCount || 0,
        error: `This affiliate has ${payoutCount} recorded payout(s). Deleting will erase that payment history. Re-confirm to proceed.`,
      }, 409);
    }

    // Delete dependents first (no FK cascade exists), then the affiliate, then coupon.
    const { error: evErr } = await admin.from('affiliate_events').delete().eq('affiliate_code', affiliateCode);
    if (evErr) return json({ success: false, error: `Failed to delete events: ${evErr.message}` }, 500);

    const { error: poErr } = await admin.from('affiliate_payouts').delete().eq('affiliate_code', affiliateCode);
    if (poErr) return json({ success: false, error: `Failed to delete payouts: ${poErr.message}` }, 500);

    const { error: delErr } = await admin.from('affiliates').delete().eq('code', affiliateCode);
    if (delErr) return json({ success: false, error: `Failed to delete affiliate: ${delErr.message}` }, 500);

    // Remove their coupon last (best-effort — a failure here shouldn't fail the whole op).
    if (affiliate.coupon_code) {
      const { error: cErr } = await admin.from('coupons').delete().eq('code', affiliate.coupon_code);
      if (cErr) console.warn(`[delete-affiliate] coupon ${affiliate.coupon_code} not removed: ${cErr.message}`);
    }

    console.log(`[delete-affiliate] HARD-deleted ${affiliateCode} (force=${force}) by ${userData.user.id}`);
    return json({
      success: true,
      mode: 'delete',
      affiliate: { code: affiliate.code, name: affiliate.name },
    });
  } catch (err) {
    console.error('[delete-affiliate] error:', err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
