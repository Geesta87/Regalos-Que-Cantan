// supabase/functions/cs-metrics/index.ts
//
// ADMIN-ONLY read endpoint for the "CS Insights" dashboard. Returns the quality
// numbers for the customer-service AI: volume, the draft outcome funnel
// (approved-as-is / edited / discarded / escalated), the same broken down BY
// question category, and a weekly "sent as-is" trend. These are the numbers that
// tell the owner when a category is safe to auto-send.
//
// Auth mirrors sms-admin: Supabase Auth JWT (config default verify_jwt = true)
// + an admin_users row. All heavy aggregation runs in SQL functions (see
// migration cs_quality_metrics) — this just calls them and assembles the JSON.
//
// Deploy with: supabase functions deploy cs-metrics --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow } = await admin
      .from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No admin access' }, 403);

    // Topics that can never be auto-sent (kept in sync with cs-agent NEVER_AUTO).
    const NEVER_AUTO = ['billing_money', 'complaint', 'change_request'];

    // ── POST: change auto-send settings (admin only) ─────────────────────
    if (req.method === 'POST') {
      if (roleRow.role !== 'admin') return json({ success: false, error: 'Only admins can change auto-send' }, 403);
      let body: { action?: string; auto_send_enabled?: boolean; category?: string; mode?: string } = {};
      try { body = await req.json(); } catch { body = {}; }
      if (body.action !== 'set-autonomy') return json({ success: false, error: 'Unknown action' }, 400);

      const { data: s } = await admin
        .from('cs_agent_settings').select('auto_send_enabled, auto_categories').eq('id', 1).maybeSingle();
      const update: Record<string, unknown> = { id: 1 };
      if (typeof body.auto_send_enabled === 'boolean') update.auto_send_enabled = body.auto_send_enabled;
      if (body.category && (body.mode === 'auto' || body.mode === 'draft')) {
        const cur: string[] = Array.isArray(s?.auto_categories) ? s.auto_categories : [];
        let next = cur.filter((c) => c !== body.category);
        if (body.mode === 'auto' && !NEVER_AUTO.includes(body.category)) next = [...next, body.category!];
        update.auto_categories = next;
      }
      const { error: upErr } = await admin.from('cs_agent_settings').upsert(update, { onConflict: 'id' });
      if (upErr) return json({ success: false, error: upErr.message }, 500);
      const { data: after } = await admin
        .from('cs_agent_settings').select('auto_send_enabled, auto_categories').eq('id', 1).maybeSingle();
      return json({
        success: true,
        autonomy: { enabled: !!after?.auto_send_enabled, categories: after?.auto_categories || [], never_auto: NEVER_AUTO },
      });
    }

    // Optional window override (?days=30).
    let days = 30;
    try {
      const u = new URL(req.url);
      const d = parseInt(u.searchParams.get('days') || '30', 10);
      if (Number.isFinite(d) && d > 0 && d <= 365) days = d;
    } catch { /* default */ }

    const [overview, byCategory, trend, volume, settings] = await Promise.all([
      admin.rpc('cs_metrics_overview', { days }),
      admin.rpc('cs_metrics_by_category', { days }),
      admin.rpc('cs_metrics_trend', { weeks: 8 }),
      admin.rpc('cs_metrics_volume', { days }),
      admin.from('cs_agent_settings').select('auto_send_enabled, auto_categories').eq('id', 1).maybeSingle(),
    ]);

    if (overview.error) return json({ success: false, error: overview.error.message }, 500);

    return json({
      success: true,
      days,
      overview: overview.data,
      by_category: byCategory.data || [],
      trend: trend.data || [],
      volume: volume.data,
      autonomy: {
        enabled: !!settings.data?.auto_send_enabled,
        categories: settings.data?.auto_categories || [],
        never_auto: NEVER_AUTO,
      },
    });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
