// supabase/functions/daily-briefing-admin/index.ts
// ===========================================================================
// DAILY BRIEFING — admin dashboard reader
// ===========================================================================
// Powers the "Daily Briefing" tab. Returns the stored Media Buyer reports
// (media_buyer_reports) so the owner can read the morning brief inside the
// dashboard, not just in email. Read-only.
//
// Auth: logged-in Supabase Auth session mapping to admin_users, role='admin'
// REQUIRED (the brief contains spend + revenue). Same pattern as
// social-pipeline-config / creative-studio-admin. verify_jwt = true.
//
// Deploy: supabase functions deploy daily-briefing-admin --project-ref yzbvajungshqcpusfiia

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
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (roleErr || !roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    // Revenue-sensitive — admins only.
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {} } }

    const limit = Math.min(Number(body.limit) || 14, 60);

    // Latest reports (newest first). The most recent run is the brief to show;
    // the rest populate a date switcher + the last agent run status.
    const { data: reports, error: repErr } = await admin
      .from('media_buyer_reports')
      .select('id, report_for, account_id, metrics, analysis, email_sent, created_at')
      .order('report_for', { ascending: false })
      .limit(limit);
    if (repErr) return json({ success: false, error: repErr.message }, 500);

    // Last agent run (so the UI can show "ran ok / errored / never run").
    const { data: lastRun } = await admin
      .from('agent_runs')
      .select('status, summary, error, started_at, finished_at')
      .eq('agent', 'media-buyer')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return json({ success: true, role: roleRow.role, reports: reports || [], last_run: lastRun || null });
  } catch (err) {
    console.error('daily-briefing-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
