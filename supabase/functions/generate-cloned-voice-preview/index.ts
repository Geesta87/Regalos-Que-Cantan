// supabase/functions/generate-cloned-voice-preview/index.ts
//
// Generates a short voice-cloned PREVIEW for the Clone Mi Voz tier.
// The customer hears themselves singing BEFORE they pay $69.
//
// Why this exists
// ---------------
// Without a preview, the buyer has to take it on faith that the voice
// clone will sound like them. With a preview, the trust gap closes and
// conversion jumps. Costs ~$0.10 of Suno quota per preview — the
// economics still work: $69 - ~$0.20 (preview + full) = ~$68.80 margin
// per sale. Browsers who bail after preview cost us $0.10 each.
//
// What we do differently from generate-cloned-voice-song
// ------------------------------------------------------
// Same Kie/Suno upload-cover endpoint, same voice-fidelity tuning, same
// genre style strings — but with a SHORT, hardcoded preview lyric (4
// lines) instead of the customer's full Claude-generated lyrics.
//
// A 4-line lyric still produces a 30-60 second song from Suno (it pads
// with instrumental intro/outro), which is plenty to demonstrate the
// voice match. We display the whole preview in the frontend — no trimming.
//
// The preview audio is downloaded and copied to OUR Storage bucket the
// same way the full song is (see cloned-voice-status). The customer's
// preview link works forever, even if they abandon mid-flow.
//
// Request
// -------
// POST /functions/v1/generate-cloned-voice-preview
//   { cloned_voice_song_id?: '<uuid>',         (existing row to attach to)
//     voice_sample_id:       '<uuid>',
//     recipient_name:        'string',
//     occasion:              'string',
//     relationship:          'string',
//     story:                 'string',
//     genre_slug:            (any slug in _shared/clonamivoz-genres.ts),
//     language?:             'es' | 'en' | 'spanglish',
//     title?:                'string',
//     lyrics?:               'string',   (full Claude lyrics, saved for later)
//     emotional_modifiers?:  'string',
//     lyrics_model_used?:    'string',
//     customer_email?:       'string',
//     vocal_gender?:         'm' | 'f' | '' }
//
// If cloned_voice_song_id is provided, we UPDATE that row instead of
// creating a new one (lets the frontend retry the preview without
// duplicating order rows).
//
// Response (200)
// --------------
//   { cloned_voice_song_id, preview_kie_task_id, status: 'generating_preview' }
//
// The frontend then polls cloned-voice-status — once the preview is
// ready, status becomes 'preview_ready' and preview_audio_url is
// populated.
//
// Auth
// ----
// verify_jwt = true. Same anon-JWT pattern as the other clonamivoz
// functions.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  CLONAMIVOZ_GENRES,
  assertStyleLengths,
  validGenreSlugs,
} from '../_shared/clonamivoz-genres.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const KIE_CALLBACK_URL =
  Deno.env.get('KIE_CLONED_VOICE_CALLBACK_URL') ||
  'https://webhook.site/00000000-0000-0000-0000-000000000000';

const STORAGE_BUCKET = 'customer-voice';
const SIGNED_URL_TTL_SECONDS = 3600;

// Voice-fidelity tuning — SAME as the full song generator. Preview must
// sound like the full song will, so tuning has to match. TIGHTENED
// 2026-05-27 after the "voice didn't sound like the user" complaint.
// See generate-cloned-voice-song/index.ts for the rationale.
const SUNO_MODEL = 'V5_5';
const STYLE_WEIGHT = 0.15;
const AUDIO_WEIGHT = 0.95;
const WEIRDNESS_CONSTRAINT = 0.10;
const NEGATIVE_TAGS =
  'autotune, pitch correction, vocoder, robotic vocals, processed vocals';

// Kie.ai (Suno) enforces a HARD 200-character cap on the `negativeTags` field.
// The combined voice-clone-protection negatives (NEGATIVE_TAGS) + each genre's
// musical negatives blow past it for EVERY genre (219-419 chars). When that
// happens Kie returns HTTP 200 with the body
// "the length of music negativeTags cannot exceed 200 characters" and the
// preview fails to generate. Cap the combined list at 200 chars, keeping the
// clone-protection tags (top priority for a voice product, and always < 200)
// and dropping trailing genre tags at a comma boundary so we never ship a
// half-written tag. KEEP IN SYNC with generate-cloned-voice-song.
const KIE_NEGATIVE_TAGS_MAX = 200;
function capNegativeTags(combined: string): string {
  if (combined.length <= KIE_NEGATIVE_TAGS_MAX) return combined;
  const truncated = combined.slice(0, KIE_NEGATIVE_TAGS_MAX);
  const lastComma = truncated.lastIndexOf(',');
  return (lastComma > 0 ? truncated.slice(0, lastComma) : truncated).trim();
}

// Genre catalog — moved to _shared/clonamivoz-genres.ts on 2026-08-27,
// shared with generate-cloned-voice-song so preview and paid song can
// NEVER drift apart (drift here = customer pays $69 for a song that
// sounds nothing like the preview).
assertStyleLengths('generate-cloned-voice-preview');

/**
 * Build the short preview lyric. 4 lines, mentions the recipient name,
 * vowel-open line endings (singalong rule from the main lyric prompt),
 * universal phrasing that fits the launch genres.
 *
 * Suno will produce roughly 30-60 seconds of audio from this — enough
 * for the customer to recognize their own voice + the chosen genre's
 * instrumentation.
 *
 * Language-aware: when a customer picks an English genre (or sets
 * language='en' in the configure step), they get an English preview
 * lyric — not the default Spanish one. Spanglish gets a code-switched
 * version.
 */
function buildPreviewLyric(recipientName: string, language: string): string {
  const lang = (language || 'es').toLowerCase();
  const rawName = (recipientName || '').trim();

  if (lang === 'en') {
    const name = rawName || 'you';
    return `[Verse]
This song I sing just for you
With my own voice, straight from the heart
For ${name}, this is what I feel today
Listen close, I sing with love`;
  }

  if (lang === 'spanglish') {
    const name = rawName || 'tú';
    return `[Verse]
This song la canto para ti
With my own voice, desde el corazón
Para ${name}, this is what I feel today
Listen close, te canto con amor`;
  }

  // Default: Spanish
  const name = rawName || 'tú';
  return `[Verse]
Esta canción la canto para ti
Con mi propia voz, desde el corazón
Para ${name}, esto es lo que siento yo
Escucha bien, te canto con amor`;
}

interface RequestBody {
  cloned_voice_song_id?: string;
  voice_sample_id?: string;
  recipient_name?: string;
  occasion?: string;
  relationship?: string;
  story?: string;
  genre_slug?: string;
  language?: string;
  title?: string;
  lyrics?: string;
  emotional_modifiers?: string;
  lyrics_model_used?: string;
  customer_email?: string;
  vocal_gender?: 'm' | 'f' | '';

  // Suno Voice engine (2026-08-08): when the customer's voice was enrolled
  // via clonamivoz-voice-enroll, this is the Kie voice-creation TASK ID —
  // which doubles as the personaId for /api/v1/generate. When present the
  // preview uses the REAL cloned voice; when absent we fall back to the
  // legacy upload-cover engine so nothing existing breaks.
  voice_task_id?: string;
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
  if (!KIE_API_KEY) {
    console.error('[generate-cloned-voice-preview] KIE_API_KEY not configured');
    return new Response(
      JSON.stringify({
        error: 'server_misconfigured',
        message: 'Kie API key not set on the server.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_body', message: 'Expected JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- validate ----------------
  const required: (keyof RequestBody)[] = [
    'voice_sample_id',
    'recipient_name',
    'occasion',
    'relationship',
    'story',
    'genre_slug',
  ];
  for (const f of required) {
    const v = body[f];
    if (!v || typeof v !== 'string' || v.trim().length === 0) {
      return new Response(
        JSON.stringify({
          error: 'missing_field',
          field: f,
          message: `Field "${f}" is required.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  const genreSlug = body.genre_slug!.trim().toLowerCase();
  const genre = CLONAMIVOZ_GENRES[genreSlug];
  if (!genre) {
    return new Response(
      JSON.stringify({
        error: 'invalid_genre',
        message: `genre_slug must be one of: ${validGenreSlugs().join(', ')}`,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const styleString = genre.style;
  // Combined voice-clone-protection + per-genre musical negatives, capped at
  // Kie's 200-char limit (clone-protection tags always survive).
  const negativeTagsCombined = capNegativeTags(`${NEGATIVE_TAGS}, ${genre.negativeTags}`);
  const language = (body.language || 'es').toLowerCase();
  const vocalGender =
    body.vocal_gender === 'm' || body.vocal_gender === 'f' ? body.vocal_gender : undefined;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---------------- look up voice sample, refresh signed URL ----------------
  const { data: voiceRow, error: voiceLookupError } = await supabase
    .from('voice_samples')
    .select('id, storage_path, deleted_at')
    .eq('id', body.voice_sample_id!)
    .single();

  if (voiceLookupError || !voiceRow) {
    return new Response(
      JSON.stringify({
        error: 'voice_sample_not_found',
        message: `No voice_sample with id ${body.voice_sample_id}.`,
      }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (voiceRow.deleted_at) {
    return new Response(
      JSON.stringify({
        error: 'voice_sample_deleted',
        message: 'Voice sample has been purged. Customer must re-record.',
      }),
      { status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const signed = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(voiceRow.storage_path, SIGNED_URL_TTL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) {
    console.error(
      '[generate-cloned-voice-preview] createSignedUrl failed:',
      signed.error
    );
    return new Response(
      JSON.stringify({
        error: 'signed_url_failed',
        message:
          signed.error?.message ||
          'Could not create a fetchable URL for the voice sample.',
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const voicePublicUrl = signed.data.signedUrl;

  // ---------------- free-preview rate limit (2026-08-27) ----------------
  // Every preview burns real Kie credits and the endpoint is reachable with
  // the public anon key. Cap NEW preview orders per voice sample and per
  // email over 24h. The retry path (cloned_voice_song_id present) is exempt
  // — it reuses an existing order row and is bounded by the same caps that
  // created it.
  if (!body.cloned_voice_song_id) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: sampleCount } = await supabase
      .from('cloned_voice_songs')
      .select('id', { count: 'exact', head: true })
      .eq('voice_sample_id', voiceRow.id)
      .gt('created_at', dayAgo);
    let emailCount = 0;
    if (body.customer_email) {
      const { count } = await supabase
        .from('cloned_voice_songs')
        .select('id', { count: 'exact', head: true })
        .eq('customer_email', body.customer_email)
        .gt('created_at', dayAgo);
      emailCount = count || 0;
    }
    if ((sampleCount || 0) >= 5 || emailCount >= 8) {
      return new Response(
        JSON.stringify({
          error: 'preview_limit_reached',
          message:
            'Ya creaste varias pruebas hoy. Espera un poco o escríbenos a hola@regalosquecantan.com si necesitas ayuda.',
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // ---------------- upsert cloned_voice_songs row ----------------
  // If frontend passed a cloned_voice_song_id, update that row (retry path).
  // Otherwise insert a fresh row. Either way we end up with one row in
  // 'generating_preview' state.
  const insertOrUpdate = {
    voice_sample_id: voiceRow.id,
    customer_email: body.customer_email || null,
    recipient_name: body.recipient_name!.trim(),
    occasion: body.occasion!.trim(),
    relationship: body.relationship!.trim(),
    story: body.story!.trim(),
    genre_slug: genreSlug,
    language,
    title: body.title?.trim() || null,
    lyrics: body.lyrics || null,
    emotional_modifiers: body.emotional_modifiers || null,
    lyrics_model_used: body.lyrics_model_used || null,
    status: 'generating_preview' as const,
    error_message: null,
    // Persist which engine this order runs on so the paid full-song path
    // (stripe webhook → generate-cloned-voice-song) reuses the same voice.
    voice_task_id: body.voice_task_id || null,
  };

  let clonedVoiceSongId: string;
  if (body.cloned_voice_song_id) {
    const { data: updatedRow, error: updateError } = await supabase
      .from('cloned_voice_songs')
      .update(insertOrUpdate)
      .eq('id', body.cloned_voice_song_id)
      .select('id')
      .single();
    if (updateError || !updatedRow) {
      console.error(
        '[generate-cloned-voice-preview] DB update failed:',
        updateError
      );
      return new Response(
        JSON.stringify({
          error: 'db_update_failed',
          message: updateError?.message || 'Could not update the song order.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    clonedVoiceSongId = updatedRow.id;
  } else {
    const { data: songRow, error: insertError } = await supabase
      .from('cloned_voice_songs')
      .insert(insertOrUpdate)
      .select('id')
      .single();
    if (insertError || !songRow) {
      console.error(
        '[generate-cloned-voice-preview] DB insert failed:',
        insertError
      );
      return new Response(
        JSON.stringify({
          error: 'db_insert_failed',
          message: insertError?.message || 'Could not record the song order.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    clonedVoiceSongId = songRow.id;
  }

  // ---------------- call Kie.ai upload-cover with the preview lyric ------
  // Pass the resolved language so the preview matches what the customer
  // configured. Previously the preview lyric was always Spanish even when
  // an English genre / language was selected, which made the preview
  // sound off-language from the customer's recording + lyrics.
  const previewLyric = buildPreviewLyric(body.recipient_name!, language);
  const previewTitle = `preview-${clonedVoiceSongId.slice(0, 8)}`;

  // Engine switch (2026-08-08): enrolled Suno Voice (personaId = the Kie
  // voice-creation task id) vs legacy upload-cover. The persona path uses
  // /api/v1/generate and does NOT take the cover-tuning knobs
  // (styleWeight/audioWeight/weirdness are upload-cover-only) nor the
  // sample uploadUrl — the voice comes from the stored persona.
  const voiceTaskId = body.voice_task_id || null;
  const kieEndpoint = voiceTaskId
    ? 'https://api.kie.ai/api/v1/generate'
    : 'https://api.kie.ai/api/v1/generate/upload-cover';
  const kiePayload = voiceTaskId
    ? {
        personaId: voiceTaskId,
        prompt: previewLyric,
        customMode: true,
        instrumental: false,
        model: SUNO_MODEL,
        style: styleString,
        title: previewTitle,
        negativeTags: negativeTagsCombined,
        callBackUrl: KIE_CALLBACK_URL,
        ...(vocalGender ? { vocalGender } : {}),
      }
    : {
        uploadUrl: voicePublicUrl,
        prompt: previewLyric,
        customMode: true,
        instrumental: false,
        model: SUNO_MODEL,
        style: styleString,
        title: previewTitle,
        negativeTags: negativeTagsCombined,
        styleWeight: STYLE_WEIGHT,
        audioWeight: AUDIO_WEIGHT,
        weirdnessConstraint: WEIRDNESS_CONSTRAINT,
        callBackUrl: KIE_CALLBACK_URL,
        ...(vocalGender ? { vocalGender } : {}),
      };

  let kieResp: Response;
  try {
    kieResp = await fetch(kieEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(kiePayload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[generate-cloned-voice-preview] Kie network error:', msg);
    await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'failed',
        error_message: `Network error contacting Kie.ai (preview): ${msg}`,
      })
      .eq('id', clonedVoiceSongId);
    return new Response(
      JSON.stringify({
        error: 'kie_network_error',
        message: msg,
        cloned_voice_song_id: clonedVoiceSongId,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const kieData = await kieResp.json().catch(() => null);

  if (!kieResp.ok || !kieData || kieData.code !== 200) {
    const errMsg = `Kie returned ${kieResp.status}: ${
      kieData?.msg || JSON.stringify(kieData)?.slice(0, 200)
    }`;
    console.error('[generate-cloned-voice-preview] Kie API error:', errMsg);
    await supabase
      .from('cloned_voice_songs')
      .update({ status: 'failed', error_message: errMsg.slice(0, 500) })
      .eq('id', clonedVoiceSongId);
    return new Response(
      JSON.stringify({
        error: 'kie_api_error',
        message: errMsg,
        kie_response: kieData,
        cloned_voice_song_id: clonedVoiceSongId,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const previewKieTaskId: string | undefined = kieData?.data?.taskId;
  if (!previewKieTaskId) {
    console.error(
      '[generate-cloned-voice-preview] Kie returned 200 but no taskId:',
      kieData
    );
    await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'failed',
        error_message: 'Kie returned no taskId for preview.',
      })
      .eq('id', clonedVoiceSongId);
    return new Response(
      JSON.stringify({
        error: 'kie_no_task_id',
        message: 'Kie did not return a taskId.',
        cloned_voice_song_id: clonedVoiceSongId,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Persist the preview taskId so the polling endpoint can finish the
  // copy + status update once Suno is done.
  const { error: updateError } = await supabase
    .from('cloned_voice_songs')
    .update({ preview_kie_task_id: previewKieTaskId })
    .eq('id', clonedVoiceSongId);

  if (updateError) {
    console.warn(
      '[generate-cloned-voice-preview] Could not persist preview_kie_task_id (non-fatal):',
      updateError
    );
  }

  return new Response(
    JSON.stringify({
      cloned_voice_song_id: clonedVoiceSongId,
      preview_kie_task_id: previewKieTaskId,
      status: 'generating_preview',
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
