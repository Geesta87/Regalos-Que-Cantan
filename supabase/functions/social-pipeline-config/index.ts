// supabase/functions/social-pipeline-config/index.ts
//
// Admin-controlled on/off toggle for the GHL social-posting pipeline.
// Backs the "Posteo activo / pausado" button on AdminDashboard.jsx.
//
// State lives in social_pipeline_state (single row, id = 1). Both
// render-social-clip and post-to-ghl read that row at the start of each
// invocation; setting enabled = false halts both without a redeploy.
//
// Auth: requires a logged-in Supabase Auth session that maps to a row in
// admin_users. Reads are allowed for both 'admin' and 'assistant' roles
// (assistant sees the toggle but the dashboard disables the button).
// Writes (set_enabled) require role = 'admin'.
//
// Deploy with: supabase functions deploy social-pipeline-config --project-ref yzbvajungshqcpusfiia

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

    let body: { action?: string; enabled?: boolean } = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = body.action || 'get';

    // ─── Writes (admin only) ─────────────────────────────────────────────
    if (action === 'set_enabled') {
      if (role !== 'admin') {
        return json({ success: false, error: 'Admins only' }, 403);
      }
      if (typeof body.enabled !== 'boolean') {
        return json({ success: false, error: 'enabled must be a boolean' }, 400);
      }
      const { error: upErr } = await admin
        .from('social_pipeline_state')
        .update({
          enabled: body.enabled,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
      if (upErr) return json({ success: false, error: upErr.message }, 500);
      // fall through to GET so the response includes the fresh state
    }

    // ─── Read state ──────────────────────────────────────────────────────
    const { data: state, error: stateErr } = await admin
      .from('social_pipeline_state')
      .select('enabled, updated_by, updated_at')
      .eq('id', 1)
      .single();
    if (stateErr || !state) {
      return json({ success: false, error: stateErr?.message || 'No pipeline state row' }, 500);
    }

    return json({
      success: true,
      role,
      enabled: state.enabled,
      updated_by: state.updated_by,
      updated_at: state.updated_at,
    });
  } catch (err) {
    console.error('social-pipeline-config error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
