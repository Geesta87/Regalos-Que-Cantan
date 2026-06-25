// supabase/functions/chief-of-staff-admin/index.ts
// ===========================================================================
// CHIEF OF STAFF — admin reader
// ===========================================================================
// Powers the "Chief of Staff" dashboard tab. Returns the latest morning
// briefings (cos_briefings). Admin-only (it surfaces revenue). verify_jwt = true.
// Also exposes action:'run' so the owner can refresh the briefing on demand.
//
// Deploy: supabase functions deploy chief-of-staff-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization header' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: ud, error: ue } = await userClient.auth.getUser();
    if (ue || !ud?.user) return json({ success: false, error: 'Invalid session' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', ud.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No dashboard access' }, 403);
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Admins only' }, 403);

    let body: any = {}; try { body = await req.json(); } catch { body = {} }

    if (body.action === 'run') {
      // Fire a fresh briefing server-to-server (don't block).
      fetch(`${SUPABASE_URL}/functions/v1/chief-of-staff-daily`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
      return json({ success: true, started: true });
    }

    const { data: briefings, error } = await admin.from('cos_briefings')
      .select('id, briefing_for, analysis, email_sent, created_at')
      .order('briefing_for', { ascending: false }).limit(14);
    if (error) return json({ success: false, error: error.message }, 500);
    return json({ success: true, role: roleRow.role, briefings: briefings || [] });
  } catch (err) {
    console.error('chief-of-staff-admin error:', err);
    return json({ success: false, error: String((err as Error)?.message || err) }, 500);
  }
});
