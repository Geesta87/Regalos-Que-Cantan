// supabase/functions/cs-distill-knowledge/index.ts
//
// STEP 4 — self-distilling knowledge. Weekly (pg_cron) the bot reads its own
// recent CORRECTIONS (owner-edited approvals) and DISCARDS, plus which topics are
// struggling, and PROPOSES concise FAQ/knowledge additions that would prevent
// those misses. Proposals land in cs_knowledge_proposals as `pending` — the owner
// approves/rejects them in Bot Training. Nothing changes the live knowledge until
// the owner approves. So this is safe to run unattended.
//
// verify_jwt = false (config.toml): invoked by pg_cron with no JWT (same as the
// other internal cron functions). It only writes PENDING proposals, so an
// unauthenticated call is harmless.
//
// Deploy with: supabase functions deploy cs-distill-knowledge --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CS_KNOWLEDGE, CS_GOLDEN_ANSWERS } from '../_shared/cs-knowledge.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('CS_DISTILL_MODEL') || 'claude-sonnet-4-6';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }
  if (!ANTHROPIC_API_KEY) return json({ ok: false, error: 'ANTHROPIC_API_KEY not set' }, 500);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Current knowledge the owner is using (custom override or the file default)
    // + the golden answers — so we don't propose things already covered.
    const { data: settings } = await admin
      .from('cs_agent_settings').select('knowledge_doc').eq('id', 1).maybeSingle();
    const knowledge = (settings?.knowledge_doc || '').trim() || CS_KNOWLEDGE;

    // Signal 1: recent CORRECTIONS (owner edited the draft before sending).
    const { data: corrections } = await admin
      .from('cs_examples')
      .select('customer_msg, reply')
      .eq('was_edited', true)
      .order('created_at', { ascending: false })
      .limit(40);

    // Signal 2: which topics are struggling (edit+discard rates by category).
    const { data: byCat } = await admin.rpc('cs_metrics_by_category', { days: 30 });

    // Signal 3: don't repropose things already pending/approved.
    const { data: existing } = await admin
      .from('cs_knowledge_proposals')
      .select('title')
      .in('status', ['pending', 'approved']);
    const existingTitles = new Set((existing || []).map((r) => (r.title || '').toLowerCase().trim()));

    const correctionLines = (corrections || [])
      .filter((c) => (c.reply || '').trim())
      .map((c) => `- Cliente: ${(c.customer_msg || '(sin texto)').slice(0, 200)}\n  Respuesta correcta del equipo: ${(c.reply || '').slice(0, 400)}`)
      .join('\n');
    const strugglingCats = (byCat || [])
      .filter((r: { edited: number; discarded: number }) => (r.edited || 0) + (r.discarded || 0) > 0)
      .map((r: { category: string; edited: number; discarded: number; total: number }) =>
        `- ${r.category}: ${r.edited} editadas, ${r.discarded} descartadas de ${r.total}`)
      .join('\n');

    if (!correctionLines) {
      return json({ ok: true, skipped: 'no corrections to learn from', created: 0 });
    }

    const system = `Eres el editor de conocimiento del bot de servicio al cliente de Regalos Que Cantan. Tu trabajo: a partir de CORRECCIONES reales (donde el equipo tuvo que editar la respuesta del bot) y de los temas que más fallan, proponer AÑADIDOS breves y concretos al documento de conocimiento para que el bot no repita esos errores.

REGLAS:
- Propón SOLO cosas que NO estén ya cubiertas en el conocimiento actual ni en las respuestas aprobadas (abajo).
- Cada propuesta debe ser corta, accionable y en el tono cálido del equipo (español para el cliente).
- Enfócate en HECHOS/POLÍTICAS o respuestas canónicas que falten, no en estilo.
- Máximo 5 propuestas. Si no hay nada claramente nuevo y útil, devuelve un arreglo vacío.
- Responde SOLO con un arreglo JSON válido, sin texto adicional. Formato:
[{"kind":"faq|fact|rule","title":"etiqueta corta","proposal":"el texto exacto a añadir al conocimiento","rationale":"por qué (qué corrección lo motivó)"}]

CONOCIMIENTO ACTUAL:
${knowledge.slice(0, 6000)}

RESPUESTAS APROBADAS EXISTENTES:
${CS_GOLDEN_ANSWERS.slice(0, 3000)}`;

    const userMsg = `CORRECCIONES RECIENTES (respuesta del bot que el equipo tuvo que editar → la correcta):\n${correctionLines}\n\nTEMAS QUE MÁS FALLAN (últimos 30 días):\n${strugglingCats || '(sin datos)'}\n\nPropón los añadidos de conocimiento (JSON array).`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, messages: [{ role: 'user', content: userMsg }] }),
    });
    if (!res.ok) {
      console.error('cs-distill: anthropic', res.status, await res.text().catch(() => ''));
      return json({ ok: false, error: `anthropic ${res.status}` }, 502);
    }
    const data = await res.json();
    const text = (data.content || []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('').trim();

    // Parse the JSON array (tolerate stray prose around it).
    let proposals: { kind?: string; title?: string; proposal?: string; rationale?: string }[] = [];
    try {
      const start = text.indexOf('[');
      const end = text.lastIndexOf(']');
      proposals = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : [];
    } catch (e) {
      console.warn('cs-distill: JSON parse failed', e, text.slice(0, 300));
      return json({ ok: false, error: 'could not parse proposals' }, 502);
    }

    // Insert new, non-duplicate proposals.
    const toInsert = proposals
      .filter((p) => p && (p.title || '').trim() && (p.proposal || '').trim())
      .filter((p) => !existingTitles.has((p.title || '').toLowerCase().trim()))
      .slice(0, 5)
      .map((p) => ({
        kind: ['faq', 'fact', 'rule'].includes(String(p.kind)) ? p.kind : 'faq',
        title: String(p.title).slice(0, 120),
        proposal: String(p.proposal).slice(0, 1500),
        rationale: p.rationale ? String(p.rationale).slice(0, 500) : null,
        status: 'pending',
      }));

    let created = 0;
    if (toInsert.length) {
      const { error: insErr } = await admin.from('cs_knowledge_proposals').insert(toInsert);
      if (insErr) return json({ ok: false, error: insErr.message }, 500);
      created = toInsert.length;

      // Best-effort heads-up to the owner.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            title: '💡 Nuevas mejoras de conocimiento sugeridas',
            body: `${created} propuesta(s) del bot esperan tu aprobación en Bot Training.`,
            url: '/admin/dashboard?tab=training',
            tag: 'cs-knowledge-proposals',
          }),
        });
      } catch (_e) { /* best-effort */ }
    }

    return json({ ok: true, created, considered: proposals.length });
  } catch (e) {
    console.error('cs-distill error:', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
