// supabase/functions/cs-agent/index.ts
//
// CUSTOMER-SERVICE AI — the "brain". Given a conversation id, it reads the
// recent messages and DRAFTS a Spanish reply. It NEVER sends anything and it
// NEVER writes to the business data. The owner approves every draft in the
// admin inbox before it goes out (Phase 1 = draft-and-approve).
//
// SAFETY MODEL (why this can't delete/change/leak things):
//   • The model is given exactly TWO tools, both read-only:
//       - look_up_my_order : SELECT on the cs_customer_lookup VIEW, filtered to
//                            the phone of THIS conversation (pinned in code —
//                            the AI cannot pass a different phone). So a customer
//                            can only ever see their OWN order, safe fields only.
//       - flag_for_human   : marks the draft as needing a person (money, refund,
//                            complaint, or "not sure"). Writes nothing to songs.
//     There is NO update/delete/insert tool. It is structurally impossible for
//     the bot to change an order, a payment, or any row of business data.
//   • It has no database credentials and no code access. It runs here, behind
//     the service-role key which the webhook passes; the handler rejects any
//     caller that is not the service role.
//   • Its only side effect is inserting ONE draft row into sms_messages
//     (direction='outbound', status='draft'). A draft is inert until the owner
//     approves it in sms-admin.
//
// verify_jwt = false (config.toml): called server-to-server by the inbound
// webhooks with the service-role key as Bearer (no user JWT). The handler
// authenticates by requiring that Bearer to equal the service-role key.
//
// Deploy with: supabase functions deploy cs-agent --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CS_KNOWLEDGE } from '../_shared/cs-knowledge.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Sonnet is plenty here and the owner approves every reply. One line to change.
const MODEL = Deno.env.get('CS_AGENT_MODEL') || 'claude-sonnet-4-6';
const SITE = 'https://regalosquecantan.com';

// How many recent messages of context to feed the model.
const HISTORY_LIMIT = 12;
// How many recent owner-approved replies to feed the model as voice examples.
const EXAMPLE_LIMIT = parseInt(Deno.env.get('CS_EXAMPLE_LIMIT') || '20', 10);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build the customer-facing link for one order, mirroring send-song-ready-sms's
// logic: upsell buyers get /success (shows everything); audio-only orders get
// the branded /s/<short_code>; fall back to /success by id.
function buildOrderLink(o: Record<string, unknown>): string {
  const isUpsell =
    o.has_video_addon === true ||
    o.karaoke_video_status != null ||
    o.karaoke_status != null;
  if (isUpsell) return `${SITE}/success?song_id=${o.id}`;
  if (o.short_code) return `${SITE}/s/${o.short_code}`;
  return `${SITE}/success?song_id=${o.id}`;
}

// ── Tools the model may call (both READ-ONLY) ──────────────────────────────
const TOOLS = [
  {
    name: 'look_up_my_order',
    description:
      "Busca el pedido del cliente que está escribiendo en esta conversación. NO recibe parámetros: siempre usa el número de teléfono de esta conversación (el cliente solo puede ver SU propio pedido). Úsala cuando el cliente pregunte por su canción, su enlace, si ya está lista o si ya pagó. Devuelve los pedidos de ese número con: nombre del destinatario, ocasión, si está pagado (is_paid), si la canción está lista (song_ready), el download_link (SOLO si está pagado) y preview_link_for_unpaid (enlace para ESCUCHAR sin descargar, para pedidos no pagados).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'flag_for_human',
    description:
      'Marca esta conversación para que la atienda una PERSONA del equipo. Úsala SIEMPRE que el tema sea de dinero (reembolsos, cargos, cobros dobles, disputas), una queja o molestia fuerte, un cambio en una canción ya hecha, o cualquier cosa de la que no estés seguro. Aun así, escribe una respuesta breve y cálida diciendo que un compañero dará seguimiento.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Motivo breve (interno) para el equipo.' },
      },
      required: ['reason'],
    },
  },
];

function systemPrompt(customerName: string | null, channel: string): string {
  const who = customerName ? `El cliente se llama ${customerName}. ` : '';
  return `Eres el agente de servicio al cliente de Regalos Que Cantan y respondes por ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} en ESPAÑOL. ${who}Tu trabajo es responder de forma cálida, humana y BREVE (es un chat, no un correo).

${CS_KNOWLEDGE}

REGLAS ESTRICTAS:
- Responde solo en español, en 1-3 frases cuando sea posible.
- NUNCA digas ni insinúes que las canciones se hacen con inteligencia artificial, IA, computadora, software, algoritmos, bots o de forma automática. Si preguntan cómo se crean, responde con calidez que NUESTRO EQUIPO crea cada canción personalizada (letra y voz) a partir de los datos que nos comparten, lista en unos minutos, y que la pueden escuchar gratis antes de pagar. Evita detalles técnicos. Si preguntan si eres un robot/bot/máquina, responde amablemente que eres parte del equipo de Regalos Que Cantan y con gusto los ayudas — sin dar detalles técnicos.
- Para cualquier dato del pedido del cliente (su canción, su enlace, si está lista, si pagó) usa la herramienta look_up_my_order. NUNCA inventes enlaces, precios, plazos ni el estado de un pedido.
- Si el pedido está PAGADO (is_paid = true): comparte su download_link para que descargue y comparta su canción.
- Si el pedido NO está pagado (is_paid = false): comparte el preview_link_for_unpaid para que ESCUCHE sus versiones, y explícale con calidez que ahí puede escucharlas y que al COMPLETAR SU COMPRA se desbloquea la descarga para guardarla y compartirla. NUNCA compartas un download_link ni digas que la canción "ya está lista para descargar" en un pedido no pagado. El enlace de preview solo deja escuchar; la descarga sigue bloqueada hasta que pague.
- Si no aparece ningún pedido para este número, no inventes: pide amablemente que escriba desde el número con el que hizo la compra, o que comparta su correo para que una persona lo verifique.
- Si el tema es de dinero (reembolso, cargo, cobro doble, disputa), una queja/molestia, un cambio de letra en una canción ya hecha, o algo de lo que no estás seguro: usa flag_for_human y responde que un compañero del equipo dará seguimiento pronto.
- No prometas reembolsos, cambios ni plazos exactos.
- Tu respuesta será revisada por una persona antes de enviarse, así que redáctala lista para enviar (sin notas internas).`;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  // Authenticate: only the service role (our webhooks) may invoke this.
  const authHeader = req.headers.get('Authorization') || '';
  if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
    return json({ ok: false, error: 'Forbidden' }, 403);
  }
  if (!ANTHROPIC_API_KEY) {
    return json({ ok: false, error: 'ANTHROPIC_API_KEY not set' }, 500);
  }

  let conversationId: string | undefined;
  try {
    ({ conversation_id: conversationId } = await req.json());
  } catch {
    return json({ ok: false, error: 'invalid body' }, 400);
  }
  if (!conversationId) return json({ ok: false, error: 'conversation_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Master switch — do nothing unless the owner has turned the bot on.
    const { data: settings } = await admin
      .from('cs_agent_settings')
      .select('enabled')
      .eq('id', 1)
      .maybeSingle();
    if (!settings?.enabled) {
      return json({ ok: true, skipped: 'cs agent disabled' });
    }

    // Load the conversation.
    const { data: convo } = await admin
      .from('sms_conversations')
      .select('id, phone, customer_name, opted_out, channel')
      .eq('id', conversationId)
      .maybeSingle();
    if (!convo) return json({ ok: false, error: 'conversation not found' }, 404);

    // Never draft to someone who opted out.
    if (convo.opted_out) return json({ ok: true, skipped: 'opted out' });

    // Load recent history (oldest → newest).
    const { data: msgs } = await admin
      .from('sms_messages')
      .select('direction, body, status, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = (msgs || []).reverse();

    // Only draft when the latest message is a real inbound customer message.
    const last = history[history.length - 1];
    if (!last || last.direction !== 'inbound') {
      return json({ ok: true, skipped: 'latest message is not inbound' });
    }
    // Don't stack drafts: if an unapproved draft already exists, leave it.
    if (history.some((m) => m.status === 'draft')) {
      return json({ ok: true, skipped: 'draft already pending' });
    }

    const phoneLast10 = String(convo.phone || '').replace(/\D/g, '').slice(-10);

    // Build the Anthropic message list from the thread.
    const messages: { role: 'user' | 'assistant'; content: unknown }[] = history
      .filter((m) => m.status !== 'draft' && m.status !== 'discarded')
      .map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.body,
      }));
    // The API requires the first message to be from the user.
    while (messages.length && messages[0].role !== 'user') messages.shift();
    if (!messages.length) return json({ ok: true, skipped: 'no user message' });

    // LEARNING: the most recent owner-approved / owner-sent replies teach the
    // bot the house voice. Edited approvals are flagged as corrections. These
    // are for TONE/STYLE only — real data comes from the tool, never here.
    let examplesBlock = '';
    try {
      const { data: examples } = await admin
        .from('cs_examples')
        .select('customer_msg, reply, was_edited')
        .order('created_at', { ascending: false })
        .limit(EXAMPLE_LIMIT);
      if (examples && examples.length) {
        const lines = examples
          .map((e) => {
            const q = (e.customer_msg || '').trim();
            const tag = e.was_edited ? ' (corregido por el equipo)' : '';
            return `${q ? `Cliente: ${q}\n` : ''}Equipo${tag}: ${e.reply}`;
          })
          .join('\n---\n');
        examplesBlock =
          `\n\nAPRENDE DE ESTAS RESPUESTAS REALES del equipo (de mensajes anteriores). Imita el TONO, la calidez, la longitud y el estilo con que responde el equipo. Las marcadas "(corregido por el equipo)" son correcciones importantes: síguelas. NO copies nombres, enlaces ni datos específicos de estos ejemplos — esos SIEMPRE vienen de la herramienta look_up_my_order:\n${lines}`;
      }
    } catch (exErr) {
      console.warn('cs-agent: examples fetch failed', exErr);
    }

    let needsHuman = false;
    let escalateReason = '';

    // ── Tool-use loop (max a few hops) ──────────────────────────────────────
    let finalText = '';
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 700,
          system: systemPrompt(convo.customer_name, convo.channel || 'sms') + examplesBlock,
          tools: TOOLS,
          messages,
        }),
      });
      if (!res.ok) {
        const errTxt = await res.text().catch(() => '');
        console.error('cs-agent: anthropic error', res.status, errTxt);
        return json({ ok: false, error: `anthropic ${res.status}` }, 502);
      }
      const data = await res.json();
      const content: AnthropicContentBlock[] = data.content || [];

      // Collect any assistant text.
      finalText = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();

      const toolUses = content.filter((c) => c.type === 'tool_use');
      if (data.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      // Echo the assistant turn back, then answer each tool call.
      messages.push({ role: 'assistant', content });
      const toolResults: unknown[] = [];
      for (const tu of toolUses) {
        let result: unknown;
        if (tu.name === 'look_up_my_order') {
          // PHONE IS PINNED from the conversation — AI input is ignored.
          if (phoneLast10.length < 10) {
            result = { orders: [], note: 'no valid phone on this conversation' };
          } else {
            const { data: orders } = await admin
              .from('cs_customer_lookup')
              .select('id, recipient_name, sender_name, occasion, genre, short_code, song_status, song_ready, has_video_addon, karaoke_video_status, karaoke_status, created_at, is_paid')
              .eq('phone_last10', phoneLast10)
              .order('created_at', { ascending: false })
              .limit(5);
            const orderList = (orders || []).map((o) => ({
              recipient_name: o.recipient_name,
              occasion: o.occasion,
              genre: o.genre,
              is_paid: o.is_paid,
              song_ready: o.song_ready,
              created_at: o.created_at,
              // HARD GATE: the DOWNLOAD link is only ever built for PAID orders.
              // Impossible for the model to hand out a download before payment.
              download_link: o.is_paid ? buildOrderLink(o) : null,
            }));
            // One PREVIEW ("listen before you pay") link covering all UNPAID
            // songs for this phone. Safe to share: the /listen page lets the
            // customer HEAR their versions, but the download stays locked until
            // they complete the purchase.
            const unpaidIds = (orders || []).filter((o) => !o.is_paid).map((o) => o.id);
            const previewLink = unpaidIds.length
              ? `${SITE}/listen?song_ids=${unpaidIds.join(',')}`
              : null;
            result = {
              orders: orderList,
              preview_link_for_unpaid: previewLink,
              guidance:
                'Pedidos PAGADOS: comparte su download_link. Pedidos NO pagados: comparte preview_link_for_unpaid para que escuche, y explica que al completar la compra se desbloquea la descarga. NUNCA compartas un download_link de un pedido no pagado.',
            };
          }
        } else if (tu.name === 'flag_for_human') {
          needsHuman = true;
          escalateReason = String(tu.input?.reason || 'flagged');
          result = { ok: true };
        } else {
          result = { error: `unknown tool ${tu.name}` };
        }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result) });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!finalText) {
      // The model produced no text (shouldn't happen) — escalate quietly.
      finalText = 'Gracias por tu mensaje. Un compañero del equipo te dará seguimiento en breve. 🙏';
      needsHuman = true;
      escalateReason = escalateReason || 'no draft text produced';
    }

    // Store the DRAFT (inert until the owner approves it in the inbox).
    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await admin
      .from('sms_messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        body: finalText,
        status: 'draft',
        channel: convo.channel || 'sms',
        ai_generated: true,
        needs_human: needsHuman,
      })
      .select('id, body, status, needs_human, created_at')
      .single();
    if (insErr) {
      console.error('cs-agent: draft insert failed', insErr);
      return json({ ok: false, error: insErr.message }, 500);
    }

    // Bump the conversation so the draft surfaces at the top of the inbox.
    await admin
      .from('sms_conversations')
      .update({ last_message_at: nowIso })
      .eq('id', conversationId);

    // Nudge the owner: a draft is waiting for approval.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          title: `✍️ Borrador listo${needsHuman ? ' ⚠️' : ''} · ${convo.customer_name || convo.phone}`,
          body: finalText.length > 110 ? finalText.slice(0, 110) + '…' : finalText,
          url: '/admin/dashboard?tab=sms',
          tag: `cs-draft-${conversationId}`,
        }),
      });
    } catch (pushErr) {
      console.warn('cs-agent: push failed', pushErr);
    }

    return json({ ok: true, draft: inserted, needs_human: needsHuman, reason: escalateReason || undefined });
  } catch (e) {
    console.error('cs-agent error:', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
