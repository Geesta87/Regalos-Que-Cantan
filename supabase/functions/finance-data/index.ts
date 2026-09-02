// supabase/functions/finance-data/index.ts
// ===========================================================================
// FINANCE DATA — serves the admin Finance tab (Mercury bank P&L)
// ===========================================================================
// Read-mostly API over mercury_* tables: overview (balances, monthly P&L,
// daily cashflow, top vendors, runway inputs), the transactions ledger,
// owner recategorization (which mints a vendor rule so it sticks), rule
// management, and an on-demand sync trigger (proxies to mercury-sync with
// the service key).
//
// Auth: logged-in Supabase Auth session mapping to admin_users with
// role='admin' — the OWNER. Deliberately stricter than most tabs: this is
// the bank account, so assistants (Ivan, role='assistant') are rejected
// here even though the frontend also hides the tab. verify_jwt = true.
// Owner decision 2026-09-02: owner-only, all accounts synced.
//
// Deploy: supabase functions deploy finance-data --project-ref yzbvajungshqcpusfiia

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

// The P&L bucket whitelist (display labels live in FinanceTab.jsx).
const CATEGORIES = [
  'revenue_stripe', 'revenue_other', 'ads_meta', 'ads_other', 'ai_apis',
  'infra', 'messaging', 'software_tools', 'fees_bank', 'refunds_chargebacks',
  'owner_draw', 'taxes', 'other',
];

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
    // Bank data — OWNER only (assistants rejected even with a valid session).
    if (roleRow.role !== 'admin') return json({ success: false, error: 'Owner only' }, 403);
    const actorEmail = userData.user.email || 'admin';

    let body: any = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { body = {}; } }
    const action = body.action || 'overview';

    // ── Overview: everything the top of the tab needs in one call ─────────
    if (action === 'overview') {
      const months = Math.min(Number(body.months) || 13, 25);
      const [accounts, state, pnl, cashflow, vendors] = await Promise.all([
        admin.from('mercury_accounts').select('id, name, kind, status, current_balance, available_balance, synced_at').order('name'),
        admin.from('mercury_sync_state').select('*').eq('id', 1).maybeSingle(),
        admin.rpc('mercury_pnl', { p_months: months }),
        admin.rpc('mercury_cashflow_daily', { p_days: 90 }),
        admin.rpc('mercury_top_counterparties', { p_days: 30 }),
      ]);
      const firstErr = accounts.error || state.error || pnl.error || cashflow.error || vendors.error;
      if (firstErr) return json({ success: false, error: firstErr.message }, 500);
      return json({
        success: true,
        categories: CATEGORIES,
        accounts: accounts.data || [],
        sync_state: state.data || null,
        pnl: pnl.data || [],
        cashflow_daily: cashflow.data || [],
        top_vendors_30d: vendors.data || [],
      });
    }

    // ── Ledger ────────────────────────────────────────────────────────────
    if (action === 'transactions') {
      const limit = Math.min(Number(body.limit) || 100, 500);
      const offset = Math.max(Number(body.offset) || 0, 0);
      let q = admin.from('mercury_transactions')
        .select('id, account_id, amount, counterparty_name, status, kind, category, category_source, is_transfer, mercury_category, bank_description, note, created_at_mercury, posted_at, dashboard_link')
        .order('created_at_mercury', { ascending: false })
        .range(offset, offset + limit - 1);
      if (body.category && CATEGORIES.includes(body.category)) q = q.eq('category', body.category);
      if (body.account_id) q = q.eq('account_id', String(body.account_id));
      if (body.month && /^\d{4}-\d{2}$/.test(body.month)) {
        const [y, m] = body.month.split('-').map(Number);
        // Month filter is a coarse UTC window (the SQL rollups do the exact
        // LA-timezone bucketing; the ledger filter just needs to be close).
        q = q.gte('created_at_mercury', new Date(Date.UTC(y, m - 1, 1)).toISOString())
             .lt('created_at_mercury', new Date(Date.UTC(y, m, 1)).toISOString());
      }
      if (body.search) q = q.or(`counterparty_name.ilike.%${String(body.search).replace(/[%,()]/g, '')}%,bank_description.ilike.%${String(body.search).replace(/[%,()]/g, '')}%`);
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, transactions: data || [], limit, offset });
    }

    // ── Recategorize (+ optionally mint a vendor rule so it sticks) ───────
    if (action === 'recategorize') {
      const { id, category, create_rule } = body;
      if (!id || !CATEGORIES.includes(category)) return json({ success: false, error: 'Need id + a valid category' }, 400);
      const { data: txn, error: txErr } = await admin.from('mercury_transactions')
        .select('id, counterparty_clean, counterparty_name').eq('id', String(id)).single();
      if (txErr || !txn) return json({ success: false, error: 'Transaction not found' }, 404);

      const { error: upErr } = await admin.from('mercury_transactions')
        .update({ category, category_source: 'manual' }).eq('id', txn.id);
      if (upErr) return json({ success: false, error: upErr.message }, 500);

      let ruleApplied = 0;
      if (create_rule !== false && txn.counterparty_clean) {
        // Owner rules outrank the seeds (priority 10 < 50).
        await admin.from('mercury_category_rules').insert({
          pattern: txn.counterparty_clean, category, priority: 10, created_by: actorEmail,
        });
        // Retroactively fix every auto-categorized txn from the same vendor
        // (manual/agent categorizations are never overwritten).
        const { data: fixed } = await admin.from('mercury_transactions')
          .update({ category, category_source: 'rule' })
          .eq('counterparty_clean', txn.counterparty_clean)
          .in('category_source', ['default', 'mercury'])
          .select('id');
        ruleApplied = fixed?.length || 0;
      }
      return json({ success: true, rule_applied_to: ruleApplied });
    }

    // ── Rules ─────────────────────────────────────────────────────────────
    if (action === 'rules') {
      const { data, error } = await admin.from('mercury_category_rules')
        .select('*').order('priority').order('created_at', { ascending: false });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, rules: data || [] });
    }
    if (action === 'delete_rule') {
      if (!body.id) return json({ success: false, error: 'Need rule id' }, 400);
      const { error } = await admin.from('mercury_category_rules').delete().eq('id', String(body.id));
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ── On-demand sync (proxied server-side; mercury-sync is verify_jwt=false
    //    but we never hand its URL habits to the browser) ───────────────────
    if (action === 'sync') {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/mercury-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ source: 'finance-tab' }),
      });
      const data = await res.json().catch(() => ({}));
      return json(data, res.ok ? 200 : 500);
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('finance-data error:', e);
    return json({ success: false, error: String((e as Error)?.message || e) }, 500);
  }
});
