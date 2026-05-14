// supabase/functions/admin-record-payout/index.ts
// Admin-only: records a payout sent to an affiliate. Inserts into
// affiliate_payouts so the partner's dashboard reflects "Pagado" and the
// admin's "Owed" column drops accordingly.
//
// AUTH: same pattern as create-affiliate / admin-affiliates. Caller passes
// their Supabase Auth user JWT in `Authorization: Bearer …`. The gateway
// validates the JWT (verify_jwt = true in config.toml) and our handler
// looks the user up in admin_users — only role = 'admin' may write payouts.
// 'assistant' is read-only on this surface (the admin dashboard hides the
// button for non-admin users too).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_METHODS = new Set(['zelle', 'venmo', 'paypal', 'bank', 'other']);

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
    const rawAmount = body?.amount;
    const rawMethod = String(body?.method || '').toLowerCase().trim();
    const rawNote = String(body?.note || '').trim();
    const rawPaidAt = body?.paid_at ? new Date(body.paid_at) : null;

    if (!affiliateCode) return json({ success: false, error: 'affiliateCode is required' }, 400);
    const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return json({ success: false, error: 'amount must be a positive number' }, 400);
    }
    if (amount > 100000) {
      // Sanity cap — protect against typos like 50.00 entered as 5000.
      return json({ success: false, error: 'amount looks too large; double-check' }, 400);
    }
    if (rawMethod && !ALLOWED_METHODS.has(rawMethod)) {
      return json({ success: false, error: 'method must be zelle, venmo, paypal, bank, or other' }, 400);
    }
    if (rawNote.length > 500) {
      return json({ success: false, error: 'note too long' }, 400);
    }

    // Verify the affiliate exists (we don't require active = true — you may
    // need to pay out a deactivated partner for previously earned commission).
    const { data: affiliate, error: affErr } = await admin
      .from('affiliates')
      .select('code, name, email')
      .eq('code', affiliateCode)
      .maybeSingle();
    if (affErr) return json({ success: false, error: affErr.message }, 500);
    if (!affiliate) return json({ success: false, error: 'No such affiliate code' }, 404);

    const paidAtIso = rawPaidAt && !isNaN(rawPaidAt.getTime())
      ? rawPaidAt.toISOString()
      : new Date().toISOString();

    const { data: payout, error: insertErr } = await admin
      .from('affiliate_payouts')
      .insert({
        affiliate_code: affiliateCode,
        amount,
        method: rawMethod || null,
        note: rawNote || null,
        paid_at: paidAtIso,
        recorded_by: userData.user.id,
      })
      .select('id, affiliate_code, amount, method, note, paid_at, recorded_by, created_at')
      .single();

    if (insertErr) {
      console.error('[admin-record-payout] insert failed:', insertErr.message);
      return json({ success: false, error: insertErr.message }, 500);
    }

    console.log(`[admin-record-payout] recorded ${amount} to ${affiliateCode} via ${rawMethod || 'unspecified'} by ${userData.user.id}`);
    return json({ success: true, payout, affiliate: { code: affiliate.code, name: affiliate.name } });
  } catch (err) {
    console.error('[admin-record-payout] error:', err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
