// supabase/functions/email-marketer-weekly/index.ts
// ===========================================================================
// EMAIL MARKETER — weekly drafter
// ===========================================================================
// Runs Monday morning via pg_cron. Researches the week's reasons to send —
// holidays, key dates, cultural moments, and creative "just because" angles —
// and drafts 2-3 designed promotional emails (subject, preview, enticing body,
// "best gift to give" angle + why a personalized song is the perfect gift, CTA).
// Drops them in email_queue (pending_approval) for the owner to review and send.
//
// It does NOT send anything. verify_jwt = false (pg_cron). Reads ANTHROPIC_API_KEY.
// Deploy: supabase functions deploy email-marketer-weekly --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('EMAIL_MARKETER_MODEL') || 'claude-opus-4-8';
const SITE = 'https://regalosquecantan.com';
const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// ---------------------------------------------------------------------------
const TOOL = {
  name: 'emit_email_batch',
  description: 'Emit this week\'s promotional emails.',
  input_schema: {
    type: 'object',
    properties: {
      emails: {
        type: 'array',
        description: '2 to 3 emails for this week. Each a different reason/angle.',
        items: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'The hook/occasion this email is built on (e.g. "Día del Padre is in 9 days", "Just because Monday", "Back-to-school nostalgia").' },
            subject: { type: 'string', description: 'Enticing Spanish subject line, <=55 chars, high open-rate. Emoji optional.' },
            preview_text: { type: 'string', description: 'Spanish preview/preheader, <=100 chars, complements the subject.' },
            headline: { type: 'string', description: 'Big Spanish headline at the top of the email.' },
            body_md: { type: 'string', description: 'The email body in warm Spanish. 2-4 short paragraphs. Lead with emotion, make the case that a personalized song is the BEST gift (unforgettable, made just for them, captures what words cannot), tie to the reason/occasion. You may include a short bullet list with "- ". Enticing, not pushy. No recipient names.' },
            cta_text: { type: 'string', description: 'Spanish button text, e.g. "Crear su canción".' },
          },
          required: ['reason', 'subject', 'preview_text', 'headline', 'body_md', 'cta_text'],
        },
      },
    },
    required: ['emails'],
  },
};

const SYSTEM = `You are the email marketing strategist for "Regalos Que Cantan" (regalosquecantan.com), a US-Hispanic brand selling personalized AI-generated Spanish songs as emotional gifts (~$30). You write the weekly promotional emails to past customers.

Your job each week: find 2-3 genuinely good REASONS to email this week and write a designed promo email for each. Think outside the box and be creative:
- Upcoming holidays & key dates (Hispanic + US): Día de las Madres, Día del Padre, Día del Amor y la Amistad, cumpleaños season, aniversarios, bodas, XV años, graduaciones, Navidad, Año Nuevo, Día de los Abuelos, Día del Niño, etc.
- Cultural / emotional moments, "just because" angles (a random Tuesday is a perfect day to surprise someone), nostalgia, "the gift they'll never forget".
- Always frame the offer as "the BEST gift to give" and explain WHY a personalized song wins: it's made just for them, it captures what words can't, it's unforgettable, it makes people cry happy tears — a keepsake forever, far better than flowers or another gift card.

Tone: warm, emotional, natural Mexican/US-Hispanic Spanish. Enticing and benefit-led with a clear call to action to create a song. No recipient names. Each email a distinct angle — don't repeat yourself.

Use the date you're given to anchor what's actually coming up this week and in the next few weeks.`;

async function generate(weekOf: string): Promise<any[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 4000, system: SYSTEM, tools: [TOOL],
      tool_choice: { type: 'tool', name: 'emit_email_batch' },
      messages: [{ role: 'user', content: `Today is ${weekOf}. Draft this week's 2-3 promotional emails. Find the best reasons to send (upcoming holidays/dates this week and the next few weeks, plus a creative "just because" angle) and make them genuinely enticing.` }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const tu = (data.content || []).find((c: any) => c.type === 'tool_use');
  if (!tu) throw new Error('No emails returned');
  return tu.input.emails || [];
}

// Simple, safe markdown-ish -> HTML (paragraphs + "- " bullet lists + **bold**).
function esc(s: string) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inline(s: string) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
function mdToHtml(md: string): string {
  return (md || '').split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => l.trim().startsWith('- '))) {
      return `<ul style="margin:0 0 16px;padding-left:20px;color:#374151;font-size:16px;line-height:1.7;">${lines.map((l) => `<li>${inline(l.trim().slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.7;">${inline(block.replace(/\n/g, '<br>'))}</p>`;
  }).join('');
}

// Branded HTML wrapper. {{UNSUB_URL}} is replaced per-recipient at send time.
function renderEmail(e: any): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;">${esc(e.preview_text || '')}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
        <tr><td style="background:#7c3aed;padding:18px 28px;">
          <span style="color:#fff;font-size:18px;font-weight:bold;letter-spacing:.3px;">🎵 Regalos Que Cantan</span>
        </td></tr>
        <tr><td style="padding:30px 28px 8px;">
          <h1 style="margin:0 0 16px;color:#111827;font-size:24px;line-height:1.25;">${inline(e.headline || '')}</h1>
          ${mdToHtml(e.body_md || '')}
        </td></tr>
        <tr><td align="center" style="padding:8px 28px 30px;">
          <a href="${SITE}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-size:17px;font-weight:bold;padding:14px 34px;border-radius:10px;">${esc(e.cta_text || 'Crear su canción')}</a>
          <p style="margin:14px 0 0;color:#9ca3af;font-size:13px;">o visita ${SITE.replace('https://', '')}</p>
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #eee;background:#fafafa;">
          <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
            Recibes este correo porque creaste una canción con Regalos Que Cantan.<br>
            <a href="{{UNSUB_URL}}" style="color:#9ca3af;">Cancelar suscripción</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const start = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const json = (s: number, b: any) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  if (Deno.env.get('EMAIL_MARKETER_ENABLED') === 'false') return json(200, { success: true, skipped: true });

  const weekOf = new Date().toISOString().slice(0, 10);
  try {
    const emails = await generate(weekOf);
    if (!emails.length) throw new Error('empty batch');
    let saved = 0;
    for (const e of emails) {
      const { error } = await supabase.from('email_queue').insert({
        week_of: weekOf, reason: e.reason ?? null, subject: e.subject || '(no subject)',
        preview_text: e.preview_text ?? null, body_html: renderEmail(e), cta_text: e.cta_text ?? null,
        cta_url: SITE, status: 'pending_approval',
      });
      if (!error) saved++;
    }
    await supabase.from('agent_runs').insert({
      agent: 'email-marketer', status: 'ok', ok: true,
      summary: `Drafted ${saved} email(s) for week of ${weekOf}`, payload: { week_of: weekOf, saved },
      finished_at: new Date().toISOString(), execution_ms: Date.now() - start,
    });
    return json(200, { success: true, week_of: weekOf, drafted: saved });
  } catch (e: any) {
    await supabase.from('agent_runs').insert({ agent: 'email-marketer', status: 'error', ok: false, error: String(e?.message || e).slice(0, 600), finished_at: new Date().toISOString() }).then(() => {}, () => {});
    return json(500, { success: false, error: String(e?.message || e) });
  }
});
