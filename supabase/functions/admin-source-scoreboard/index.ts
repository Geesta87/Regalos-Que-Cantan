// supabase/functions/admin-source-scoreboard/index.ts
// Admin-only traffic-source scoreboard for the dashboard.
//
// Returns per-source visits / purchases / revenue / conversion for a rolling
// window, so the owner can see exactly how much traffic AND how many sales each
// channel (TikTok, Facebook, Instagram, …) drives. All aggregation happens in
// Postgres via public.get_source_scoreboard() — we never pull the ~42k-row
// songs table to the browser (songs-table-scale rule).
//
// Same auth pattern as admin-songs / admin-affiliates: the gateway validates the
// logged-in Supabase Auth user JWT (verify_jwt = true), and the handler requires
// a row in admin_users. Both 'admin' and 'assistant' roles may read.
//
// Deploy with: supabase functions deploy admin-source-scoreboard --project-ref yzbvajungshqcpusfiia

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

    // Window in days (default 30). Clamp to a sane range.
    let days = 30;
    try {
      const url = new URL(req.url);
      const raw = parseInt(url.searchParams.get('days') || '30', 10);
      if (Number.isFinite(raw)) days = Math.min(Math.max(raw, 1), 365);
    } catch { /* keep default */ }

    const { data, error } = await admin.rpc('get_source_scoreboard', { days });
    if (error) {
      console.error('[admin-source-scoreboard] rpc error:', error.message);
      return json({ success: false, error: error.message }, 500);
    }

    // Coerce numerics (Postgres returns numeric as string over PostgREST).
    const rows = (data || []).map((r: any) => ({
      source: r.source,
      visits: Number(r.visits) || 0,
      purchases: Number(r.purchases) || 0,
      revenue: Number(r.revenue) || 0,
      convPct: Number(r.visits) > 0
        ? Math.round((Number(r.purchases) / Number(r.visits)) * 10000) / 100
        : null,
    }));

    return json({ success: true, days, sources: rows });
  } catch (err: any) {
    console.error('[admin-source-scoreboard] threw:', err?.message || err);
    return json({ success: false, error: err?.message || 'Unexpected error' }, 500);
  }
});
