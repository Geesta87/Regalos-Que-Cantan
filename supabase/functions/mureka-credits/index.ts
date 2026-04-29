// supabase/functions/mureka-credits/index.ts
//
// Estimated-balance widget for Mureka credits. useapi.net does not expose
// Mureka credit balance via API (verified by probing every endpoint), so the
// dashboard relies on a manual anchor:
//   * Admin tops up at useapi.net, then enters the new balance here.
//   * We store balance + anchored_at in mureka_credit_state.
//   * Every successful Mureka generation since the anchor counts as
//     `credits_per_generation` credits used (default 1; 1 mureka_job_id == 1
//     generation == 2 song rows, verified against production data).
//   * Estimated remaining = balance − (generations_since_anchor × per_gen_cost).
//
// Auth: requires a logged-in Supabase Auth session. Reading is allowed for
// any role registered in `admin_users` (admin or assistant — the assistant
// hides the value visually, but the function still answers, the dashboard
// decides what to render). Writing requires role = 'admin'.
//
// Deploy with: supabase functions deploy mureka-credits --project-ref yzbvajungshqcpusfiia

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

    // Resolve caller from JWT
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }
    const userId = userData.user.id;

    // Service-role client + role check
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .single();
    if (roleErr || !roleRow) {
      return json({ success: false, error: 'No dashboard access' }, 403);
    }
    const role = roleRow.role as 'admin' | 'assistant';

    // Parse request body (POST may carry an action)
    let body: { action?: string; balance?: number; credits_per_generation?: number; low_threshold?: number; critical_threshold?: number } = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = body.action || 'get';

    // ─── Writes (admin only) ─────────────────────────────────────────────
    if (action === 'set_balance' || action === 'set_thresholds' || action === 'set_per_gen') {
      if (role !== 'admin') {
        return json({ success: false, error: 'Admins only' }, 403);
      }

      const update: Record<string, unknown> = { updated_by: userId, updated_at: new Date().toISOString() };

      if (action === 'set_balance') {
        if (typeof body.balance !== 'number' || !Number.isFinite(body.balance) || body.balance < 0) {
          return json({ success: false, error: 'balance must be a non-negative number' }, 400);
        }
        update.balance = Math.round(body.balance);
        update.anchored_at = new Date().toISOString();
      } else if (action === 'set_thresholds') {
        if (typeof body.low_threshold === 'number' && body.low_threshold >= 0) {
          update.low_threshold = Math.round(body.low_threshold);
        }
        if (typeof body.critical_threshold === 'number' && body.critical_threshold >= 0) {
          update.critical_threshold = Math.round(body.critical_threshold);
        }
      } else if (action === 'set_per_gen') {
        if (typeof body.credits_per_generation !== 'number' || body.credits_per_generation <= 0) {
          return json({ success: false, error: 'credits_per_generation must be > 0' }, 400);
        }
        update.credits_per_generation = body.credits_per_generation;
      }

      const { error: upErr } = await admin
        .from('mureka_credit_state')
        .update(update)
        .eq('id', 1);
      if (upErr) return json({ success: false, error: upErr.message }, 500);
      // fall through to GET so the response includes the fresh estimate
    }

    // ─── Read state + compute estimate ───────────────────────────────────
    const { data: state, error: stateErr } = await admin
      .from('mureka_credit_state')
      .select('balance, anchored_at, credits_per_generation, low_threshold, critical_threshold, updated_at')
      .eq('id', 1)
      .single();
    if (stateErr || !state) {
      return json({ success: false, error: stateErr?.message || 'No credit state row' }, 500);
    }

    // Count distinct mureka_job_id values created since the anchor.
    // 1 mureka_job_id == 1 generation == 2 song rows (verified).
    const { data: jobsRows, error: jobsErr } = await admin
      .from('songs')
      .select('mureka_job_id')
      .gte('created_at', state.anchored_at)
      .not('mureka_job_id', 'is', null);
    if (jobsErr) return json({ success: false, error: jobsErr.message }, 500);

    const distinctJobs = new Set<string>();
    for (const r of jobsRows || []) {
      if (r.mureka_job_id) distinctJobs.add(r.mureka_job_id as string);
    }
    const generations = distinctJobs.size;
    const credits_used = Math.round(generations * Number(state.credits_per_generation));
    const estimated_remaining = Math.max(0, state.balance - credits_used);

    let status: 'healthy' | 'low' | 'critical' = 'healthy';
    if (estimated_remaining <= state.critical_threshold) status = 'critical';
    else if (estimated_remaining <= state.low_threshold) status = 'low';

    return json({
      success: true,
      role,
      balance: state.balance,
      anchored_at: state.anchored_at,
      credits_per_generation: Number(state.credits_per_generation),
      low_threshold: state.low_threshold,
      critical_threshold: state.critical_threshold,
      updated_at: state.updated_at,
      generations_since_anchor: generations,
      credits_used,
      estimated_remaining,
      status,
    });
  } catch (err) {
    console.error('mureka-credits error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
