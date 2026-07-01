// supabase/functions/cs-training-admin/index.ts
//
// Backs the admin "Bot Training" panel. Lets the owner edit the customer-service
// rep's knowledge (facts, prices, tone, rules) in plain text — saved to
// cs_agent_settings.knowledge_doc, which cs-agent reads on the very next message
// (no redeploy). Also lists/deletes the auto-learned reply examples.
//
// Auth: same as sms-admin — the gateway verifies the Supabase Auth JWT
// (config.toml verify_jwt = true), then we require a row in admin_users. Only
// role='admin' may save (it changes what the bot says to customers).
//
// Contract with the frontend (BotTrainingTab.jsx):
//   GET  → { success, role, enabled, knowledge, is_custom, examples: [...] }
//   POST { action:'save', knowledge }        → { success }
//   POST { action:'reset' }                  → { success }  (revert to default)
//   POST { action:'delete-example', id }     → { success }
//   POST { action:'toggle', enabled }        → { success }  (bot master switch)
//
// Deploy with: supabase functions deploy cs-training-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CS_KNOWLEDGE } from '../_shared/cs-knowledge.ts';

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
    const role = roleRow.role as 'admin' | 'assistant';

    let body: { action?: string; knowledge?: string; id?: string; enabled?: boolean } = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const action = body.action || 'get';

    // ── get: knowledge + recent learned examples ─────────────────────────
    if (action === 'get') {
      const { data: settings } = await admin
        .from('cs_agent_settings').select('enabled, knowledge_doc').eq('id', 1).maybeSingle();
      const { data: examples } = await admin
        .from('cs_examples')
        .select('id, created_at, channel, customer_msg, reply, was_edited, source')
        .order('created_at', { ascending: false })
        .limit(50);
      const custom = (settings?.knowledge_doc || '').trim();
      return json({
        success: true,
        role,
        enabled: !!settings?.enabled,
        knowledge: custom || CS_KNOWLEDGE,
        is_custom: !!custom,
        examples: examples || [],
      });
    }

    // Everything below changes bot behavior → admins only.
    if (role !== 'admin') return json({ success: false, error: 'Only admins can edit training' }, 403);

    // ── save knowledge ───────────────────────────────────────────────────
    if (action === 'save') {
      const knowledge = (body.knowledge || '').trim();
      if (!knowledge) return json({ success: false, error: 'knowledge cannot be empty' }, 400);
      const { error } = await admin
        .from('cs_agent_settings').update({ knowledge_doc: knowledge, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ── reset to the built-in default ────────────────────────────────────
    if (action === 'reset') {
      const { error } = await admin
        .from('cs_agent_settings').update({ knowledge_doc: null, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, knowledge: CS_KNOWLEDGE });
    }

    // ── delete a learned example ─────────────────────────────────────────
    if (action === 'delete-example') {
      if (!body.id) return json({ success: false, error: 'id required' }, 400);
      const { error } = await admin.from('cs_examples').delete().eq('id', body.id);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ── flip the bot master switch ───────────────────────────────────────
    if (action === 'toggle') {
      const { error } = await admin
        .from('cs_agent_settings').update({ enabled: !!body.enabled, updated_at: new Date().toISOString() }).eq('id', 1);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, enabled: !!body.enabled });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
