// supabase/functions/cs-copilot/index.ts
//
// ADMIN-ONLY copilot. Powers the "🤖 Ask AI" panel inside a conversation: while
// the owner chats with a customer, they can privately ask this assistant about
// the order and get answers/links to paste — without leaving the thread.
//
// Unlike cs-agent (which drafts customer-FACING replies and is deliberately
// restricted), this answers the OWNER and has FULL read access to the order:
// payment status, preview + download links, song details, the customer's
// context, and the lyrics. Safe because it's admin-gated and only the owner
// ever sees it.
//
// Auth: Supabase Auth JWT (config.toml verify_jwt = true) + admin_users check.
//
// Contract with the frontend (SmsInboxTab copilot panel):
//   POST { conversation_id, messages:[{role,content}] } → { success, answer }
//
// Deploy with: supabase functions deploy cs-copilot --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('CS_COPILOT_MODEL') || 'claude-sonnet-4-6';
const SITE = 'https://regalosquecantan.com';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function isPaid(s: Record<string, unknown>): boolean {
  if (!s.paid_at) return false;
  if (s.paid !== true && s.payment_status !== 'paid') return false;
  const amt = s.amount_paid != null ? parseFloat(String(s.amount_paid)) : 0;
  return amt > 0 || !!s.stripe_payment_id;
}

function downloadLink(s: Record<string, unknown>): string {
  const upsell = s.has_video_addon === true || s.karaoke_video_status != null || s.karaoke_status != null;
  if (upsell) return `${SITE}/success?song_id=${s.id}`;
  if (s.short_code) return `${SITE}/s/${s.short_code}`;
  return `${SITE}/success?song_id=${s.id}`;
}

const TOOL = {
  name: 'get_order',
  description:
    "Look up the customer's order(s). By default uses the phone number of the open conversation. Optionally pass `search` (an email or phone) to look up a different order. Returns FULL details: recipient, sender, occasion, genre, payment status, amount paid, preview link, download link, the customer's context/details they typed, and the song lyrics.",
  input_schema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Optional email or phone to look up instead of this conversation.' },
    },
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ success: false, error: 'ANTHROPIC_API_KEY not set' }, 500);

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json({ success: false, error: 'Missing Authorization' }, 401);
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ success: false, error: 'Invalid session' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: roleRow } = await admin.from('admin_users').select('role').eq('user_id', userData.user.id).single();
    if (!roleRow) return json({ success: false, error: 'No admin access' }, 403);
    const role = (roleRow.role as 'admin' | 'assistant') || 'assistant';
    const isAdmin = role === 'admin';

    const { conversation_id, messages } = await req.json();
    if (!conversation_id || !Array.isArray(messages) || !messages.length) {
      return json({ success: false, error: 'conversation_id and messages required' }, 400);
    }

    const { data: convo } = await admin
      .from('sms_conversations').select('phone, customer_name').eq('id', conversation_id).maybeSingle();
    const convoPhone = String(convo?.phone || '');
    const convoLast10 = convoPhone.replace(/\D/g, '').slice(-10);

    async function runGetOrder(searchArg?: string): Promise<unknown> {
      let query = admin.from('songs')
        .select('id, recipient_name, sender_name, email, whatsapp_phone, occasion, genre, genre_name, short_code, audio_url, paid, payment_status, paid_at, amount_paid, stripe_payment_id, has_video_addon, karaoke_status, karaoke_video_status, details, lyrics, created_at')
        .order('created_at', { ascending: false }).limit(6);
      const search = (searchArg || '').trim();
      if (search.includes('@')) {
        query = query.ilike('email', search);
      } else {
        const last10 = (search || convoLast10).replace(/\D/g, '').slice(-10);
        if (last10.length < 10) return { orders: [], note: 'no valid phone/email to search' };
        query = query.ilike('whatsapp_phone', `%${last10}`);
      }
      const { data: rows } = await query;
      return {
        orders: (rows || []).map((s) => {
          const paid = isPaid(s);
          return {
            recipient_name: s.recipient_name,
            sender_name: s.sender_name,
            email: s.email,
            occasion: s.occasion,
            genre: s.genre_name || s.genre,
            is_paid: paid,
            paid_at: s.paid_at,
            // Revenue is hidden from assistants (same as the orders list).
            amount_paid: isAdmin ? s.amount_paid : undefined,
            created_at: s.created_at,
            song_ready: !!(s.audio_url && String(s.audio_url) !== ''),
            preview_link: `${SITE}/listen?song_id=${s.id}`,
            download_link: paid ? downloadLink(s) : null,
            customer_context: s.details || null,
            lyrics: s.lyrics || null,
          };
        }),
      };
    }

    const system = `Eres el copiloto interno del equipo de soporte de Regalos Que Cantan. Estás ayudando a un AGENTE HUMANO (el dueño) que en este momento chatea con un cliente (teléfono ${convoPhone || 'desconocido'}${convo?.customer_name ? `, ${convo.customer_name}` : ''}).

Tu trabajo: contestar rápido y directo las preguntas del agente sobre el pedido y darle lo que necesite para pegarle al cliente (enlaces, estado de pago, detalles, letra). Usa la herramienta get_order para consultar el pedido (por defecto usa el teléfono de esta conversación; si el agente menciona otro correo/teléfono, pásalo como search).

REGLAS:
- Hablas con el DUEÑO, no con el cliente. Sé breve y directo. Puedes responder en español o inglés según te escriban.
- Tienes acceso completo al pedido: estado de pago, enlace de preview (/listen), enlace de descarga (solo si está pagado), detalles/contexto del cliente y la LETRA de la canción.
- Cuando el agente te pida "algo para mandarle al cliente", dáselo en ESPAÑOL, listo para copiar y pegar.
- El download_link solo existe si el pedido está pagado. Si no está pagado y piden el link de descarga, avisa que aún no ha pagado y ofrece el enlace de preview.
- Nunca inventes datos; si get_order no devuelve algo, dilo.${isAdmin ? '' : '\n- NUNCA menciones montos, cantidades ni cifras de dinero (por ejemplo $39.99). Solo puedes decir si el pedido está pagado o no, nunca cuánto.'}`;

    const convo2: { role: 'user' | 'assistant'; content: unknown }[] = messages
      .filter((m: { role?: string; content?: string }) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    while (convo2.length && convo2[0].role !== 'user') convo2.shift();
    if (!convo2.length) return json({ success: false, error: 'no user message' }, 400);

    let answer = '';
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1000, system, tools: [TOOL], messages: convo2 }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error('cs-copilot anthropic error', res.status, t);
        return json({ success: false, error: `anthropic ${res.status}` }, 502);
      }
      const data = await res.json();
      const content = data.content || [];
      answer = content.filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n').trim();
      const toolUses = content.filter((c: { type: string }) => c.type === 'tool_use');
      if (data.stop_reason !== 'tool_use' || !toolUses.length) break;
      convo2.push({ role: 'assistant', content });
      const results: unknown[] = [];
      for (const tu of toolUses) {
        const out = tu.name === 'get_order' ? await runGetOrder(tu.input?.search) : { error: `unknown tool ${tu.name}` };
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      }
      convo2.push({ role: 'user', content: results });
    }

    return json({ success: true, answer: answer || '(sin respuesta)' });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
