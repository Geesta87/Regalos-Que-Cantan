// supabase/functions/generate-cloned-voice-lyrics/index.ts
//
// Generates personalized Spanish song lyrics for the Clone Mi Voz tier
// (regalosquecantan.com/clonamivoz) using Anthropic Claude.
//
// Why this lives separately from generate-song
// --------------------------------------------
// The production generate-song function is 2,600+ lines and tightly couples
// lyric generation to: anti-abuse rate limiting, Mureka music generation,
// Stripe order context, customer payment state, etc. The Clone Mi Voz tier
// doesn't need ANY of that today (no Stripe, no Mureka, no rate-limit DB
// rows). Keeping the lyric-gen path isolated here means:
//   - generate-song stays untouched (zero regression risk to the existing
//     $29.99 funnel)
//   - cloned-voice flow can iterate independently
//   - clean separation while we validate the new tier
//
// IMPORTANT: This file's LYRICS_TOOL and LYRICS_SYSTEM_PROMPT started as
// VERBATIM copies from generate-song/index.ts (lines ~1701-1787 as of
// 2026-05-27). Since 2026-08-27 they diverge DELIBERATELY in one way:
// Clone Mi Voz supports English/Spanglish lyrics, so the tool description
// is language-neutral and buildUserMessage adds an English-mode override
// (English section markers + an English adaptation of the open-vowel
// chorus rule). Everything else should stay in sync with production —
// if generate-song's prompt is updated, re-sync the shared parts.
//
// Per-song user-message templating is simplified (does not pull from the
// full 700-line genreDNA database). Genre tone hints come from the shared
// catalog in _shared/clonamivoz-genres.ts (lyricHints), which covers every
// genre — including the English ones that used to fall through to a
// generic fallback.
//
// Request
// -------
// POST /functions/v1/generate-cloned-voice-lyrics
//   Headers: Authorization: Bearer <supabase anon key>
//            Content-Type: application/json
//   Body:
//     recipient_name: required
//     occasion:       required
//     relationship:   required
//     story:          required (min 20 chars)
//     genre_slug:     required (any slug in _shared/clonamivoz-genres.ts)
//     language:       optional ('es' | 'en' | 'spanglish', default 'es')
//
// Response (200)
// --------------
//   { title, lyrics, emotional_modifiers, model_used }
//
// Auth
// ----
// verify_jwt = true (see supabase/config.toml). Called from the /clonamivoz
// frontend with the public anon JWT. Gateway validates the JWT, then this
// handler validates inputs and calls Claude.
//
// Deploy with: supabase functions deploy generate-cloned-voice-lyrics --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { CLONAMIVOZ_GENRES } from '../_shared/clonamivoz-genres.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

// Production model order — matches generate-song/index.ts line ~2301.
// If production swaps models, swap them here too so output stays consistent.
const CLAUDE_PRIMARY_MODEL = 'claude-sonnet-4-6';
const CLAUDE_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 3;

// ============================================================================
// LYRICS_TOOL — copied verbatim from generate-song/index.ts line 1701
// Do not modify in isolation. Update both files together when the prompt
// contract evolves so cloned-voice output style matches the regular tier.
// ============================================================================
const LYRICS_TOOL = {
  name: 'submit_song_lyrics',
  description:
    'Submit the final song lyrics and emotional modifiers for the music production pipeline. ' +
    'You MUST call this tool to deliver your output. Do not respond with prose, JSON text, ' +
    'or any other format — only call this tool with both required fields populated.',
  input_schema: {
    type: 'object',
    properties: {
      lyrics: {
        type: 'string',
        description:
          // Deliberate divergence from generate-song: Clone Mi Voz supports
          // English/Spanglish, so this is language-neutral (the user message
          // states the language).
          'The complete song lyrics in the language requested in the user message (Spanish unless stated otherwise). Use real newline characters between lines ' +
          '(the field accepts multi-line strings natively — do NOT write the literal characters ' +
          'backslash-n). Include all required section markers like [Intro], [Verso 1], [Coro], ' +
          '[Verso 2], [Puente], [Coro Final], [Outro] etc. per the structure rules in the user message. ' +
          'Follow ALL composition rules from the system prompt and the per-song specifics from the user message.',
      },
      emotionalModifiers: {
        type: 'string',
        description:
          'Up to 25 words in ENGLISH describing the unique emotion and atmosphere of THIS song. ' +
          'Do NOT mention the genre, instruments, or tempo — those go elsewhere in the pipeline. ' +
          'The modifiers MUST match the sonic character of the genre (e.g. fierce/defiant for ' +
          'aggressive genres, aching/bittersweet for melancholic, euphoric for festive, tender for romantic).',
      },
    },
    required: ['lyrics', 'emotionalModifiers'],
    additionalProperties: false,
  },
} as const;

// ============================================================================
// LYRICS_SYSTEM_PROMPT — copied verbatim from generate-song/index.ts line 1736
// ============================================================================
const LYRICS_SYSTEM_PROMPT = `Eres un compositor experto de música mexicana y latina. Te especializas en composición personalizada para regalos musicales. Escribes letras que la gente CANTA, no que solo lee.

Recibirás los detalles de cada canción (género, destinatario, ocasión, detalles personales, estructura de secciones) en el mensaje del usuario. Las REGLAS siguientes aplican a TODAS las canciones que escribes, sin excepción.

REGLAS DE COMPOSICIÓN (OBLIGATORIAS):

1. CORO = LO MÁS IMPORTANTE. El coro DEBE ser pegajoso, corto (4 líneas), y fácil de cantar. El oyente debe poder cantar el coro después de escucharlo UNA vez. Si el coro no es memorable, la canción falla.

   FÓRMULA OBLIGATORIA DEL CORO — patrón A-A'-B-A (la receta del earworm):
   - Línea 1 (A): La frase-GANCHO central. Esta es LA línea que la gente recuerda y tararea. Es el corazón de la canción. 4-7 sílabas. Contiene el sentimiento principal.
   - Línea 2 (A'): Variación de la línea 1. Misma estructura rítmica, cambia 1-2 palabras. Refuerza el gancho sin repetirlo idéntico.
   - Línea 3 (B): Línea de CONTRASTE. Idea diferente que prepara el regreso al gancho.
   - Línea 4 (A): REPITE EXACTAMENTE la línea 1. Cierra el coro con el gancho intacto.

   Esta repetición intencional (3 veces el gancho, 1 vez variación, 1 vez contraste) es lo que crea earworm — la canción que se queda en la cabeza después de UNA escucha. NO inventes "estilos creativos" de coro: usa esta fórmula sin excepciones.

2. CONTRASTE VERSO vs CORO. Los versos CUENTAN la historia (narrativos, específicos, íntimos). El coro EXPLOTA la emoción (universal, repetible, intenso). Que se sientan como secciones DISTINTAS en energía y tono.

3. DETALLES ESPECÍFICOS > FRASES GENÉRICAS.
   PROHIBIDO: "eres la luz de mi vida", "sin ti no puedo vivir", "eres mi todo", "mi corazón late por ti", "eres mi sol y mi luna", "eres el amor de mi vida", "contigo soy feliz".
   EN VEZ usa los detalles personales que el usuario provee para crear imágenes ÚNICAS y concretas. Un recuerdo específico vale más que 10 frases bonitas genéricas.
   REGLA CRÍTICA: Si el usuario mencionó FECHAS, LUGARES, EVENTOS, APODOS, o ANÉCDOTAS en los detalles, DEBES incluir CADA UNO en la letra. Distribúyelos así: Verso 1 = contexto/origen de la historia, Verso 2 = momentos específicos y recuerdos, Puente = lo más íntimo/vulnerable. NO ignores ningún detalle que el usuario proporcionó — es lo que hace ÚNICA esta canción y por lo que PAGARON.

4. USO DEL NOMBRE — instrucción específica viene en el mensaje del usuario (varía si la canción es para otra persona o para uno mismo).

5. CANTABILIDAD — DOS PRESUPUESTOS DE SÍLABAS DISTINTOS (no es un solo límite universal).
   - VERSOS ([Verso 1], [Verso 2], [Puente]): 8-14 sílabas por línea. Los versos cuentan la historia — necesitan espacio para narrar.
   - CORO ([Coro], [Coro Final], [Pre-Coro]): 4-7 sílabas por línea. CORTAS, PUNZANTES. Líneas largas en el coro NO se pueden gritar en grupo. La línea-gancho debe ser tan corta que se grabe en la cabeza después de UNA escucha. Si una línea del coro pasa de 7 sílabas, RECÓRTALA.
   Español mexicano COLOQUIAL, no literario ni poético rebuscado. Escribe como se HABLA en México.

6. RIMA. Usa rima consonante o asonante natural. No fuerces rimas artificiales. Esquema por estrofa: ABAB o AABB.

7. PUENTE = GIRO EMOCIONAL. Cambio de perspectiva, confesión íntima, o el momento más vulnerable. NO repetir la misma idea de los versos.

8. NO empezar múltiples versos con la misma palabra. Varía las aperturas de cada línea.

9. VOCALES ABIERTAS AL FINAL DEL CORO — regla física, no estilística. Cada línea de [Coro], [Coro Final], y [Pre-Coro] (si existe) DEBE terminar en vocal abierta: a, o, e. NUNCA terminar línea del coro en consonante final, ni en "s" plural, ni en sílabas cerradas (-r, -n, -d, -l, -z, etc.).
   Razón: las vocales abiertas se pueden SOSTENER al cantar — son donde vive el "singalong". Las consonantes cortan el sonido y matan la cantabilidad en grupo. Compara: "te quiero a ti" (cantable) vs "te quiero más" (cortante).
   Si una línea del coro termina en consonante, REESCRÍBELA invirtiendo el orden o cambiando la palabra final para que termine en vocal abierta. Esta regla es INNEGOCIABLE para [Coro], [Coro Final], [Pre-Coro]. En versos no aplica (puedes terminar como quieras).

REGLA ABSOLUTA — NOMBRES DE ARTISTAS:
NUNCA escribas el nombre de un artista, banda, cantante o grupo musical real (ni en las letras, ni en emotionalModifiers, ni en ningún otro campo). Esto incluye nombres como "Christian Nodal", "Vicente Fernández", "Alacranes Musical", "Banda MS", "Carin León", "Peso Pluma", "K-Paz", "Diomedes Díaz", etc. — si pensaste mencionar un artista para describir el estilo, REEMPLÁZALO por una descripción del SONIDO ("modern romantic ranchera style", "techno-banda style") sin mencionar al artista. El proveedor de música RECHAZA cualquier referencia a artistas reales y la canción FALLA.

REGLA CRÍTICA para emotionalModifiers:
Los modifiers DEBEN ser compatibles con el carácter sonoro del género. Expresa la emoción A TRAVÉS del lente del género, nunca en contra.
- Género agresivo/oscuro (bélico, trap, alterados): emociones con fuerza — "fierce unbreakable loyalty, defiant pride, raw respect" NO "warm heartfelt tender"
- Género melancólico (sad sierreño, bolero): emociones con peso — "aching longing, bittersweet devotion, haunting memory"
- Género festivo/bailable (cumbia, quebradita): emociones con energía — "euphoric celebration, infectious joy, vibrant tribute"
- Género romántico/suave: calidez — "tender intimacy, warm embrace, gentle devotion"

ENTREGA DE LA SALIDA:
SIEMPRE entrega tu resultado llamando a la herramienta submit_song_lyrics con ambos campos (lyrics, emotionalModifiers). NUNCA respondas con prosa, JSON en texto, o cualquier otro formato. La herramienta es el único canal de entrega.`;

// ============================================================================
// Genre tone hints now come from the SHARED catalog
// (_shared/clonamivoz-genres.ts → lyricHints), which covers all 14 genres —
// Spanish AND English. Before 2026-08-27 a local 6-genre table lived here
// and the English genres fell through to a generic fallback whose
// displayName was the raw slug ("country_en"), producing weaker,
// less genre-true lyrics.
// ============================================================================

const VALID_LANGUAGES = new Set(['es', 'en', 'spanglish']);

interface LyricsRequestBody {
  recipient_name?: string;
  occasion?: string;
  relationship?: string;
  story?: string;
  genre_slug?: string;
  language?: string;
}

function buildUserMessage(req: Required<Omit<LyricsRequestBody, 'language'>> & { language: 'es' | 'en' | 'spanglish' }): string {
  const g = CLONAMIVOZ_GENRES[req.genre_slug]?.lyricHints || {
    displayName: req.genre_slug,
    baseStyle: req.genre_slug,
    tempo: 'mid-tempo emocional',
    instruments: 'acompañamiento tradicional latino',
    vibe: 'cálido y personal',
    emotionalDirection: 'warm tender devotion',
  };

  const isEnglish = req.language === 'en';

  // English songs use English section markers directly (Suno is
  // English-trained; the song generator's englishifyLyricsMarkers pass
  // leaves already-English markers untouched).
  const M = isEnglish
    ? { intro: '[Intro]', v1: '[Verse 1]', coro: '[Chorus]', v2: '[Verse 2]', puente: '[Bridge]', coroFinal: '[Final Chorus]', outro: '[Outro]' }
    : { intro: '[Intro]', v1: '[Verso 1]', coro: '[Coro]', v2: '[Verso 2]', puente: '[Puente]', coroFinal: '[Coro Final]', outro: '[Outro]' };

  const langInstruction = isEnglish
    ? `IMPORTANTE — MODO INGLÉS:
- Escribe TODA la letra en INGLÉS americano coloquial y natural (no en español). Escribe como se HABLA, no inglés literario.
- Usa los marcadores de sección en inglés: [Intro], [Verse 1], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro]. Donde las reglas del sistema digan [Coro]/[Verso]/[Puente], aplican igual a [Chorus]/[Verse]/[Bridge].
- ADAPTACIÓN de la regla de vocales abiertas (regla 9): en inglés, cada línea del [Chorus] y [Final Chorus] DEBE terminar en un sonido abierto y sostenible — vocales largas o diptongos abiertos ("you", "away", "go", "true", "day", "shine"). NUNCA termines una línea del coro en consonantes oclusivas o cortantes (-t, -k, -p, -ct, -st, -ck). Las vocales sostenibles son donde vive el singalong.
- Todas las demás reglas del sistema (fórmula A-A'-B-A del coro, presupuestos de sílabas, detalles específicos obligatorios, rima ABAB/AABB, prohibición de nombres de artistas) aplican igual, en inglés.`
    : req.language === 'spanglish'
    ? 'IMPORTANTE: Escribe las letras en SPANGLISH (mayormente español con frases en inglés mezcladas naturalmente).'
    : ''; // default Spanish — no extra instruction needed

  return `Escribe una canción de ${g.displayName} con los siguientes datos.${langInstruction ? '\n\n' + langInstruction : ''}

DATOS DE LA CANCIÓN:
- Para quién: ${req.recipient_name}
- Relación: ${req.relationship}
- Ocasión: ${req.occasion}
- Detalles e historia que dio el usuario:
"""
${req.story}
"""

GÉNERO Y ESTILO MUSICAL (referencia para el TONO de las letras, no para el sonido — el sonido lo maneja el productor de música):
- Estilo base: ${g.baseStyle}
- Tempo de referencia: ${g.tempo}
- Instrumentos típicos: ${g.instruments}
- Vibe: ${g.vibe}
- Dirección emocional (para tu emotionalModifiers): ${g.emotionalDirection}

USO DEL NOMBRE:
El nombre del destinatario (${req.recipient_name}) debe aparecer 3-5 veces distribuido naturalmente a lo largo de la canción — al menos una vez en el primer verso, una vez en el coro, y una en el coro final o el puente. No lo fuerces si rompe la métrica; reemplaza por ${isEnglish ? '"you" o "my love"' : '"tú" o "mi amor"'} si es necesario para mantener cantabilidad.

ESTRUCTURA OBLIGATORIA (en este orden exacto):
- ${M.intro}: Apertura instrumental. NO escribir letra — solo poner "${M.intro}" para que el productor cree una entrada musical.
- ${M.v1}: Presenta la historia. Contexto, escena, quién eres y qué sientes hacia ${req.recipient_name}. Incorpora detalles del origen de la historia.
- ${M.coro}: GANCHO emocional siguiendo la fórmula A-A'-B-A (4 líneas cortas de 4-7 sílabas, finales de línea abiertos y sostenibles).
- ${M.v2}: Profundiza con detalles específicos. Momentos concretos, recuerdos, eventos mencionados por el usuario.
- ${M.coro}: Repetición del coro (MISMA letra exacta — no improvisar nuevo coro).
- ${M.puente}: Giro emocional. Lo más vulnerable o íntimo de toda la canción.
- ${M.coroFinal}: Cierre con impacto. Misma fórmula A-A'-B-A. Puede tener variación sutil en la línea 3 (B).
- ${M.outro}: Cierre instrumental. NO escribir letra — solo poner "${M.outro}" para que el productor añada un cierre musical.

Cuando termines, llama a la herramienta submit_song_lyrics con la letra completa y los emotionalModifiers en inglés. Recuerda todas las reglas del sistema (composición, nombres de artistas, compatibilidad de modifiers con el género).`;
}

function deriveTitle(lyrics: string, recipientName: string, genreSlug: string): string {
  const lines = lyrics.split('\n').map((l) => l.trim());
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('[') && line.endsWith(']')) continue;
    const cleaned = line.replace(/[.,!?¡¿…]+$/, '').slice(0, 60);
    if (cleaned.length >= 5) return cleaned;
  }
  return `${genreSlug} para ${recipientName}`.slice(0, 60);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', message: 'Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!ANTHROPIC_API_KEY) {
    console.error('[generate-cloned-voice-lyrics] ANTHROPIC_API_KEY not configured');
    return new Response(
      JSON.stringify({ error: 'server_misconfigured', message: 'Anthropic API key not set on the server.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body: LyricsRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_body', message: 'Expected JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- validate ----------------
  const requiredFields: (keyof LyricsRequestBody)[] = ['recipient_name', 'occasion', 'relationship', 'story', 'genre_slug'];
  for (const f of requiredFields) {
    const v = body[f];
    if (!v || typeof v !== 'string' || v.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'missing_field', field: f, message: `Field "${f}" is required.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  if (body.story!.trim().length < 20) {
    return new Response(
      JSON.stringify({ error: 'story_too_short', message: 'Story must be at least 20 characters.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (body.story!.length > 5000) {
    return new Response(
      JSON.stringify({ error: 'story_too_long', message: 'Story must be at most 5000 characters.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const language = (body.language || 'es').toLowerCase();
  if (!VALID_LANGUAGES.has(language)) {
    return new Response(
      JSON.stringify({ error: 'invalid_language', message: `language must be one of: ${Array.from(VALID_LANGUAGES).join(', ')}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const userMessage = buildUserMessage({
    recipient_name: body.recipient_name!.trim(),
    occasion: body.occasion!.trim(),
    relationship: body.relationship!.trim(),
    story: body.story!.trim(),
    genre_slug: body.genre_slug!.trim().toLowerCase(),
    language: language as 'es' | 'en' | 'spanglish',
  });

  // ---------------- Claude call with retries ----------------
  let modelUsed = CLAUDE_PRIMARY_MODEL;
  let toolInput: { lyrics: string; emotionalModifiers: string } | null = null;
  let lastErrorText = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const model = attempt === MAX_RETRIES ? CLAUDE_FALLBACK_MODEL : CLAUDE_PRIMARY_MODEL;

    let claudeResponse: Response;
    try {
      claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          // Prompt caching on the static rules block — matches production.
          system: [{ type: 'text', text: LYRICS_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: [LYRICS_TOOL],
          tool_choice: { type: 'tool', name: 'submit_song_lyrics' },
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
    } catch (e) {
      lastErrorText = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_RETRIES) {
        const delay = attempt * 5000;
        console.warn(`[generate-cloned-voice-lyrics] network error attempt ${attempt}, retrying in ${delay}ms: ${lastErrorText}`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    const claudeData = await claudeResponse.json().catch(() => null);

    if (!claudeResponse.ok || !claudeData || !Array.isArray(claudeData.content)) {
      const isOverloaded = claudeData?.error?.type === 'overloaded_error' || claudeResponse.status === 529;
      lastErrorText = `HTTP ${claudeResponse.status}: ${JSON.stringify(claudeData).slice(0, 300)}`;
      if (isOverloaded && attempt < MAX_RETRIES) {
        const delay = attempt * 5000;
        console.warn(`[generate-cloned-voice-lyrics] Claude overloaded attempt ${attempt}, retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (attempt === MAX_RETRIES) break;
      continue;
    }

    const found = claudeData.content.find(
      (b: { type?: string; name?: string }) => b && b.type === 'tool_use' && b.name === 'submit_song_lyrics'
    );
    if (
      found &&
      typeof found.input?.lyrics === 'string' &&
      found.input.lyrics.trim() &&
      typeof found.input?.emotionalModifiers === 'string'
    ) {
      toolInput = { lyrics: found.input.lyrics, emotionalModifiers: found.input.emotionalModifiers };
      modelUsed = model;
      if (attempt > 1) {
        console.log(`[generate-cloned-voice-lyrics] succeeded on attempt ${attempt} with ${model}`);
      }
      if (claudeData.usage) {
        console.log(
          `[generate-cloned-voice-lyrics] usage: input=${claudeData.usage.input_tokens} ` +
            `cache_read=${claudeData.usage.cache_read_input_tokens ?? 0} ` +
            `cache_write=${claudeData.usage.cache_creation_input_tokens ?? 0} ` +
            `output=${claudeData.usage.output_tokens}`
        );
      }
      break;
    }

    console.warn(
      `[generate-cloned-voice-lyrics] 200 but no valid tool_use attempt ${attempt}. ` +
        `stop_reason=${claudeData.stop_reason}`
    );
  }

  if (!toolInput) {
    console.error('[generate-cloned-voice-lyrics] all retries failed', lastErrorText);
    return new Response(
      JSON.stringify({
        error: 'lyrics_tool_call_failed',
        message: 'Could not generate lyrics after retries. ' + lastErrorText.slice(0, 200),
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const title = deriveTitle(toolInput.lyrics, body.recipient_name!.trim(), body.genre_slug!.trim().toLowerCase());

  return new Response(
    JSON.stringify({
      title,
      lyrics: toolInput.lyrics,
      emotional_modifiers: toolInput.emotionalModifiers,
      model_used: modelUsed,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
