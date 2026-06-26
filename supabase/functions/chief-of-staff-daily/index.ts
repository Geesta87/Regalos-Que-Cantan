// supabase/functions/chief-of-staff-daily/index.ts
// ===========================================================================
// CHIEF OF STAFF — daily command center
// ===========================================================================
// Runs each morning AFTER the other agents. Reads what every agent did + the
// business state, and has Claude fold it into ONE prioritized briefing: the few
// things that matter today, each pointing at the right tab, plus a health check
// on every agent. Stores it + emails the owner.
//
// verify_jwt = false (pg_cron). Reads ANTHROPIC_API_KEY + SENDGRID_API_KEY.
// Deploy: supabase functions deploy chief-of-staff-daily --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const MODEL = Deno.env.get('COS_MODEL') || 'claude-opus-4-8';
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RQC Chief of Staff';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const AGENTS = ['media-buyer', 'creative-studio', 'email-marketer', 'competitor-scan'];

const TOOL = {
  name: 'emit_cos_briefing',
  description: 'Emit the prioritized morning command-center briefing.',
  input_schema: {
    type: 'object',
    properties: {
      greeting: { type: 'string', description: 'One sentence: the single most important thing for the owner today.' },
      snapshot: { type: 'string', description: '2-3 sentences, plain language: how the business did yesterday + what is queued across the agents.' },
      top_actions: {
        type: 'array',
        description: 'The 3-5 things that matter today, highest-impact first.',
        items: {
          type: 'object',
          properties: {
            priority: { type: 'integer' },
            action: { type: 'string', description: 'Concrete action.' },
            why: { type: 'string', description: 'One line of why it matters.' },
            where: { type: 'string', description: 'Which dashboard tab to do it in (e.g. "Creative Studio", "Daily Briefing", "Emails", "Competitors").' },
          },
          required: ['priority', 'action', 'why', 'where'],
        },
      },
      agent_health: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            agent: { type: 'string' },
            status: { type: 'string', enum: ['ok', 'attention'] },
            note: { type: 'string' },
          },
          required: ['agent', 'status', 'note'],
        },
      },
    },
    required: ['greeting', 'snapshot', 'top_actions', 'agent_health'],
  },
};

const SYSTEM = `You are the Chief of Staff for the owner of "Regalos Que Cantan" (personalized Spanish songs, ~$30 AOV). Every morning you read what each AI agent did overnight + the business state, and tell the owner the FEW things that actually matter today — in priority order, action-first, each pointing at the exact dashboard tab to do it in.

Be decisive and concise — you're the owner's right hand, not a report generator. Surface money being left on the table (creatives or emails waiting for approval, a winning competitor angle to clone, an ad budget move to apply). Flag anything that needs attention: an agent that errored, drafts going stale, a sending email, a bad ad day. If everything's quiet, say so plainly. Plain language, no jargon dumps.`;

async function callClaude(gathered: any): Promise<any> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2500, system: SYSTEM, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'emit_cos_briefing' },
      messages: [{ role: 'user', content: `Here is this morning's cross-agent snapshot. Produce the briefing.\n\n${JSON.stringify(gathered, null, 2)}` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!tu) throw new Error('No briefing returned');
  return tu.input;
}

function renderEmail(a: any, dateStr: string): string {
  const actions = (a.top_actions || []).map((x: any) =>
    `<li style="margin:0 0 12px;"><b style="color:#111;">${x.action}</b> <span style="color:#9ca3af;font-size:12px;">· ${x.where}</span><br><span style="color:#666;font-size:13px;">${x.why}</span></li>`).join('');
  const health = (a.agent_health || []).map((h: any) =>
    `<span style="display:inline-block;margin:0 8px 6px 0;font-size:12px;padding:3px 8px;border-radius:999px;background:${h.status === 'ok' ? '#dcfce7' : '#fef3c7'};color:${h.status === 'ok' ? '#166534' : '#92400e'};">${h.status === 'ok' ? '✓' : '⚠'} ${h.agent}</span>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#111827;padding:22px 28px;">
      <div style="color:#9ca3af;font-size:12px;letter-spacing:.5px;text-transform:uppercase;">Chief of Staff · Morning Command Center</div>
      <h1 style="color:#fff;margin:6px 0 0;font-size:20px;">${dateStr}</h1>
    </div>
    <div style="padding:24px 28px;">
      <div style="font-size:16px;line-height:1.5;color:#111;border-left:4px solid #7c3aed;padding-left:12px;margin-bottom:16px;">${a.greeting}</div>
      <p style="color:#374151;font-size:14px;line-height:1.6;">${a.snapshot}</p>
      <h3 style="margin:22px 0 8px;font-size:15px;color:#111;">Today's priorities</h3>
      <ol style="padding-left:18px;color:#111;font-size:14px;">${actions}</ol>
      <h3 style="margin:22px 0 8px;font-size:15px;color:#111;">Agents</h3>
      <div>${health}</div>
      <p style="color:#9ca3af;font-size:12px;margin-top:20px;border-top:1px solid #eee;padding-top:14px;">Your AI team ran overnight. Open the dashboard to act on the above.</p>
    </div>
  </div>
</body></html>`;
}

async function sendEmail(subject: string, html: string) {
  if (!SENDGRID_API_KEY) return false;
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME }, reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject, content: [{ type: 'text/html', value: html }], categories: ['chief_of_staff', 'rqc_internal'],
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false }, subscription_tracking: { enable: false } },
    }),
  });
  return res.ok;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  if (Deno.env.get('COS_ENABLED') === 'false') return json(200, { success: true, skipped: true });

  const count = async (table: string, build: (q: any) => any) => {
    const { count } = await build(supabase.from(table).select('id', { count: 'exact', head: true }));
    return count || 0;
  };

  try {
    // ---- Gather across agents ----
    const { data: mb } = await supabase.from('media_buyer_reports').select('report_for, metrics, analysis').order('report_for', { ascending: false }).limit(1).maybeSingle();
    const [creativesReady, creativesGenerating, emailsPending, emailsSending, competitorsNew] = await Promise.all([
      count('creative_queue', (q) => q.eq('status', 'ready')),
      count('creative_queue', (q) => q.eq('status', 'generating')),
      count('email_queue', (q) => q.eq('status', 'pending_approval')),
      count('email_queue', (q) => q.eq('status', 'sending')),
      count('competitor_ads', (q) => q.eq('status', 'new')),
    ]);
    const { data: compTop } = await supabase.from('competitor_ads').select('page_name, score, analysis').eq('status', 'new').order('score', { ascending: false, nullsFirst: false }).limit(2);
    const runs: Record<string, any> = {};
    for (const ag of AGENTS) {
      const { data } = await supabase.from('agent_runs').select('status, summary, error, started_at').eq('agent', ag).order('started_at', { ascending: false }).limit(1).maybeSingle();
      runs[ag] = data || null;
    }

    const gathered = {
      media_buyer: mb ? { report_for: mb.report_for, headline: mb.analysis?.headline, account_health: mb.analysis?.account_health, revenue: mb.metrics?.revenue_crosscheck, top_recommendation: mb.analysis?.recommendations?.[0] } : null,
      creative_studio: { ready_for_approval: creativesReady, still_generating: creativesGenerating },
      email_marketer: { drafts_pending_approval: emailsPending, currently_sending: emailsSending },
      competitors: { new_opportunities: competitorsNew, top: (compTop || []).map((c: any) => ({ page_name: c.page_name, score: c.score, suggested_angle: c.analysis?.suggested_rqc_angle })) },
      agent_runs: runs,
    };

    const briefing = await callClaude(gathered);
    // Defensive: the model occasionally returns top_actions/agent_health as a
    // STRING instead of an array, which crashed the email render + the dashboard
    // (.map on a string). Coerce to arrays — salvage a string into one action.
    briefing.top_actions = Array.isArray(briefing.top_actions)
      ? briefing.top_actions
      : (typeof briefing.top_actions === 'string' && briefing.top_actions.trim()
          ? [{ priority: 1, action: briefing.top_actions.trim(), why: '', where: '' }]
          : []);
    if (!Array.isArray(briefing.agent_health)) briefing.agent_health = [];
    const briefingFor = new Date().toISOString().slice(0, 10);
    await supabase.from('cos_briefings').upsert({ briefing_for: briefingFor, gathered, analysis: briefing, email_sent: false }, { onConflict: 'briefing_for' });

    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
    const emailed = await sendEmail(`🧭 ${briefing.greeting?.slice(0, 80) || 'Morning briefing'}`, renderEmail(briefing, dateStr));
    if (emailed) await supabase.from('cos_briefings').update({ email_sent: true }).eq('briefing_for', briefingFor);

    await supabase.from('agent_runs').insert({ agent: 'chief-of-staff', status: 'ok', ok: true, summary: briefing.greeting?.slice(0, 200), payload: { briefing_for: briefingFor, actions: briefing.top_actions?.length, emailed }, finished_at: new Date().toISOString(), execution_ms: Date.now() - start });
    return json(200, { success: true, briefing_for: briefingFor, emailed });
  } catch (e: any) {
    await supabase.from('agent_runs').insert({ agent: 'chief-of-staff', status: 'error', ok: false, error: String(e?.message || e).slice(0, 600), finished_at: new Date().toISOString() }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
