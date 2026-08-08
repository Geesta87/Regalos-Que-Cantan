// supabase/functions/cs-agent/index.ts
//
// CUSTOMER-SERVICE AI — the "brain". Given a conversation id, it reads the
// recent messages and DRAFTS a Spanish reply. It NEVER sends anything and it
// NEVER writes to the business data. The owner approves every draft in the
// admin inbox before it goes out (Phase 1 = draft-and-approve).
//
// SAFETY MODEL (why this can't delete/change/leak things):
//   • The model is given exactly THREE tools, all INERT at draft time:
//       - look_up_my_order : SELECT on the cs_customer_lookup VIEW, filtered to
//                            the phone of THIS conversation (pinned in code —
//                            the AI cannot pass a different phone). So a customer
//                            can only ever see their OWN order, safe fields only.
//       - send_link_by_email: records a PROPOSED action on the draft (resend the
//                            paid-song link via recover-song). Nothing is sent at
//                            draft time — sms-admin executes it only when the
//                            owner APPROVES the draft.
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
import { CS_KNOWLEDGE, CS_GOLDEN_ANSWERS } from '../_shared/cs-knowledge.ts';
import { OFFERS } from '../_shared/brand-brief.ts';
import { embedText, embedTexts } from '../_shared/embed.ts';
import { sendSms } from '../_shared/send-sms.ts';
import { sendWhatsApp } from '../_shared/send-whatsapp.ts';
import { translateOne } from '../_shared/translate.ts';
// ONE resolver for "who is this customer". The snapshot and the look_up_my_order
// tool both go through it, so they can no longer contradict each other — which
// was the single biggest cause of thrown-away drafts in the Aug-2026 audit.
import {
  buildOrderLink,
  buildPreviewLink,
  extractEmails,
  extractSongRefs,
  fetchOrderExtras,
  phoneLast10 as toLast10,
  resolveCustomerOrders,
  type CsOrder,
  type OrderExtras,
} from '../_shared/cs-customer-resolve.ts';

// Topics that can NEVER auto-send, even if added to the allowlist (belt & braces
// with needs_human). Money, complaints, and edits to finished songs always go to
// a human.
const NEVER_AUTO = new Set(['billing_money', 'complaint', 'change_request']);

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

function daysAgo(iso: unknown): number | null {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

// ── Always-on "situation snapshot" ─────────────────────────────────────────
// Before the model writes anything, we hand it a factual picture of WHO this
// customer is and WHERE they are in the journey — so it responds to the
// situation, not just the words.
//
// Identity resolution lives ENTIRELY in _shared/cs-customer-resolve.ts, which
// the look_up_my_order tool also calls. Previously these were two separate
// implementations reading two different sources, and they disagreed constantly:
// the snapshot could find you by email, the tool could only find you by phone.
// The model got both answers in one turn and wrote "I couldn't find your order"
// to customers whose order was right there. One resolver, one answer.

// Render the video / story-video / open-correction state for the songs we found,
// so threads about photos, videos and pending fixes stop being answered blind.
function renderExtras(orders: CsOrder[], extras: OrderExtras): string[] {
  const lines: string[] = [];
  const nameFor = (songId: string) =>
    orders.find((o) => String(o.id) === String(songId))?.recipient_name || 'su canción';

  for (const v of extras.videos) {
    const who = nameFor(v.song_id);
    if (v.video_url) {
      lines.push(`- VIDEO CON FOTOS de ${who}: YA ESTÁ LISTO. Si pregunta por el video, es este pedido.`);
    } else if (v.paid && !v.photo_count) {
      lines.push(`- VIDEO CON FOTOS de ${who}: PAGADO pero AÚN NO subió las fotos. Si escribe sobre el video, lo que necesita es subir sus fotos desde el enlace de su canción.`);
    } else if (v.paid) {
      lines.push(`- VIDEO CON FOTOS de ${who}: pagado, ${v.photo_count} foto(s) recibidas, en proceso (estado: ${v.status || 'en curso'}). NO prometas fecha.`);
    }
  }
  for (const sv of extras.storyVideos) {
    const who = nameFor(sv.song_id);
    lines.push(
      sv.video_url
        ? `- VIDEO ANIMADO de ${who}: YA ESTÁ LISTO.`
        : `- VIDEO ANIMADO (Animado) de ${who}: EN PRODUCCIÓN (estado: ${sv.state || 'en curso'}). Si manda fotos o dice quién es quién, es para ESTE video — agradécelo y confirma que se lo pasamos al equipo. NO prometas fecha y NO lo trates como una pregunta sobre la canción.`,
    );
  }
  for (const f of extras.fixes) {
    lines.push(
      `- CORRECCIÓN YA REGISTRADA para ${nameFor(f.song_id)} (estado: ${f.status || 'abierta'}): "${String(f.customer_request || '').slice(0, 140)}". NO la registres de nuevo; confirma que el equipo ya la tiene.`,
    );
  }
  return lines;
}

// deno-lint-ignore no-explicit-any
async function buildSituationSnapshot(admin: any, opts: {
  phoneLast10: string;
  customerEmails: string[];
  songIds: string[];
  shortCodes: string[];
  alreadySentLink: boolean;
  /** How many times we have ALREADY asked this person for their email. */
  emailAsks: number;
  /** Someone in this thread has claimed a payment (often Zelle). */
  paymentClaimed: boolean;
}): Promise<{ text: string; identified: boolean; orders: CsOrder[] }> {
  const { orders, matchedBy } = await resolveCustomerOrders(admin, {
    // Song links already in this thread beat everything — see extractSongRefs.
    songIds: opts.songIds,
    shortCodes: opts.shortCodes,
    phoneLast10: opts.phoneLast10,
    emails: opts.customerEmails,
    // Names are NOT used here on purpose: a name-only match can hit a stranger.
    // The tool may try it, and flags the result as needing confirmation.
  });

  const header =
    'SITUACIÓN DEL CLIENTE (contexto real del sistema — LÉELO Y PIÉNSALO ANTES DE RESPONDER; responde según la SITUACIÓN, no solo según las palabras del mensaje):';

  if (!orders.length) {
    const gaveEmail = opts.customerEmails.length > 0;
    // STOP THE LOOP. Asking again for an email we already asked for is the
    // single most common wasted draft: on 2026-08-05 one thread got the same
    // request five times because the order was built by hand (no phone, house
    // email) and no answer could ever have resolved it.
    const askedAlready = opts.emailAsks >= 1;
    return {
      identified: false,
      orders: [],
      text: `${header}
- NO pude identificar a este cliente${gaveEmail ? ' ni con el correo que dio' : ' por su número de teléfono'}. Esto NO significa que sea nuevo: puede haber comprado en la web con otro número, o el equipo pudo haberle creado la canción a mano desde este mismo chat. NUNCA asumas que no ha comprado, y NUNCA le preguntes "¿ya hizo su canción?" como si fuera nuevo.
${askedAlready
  ? `- ⛔ YA LE PEDIMOS EL CORREO ${opts.emailAsks} vez/veces en esta conversación y seguimos sin ubicarlo. PROHIBIDO volver a pedírselo. Pedir el mismo dato otra vez enoja al cliente y no resuelve nada.
- Haz UNA de estas dos cosas, no otra: (a) si el cliente hizo una PREGUNTA o te dio una INSTRUCCIÓN, respóndele ESO directamente con lo que ya sabes de la conversación; o (b) si de verdad hace falta ubicar el pedido, usa look_up_my_order con el NOMBRE de la persona a quien va la canción (búscalo en el historial de este chat — es muy probable que ya lo haya dicho).
- Si aun así no aparece, dile con calidez que un compañero lo revisa y NO pidas más datos.`
  : `- Pídele UNA SOLA VEZ, con calidez, el CORREO de su pedido. Si no lo da o no aparece, NO se lo vuelvas a pedir: usa look_up_my_order con el NOMBRE de la persona a quien va la canción (revisa el historial, quizá ya lo dijo).`}`,
    };
  }

  const paid = orders.filter((o) => o.is_paid);
  const unpaid = orders.filter((o) => !o.is_paid);
  const anyReady = orders.some((o) => o.song_ready);
  const recent = orders[0];
  const d = daysAgo(recent.created_at);
  const whenTxt = d === 0 ? 'hoy' : d === 1 ? 'ayer' : d != null ? `hace ${d} días` : 'recientemente';
  const recipient = recent.recipient_name
    ? ` (la más reciente para ${recent.recipient_name}${recent.occasion ? `, ${recent.occasion}` : ''})`
    : '';
  const how = matchedBy.includes('phone')
    ? 'por su teléfono'
    : matchedBy.length
    ? 'por el correo que dio'
    : '';

  const lines: string[] = [
    header,
    `- Cliente IDENTIFICADO${how ? ` (${how})` : ''}. Pedido más reciente: ${whenTxt}${recipient}.`,
  ];

  if (paid.length) {
    lines.push(
      `- YA ES CLIENTE: tiene ${paid.length} canción(es) PAGADA(S)${anyReady ? ' y lista(s)' : ''}.${opts.alreadySentLink ? ' Ya le enviamos su enlace antes.' : ''} Trátalo como cliente existente y NUNCA le preguntes si ya hizo su canción. Si necesita su enlace, compárteselo:`,
    );
    for (const o of paid.slice(0, 4)) {
      lines.push(`    · ${o.recipient_name || 'su canción'}: ${buildOrderLink(o, SITE)}`);
    }
  }
  if (unpaid.length) {
    // Zelle and other off-Stripe payments never reach the songs table, so an
    // order can read "unpaid" for a customer who HAS paid. Telling a paying
    // customer to go pay is far worse than saying nothing — so when a payment
    // has been claimed in this thread, we suppress the pay-now push entirely
    // and hand it to a person. (Real case: Rolando, 2026-08-05, paid by Zelle.)
    if (opts.paymentClaimed) {
      lines.push(
        `- ⚠️ ATENCIÓN: en el sistema estas canciones figuran SIN pagar, PERO en esta conversación ya se habló de un pago (posiblemente por Zelle o transferencia, que NO se registran automáticamente). NO le digas que no ha pagado, NO le pidas que pague y NO le mandes a completar la compra. Responde con calidez lo que te pregunte y deja que un compañero verifique el pago.`,
      );
    } else {
      lines.push(
        `- Tiene ${unpaid.length} canción(es) SIN pagar. Si pregunta por ellas, comparte este enlace para que las ESCUCHE y explícale que al completar la compra se desbloquea la descarga (NUNCA compartas descarga de algo no pagado): ${buildPreviewLink(unpaid, SITE)}`,
      );
    }
  }
  if (paid.length > 1) {
    lines.push(`- Es CLIENTE RECURRENTE (${paid.length} compradas). Trátalo con especial cariño y gratitud.`);
  }

  // Everything that is NOT the song itself: videos, Animado, open corrections.
  try {
    const extras = await fetchOrderExtras(admin, orders.map((o) => String(o.id)));
    lines.push(...renderExtras(orders, extras));
  } catch (exErr) {
    console.warn('cs-agent: extras fetch failed', exErr);
  }

  return { text: lines.join('\n'), identified: true, orders };
}

// LIVE PRICES — built from the same code-owned catalog the website and every
// generator use (_shared/brand-brief.ts OFFERS). Appended AFTER the knowledge
// doc so the bot never quotes a stale price even if the owner's custom
// knowledge text falls behind. Update OFFERS once → the bot updates too.
const LIVE_PRICES = `

PRECIOS VIGENTES (fuente oficial — si algún otro texto de este documento dice un precio distinto, ESTOS son los correctos):
- Canción personalizada — ${OFFERS.single}
- Paquete de 2 canciones — ${OFFERS.twoPack}
- Paquete de 3 canciones — ${OFFERS.threePack}
- Video con fotos — ${OFFERS.videoAddon} · Video con letra (lyric video) — ${OFFERS.lyricVideo}`;

// ── Tools the model may call (all inert at draft time) ─────────────────────
const TOOLS = [
  {
    name: 'look_up_my_order',
    description:
      "Busca el pedido del cliente de esta conversación. SIEMPRE busca automáticamente por el teléfono de esta conversación. Además puedes pasar el CORREO que el cliente escribió y/o el NOMBRE de la persona a quien va dedicada la canción, para encontrarlo cuando el teléfono no lo ubica (más de la mitad de los clientes compraron en la web con otro número). Úsala cuando el cliente pregunte por su canción, su enlace, si ya está lista o si ya pagó — y ÚSALA DE NUEVO en cuanto el cliente te dé un correo o un nombre nuevo. Devuelve: nombre del destinatario, ocasión, si está pagado (is_paid), si la canción está lista (song_ready), el download_link (SOLO si está pagado) y preview_link_for_unpaid (enlace para ESCUCHAR sin descargar). Si el resultado trae needs_confirmation=true, el pedido se encontró SOLO por nombre y puede ser de otra persona: confirma la identidad con el cliente ANTES de compartir ningún enlace.",
    input_schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'El correo que el cliente escribió en la conversación, si dio alguno. Opcional.',
        },
        recipient_name: {
          type: 'string',
          description: 'El nombre de la persona a quien va dedicada la canción, si el cliente lo dijo. Úsalo solo cuando el teléfono y el correo no encontraron nada. Opcional.',
        },
      },
    },
  },
  {
    name: 'send_link_by_email',
    description:
      'Propone RE-ENVIAR por CORREO el enlace de las canciones PAGADAS del cliente. Úsala solo cuando el cliente diga que perdió el correo con su enlace o pida recibirlo por email, Y te haya dado (o confirme en la conversación) su dirección de correo. NO envía nada ahora mismo: el correo se envía automáticamente cuando el equipo apruebe tu respuesta. En tu respuesta dile al cliente que le reenviaremos el enlace a ese correo (menciona el correo para confirmar que es el correcto). Solo funciona para pedidos pagados.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'El correo del cliente, exactamente como él lo escribió en la conversación.' },
      },
      required: ['email'],
    },
  },
  {
    name: 'request_song_fix',
    description:
      'Úsala cuando el cliente pida un CAMBIO o CORRECCIÓN en una canción que YA se hizo (un nombre mal escrito o mal pronunciado, una fecha equivocada, una línea de la letra que quiere cambiar, "cámbienle esta parte", etc.). Registra una solicitud de arreglo para que el equipo corrija esa canción. NO cambia nada ahora mismo y NO promete un plazo: solo deja anotado el pedido con el detalle EXACTO de lo que el cliente quiere cambiar, y el equipo lo revisa. La solicitud se crea automáticamente cuando el equipo apruebe tu respuesta. En tu respuesta, confirma con calidez que tomamos nota del cambio y que el equipo lo revisará (sin prometer cuándo estará listo).',
    input_schema: {
      type: 'object',
      properties: {
        what_to_change: {
          type: 'string',
          description: 'El cambio EXACTO que pide el cliente, con todo el detalle que dio: qué dice ahora y qué debería decir (nombre correcto, fecha correcta, la línea exacta de la letra, etc.). Escríbelo claro para que el equipo lo corrija sin volver a preguntar.',
        },
      },
      required: ['what_to_change'],
    },
  },
  {
    name: 'flag_for_human',
    description:
      'Marca esta conversación para que la atienda una PERSONA del equipo. Úsala SIEMPRE que el tema sea de dinero (reembolsos, cargos, cobros dobles, disputas), una queja o molestia fuerte, o cualquier cosa de la que no estés seguro. (Para un CAMBIO en una canción ya hecha, usa mejor request_song_fix.) Aun así, escribe una respuesta breve y cálida diciendo que un compañero dará seguimiento.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Motivo breve (interno) para el equipo.' },
      },
      required: ['reason'],
    },
  },
];

// ── The WhatsApp button opener ──────────────────────────────────────────────
// 755 of 2,775 inbound messages in 45 days (27%) are the SAME contentless text,
// produced by tapping the "Hola, tengo una pregunta" button on the site. There
// is nothing to reason about: when we can't identify the sender there is exactly
// one right reply, and it's the one the training doc already prescribes (PASO 1).
// Answering it with a full tool-using model round-trip bought nothing.
const OPENER_REPLY =
  '¡Hola! 👋 Gracias por escribirnos a Regalos Que Cantan 🎵 Con mucho gusto le ayudo. Para empezar, ¿ya creó su canción con nosotros o le gustaría hacer una?';

// Same idea for a customer we DID identify: still an instant, deterministic
// welcome that orients them (owner rule 2026-08-08: the opener button always
// gets the friendly created-or-create question) — but acknowledging that they
// already have songs with us instead of asking as if they were new.
const openerReplyKnown = (name: string | null) =>
  `¡Hola${name ? `, ${name}` : ''}! 👋 Qué gusto saludarle de nuevo en Regalos Que Cantan 🎵 ¿Le ayudo con su canción, o le gustaría crear una nueva?`;

function isButtonOpener(text: string): boolean {
  const t = String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                // strip emoji/punctuation/mojibake
    .replace(/\s+/g, ' ')
    .trim().toLowerCase();
  if (!t || t.length > 80) return false;
  return /^hola\s+tengo una pregunta( sobre)?\b/.test(t);
}

// Finite set of question categories (the "states" a message can be about) — used
// to measure quality BY topic in the dashboard and, later, to gate auto-send.
const CS_CATEGORIES = [
  'price', 'how_it_works', 'locate_song', 'download_help', 'song_status',
  'change_request', 'billing_money', 'complaint', 'voice_options', 'upsell',
  'greeting', 'thanks_closing', 'other',
] as const;
const CLASSIFY_MODEL = Deno.env.get('CS_CLASSIFY_MODEL') || 'claude-haiku-4-5-20251001';

// Tag the incoming customer message with ONE category (cheap Haiku call).
// Best-effort: returns 'other' on anything unexpected so it never blocks a draft.
async function classifyCategory(text: string): Promise<string> {
  const t = (text || '').trim();
  if (!t || !ANTHROPIC_API_KEY) return 'other';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        max_tokens: 12,
        system: `Clasifica el mensaje de un cliente de una tienda de canciones personalizadas en UNA sola categoría. Responde SOLO con el id exacto, sin nada más.
- price: pregunta por precio/costo
- how_it_works: cómo funciona, si es membresía
- locate_song: no encuentra su canción / ya pagó / no le llegó / dónde está
- download_help: cómo o no puede descargar
- song_status: si ya está lista / estado del pedido
- change_request: cambiar o corregir una canción YA hecha
- billing_money: reembolso, cargo, cobro doble, disputa
- complaint: queja, molestia, no le gustó
- voice_options: voz femenina/masculina u opciones de la canción
- upsell: video, karaoke, clona mi voz, extras
- greeting: saludo sin pregunta clara
- thanks_closing: agradecimiento o despedida
- other: cualquier otra cosa`,
        messages: [{ role: 'user', content: t.slice(0, 500) }],
      }),
    });
    if (!res.ok) return 'other';
    const data = await res.json();
    const raw = (data.content?.[0]?.text || '').trim().toLowerCase().replace(/[^a-z_]/g, '');
    return (CS_CATEGORIES as readonly string[]).includes(raw) ? raw : 'other';
  } catch {
    return 'other';
  }
}

// #4 SAFETY CRITIC — a cheap second-model check that a draft doesn't break a
// hard rule. `ran` is false if the check couldn't execute (no key / error) so
// callers can fail CLOSED for auto-send (require ran && pass) while fail-open for
// drafts (a human reviews anyway).
async function safetyReview(draft: string): Promise<{ ran: boolean; pass: boolean; reason: string }> {
  const t = (draft || '').trim();
  if (!t || !ANTHROPIC_API_KEY) return { ran: false, pass: true, reason: '' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLASSIFY_MODEL,
        max_tokens: 30,
        system: `Eres un revisor de seguridad de respuestas de servicio al cliente de Regalos Que Cantan. Revisa SOLO si la RESPUESTA rompe una de estas reglas CLARAS (no juzgues precios ni datos del pedido — eso ya está verificado en otro lado):
1. Revela o insinúa que es IA / bot / robot / automático / computadora / software / algoritmo.
2. Promete un REEMBOLSO, o una fecha/plazo EXACTO garantizado (ej. "llega el martes sin falta").
3. Tono grosero, ofensivo o claramente poco profesional.
4. Confirma o da por recibido un PAGO (dice "recibimos su pago", "ya nos llegó", "pago confirmado", o menciona un monto como recibido). Nunca podemos confirmar un pago en el chat.
Si NO rompe ninguna de estas 4, responde "PASS". Solo responde "FAIL: <razón corta>" si rompe claramente una. Ante la duda, PASS.`,
        messages: [{ role: 'user', content: t.slice(0, 1200) }],
      }),
    });
    if (!res.ok) return { ran: false, pass: true, reason: '' };
    const data = await res.json();
    const out = (data.content?.[0]?.text || '').trim();
    if (/^pass/i.test(out)) return { ran: true, pass: true, reason: '' };
    if (/^fail/i.test(out)) return { ran: true, pass: false, reason: out.replace(/^fail:?\s*/i, '').slice(0, 200) };
    return { ran: false, pass: true, reason: '' };
  } catch {
    return { ran: false, pass: true, reason: '' };
  }
}

// ── Payment-claim guard (code, not prompt) ─────────────────────────────────
// On 2026-08-05 a customer sent a Zelle screenshot and said "ahí está ya". The
// vision path read the image and the bot drafted "¡Perfecto, recibimos su pago
// de $30 por Zelle!" — asserting we had received money, off a picture the
// customer supplied. It was classified 'other' with needs_human = false, so the
// NEVER_AUTO list (which only covers billing_money) would NOT have stopped it.
// The classifier is the weak link, so this check does not depend on it.
//
// A screenshot is a claim, not a receipt. Confirming payment we have not
// verified invites both fraud and chargebacks.
// NOTE ON \b: JavaScript's \b is ASCII-only, so it does NOT match after an
// accented letter — "llegó ", "acreditó ", "está " all failed a trailing \b and
// silently slipped past an earlier version of this guard. Use Unicode-aware
// lookarounds instead, with the /u flag.
const B0 = '(?<![\\p{L}\\p{N}])'; // start-of-word
const B1 = '(?![\\p{L}\\p{N}])'; // end-of-word

const PAYMENT_CONFIRM_RE = new RegExp(
  B0 +
    '(?:' +
    'recibimos|recib[ií]|recibido' +
    '|ya\\s+(?:nos\\s+)?(?:lleg[oó]|entr[oó]|cay[oó])' +
    '|confirmamos' +
    '|qued[oó]\\s+(?:pagado|confirmado)' +
    // "pago recibido", "pago fue confirmado", "depósito ya se acreditó", …
    '|(?:pago|dep[oó]sito|transferencia)\\s+(?:\\S+\\s+){0,2}?(?:recibido|confirmado|acreditado)' +
    '|se\\s+acredit[oó]' +
    ')' +
    B1,
  'iu',
);
const PAYMENT_CONTEXT_RE = new RegExp(
  B0 + '(?:pago|pagado|zelle|dep[oó]sito|transferencia|cargo)|\\$\\s?\\d',
  'iu',
);

// ── Transactional-money talk (auto-send blocker, 2026-08-08 audit) ─────────
// The category allowlist alone is not a safe gate: a customer wrote "la
// segunda que pagué creo que es de 39.98, muchísimas gracias" and the
// classifier filed it under thanks_closing. Any mention of an actual payment /
// transaction in the customer's message keeps the reply as a DRAFT, no matter
// the category. Deliberately does NOT match price-inquiry words ("cuánto
// cuesta", "precio") — those are exactly what the price category auto-answers.
const TRANSACTIONAL_MONEY_RE = new RegExp(
  B0 +
    '(?:pagu[eé]|pag[oó]|pagado|zelle|dep[oó]sit\\w*|transferencia|reembolso|devoluci[oó]n|cobr\\w*|cargo|comprobante|captura|tarjeta)' +
    B1 +
    '|\\$\\s?\\d',
  'iu',
);

/** Does this draft assert that WE received money? */
export function claimsPaymentReceipt(text: string): boolean {
  const t = String(text || '');
  return PAYMENT_CONFIRM_RE.test(t) && PAYMENT_CONTEXT_RE.test(t);
}

/** Is the customer claiming/sending proof of a payment right now? */
function customerClaimsPayment(text: string, hasImage: boolean): boolean {
  const t = String(text || '');
  const claim = new RegExp(
    B0 +
      '(?:' +
      'ya\\s+(?:le\\s+|se\\s+lo\\s+)?(?:pagu[eé]|deposit[eé]|mand[eé]|envi[eé])' +
      '|ah[ií]\\s+est[aá]' +
      '|listo\\s+el\\s+pago' +
      '|hice\\s+(?:el\\s+)?(?:pago|dep[oó]sito|la\\s+transferencia)' +
      '|comprobante|captura' +
      '|le\\s+mand[eé]\\s+el\\s+dinero' +
      ')' +
      B1,
    'iu',
  ).test(t);
  // An image with no text, in a thread about money, is almost always a receipt.
  return claim || (hasImage && PAYMENT_CONTEXT_RE.test(t));
}

function systemPrompt(customerName: string | null, channel: string, knowledge: string, snapshot: string): string {
  const who = customerName ? `El cliente se llama ${customerName}. ` : '';
  return `Eres el agente de servicio al cliente de Regalos Que Cantan y respondes por ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} en ESPAÑOL. ${who}Tu trabajo es responder de forma cálida, humana y BREVE (es un chat, no un correo).

${snapshot ? snapshot + '\n\n' : ''}${knowledge}${LIVE_PRICES}

${CS_GOLDEN_ANSWERS}

REGLAS ESTRICTAS:
- ⭐ REGLA #1 — RESPONDE LO QUE EL CLIENTE ACABA DE DECIR. Antes que nada, lee (a) el ÚLTIMO mensaje del cliente y (b) el último mensaje que le mandamos NOSOTROS. Si le hicimos una PREGUNTA y él la contestó, tu respuesta debe atender ESA contestación. Si te dio una instrucción ("mándamela", "la uno", "está bien"), atiéndela. El bloque "SITUACIÓN DEL CLIENTE" es CONTEXTO para responder mejor — NO es un guion que reemplace lo que el cliente dijo. Es un ERROR GRAVE contestar con un trámite (pedir el correo, pedir datos) cuando el cliente acaba de responder una pregunta nuestra o pedir algo concreto.
- NO REPITAS PREGUNTAS. Si un dato ya se pidió en esta conversación —o el cliente ya lo dio— no lo vuelvas a pedir. Relee el historial antes de preguntar cualquier cosa.
- 💰 NUNCA confirmes que recibimos un pago. No digas "recibimos su pago", "ya nos llegó", ni menciones un monto, AUNQUE el cliente mande una captura, un comprobante o diga que ya pagó. Una captura es lo que el cliente dice, no una confirmación nuestra. Agradece, dile que el equipo lo verifica y confirma en un momento, y usa flag_for_human. Esto aplica a Zelle, transferencias y cualquier otro método.
- ANTES de escribir, mira el bloque "SITUACIÓN DEL CLIENTE" de arriba y decide en qué situación está el cliente; responde acorde a ESA situación, no solo a las palabras del mensaje. Si el cliente ya es cliente (tiene canciones pagadas), trátalo como tal y NUNCA le preguntes si ya hizo su canción. Si no está identificado, pídele con calidez el correo de su pedido para ubicarlo — NUNCA asumas que no ha comprado.
- IDIOMA: responde normalmente en ESPAÑOL (la gran mayoría de clientes son hispanohablantes). SOLO si el cliente claramente escribe TODO su mensaje en otro idioma (inglés, portugués), respóndele en ESE idioma. Ante cualquier duda, español. 1-3 frases cuando sea posible.
- NUNCA digas ni insinúes que las canciones se hacen con inteligencia artificial, IA, computadora, software, algoritmos, bots o de forma automática. Si preguntan cómo se crean, responde con calidez que NUESTRO EQUIPO crea cada canción personalizada (letra y voz) a partir de los datos que nos comparten, lista en unos minutos, y que la pueden escuchar gratis antes de pagar. Evita detalles técnicos. Si preguntan si eres un robot/bot/máquina, responde amablemente que eres parte del equipo de Regalos Que Cantan y con gusto los ayudas — sin dar detalles técnicos.
- 💵 PRECIO — RESPUESTA SIMPLE. Cuando pregunten el precio, responde solo lo esencial: la canción personalizada cuesta ${OFFERS.single} y puede ESCUCHAR una muestra GRATIS antes de pagar. Cierra con una pregunta cálida (ej. "¿Para quién sería la canción?"). NO enumeres el menú completo de paquetes, videos y extras — es demasiada información y abruma al cliente. Solo menciona el paquete de 2 (${OFFERS.twoPack}) o de 3 (${OFFERS.threePack}) si el cliente habla de VARIAS canciones, y un extra (video, etc.) solo si él pregunta por ese extra.
- Para cualquier dato del pedido del cliente (su canción, su enlace, si está lista, si pagó) usa la herramienta look_up_my_order. NUNCA inventes enlaces, precios, plazos ni el estado de un pedido.
- Si el pedido está PAGADO (is_paid = true): comparte su download_link para que descargue y comparta su canción.
- Si el pedido NO está pagado (is_paid = false): comparte el preview_link_for_unpaid para que ESCUCHE sus versiones, y explícale con calidez que ahí puede escucharlas y que al COMPLETAR SU COMPRA se desbloquea la descarga para guardarla y compartirla. NUNCA compartas un download_link ni digas que la canción "ya está lista para descargar" en un pedido no pagado. El enlace de preview solo deja escuchar; la descarga sigue bloqueada hasta que pague.
- Si no aparece ningún pedido para este número, NO te rindas y NO inventes. Sigue esta escalera, en orden: (1) pide con calidez el CORREO del pedido y vuelve a llamar look_up_my_order con ese correo; (2) si el correo tampoco lo ubica, pide el NOMBRE de la persona a quien va dedicada la canción y llama look_up_my_order con ese nombre; (3) solo cuando ya intentaste teléfono, correo Y nombre, di que un compañero lo verificará. Pide UN dato a la vez, no los tres juntos.
- Si un resultado viene con needs_confirmation=true, se encontró SOLO por nombre y podría ser de otra persona: NO compartas enlaces, confirma primero la identidad.
- VENDER ANTES QUE ESCALAR: si el cliente muestra intención de COMPRAR (quiere otra canción, dice "la compro", "aunque me cobren", pregunta cómo pagar, quiere un video o un extra), tu respuesta SIEMPRE debe incluir el camino para comprar — el enlace de su canción sin pagar, o regalosquecantan.com para una nueva. Nunca respondas solo "un compañero te dará seguimiento" a alguien que quiere darnos dinero.
- UNA ESCALACIÓN NUNCA ES LA RESPUESTA COMPLETA: aunque uses flag_for_human, responde PRIMERO lo que sí puedes responder con los datos que tienes (el precio, cómo funciona, dónde está su canción, qué opciones existen) y recién entonces di que un compañero dará seguimiento. Una respuesta que solo dice "un compañero te contactará" y nada más NO sirve.
- Si el cliente pide un CAMBIO o corrección en una canción que YA se hizo (un nombre mal escrito o mal pronunciado, una fecha equivocada, una línea de la letra que quiere cambiar): usa request_song_fix con el detalle EXACTO del cambio, y responde con calidez que tomamos nota y que el equipo lo revisará (sin prometer plazo).
- Si el tema es de dinero (reembolso, cargo, cobro doble, disputa), una queja/molestia fuerte, o algo de lo que no estás seguro: usa flag_for_human y responde que un compañero del equipo dará seguimiento pronto.
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
      .select('enabled, knowledge_doc, auto_send_enabled, auto_categories')
      .eq('id', 1)
      .maybeSingle();
    if (!settings?.enabled) {
      return json({ ok: true, skipped: 'cs agent disabled' });
    }
    // Owner-editable knowledge (Bot Training panel). Falls back to the file
    // default when the owner hasn't customized it yet.
    const knowledge = (settings?.knowledge_doc || '').trim() || CS_KNOWLEDGE;

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
      .select('id, direction, body, status, created_at, media_path, media_type, ai_generated')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = (msgs || []).reverse();

    // Only draft when the latest message is a real inbound customer message.
    const last = history[history.length - 1];
    if (!last || last.direction !== 'inbound') {
      return json({ ok: true, skipped: 'latest message is not inbound' });
    }

    // ── Draft hygiene (2026-08-08 audit) ──────────────────────────────────
    // 1) OWNER IS LIVE IN THIS THREAD. When a human sent a manual reply in the
    //    last 10 minutes, the owner is actively chatting — every draft written
    //    behind their back is noise they must discard (977 discards in 30 days,
    //    a large share from exactly this). Stay quiet and let them work.
    const tenMinAgo = Date.now() - 10 * 60e3;
    const ownerActive = history.some((m) =>
      m.direction === 'outbound' && m.ai_generated !== true &&
      m.status !== 'draft' && m.status !== 'discarded' &&
      new Date(String(m.created_at)).getTime() > tenMinAgo,
    );
    if (ownerActive) return json({ ok: true, skipped: 'owner active in thread' });

    // 2) CONTENTLESS ACKS. "ok", "vale", a bare 👍, or an empty body (no media)
    //    need no reply — drafting on them buried the real drafts. EXCEPTION:
    //    if OUR last message asked a question, a bare "ok"/👍 is the customer
    //    ANSWERING it (consent), so the model still gets to respond.
    if (!last.media_path) {
      const norm = String(last.body || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim().toLowerCase();
      const ACKS = new Set(['ok', 'okay', 'okey', 'oki', 'va', 'vale', 'sale', 'dale', 'esta bien', 'ta bien']);
      const contentless = norm === '' || ACKS.has(norm);
      if (contentless) {
        const prevOutbound = [...history].reverse().find((m) =>
          m.direction === 'outbound' && m.status !== 'draft' && m.status !== 'discarded');
        const weAskedAQuestion = !!prevOutbound && /\?\s*$/.test(String(prevOutbound.body || '').trim());
        if (!weAskedAQuestion) return json({ ok: true, skipped: 'contentless ack' });
      }
    }
    // If an unapproved draft already exists, only REPLACE it when the customer
    // has messaged AGAIN since it was written (i.e. the draft is now stale and
    // doesn't reflect what they just said). If nothing newer came in, leave the
    // pending draft alone. `staleDraftId` is discarded right before we write the
    // fresh draft below.
    let staleDraftId: string | null = null;
    const existingDraft = history.find((m) => m.status === 'draft');
    if (existingDraft) {
      const draftTime = new Date(String(existingDraft.created_at)).getTime();
      const newerInbound = history.some(
        (m) => m.direction === 'inbound' && new Date(String(m.created_at)).getTime() > draftTime,
      );
      if (!newerInbound) {
        return json({ ok: true, skipped: 'draft already pending' });
      }
      staleDraftId = existingDraft.id as string;
    }

    const phoneLast10 = toLast10(convo.phone);

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

    // VISION: if the latest customer message includes an image, attach it so the
    // model can SEE what they're showing (an error, a screenshot, the song page).
    // Best-effort — a failure just falls back to text-only.
    if (last.media_path && String(last.media_type || '').startsWith('image/')) {
      try {
        const { data: blob } = await admin.storage.from('cs-media').download(last.media_path);
        if (blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = '';
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const b64 = btoa(bin);
          // Attach to the LAST user message (the one we're replying to).
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
              const txt = typeof messages[i].content === 'string' ? messages[i].content : '';
              messages[i].content = [
                { type: 'text', text: txt && txt.trim() ? txt : 'El cliente envió esta imagen (descríbela y ayúdalo según lo que muestra):' },
                { type: 'image', source: { type: 'base64', media_type: last.media_type, data: b64 } },
              ];
              break;
            }
          }
        }
      } catch (visErr) {
        console.warn('cs-agent: vision attach failed', visErr);
      }
    }

    // ── Always-on situation snapshot ────────────────────────────────────────
    // Ground the reply in WHO this customer is, before the model writes. Resolve
    // by the conversation phone AND any email the customer typed in the thread.
    const customerEmails = extractEmails(
      history.filter((m) => m.direction === 'inbound').map((m) => m.body || ''),
    );
    // Song links already in this thread — from EITHER side. When the team builds
    // an order by hand there is no phone and no customer email to find it by, but
    // the /listen link we pasted names the songs exactly. Scanned over the FULL
    // conversation, not just the recent window, because the link is often several
    // messages back.
    const { data: allBodies } = await admin
      .from('sms_messages')
      .select('body')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(120);
    const threadTexts = (allBodies || []).map((m: { body: string | null }) => m.body || '');
    const { ids: songIds, shortCodes } = extractSongRefs(threadTexts);

    // How many times have we ALREADY asked this person for their email? Used to
    // hard-stop the re-ask loop.
    const emailAsks = (allBodies || []).filter((m: { body: string | null }) =>
      /correo|email/i.test(m.body || '') && /comparte|compartir|me da|cu[aá]l es|proporcion|indic/i.test(m.body || ''),
    ).length;

    // Did we already send them a song link earlier in this thread? (so the bot
    // doesn't re-ask or re-explain what we already delivered).
    const alreadySentLink = history.some(
      (m) => m.direction === 'outbound' && /\/s\/|\/success|\/listen|ya est\w* lista/i.test(m.body || ''),
    );
    // Has anyone in this thread claimed a payment? Zelle/transfers never reach
    // the songs table, so this is the only signal we have that "unpaid" may be
    // stale. Checked over the whole conversation, either direction.
    const paymentClaimed = threadTexts.some((b) =>
      /zelle|dep[oó]sito|transferencia|ya (?:le )?(?:pagu[eé]|pag[oó])|comprobante|ya complet[oó] su pago|ya lleg[oó]/i.test(b),
    );

    let snapshot = '';
    let customerIdentified = false;
    try {
      const snap = await buildSituationSnapshot(admin, {
        phoneLast10, customerEmails, songIds, shortCodes, alreadySentLink, emailAsks, paymentClaimed,
      });
      snapshot = snap.text;
      customerIdentified = snap.identified;
    } catch (snapErr) {
      console.warn('cs-agent: snapshot build failed', snapErr);
    }

    // Tag this message's topic for the quality dashboard (best-effort).
    const category = await classifyCategory(String(last.body || ''));

    // LEARNING: retrieve the team's most RELEVANT past replies (semantic match on
    // the incoming message), not just the newest — so the bot learns from
    // precedent that actually fits this question. Falls back to recency when
    // embeddings aren't available (incl. cold-start before anything is embedded).
    let examplesBlock = '';
    try {
      // (a) Lazy backfill: embed a small batch of not-yet-embedded examples each
      // run, so the corpus fills in on its own without a separate job.
      const { data: unembedded } = await admin
        .from('cs_examples')
        .select('id, customer_msg, reply')
        .is('embedding', null)
        .limit(16);
      if (unembedded && unembedded.length) {
        const vecs = await embedTexts(
          unembedded.map((e) => (e.customer_msg || e.reply || '').trim()),
        );
        if (vecs) {
          await Promise.all(unembedded.map((e, i) =>
            vecs[i]
              ? admin.from('cs_examples').update({ embedding: vecs[i] }).eq('id', e.id)
              : Promise.resolve(),
          ));
        }
      }

      // (b) Retrieve the approved replies most SIMILAR to this incoming message.
      let examples:
        | { customer_msg: string; reply: string; was_edited: boolean; draft_original?: string | null }[]
        | null = null;
      const queryVec = await embedText(String(last.body || ''));
      if (queryVec) {
        const { data: matched } = await admin.rpc('match_cs_examples', {
          query_embedding: queryVec,
          match_count: EXAMPLE_LIMIT,
        });
        if (matched && matched.length) examples = matched;
      }
      // Fallback: recency.
      if (!examples) {
        const { data: recent } = await admin
          .from('cs_examples')
          .select('customer_msg, reply, was_edited, draft_original')
          // Skip fragments ("ok", "gracias") — they teach nothing and crowd out
          // real examples. Mirrors the filter in match_cs_examples.
          .not('reply', 'is', null)
          .order('created_at', { ascending: false })
          .limit(EXAMPLE_LIMIT);
        examples = (recent || []).filter((e: { reply?: string }) => (e.reply || '').trim().length >= 25);
      }

      if (examples && examples.length) {
        const lines = examples
          .map((e) => {
            const q = (e.customer_msg || '').trim();
            const before = (e.draft_original || '').trim();
            // A correction teaches far more when the MISTAKE travels with it.
            if (e.was_edited && before) {
              return `${q ? `Cliente: ${q}\n` : ''}Borrador INCORRECTO: ${before}\nCORREGIDO por el equipo: ${e.reply}`;
            }
            const tag = e.was_edited ? ' (corregido por el equipo)' : '';
            return `${q ? `Cliente: ${q}\n` : ''}Equipo${tag}: ${e.reply}`;
          })
          .join('\n---\n');
        examplesBlock =
          `\n\nAPRENDE DE ESTAS RESPUESTAS REALES del equipo (las más PARECIDAS a este mensaje). Imita el TONO, la calidez, la longitud y el estilo con que responde el equipo. Donde veas "Borrador INCORRECTO" seguido de "CORREGIDO por el equipo", es un error que YA cometiste antes: NO lo repitas, escribe como la versión corregida. NO copies nombres, enlaces ni datos específicos de estos ejemplos — esos SIEMPRE vienen de la herramienta look_up_my_order o de la SITUACIÓN DEL CLIENTE:\n${lines}`;
      }
    } catch (exErr) {
      console.warn('cs-agent: retrieval failed', exErr);
    }

    let needsHuman = false;
    let escalateReason = '';
    // Set when an order was matched ONLY by recipient name — it may belong to
    // someone else. Blocks auto-send outright (see the gate below).
    let unconfirmedMatch = false;
    // Approval-gated side action, recorded on the draft; sms-admin executes it
    // ONLY when the owner approves the draft. Two shapes today:
    //   { type: 'resend_email', email }           → resend the paid link by email
    //   { type: 'song_fix_request', what_to_change } → queue a song fix for the team
    let proposedAction: Record<string, unknown> | null = null;

    // ── Tool-use loop (max a few hops) ──────────────────────────────────────
    let finalText = '';

    // FAST PATH — the contentless "Hola, tengo una pregunta" button. There is
    // nothing to reason about: the button carries zero information, so the one
    // right reply is the friendly welcome that asks whether they already
    // created their song or want to make one (owner rule 2026-08-08: ALWAYS
    // answer the opener this way, instantly). Identified customers get the
    // welcome-back variant that doesn't treat them like a stranger. Skips the
    // model entirely; the fixed text also qualifies for auto-send below.
    const useOpenerFastPath =
      !last.media_path &&
      isButtonOpener(String(last.body || ''));

    if (useOpenerFastPath) {
      finalText = customerIdentified ? openerReplyKnown(convo.customer_name) : OPENER_REPLY;
    }

    for (let hop = 0; !useOpenerFastPath && hop < 4; hop++) {
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
          system: systemPrompt(convo.customer_name, convo.channel || 'sms', knowledge, snapshot) + examplesBlock,
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
          // PHONE IS ALWAYS PINNED from the conversation. The model may ADD an
          // email or a recipient name to widen the search, but it can never
          // swap the phone out — so a customer still cannot reach anyone else's
          // order through the phone path.
          const toolEmail = String(tu.input?.email || '').trim().toLowerCase();
          const toolName = String(tu.input?.recipient_name || '').trim();
          // Emails the customer typed in the thread + whatever the model passed.
          const searchEmails = [...new Set([...customerEmails, toolEmail].filter(Boolean))];

          const { orders, matchedBy, needsConfirmation } = await resolveCustomerOrders(admin, {
            songIds,
            shortCodes,
            phoneLast10,
            emails: searchEmails,
            recipientNames: toolName ? [toolName] : [],
          });

          if (!orders.length) {
            result = {
              orders: [],
              searched_by: {
                phone: phoneLast10.length === 10,
                emails: searchEmails,
                recipient_name: toolName || null,
              },
              guidance: searchEmails.length || toolName
                ? 'No apareció nada. Pide el OTRO dato que aún no tengas (si ya diste correo, pide el nombre de la persona a quien va la canción; si ya diste nombre, pide el correo) y vuelve a llamar a esta herramienta. Solo si ya intentaste teléfono, correo Y nombre, dile que un compañero lo verificará.'
                : 'No apareció nada por teléfono. Pide con calidez el CORREO del pedido y vuelve a llamar a esta herramienta con él. NUNCA asumas que el cliente no ha comprado.',
            };
          } else {
            if (needsConfirmation) unconfirmedMatch = true;
            const orderList = orders.slice(0, 5).map((o) => ({
              recipient_name: o.recipient_name,
              occasion: o.occasion,
              genre: o.genre,
              is_paid: o.is_paid,
              song_ready: o.song_ready,
              created_at: o.created_at,
              // HARD GATE: the DOWNLOAD link is only ever built for PAID orders,
              // and never at all on an unconfirmed name-only match.
              download_link: o.is_paid && !needsConfirmation ? buildOrderLink(o, SITE) : null,
            }));
            const unpaid = orders.filter((o) => !o.is_paid);
            result = {
              orders: orderList,
              matched_by: matchedBy,
              needs_confirmation: needsConfirmation,
              // One PREVIEW ("listen before you pay") link covering all UNPAID
              // songs. Safe to share: /listen lets the customer HEAR their
              // versions, but download stays locked until they complete purchase.
              preview_link_for_unpaid: needsConfirmation ? null : buildPreviewLink(unpaid, SITE),
              guidance: needsConfirmation
                ? 'ATENCIÓN: esto se encontró SOLO por el nombre del destinatario, así que podría ser el pedido de otra persona. NO compartas ningún enlace todavía. Confirma primero con el cliente (por ejemplo: "¿La canción es para [NOMBRE], de parte de [REMITENTE]?") y pídele el correo del pedido para confirmarlo.'
                : 'Pedidos PAGADOS: comparte su download_link. Pedidos NO pagados: comparte preview_link_for_unpaid para que escuche, y explica que al completar la compra se desbloquea la descarga. NUNCA compartas un download_link de un pedido no pagado.',
            };
          }
        } else if (tu.name === 'send_link_by_email') {
          // INERT at draft time: we only RECORD the proposal. sms-admin calls
          // recover-song (paid songs only, to this email) on owner approval.
          const email = String(tu.input?.email || '').trim().toLowerCase();
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            proposedAction = { type: 'resend_email', email };
            result = {
              ok: true,
              note: `Anotado. Cuando el equipo apruebe tu respuesta, se reenviará por correo a ${email} el enlace de sus canciones PAGADAS (si ese correo no tiene canciones pagadas, no se enviará nada). En tu respuesta confirma al cliente el correo al que se lo reenviaremos.`,
            };
          } else {
            result = { ok: false, error: 'correo inválido — pide al cliente que escriba su correo de nuevo' };
          }
        } else if (tu.name === 'request_song_fix') {
          // INERT at draft time: only RECORD the proposal. sms-admin creates the
          // song_fix_requests row (resolving the song by this conversation's
          // phone) when the owner approves the draft. A change to a finished song
          // always wants a person's eyes, so surface it as needs-a-human too.
          const whatToChange = String(tu.input?.what_to_change || '').trim();
          if (whatToChange) {
            proposedAction = { type: 'song_fix_request', what_to_change: whatToChange };
            needsHuman = true;
            escalateReason = escalateReason || 'song fix requested';
            result = {
              ok: true,
              note: 'Anotado. Cuando el equipo apruebe tu respuesta, se creará una solicitud de arreglo para esta canción con el detalle que registraste, y el equipo la corregirá. Confirma al cliente con calidez que tomamos nota del cambio y que el equipo lo revisará, SIN prometer un plazo.',
            };
          } else {
            result = { ok: false, error: 'describe el cambio exacto que pide el cliente' };
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

    // #4 SAFETY CRITIC — check the finished draft against the hard rules. A real
    // failure flags it for a human (and blocks auto-send).
    const safety = await safetyReview(finalText);
    if (safety.ran && !safety.pass) {
      needsHuman = true;
      escalateReason = `safety: ${safety.reason}`;
    }

    // PAYMENT GUARD — deterministic, independent of the topic classifier.
    // Money confirmations always want a person's eyes, whatever category the
    // Haiku pass happened to assign.
    if (claimsPaymentReceipt(finalText)) {
      needsHuman = true;
      escalateReason = escalateReason || 'draft confirms a payment we have not verified';
    }
    if (customerClaimsPayment(String(last.body || ''), !!last.media_path)) {
      needsHuman = true;
      escalateReason = escalateReason || 'customer is claiming a payment / sent a receipt';
    }

    // English gloss of the draft, so a non-Spanish-speaking assistant can read
    // what this reply says BEFORE approving it. Best-effort (null on failure —
    // sms-admin backfills it on the next inbox load either way). Customer-facing
    // text is unaffected: only `body` is ever sent.
    const bodyEn = await translateOne(finalText);

    const nowIso = new Date().toISOString();

    // Retire the now-stale draft (the customer messaged again after it was
    // written) just before we write the fresh one, so the inbox shows a single
    // up-to-date draft instead of an outdated one.
    if (staleDraftId) {
      await admin
        .from('sms_messages')
        .update({ status: 'discarded', needs_human: false })
        .eq('id', staleDraftId)
        .eq('status', 'draft');
    }

    // #2 AUTO-SEND (default OFF). Send WITHOUT owner approval only when the master
    // switch is on, this category is on the allowlist (and not a never-auto one),
    // nothing flagged a human, and the safety critic explicitly passed.
    const autoCats: string[] = Array.isArray(settings?.auto_categories) ? settings.auto_categories : [];
    // Every condition below must hold. The list fails CLOSED: anything we are
    // not sure about becomes a draft for the owner, which is the status quo and
    // costs nothing. Ordered cheapest-check-first for readability, not speed.
    const autoBlockers: string[] = [];
    if (settings?.auto_send_enabled !== true) autoBlockers.push('master switch off');
    if (!autoCats.includes(category)) autoBlockers.push(`category '${category}' not allowlisted`);
    if (NEVER_AUTO.has(category)) autoBlockers.push('category is never-auto');
    if (needsHuman) autoBlockers.push('flagged for a human');
    if (proposedAction) autoBlockers.push('has a proposed side action');
    if (!(safety.ran && safety.pass)) autoBlockers.push('safety critic did not explicitly pass');
    // ── extra gates added after the Aug-2026 audit ──
    // An order matched only by NAME could belong to a stranger — never unattended.
    if (unconfirmedMatch) autoBlockers.push('order matched by name only');
    // Any customer-specific LINK in an unidentified thread is a leak risk.
    if (!customerIdentified && /https?:\/\//.test(finalText)) {
      autoBlockers.push('shares a link but customer is not identified');
    }
    // Image threads go through the vision path, which is the least reliable input.
    if (last.media_path) autoBlockers.push('inbound message contains media');
    // Long replies are where the model reasons most, and reason most wrongly.
    if (finalText.length > 600) autoBlockers.push('reply too long for unattended send');
    // Customer is talking about an actual payment/transaction (not asking a
    // price): even in an allowlisted category, money talk waits for the owner.
    if (TRANSACTIONAL_MONEY_RE.test(String(last.body || ''))) {
      autoBlockers.push('customer message mentions a payment/transaction');
    }

    // The opener fast path is FIXED text we wrote ourselves — no model output,
    // no links, no customer data beyond their first name. Category allowlist
    // and safety critic don't apply to it; the master switch still does.
    if (useOpenerFastPath) {
      autoBlockers.length = 0;
      if (settings?.auto_send_enabled !== true) autoBlockers.push('master switch off');
    }

    const canAuto = autoBlockers.length === 0;

    if (canAuto) {
      const sendCh = convo.channel || 'sms';
      const result = sendCh === 'whatsapp'
        ? await sendWhatsApp(convo.phone, finalText)
        : await sendSms(convo.phone, finalText);
      const { data: sent } = await admin
        .from('sms_messages')
        .insert({
          conversation_id: conversationId,
          direction: 'outbound',
          body: finalText,
          body_en: bodyEn,
          status: result.ok ? (result.status || 'sent') : 'failed',
          twilio_sid: result.sid || null,
          channel: sendCh,
          ai_generated: true,
          needs_human: false,
          was_edited: false,
          auto_sent: true,
          category,
        })
        .select('id, status')
        .single();
      await admin.from('sms_conversations').update({ last_message_at: nowIso }).eq('id', conversationId);
      // Light heads-up so the owner can still eyeball what went out on its own.
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-admin-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({
            title: `🤖 Auto-respuesta enviada · ${convo.customer_name || convo.phone}`,
            body: finalText.length > 110 ? finalText.slice(0, 110) + '…' : finalText,
            url: '/admin/dashboard?tab=sms',
            tag: `cs-auto-${conversationId}`,
          }),
        });
      } catch (_e) { /* best-effort */ }
      return json({ ok: true, auto_sent: true, category, send_ok: result.ok });
    }

    // Store the DRAFT (inert until the owner approves it in the inbox).
    const { data: inserted, error: insErr } = await admin
      .from('sms_messages')
      .insert({
        conversation_id: conversationId,
        direction: 'outbound',
        body: finalText,
        body_en: bodyEn,
        status: 'draft',
        channel: convo.channel || 'sms',
        ai_generated: true,
        needs_human: needsHuman,
        proposed_action: proposedAction,
        category,
      })
      .select('id, body, body_en, status, needs_human, created_at')
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

    return json({
      ok: true,
      draft: inserted,
      needs_human: needsHuman,
      reason: escalateReason || undefined,
      // When auto-send is ON but this reply still became a draft, say WHY. This
      // is how you tune the allowlist without guessing.
      auto_blocked_by: settings?.auto_send_enabled === true ? autoBlockers : undefined,
    });
  } catch (e) {
    console.error('cs-agent error:', e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
