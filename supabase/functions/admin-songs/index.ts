// supabase/functions/admin-songs/index.ts
// Authenticated reader + delivery-tracker for the admin dashboard.
//
// Why this exists: the dashboard used to read `songs` directly from the
// browser with the anon key. That meant anyone with the URL could see
// every customer's email, phone and payment amounts. Now reads go through
// this function, which:
//   1. Requires a valid Supabase Auth JWT (verified by the platform gateway
//      because supabase/config.toml has [functions.admin-songs] with
//      verify_jwt = true — the default; explicit for clarity).
//   2. Looks up the caller in `admin_users` to find their role.
//   3. For role = 'assistant', strips price / payment-amount fields from
//      every row before returning. The numbers never reach their browser,
//      so DevTools can't reveal them.
//
// As of 2026-04-30 also handles WhatsApp-delivery tracking:
//   - action: 'mark-sent'         → set songs.whatsapp_sent_at = now() for one song
//   - action: 'unmark-sent'       → clear it (admin mistake recovery)
//   - action: 'bulk-mark-sent'    → set it for an array of song ids
//   - action: 'backfill-sent'     → set it for every paid+phone song with
//                                    created_at <= cutoff that's currently NULL
//
// As of 2026-05-06 also handles manual email-delivery tracking:
//   - action: 'mark-email-sent'   → set songs.email_sent_at = now() for one song
//   - action: 'unmark-email-sent' → clear it
//
// Delivery-tracking writes are allowed for BOTH 'admin' and 'assistant' roles
// — Ivan (assistant) and the owner (admin) both operate the dashboard, and a
// click by either one needs to sync to the other so neither double-sends to
// a customer. Only revenue-sensitive actions (backfill-sent, which is a bulk
// admin-only sweep) stay restricted.
//
// Deploy with: supabase functions deploy admin-songs --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// Used by the "Make Song for Customer" brief extraction. Same project secret
// every other Claude-backed function reads.
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
// Injected server-side into the generate-song proxy so staff-created songs skip
// the anti-abuse caps. Never sent to the browser.
const ADMIN_OVERRIDE_PIN = Deno.env.get('ADMIN_OVERRIDE_PIN') || '';
const CLAUDE_PRIMARY_MODEL = 'claude-opus-4-8';
const CLAUDE_FALLBACK_MODEL = 'claude-sonnet-4-6';

// Same column set the dashboard previously requested, plus whatsapp_sent_at
// (Pending to Send tab) and admin_dismissed_at (Stuck/failed counter).
const SONG_LIST_COLUMNS = [
  'id', 'created_at', 'email', 'recipient_name', 'sender_name',
  'genre', 'genre_name', 'sub_genre', 'occasion', 'voice_type',
  'session_id', 'stripe_session_id', 'stripe_payment_id', 'payment_status',
  'paid', 'paid_at', 'amount_paid',
  'coupon_code', 'affiliate_code', 'utm_source',
  'audio_url', 'whatsapp_phone', 'whatsapp_sent_at', 'email_sent_at', 'download_count', 'downloaded',
  'has_video_addon', 'karaoke_url', 'karaoke_status', 'admin_dismissed_at', 'status',
  // version + mureka_job_id power the V1/V2 label in the admin orders list:
  // each song creation produces 2 rows that share a mureka_job_id, one per
  // generated audio variant (version 1, version 2).
  'version', 'mureka_job_id',
  // provider decides whether the "Fix a Song" card offers a surgical section fix
  // (Kie) or only a full re-roll (Mureka) — needed on list/version rows before
  // the lazy `detail` load, else already-fixed Kie songs falsely read as Mureka.
  'provider',
  // Fix footprint — so the list can flag songs that were repaired.
  'fixed_at', 'fix_count',
  // Manual (Zelle/cash) paid marker — so the list can show it + allow undo.
  'marked_paid_at', 'marked_paid_source',
  // Small modal-only fields are safe to include in the list (each adds a few
  // bytes per row). `details` and `lyrics` are NOT in the list — the table has
  // 24k+ rows and avg(lyrics)+avg(details) ≈ 1.6 KB/row, so including them
  // pushed the response past the edge function's memory ceiling and the call
  // started returning 546 (Resource Limit Exceeded), which made the dashboard
  // render "0 songs". Those two fields are lazy-loaded via the `detail` action
  // when the order-details modal opens — see fetchSongDetails in AdminDashboard.jsx.
  'relationship', 'last_downloaded_at',
].join(',');

// Fields that reveal payment amounts. Wiped out for the assistant role.
// We KEEP `paid`, `paid_at`, `payment_status`, `stripe_payment_id` so the
// "Pagado / Pendiente" badge still works — the assistant just can't see how
// much was paid.
const REVENUE_FIELDS = ['amount_paid'];

function redactForAssistant<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of REVENUE_FIELDS) {
    if (f in out) out[f] = null;
  }
  return out as T;
}

// ─── "Make Song for Customer" brief extraction ─────────────────────────────
// Reads a WhatsApp/SMS thread and fills the generate-song brief, grounding every
// field in what the customer actually wrote.
//
// The enum lists come from the CALLER (src/config/songOptions.js) so the picker
// and the extractor can never disagree; these are only a floor for an old cached
// frontend. Genre ids always come from the caller's catalog.
const FALLBACK_OCCASIONS = ['cumpleanos','aniversario','san_valentin','boda','nacimiento','dia_madre','dia_padre','amor','graduacion','quinceanera','bautizo','jubilacion','negocio','amistad','agradecimiento','mascota','memorial','dia_muertos','navidad','para_mi','otro'];
const FALLBACK_RELATIONSHIPS = ['pareja','madre','padre','hijo','hermano','abuelo','amigo','jefe','yo_mismo','otro'];
const FALLBACK_TONES = ['celebracion','amor','agradecimiento','nostalgia','motivacion','despedida','humor'];

function briefTool(genreIds: string[], occasionIds: string[], relationshipIds: string[], toneIds: string[]) {
  const evidenceItem = {
    type: 'object',
    properties: {
      field: { type: 'string', description: 'Which brief field this is about, e.g. "genre" or "recipientName".' },
      status: {
        type: 'string',
        enum: ['stated', 'inferred', 'missing'],
        description: 'stated = the customer said it outright. inferred = you worked it out from context (say how in noteEn). missing = it is not in the conversation at all.',
      },
      quoteEs: { type: 'string', description: 'The customer\'s own words in Spanish that support this, verbatim. Empty when status is missing.' },
      quoteEn: { type: 'string', description: 'Plain English translation of quoteEs. Empty when status is missing.' },
      noteEn: { type: 'string', description: 'One short English sentence for the operator: why you chose this value, or what is unclear.' },
    },
    required: ['field', 'status', 'noteEn'],
  };

  return {
    name: 'submit_song_brief',
    description: 'Return the song brief extracted from the conversation, with evidence for every field.',
    input_schema: {
      type: 'object',
      properties: {
        isSongRequest: { type: 'boolean', description: 'False if this conversation is not a customer asking us to create a NEW song (e.g. it is a correction to an existing song, a refund, or small talk).' },
        // Both names are looked up in the customer's own words before they are
        // accepted — a name the customer never wrote is dropped, not sung.
        recipientName: { type: 'string', description: 'Who the song is FOR, copied EXACTLY as the customer spelled it — same accents, same nickname, no "corrections". Do not add an accent they did not write and do not expand a nickname. If they never wrote the name, leave this empty. A name that does not appear in their messages is DISCARDED by the server.' },
        senderName: { type: 'string', description: 'Who the song is FROM, copied EXACTLY as written. Same rules as recipientName. Leave empty if they never said — do not assume the sender is the person texting.' },
        relationship: { type: 'string', enum: [...relationshipIds, ''], description: 'Relationship of the sender to the recipient.' },
        customRelationship: { type: 'string', description: 'Only when relationship is "otro": the relationship in the customer\'s own Spanish words, e.g. "mi madrina que me crió".' },
        occasion: { type: 'string', enum: [...occasionIds, ''], description: 'The occasion for the song.' },
        customOccasion: { type: 'string', description: 'Only when occasion is "otro": what they are celebrating, in Spanish, at least 20 characters.' },
        emotionalTone: { type: 'string', enum: [...toneIds, ''], description: 'Only when occasion is "otro": the emotional tone.' },
        genre: { type: 'string', enum: [...genreIds, 'otro', ''], description: 'Musical genre id from the catalog. Use "otro" ONLY when the customer named a style that is not in the catalog.' },
        subGenre: { type: 'string', description: 'Sub-genre id belonging to the chosen genre. Empty if the customer gave no hint at all — do not pick one at random.' },
        customStyle: { type: 'string', description: 'Only when genre is "otro": the style the customer named, in their words, max 150 characters.' },
        voiceType: { type: 'string', enum: ['male', 'female', ''], description: 'Singer gender. If the customer did not say, choose what fits the genre and who is singing to whom, and mark it inferred.' },
        // THE STORY IS NEVER WRITTEN BY YOU — IT IS QUOTED.
        // `details` reaches the lyrics prompt verbatim as "DETALLES PERSONALES"
        // and the fact-checker treats it as ground truth, so a paraphrase that
        // shifts one verb ("se conocieron" → "se casaron") becomes a fact the
        // whole pipeline then faithfully protects. We therefore never let the
        // model author this text: it selects spans, and the server rebuilds
        // them from the source transcript.
        storyQuotes: {
          type: 'array',
          description: 'The customer\'s OWN WORDS that make up the story, as VERBATIM spans copied character-for-character out of their messages, in the order they should be read. Copy exactly — do not fix typos, do not tidy grammar, do not merge two sentences, do not translate, do not summarize. Any span that is not an exact copy is DISCARDED by the server. Quote only from the CUSTOMER\'s messages, never from ours. Include every span carrying a fact or feeling for the song; skip logistics ("¿cuánto cuesta?", "ok gracias").',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The span, copied VERBATIM from a customer message.' },
              en: { type: 'string', description: 'English translation of this span, for the operator. Reading aid only — never used in the song.' },
              whyEn: { type: 'string', description: 'Short English note on what this span contributes, e.g. "how they met + the year".' },
            },
            required: ['text', 'en'],
          },
        },
        requestedLines: {
          type: 'array',
          description: 'Spans where the customer asked for specific words to appear IN the song ("quiero que diga…", "que mencione…"). VERBATIM, same rules as storyQuotes. Empty array if none.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The requested wording, copied VERBATIM.' },
              en: { type: 'string' },
              whyEn: { type: 'string' },
            },
            required: ['text', 'en'],
          },
        },
        clarifications: {
          type: 'array',
          description: 'OPTIONAL. Short factual notes YOU write to disambiguate the quotes for the songwriter — and ONLY that, e.g. "Ana = su esposa" or "el 15 de agosto = la fecha de la boda". These are shown to the operator separately and are OFF by default, because they are your words, not the customer\'s. Never put a fact here that the customer did not state. Empty array if the quotes already stand on their own.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The note, in Spanish.' },
              en: { type: 'string', description: 'English translation.' },
            },
            required: ['text', 'en'],
          },
        },
        // NOTE: there is deliberately no free-text `songwriterNotes` here. That
        // field reaches the lyric prompt with "trata cualquier dato concreto
        // mencionado aquí como información REAL del cliente" — i.e. anything
        // written into it is believed. Model-authored prose must never land
        // there. The modal builds it from verified `requestedLines` plus what
        // the operator types.
        email: { type: 'string', description: 'The customer\'s email if they typed one in the conversation. Empty otherwise.' },
        evidence: { type: 'array', items: evidenceItem, description: 'One entry per field you filled or left blank. Always include recipientName, senderName, relationship, occasion, genre, subGenre, voiceType and details.' },
        openQuestions: {
          type: 'array',
          description: 'One entry per piece of information you still need. Empty array when the brief is complete.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              questionEs: { type: 'string', description: 'The question to send the customer, in warm natural Mexican Spanish, ready to paste into WhatsApp.' },
              questionEn: { type: 'string', description: 'English translation so the operator knows what they are sending.' },
            },
            required: ['field', 'questionEs', 'questionEn'],
          },
        },
      },
      required: ['isSongRequest', 'storyQuotes', 'evidence', 'openQuestions'],
    },
  };
}

// ─── Verbatim guarantee ────────────────────────────────────────────────────
// A prompt saying "copy exactly" is a promise, not a guarantee. This is the
// guarantee: every span the model returns is LOOKED UP in the customer's own
// messages, and the text we keep is the span sliced out of the SOURCE — never
// the model's rendering of it. If a span cannot be found, it is discarded and
// reported, not quietly repaired.
//
// Matching is done on a normalized projection (case-folded, accents stripped,
// whitespace collapsed) so an accent the model dropped while copying doesn't
// throw away a legitimate quote — but the text that survives is still sliced
// from the original, accents and typos intact. Nothing the model typed reaches
// the song.
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Normalized string + a map from each normalized char back to its source index.
function normIndex(src: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      if (!prevSpace && norm.length) { norm += ' '; map.push(i); }
      prevSpace = true;
      continue;
    }
    prevSpace = false;
    const folded = deaccent(ch.toLowerCase());
    // Folding is 1:1 for every character we care about; if a locale ever makes
    // it expand, keep the map aligned by charging the extra chars to the same
    // source index rather than drifting.
    for (let k = 0; k < folded.length; k++) { norm += folded[k]; map.push(i); }
  }
  return { norm, map };
}

// Returns the SOURCE span matching `quote`, or null when it isn't really there.
function verbatimSpan(source: { norm: string; map: number[]; raw: string }, quote: string, minLen = 3): string | null {
  const q = normIndex(quote).norm.trim();
  if (q.length < minLen) return null;
  const at = source.norm.indexOf(q);
  if (at === -1) return null;
  const start = source.map[at];
  const end = source.map[at + q.length - 1];
  return source.raw.slice(start, end + 1).trim();
}

// Verify a list of {text, en, whyEn} spans against the customer's own words.
function verifyQuotes(
  source: { norm: string; map: number[]; raw: string },
  items: any[],
): { kept: any[]; rejected: string[] } {
  const kept: any[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const it of Array.isArray(items) ? items : []) {
    const raw = typeof it?.text === 'string' ? it.text : '';
    if (!raw.trim()) continue;
    const span = verbatimSpan(source, raw);
    if (!span) { rejected.push(raw.trim()); continue; }
    const key = span.toLowerCase();
    if (seen.has(key)) continue; // same span selected twice
    seen.add(key);
    kept.push({ text: span, en: typeof it?.en === 'string' ? it.en : '', whyEn: typeof it?.whyEn === 'string' ? it.whyEn : '' });
  }
  return { kept, rejected };
}

// Names get SUNG, so their spelling is not cosmetic — "Maria" vs "María" vs
// "Maria Jose" is the difference between a gift and a re-do. Models retype names
// from memory and quietly regularize them (adding the accent Spanish "should"
// have, expanding a nickname), so a name is only accepted if it actually appears
// in what the customer wrote, and the spelling kept is theirs.
//
// The one liberty taken: ALL-CAPS is very common on WhatsApp and is a shouting
// artifact rather than a spelling, so a fully-uppercase match is title-cased.
// Accents — the part models actually get wrong — are preserved exactly.
function verbatimName(source: { norm: string; map: number[]; raw: string }, raw: string): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const span = verbatimSpan(source, raw.trim(), 2);
  if (!span) return null;
  const letters = span.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && span === span.toUpperCase()) {
    return span.toLowerCase().replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
  }
  return span;
}

const BRIEF_SYSTEM = `Eres el asistente de un equipo que crea canciones personalizadas en español. Lees la conversación de WhatsApp entre el equipo y un cliente que pidió que NOSOTROS le hagamos la canción, y llenas la ficha de pedido.

REGLA ABSOLUTA: NUNCA INVENTES. Todo dato que pongas debe salir de lo que el cliente escribió. Si algo no está en la conversación, déjalo vacío y agrégalo a openQuestions. Una ficha incompleta y honesta es correcta; una ficha completa con datos inventados produce una canción que el cliente rechaza ("esta no es mi canción"). Esto incluye nombres, fechas, lugares, número de hijos y cualquier detalle personal.

Sobre el GÉNERO:
- Si el cliente nombró un estilo, úsalo, aunque lo diga coloquialmente ("algo movidito", "una de banda", "estilo Nodal" → el género que corresponde, nunca el nombre del artista).
- Si NO nombró ningún estilo, NO adivines un género "típico". Déjalo vacío y pregúntalo. La mayoría de los pedidos son para la pareja y en balada o romántica, así que el corrido NUNCA es una suposición segura.
- El subgénero cambia mucho la canción (bélico ≠ romántico). Si el cliente no dio pistas para elegir subgénero, déjalo vacío.

Sobre LA HISTORIA (storyQuotes): TÚ NO ESCRIBES LA HISTORIA. La SELECCIONAS.
De la historia se escribe la letra, y el verificador de datos de la canción trata ese texto como la VERDAD. Si tú resumes o reformulas, un verbo cambiado ("se conocieron" → "se casaron") se convierte en un hecho falso que el resto del sistema va a proteger fielmente. Por eso:
- Copia fragmentos EXACTOS de los mensajes DEL CLIENTE, carácter por carácter. No corrijas faltas de ortografía, no arregles la gramática, no unas dos frases en una, no traduzcas, no resumas, no "mejores" nada.
- El servidor busca cada fragmento en los mensajes del cliente. Lo que no aparezca TAL CUAL se DESCARTA y se reporta como error tuyo.
- Cita SOLO al cliente. Nunca cites lo que dijimos NOSOTROS: si el cliente contestó "sí" a una propuesta nuestra, cita la respuesta del cliente y explica el contexto en whyEn.
- Incluye todos los fragmentos con datos o sentimiento; omite lo logístico ("¿cuánto cuesta?", "ok gracias").
- Si el cliente casi no contó nada, devuelve pocos fragmentos y pon preguntas en openQuestions. NO rellenes.
Si necesitas aclarar algo para el compositor (por ejemplo "Ana = su esposa"), va en clarifications, que se muestra aparte y marcado como tuyo — nunca mezclado con las palabras del cliente.

Si el cliente pidió que la canción DIGA algo específico ("quiero que diga…"), ese fragmento va TAMBIÉN en requestedLines, igual de textual.

El operador que revisa esto NO habla español: cada campo necesita su cita textual en español Y su traducción al inglés.

Llama siempre a submit_song_brief.`;

async function callClaudeExtractBrief(
  exchange: string,
  catalogText: string,
  genreIds: string[],
  occasionIds: string[] = FALLBACK_OCCASIONS,
  relationshipIds: string[] = FALLBACK_RELATIONSHIPS,
  toneIds: string[] = FALLBACK_TONES,
): Promise<any | null> {
  const tool = briefTool(genreIds, occasionIds, relationshipIds, toneIds);
  const user =
    `CATÁLOGO DE GÉNEROS Y SUBGÉNEROS (usa SOLO estos ids):\n${catalogText}\n\n` +
    `CONVERSACIÓN (Cliente = el comprador, Nosotros = el equipo):\n${exchange}\n\n` +
    `Llena la ficha con submit_song_brief. Recuerda: lo que no esté en la conversación va vacío y a openQuestions.`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const model = attempt === 2 ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 3000,
          system: BRIEF_SYSTEM,
          tools: [tool],
          tool_choice: { type: 'tool', name: 'submit_song_brief' },
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!resp.ok) {
        console.warn(`[extract-brief] ${model} → ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      const block = (data?.content || []).find((b: any) => b?.type === 'tool_use' && b?.name === 'submit_song_brief');
      if (block?.input) return block.input;
    } catch (e) {
      console.warn(`[extract-brief] ${model} threw: ${(e as Error).message}`);
    }
  }
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    // Resolve the caller from their JWT. We use the anon-key client + the
    // user's token so getUser() identifies them.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }
    const userId = userData.user.id;

    // Service-role client for everything else. We've verified WHO the caller
    // is; from here on we apply our own role check.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (roleErr || !roleRow) {
      return json({ success: false, error: 'No admin access' }, 403);
    }

    const role = roleRow.role as 'admin' | 'assistant';
    const isAssistant = role === 'assistant';

    // Parse request
    let body: {
      action?: string;
      songId?: string;
      songIds?: string[];
      cutoff?: string;
      search?: string;
      searchField?: string;
      limit?: number;
      amount?: number;
      source?: string;
      // "Make Song for Customer" (extract-brief / create-song)
      exchange?: string;
      customerText?: string;
      customerName?: string;
      catalog?: Array<{ id: string; name: string; description?: string; subGenres?: Array<{ id: string; name: string; description?: string }> }>;
      occasionIds?: string[];
      relationshipIds?: string[];
      toneIds?: string[];
      brief?: Record<string, unknown>;
      force?: boolean;
    } = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const action = body.action || 'list';

    // ─── action: mark-paid / unmark-paid ──────────────────────────────────
    // Manually mark a song paid (e.g. customer paid via Zelle) so it counts as
    // a regular paid song everywhere and survives any unpaid-storage cleanup.
    // Admin-only (not assistants). Writes the same fields Stripe does, plus a
    // marker so it's auditable + reversible.
    if (action === 'mark-paid' || action === 'unmark-paid') {
      if (isAssistant) return json({ success: false, error: 'Only admins can change payment status' }, 403);
      if (!body.songId) return json({ success: false, error: 'songId required' }, 400);

      if (action === 'unmark-paid') {
        // Only revert songs that were MANUALLY marked — never undo a real Stripe payment.
        const { data: s } = await admin.from('songs').select('marked_paid_at').eq('id', body.songId).single();
        if (!s) return json({ success: false, error: 'song not found' }, 404);
        if (!s.marked_paid_at) return json({ success: false, error: 'This song was not manually marked — only manual (Zelle) marks can be undone.' }, 400);
        const { error } = await admin.from('songs').update({
          paid: false, payment_status: null, paid_at: null, amount_paid: null, payment_method: null,
          marked_paid_at: null, marked_paid_source: null, marked_paid_by: null,
        }).eq('id', body.songId);
        if (error) return json({ success: false, error: error.message }, 500);
        return json({ success: true, songId: body.songId, paid: false });
      }

      const now = new Date().toISOString();
      const amount = (body.amount != null && !Number.isNaN(Number(body.amount))) ? Number(body.amount) : null;
      const source = (body.source && String(body.source).trim()) ? String(body.source).trim().slice(0, 40) : 'zelle';
      const update: Record<string, unknown> = {
        paid: true,
        payment_status: 'paid',
        paid_at: now,
        // payment_method is the established Zelle tag (88 songs already use it)
        // and the storage-cleanup guard protects payment_method<>'zelle'.
        payment_method: source,
        marked_paid_at: now,
        marked_paid_source: source,
        marked_paid_by: (userData.user.email || userId).slice(0, 120),
      };
      // amount_paid intentionally left as-is unless explicitly passed — keeps
      // manual payments from inflating revenue reports (matches prior reconciliation).
      if (amount != null) update.amount_paid = amount;
      const { error } = await admin.from('songs').update(update).eq('id', body.songId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, songId: body.songId, paid: true, markedPaidAt: now, source, amountPaid: amount });
    }

    // ─── action: extract-brief ───────────────────────────────────────────
    // "Make Song for Customer" (2026-08-12). Ivan handles WhatsApp customers
    // who want US to build the song for them, but he does not read Spanish and
    // was round-tripping the thread through ChatGPT by hand. This action reads
    // the conversation and returns a COMPLETE, structured song brief in the
    // exact shape `generate-song` wants — plus, for every field, the Spanish
    // quote it came from and an English translation of that quote.
    //
    // The evidence is the point. Ivan cannot verify a Spanish brief by reading
    // it, but he CAN verify "customer said X → field says X" when both are in
    // front of him. Nothing here is committed: the modal renders this as an
    // editable form and a human confirms before a single credit is spent.
    //
    // Hard rule, mirroring Ace's understanding step: NEVER GUESS. A field that
    // isn't grounded in the conversation comes back `missing` with a Spanish
    // question to send the customer — it does not come back filled in with a
    // plausible default. Blank/invented details are already our top complaint
    // driver ("this isn't my song"); this path must not add to it.
    if (action === 'extract-brief') {
      const exchange = typeof body.exchange === 'string' ? body.exchange.trim() : '';
      if (!exchange) return json({ success: false, error: 'exchange required' }, 400);
      if (!ANTHROPIC_API_KEY) {
        return json({ success: false, error: 'ANTHROPIC_API_KEY is not configured on Supabase' }, 500);
      }

      // The genre catalog is supplied by the caller from src/config/genres.js so
      // there is exactly ONE genre list in the codebase. The caller is an
      // authenticated admin, and `generate-song` re-validates every id against
      // its own genreDNA table regardless, so trusting it here costs nothing.
      const catalog = Array.isArray(body.catalog) ? body.catalog : [];
      if (!catalog.length) return json({ success: false, error: 'catalog required' }, 400);

      const genreIds = catalog.map((g: any) => String(g?.id || '')).filter(Boolean);
      const catalogText = catalog
        .map((g: any) => {
          const subs = (Array.isArray(g?.subGenres) ? g.subGenres : [])
            .map((s: any) => `    - ${s?.id}: ${s?.name} — ${s?.description || ''}`)
            .join('\n');
          return `- ${g?.id}: ${g?.name} — ${g?.description || ''}\n${subs}`;
        })
        .join('\n');

      const brief = await callClaudeExtractBrief(
        exchange,
        catalogText,
        genreIds,
        body.occasionIds?.length ? body.occasionIds : undefined,
        body.relationshipIds?.length ? body.relationshipIds : undefined,
        body.toneIds?.length ? body.toneIds : undefined,
      );
      if (!brief) {
        return json({ success: false, error: 'The AI could not read this conversation. Try again, or fill the brief in by hand.' }, 502);
      }

      // ── Enforce the verbatim guarantee ────────────────────────────────
      // Every story span is looked up in the CUSTOMER's own messages only —
      // never in ours, or the model could quote a suggestion we made back as
      // if the customer had said it. What survives is sliced from the source,
      // so the story is the customer's words even if the model retyped them
      // slightly. Anything not found is reported, not silently repaired.
      const customerText = typeof body.customerText === 'string' ? body.customerText : '';
      if (!customerText.trim()) {
        return json({ success: false, error: 'customerText required (the customer\'s own messages, for the verbatim check)' }, 400);
      }
      const src = { ...normIndex(customerText), raw: customerText };

      const story = verifyQuotes(src, brief.storyQuotes);
      const asked = verifyQuotes(src, brief.requestedLines);
      const rejected = [...story.rejected, ...asked.rejected];
      if (rejected.length) {
        console.warn(`[extract-brief] discarded ${rejected.length} non-verbatim span(s): ${JSON.stringify(rejected).slice(0, 500)}`);
      }

      // ── Names ─────────────────────────────────────────────────────────
      // Checked against the customer's messages PLUS the thread's saved
      // contact name — that name is real data we already hold, not something
      // the model made up, and senders often never retype their own name.
      const nameSrcRaw = `${customerText}\n${typeof body.customerName === 'string' ? body.customerName : ''}`;
      const nameSrc = { ...normIndex(nameSrcRaw), raw: nameSrcRaw };

      const evidence: any[] = Array.isArray(brief.evidence) ? [...brief.evidence] : [];
      const questions: any[] = Array.isArray(brief.openQuestions) ? [...brief.openQuestions] : [];
      const NAME_ASKS: Record<string, { es: string; en: string }> = {
        recipientName: {
          es: '¿Me confirmas el nombre de la persona a quien va dedicada la canción y cómo se escribe? Así lo cantamos tal cual 😊',
          en: "Asks them to confirm the recipient's name and its exact spelling.",
        },
        senderName: {
          es: '¿Y de parte de quién va la canción? Dime el nombre tal como quieres que aparezca 🙏',
          en: 'Asks who the song is from, spelled how they want it.',
        },
      };

      const names: Record<string, string> = {};
      for (const field of ['recipientName', 'senderName']) {
        const proposed = typeof (brief as any)[field] === 'string' ? (brief as any)[field] : '';
        const verified = verbatimName(nameSrc, proposed);
        names[field] = verified || '';
        if (proposed.trim() && !verified) {
          // The model produced a name that is nowhere in the customer's words.
          // Drop it and ask — a re-spelled or invented name gets SUNG.
          console.warn(`[extract-brief] ${field} "${proposed}" not found in customer text — dropped`);
          const idx = evidence.findIndex((e) => e?.field === field);
          const entry = {
            field,
            status: 'missing',
            quoteEs: '',
            quoteEn: '',
            noteEn: `The AI proposed "${proposed.trim()}", but the customer never wrote that name — so it was dropped rather than guessed at. Confirm the spelling with them.`,
          };
          if (idx >= 0) evidence[idx] = entry; else evidence.push(entry);
        }
        if (!names[field] && !questions.some((q) => q?.field === field)) {
          questions.push({ field, questionEs: NAME_ASKS[field].es, questionEn: NAME_ASKS[field].en });
        }
      }

      return json({
        success: true,
        brief: {
          ...brief,
          ...names,
          evidence,
          openQuestions: questions,
          storyQuotes: story.kept,
          requestedLines: asked.kept,
          // Model-authored connective notes. Kept SEPARATE and off by default in
          // the UI precisely because these are the one thing here that is not
          // the customer's own words.
          clarifications: Array.isArray(brief.clarifications) ? brief.clarifications : [],
          // Surfaced so the operator learns the extraction tried to reword
          // something, rather than it vanishing without a trace.
          rejectedQuotes: rejected,
        },
      });
    }

    // ─── action: create-song ─────────────────────────────────────────────
    // Generate a song on the customer's behalf from the human-confirmed brief.
    //
    // This PROXIES to `generate-song` rather than reimplementing it. That
    // function already owns the lyric rules (rhyme mandate, fact-check, name
    // pronunciation, nationality separation, requested-line guarantee), the
    // genre DNA → style prompt build, provider routing and the songs insert.
    // A second generator would immediately drift from all of it.
    //
    // Two things this wrapper adds:
    //  1. ADMIN_OVERRIDE_PIN is injected SERVER-SIDE. Staff creating songs for
    //     paying customers must not trip the anti-abuse caps (which are keyed
    //     on IP and unpaid-song counts and would fire after a couple of orders
    //     from the office), and the PIN must never be handed to a browser.
    //  2. A duplicate guard. This call is slow (Claude lyrics + provider
    //     submit); if it times out at the gateway the song is usually still
    //     being generated. Without this, a retry burns a second set of credits
    //     and leaves the customer two songs. Same email + recipient inside 15
    //     minutes is refused unless the caller explicitly passes `force`.
    if (action === 'create-song') {
      const b = (body.brief || {}) as Record<string, any>;
      const email = String(b.email || '').trim().toLowerCase();
      const recipientName = String(b.recipientName || '').trim();
      const senderName = String(b.senderName || '').trim();
      const details = String(b.details || '').trim();

      // Required-field gate. The modal blocks on these too, but a UI check is
      // not a guarantee — an empty `details` is exactly how a customer ends up
      // with generic lyrics and a "this isn't my song" refund request.
      const missing: string[] = [];
      if (!email) missing.push('email');
      if (!recipientName) missing.push('recipientName');
      if (!senderName) missing.push('senderName');
      if (!b.genre) missing.push('genre');
      if (!b.occasion) missing.push('occasion');
      if (!b.relationship) missing.push('relationship');
      if (details.length < 20) missing.push('details (needs the real story, at least 20 characters)');
      if (missing.length) {
        return json({ success: false, error: `Brief incomplete — missing: ${missing.join(', ')}` }, 400);
      }

      if (!body.force) {
        const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: dupes } = await admin
          .from('songs')
          .select('id, created_at, recipient_name')
          .eq('email', email)
          .ilike('recipient_name', recipientName)
          .gte('created_at', since)
          .limit(1);
        if (dupes && dupes.length) {
          return json({
            success: false,
            code: 'DUPLICATE_RECENT',
            error: `A song for ${recipientName} was already created for ${email} in the last 15 minutes. It may still be generating — check the Orders tab before making another one.`,
          }, 409);
        }
      }

      const payload: Record<string, unknown> = {
        genre: b.genre,
        genreName: b.genreName || '',
        subGenre: b.subGenre || '',
        subGenreName: b.subGenreName || '',
        genreStyle: b.subGenrePrompt || '',
        customStyle: b.customStyle || '',
        occasion: b.occasion,
        occasionPrompt: b.occasionPrompt || '',
        customOccasion: b.customOccasion || '',
        emotionalTone: b.emotionalTone || '',
        recipientName,
        senderName,
        relationship: b.relationship,
        customRelationship: b.customRelationship || '',
        details,
        songwriterNotes: b.songwriterNotes || '',
        useCustomLyrics: false,
        customLyrics: '',
        email,
        voiceType: b.voiceType === 'female' ? 'female' : 'male',
      };
      if (ADMIN_OVERRIDE_PIN) payload.overridePin = ADMIN_OVERRIDE_PIN;

      console.log(`[make-song] role=${role} email=${email} recipient=${recipientName} genre=${b.genre}/${b.subGenre || '-'} occasion=${b.occasion}`);

      let genRes: Response;
      try {
        genRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-song`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        // The request itself never completed, so we cannot tell whether the song
        // started. Say that plainly instead of implying nothing happened.
        return json({
          success: false,
          code: 'GENERATE_UNREACHABLE',
          error: `Could not reach the song generator (${(e as Error).message}). The song MAY still have started — check the Orders tab for ${email} before retrying.`,
        }, 502);
      }

      const genData = await genRes.json().catch(() => ({}));
      if (!genRes.ok || !genData?.success) {
        // generate-song answers the customer, so its errors are in Spanish and
        // deliberately vague (they double as anti-abuse responses). Translate
        // the ones staff can actually hit into something actionable in English —
        // otherwise the operator sees "Has generado demasiadas canciones…" and
        // has no idea the fix is a missing project secret.
        const antiAbuse = genRes.status === 429
          || ['RATE_LIMIT_UNPAID', 'IP_BLOCKED', 'EMAIL_BLOCKED', 'COUNTRY_BLOCKED'].includes(genData?.code);
        if (antiAbuse) {
          return json({
            success: false,
            code: genData?.code || 'RATE_LIMIT_UNPAID',
            error: ADMIN_OVERRIDE_PIN
              ? `The anti-abuse limit blocked this even with the staff override (code: ${genData?.code || genRes.status}). This usually means the customer's own email is on the blocklist — check blocked_emails before retrying.`
              : 'Blocked by the anti-abuse rate limit. Staff song creation is supposed to skip it, but the ADMIN_OVERRIDE_PIN project secret is not set on Supabase — ask the owner to set it, then try again.',
          }, 429);
        }
        return json({
          success: false,
          code: genData?.code || 'GENERATE_FAILED',
          error: genData?.error || `generate-song returned ${genRes.status}`,
        }, 502);
      }

      return json({
        success: true,
        song: genData.song || null,
        sessionId: genData.sessionId || null,
      });
    }

    // ─── action: detail ──────────────────────────────────────────────────
    if (action === 'detail') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const { data, error } = await admin
        .from('songs')
        .select('*')
        .eq('id', body.songId)
        .single();
      if (error) return json({ success: false, error: error.message }, 500);
      const song = isAssistant ? redactForAssistant(data) : data;
      return json({ success: true, role, song });
    }

    // ─── action: mark-sent (admin or assistant) ──────────────────────────
    // Sets whatsapp_sent_at to NOW() for one song. Idempotent — calling it
    // twice doesn't re-stamp; we keep the original send time. Both roles can
    // call this so a click by either operator syncs to the other (otherwise
    // we double-send to the customer).
    if (action === 'mark-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: nowIso })
        .eq('id', body.songId)
        .is('whatsapp_sent_at', null) // don't overwrite an existing send time
        .select('id, whatsapp_sent_at')
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      // If maybeSingle returned null it means it was already marked — return
      // the existing timestamp so the UI still updates correctly.
      let finalRow = data;
      if (!finalRow) {
        const { data: existing } = await admin
          .from('songs')
          .select('id, whatsapp_sent_at')
          .eq('id', body.songId)
          .maybeSingle();
        finalRow = existing;
      }
      return json({ success: true, song: finalRow });
    }

    // ─── action: unmark-sent (admin or assistant) ────────────────────────
    // Recovery for "oops, I clicked the wrong button". Clears the timestamp.
    if (action === 'unmark-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const { error } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: null })
        .eq('id', body.songId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ─── action: bulk-mark-sent (admin or assistant) ─────────────────────
    // Stamps an array of songs in a single round-trip. Used by the bulk
    // "Marcar seleccionadas como enviadas" button on the Por Enviar tab.
    if (action === 'bulk-mark-sent') {
      const ids = Array.isArray(body.songIds) ? body.songIds : [];
      if (ids.length === 0) {
        return json({ success: false, error: 'songIds required' }, 400);
      }
      if (ids.length > 500) {
        return json({ success: false, error: 'Too many ids (max 500)' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { error, count } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: nowIso }, { count: 'exact' })
        .in('id', ids)
        .is('whatsapp_sent_at', null);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, updated: count ?? 0, sentAt: nowIso });
    }

    // ─── action: mark-email-sent (admin or assistant) ────────────────────
    // Sets email_sent_at to NOW() for one song. Used by the small "email
    // sent?" checkbox shown next to the customer's email on paid orders that
    // don't have a WhatsApp number — when the song link has been delivered
    // manually via the Mi Canción recovery flow. Idempotent.
    if (action === 'mark-email-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from('songs')
        .update({ email_sent_at: nowIso })
        .eq('id', body.songId)
        .is('email_sent_at', null)
        .select('id, email_sent_at')
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      let finalRow = data;
      if (!finalRow) {
        const { data: existing } = await admin
          .from('songs')
          .select('id, email_sent_at')
          .eq('id', body.songId)
          .maybeSingle();
        finalRow = existing;
      }
      return json({ success: true, song: finalRow });
    }

    // ─── action: unmark-email-sent (admin or assistant) ──────────────────
    if (action === 'unmark-email-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const { error } = await admin
        .from('songs')
        .update({ email_sent_at: null })
        .eq('id', body.songId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ─── action: backfill-sent (admin only) ──────────────────────────────
    // One-click "everything paid before <cutoff> is already sent" helper so
    // the Por Enviar queue isn't flooded on day one. Cutoff is an ISO
    // timestamp; we only touch rows that are paid, have a phone, and
    // currently have whatsapp_sent_at = NULL.
    if (action === 'backfill-sent') {
      if (isAssistant) return json({ success: false, error: 'Admin only' }, 403);
      const cutoff = body.cutoff;
      if (!cutoff || isNaN(new Date(cutoff).getTime())) {
        return json({ success: false, error: 'cutoff (ISO timestamp) required' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { error, count } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: nowIso }, { count: 'exact' })
        .eq('paid', true)
        .not('whatsapp_phone', 'is', null)
        .is('whatsapp_sent_at', null)
        .lte('created_at', cutoff);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, updated: count ?? 0, sentAt: nowIso });
    }

    // ─── action: list (default) ──────────────────────────────────────────
    // When `search` is provided we filter server-side across email,
    // recipient_name, sender_name and whatsapp_phone (case-insensitive). This
    // is what the admin dashboard's Lookup tab calls — without this branch
    // the function returned the entire songs table (~40k rows) and the
    // frontend rendered them all as "results for <whatever>", which felt
    // like the page refreshing and losing the match the admin was about to
    // click. See AdminDashboard.jsx → lookupServerResults useEffect.
    const search = typeof body.search === 'string' ? body.search.trim() : '';
    const searchField = typeof body.searchField === 'string' ? body.searchField : 'all';
    const requestedLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : null;

    let query = admin
      .from('songs')
      .select(SONG_LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) {
      // Strip PostgREST .or() syntax-breaking chars before interpolating.
      // These never appear in real names / emails / phone numbers so dropping
      // them is a no-op for valid lookup queries.
      const safeSearch = search.replace(/["\\,()]/g, '');
      if (safeSearch) {
        const pattern = `%${safeSearch}%`;
        if (searchField === 'email') {
          query = query.ilike('email', pattern);
        } else if (searchField === 'name') {
          query = query.or(`recipient_name.ilike."${pattern}",sender_name.ilike."${pattern}"`);
        } else if (searchField === 'phone') {
          query = query.ilike('whatsapp_phone', pattern);
        } else {
          query = query.or(
            `email.ilike."${pattern}",recipient_name.ilike."${pattern}",sender_name.ilike."${pattern}",whatsapp_phone.ilike."${pattern}"`
          );
        }
      }
    }

    // For a search request, cap at 500 rows (matches the limit the dashboard
    // requests). For the no-search dashboard fetch, return only the most recent
    // working set. The songs table has grown past 40k rows; the old 50k ceiling
    // meant this branch pulled essentially the whole table into the function,
    // which blew past the edge runtime's ~256 MB memory limit and returned
    // HTTP 546 (Resource Limit Exceeded) — the dashboard couldn't load at all.
    // Lifetime totals now come from get_admin_song_stats() below (computed in
    // Postgres), and all-history lookups go through the search branch above.
    const maxRows = search ? 500 : 10000;
    const limit = Math.min(Math.max(requestedLimit ?? maxRows, 1), maxRows);
    query = query.range(0, limit - 1);

    const { data, error, count } = await query;
    if (error) return json({ success: false, error: error.message }, 500);

    const songs = isAssistant ? (data || []).map(redactForAssistant) : (data || []);

    // Lifetime stats over the FULL table, aggregated in the database so we never
    // pull every row into the function. Revenue is redacted for the assistant
    // role (same rule as the per-row amount_paid redaction above). Only needed
    // for the dashboard's no-search fetch; the Lookup tab doesn't use it.
    let stats = null;
    if (!search) {
      const { data: statsRow, error: statsErr } = await admin.rpc(
        'get_admin_song_stats',
        { redact_revenue: isAssistant }
      );
      if (statsErr) {
        console.error('admin-songs stats rpc error:', statsErr);
      } else {
        stats = statsRow;
      }
    }

    return json({ success: true, role, songs, stats, total_count: count ?? songs.length });
  } catch (err) {
    console.error('admin-songs error:', err);
    return json({ success: false, error: String(err?.message || err) }, 500);
  }
});
