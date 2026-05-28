// supabase/functions/generate-cloned-voice-song/index.ts
//
// Submits a Clone Mi Voz song to Suno via Kie.ai's upload-cover endpoint.
// This is the music-generation step; lyrics come pre-generated from the
// frontend (which already called generate-cloned-voice-lyrics).
//
// Flow
// ----
//   1. Frontend uploads voice via upload-customer-voice → gets voice_sample_id
//   2. Frontend gets lyrics via generate-cloned-voice-lyrics → gets {title, lyrics}
//   3. Frontend calls THIS function with voice_sample_id + lyrics + genre
//   4. This function:
//      - Inserts public.cloned_voice_songs row (status='generating_song')
//      - Re-creates a fresh signed URL for the voice (1h TTL)
//      - Calls Kie.ai /api/v1/generate/upload-cover with the voice URL +
//        genre-specific style + lyrics + voice-fidelity tuning params
//        (styleWeight 0.35, audioWeight 0.85, weirdness 0.2) validated in
//        the standalone test harness
//      - Saves kie_task_id on the row
//   5. Frontend polls cloned-voice-status (next commit) for completion
//
// Why upload-cover (not /generate)
// --------------------------------
// upload-cover is Suno's voice-clone-style entry point: takes a public
// audio URL + style + lyrics and produces a song in that voice. The
// regular /generate endpoint that recover-mureka-cap-songs uses is for
// the Mureka-style flow (no source audio).
//
// Why not also generate lyrics here
// ---------------------------------
// Keeping lyric-gen and music-gen as separate functions lets the customer
// review/edit lyrics before committing to a $-burning Kie call. Matches
// the test app's flow that we validated end-to-end.
//
// Auth
// ----
// verify_jwt = true (see supabase/config.toml). Frontend posts with the
// Supabase anon JWT, same pattern as upload-customer-voice and the
// lyric-gen function.
//
// Deploy with: supabase functions deploy generate-cloned-voice-song --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
// callBackUrl is required by Kie but we poll for status, so a webhook.site
// placeholder is fine. Override via env if a real receiver is set up later.
const KIE_CALLBACK_URL = Deno.env.get('KIE_CLONED_VOICE_CALLBACK_URL') || 'https://webhook.site/00000000-0000-0000-0000-000000000000';

const STORAGE_BUCKET = 'customer-voice';
const SIGNED_URL_TTL_SECONDS = 3600;

// Suno model. V5_5 is what we validated in the test app for the cloned-voice
// quality recipe. Production's Mureka-fallback path uses V4_5 via KIE_MODEL
// env var; we intentionally pin V5_5 here for this tier.
const SUNO_MODEL = 'V5_5';

// Voice-fidelity tuning — TIGHTENED 2026-05-27 after a production
// complaint that the cloned voice "didn't sound like the user".
// Original tuning (styleWeight 0.35, audioWeight 0.85, weirdness 0.2)
// was validated on pre-recorded MP3 files in the test harness, but
// production input (browser-captured WebM/Opus) is a weaker signal,
// so Suno needs harder voice anchoring to lock onto the speaker.
//
// Direction of each knob:
//   styleWeight ↓     → less genre influence, more voice
//   audioWeight ↑     → more anchoring to the reference recording
//   weirdness ↓       → less creative liberty, more faithful clone
const STYLE_WEIGHT = 0.15;
const AUDIO_WEIGHT = 0.95;
const WEIRDNESS_CONSTRAINT = 0.10;
const NEGATIVE_TAGS = 'autotune, pitch correction, vocoder, robotic vocals, processed vocals';

// Per-launch-genre style strings — TRIMMED to instrumentation only.
//
// Old strings included vocal-style directives ("voz natural", "vibrato
// dramático", "fuerte emocional", "voz fuerte y orgullosa", etc) which
// FIGHT the cloned voice — Suno tries to overlay that vocal style on
// top of the customer's actual delivery, drowning their character out.
//
// New strings describe ONLY instruments + arrangement so the customer's
// voice can come through unfiltered. The cloned voice itself provides
// the vocal style.
const GENRE_STYLES: Record<string, string> = {
  romantico: 'romantic Latin ballad: acoustic guitar fingerpicking, soft strings, gentle mid-tempo, sparse arrangement',
  balada: 'balada latina clásica: piano grande, cuerdas orquestales, percusión cepillada, arreglo elegante',
  banda: 'banda sinaloense: tambora, tuba, trompetas, trombones, clarinetes, ritmo norteño festivo',
  corrido: 'corrido norteño: acordeón diatónico, bajo sexto, tololoche o bajo eléctrico, ritmo polka tradicional',
  ranchera: 'mariachi instrumental: trompetas, violines, vihuela, guitarrón, ritmo tradicional mexicano',
  mariachi: 'mariachi tradicional: trompetas, violines, guitarrón, vihuela, arreglo clásico mexicano',
};

interface RequestBody {
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
    console.error('[generate-cloned-voice-song] KIE_API_KEY not configured');
    return new Response(
      JSON.stringify({ error: 'server_misconfigured', message: 'Kie API key not set on the server.' }),
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
  const required: (keyof RequestBody)[] = ['voice_sample_id', 'recipient_name', 'occasion', 'relationship', 'story', 'genre_slug', 'lyrics'];
  for (const f of required) {
    const v = body[f];
    if (!v || typeof v !== 'string' || v.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'missing_field', field: f, message: `Field "${f}" is required.` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }
  const genreSlug = body.genre_slug!.trim().toLowerCase();
  const styleString = GENRE_STYLES[genreSlug];
  if (!styleString) {
    return new Response(
      JSON.stringify({
        error: 'invalid_genre',
        message: `genre_slug must be one of: ${Object.keys(GENRE_STYLES).join(', ')}`,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  if (body.lyrics!.length > 5000) {
    return new Response(
      JSON.stringify({ error: 'lyrics_too_long', message: 'lyrics must be at most 5000 characters.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const language = (body.language || 'es').toLowerCase();
  const vocalGender = body.vocal_gender === 'm' || body.vocal_gender === 'f' ? body.vocal_gender : undefined;

  // ---------------- look up voice_sample + refresh signed URL ----------------
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

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
    console.error('[generate-cloned-voice-song] createSignedUrl failed:', signed.error);
    return new Response(
      JSON.stringify({
        error: 'signed_url_failed',
        message: signed.error?.message || 'Could not create a fetchable URL for the voice sample.',
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const voicePublicUrl = signed.data.signedUrl;

  // ---------------- insert cloned_voice_songs row ----------------
  const { data: songRow, error: insertError } = await supabase
    .from('cloned_voice_songs')
    .insert({
      voice_sample_id: voiceRow.id,
      customer_email: body.customer_email || null,
      recipient_name: body.recipient_name!.trim(),
      occasion: body.occasion!.trim(),
      relationship: body.relationship!.trim(),
      story: body.story!.trim(),
      genre_slug: genreSlug,
      language,
      title: body.title?.trim() || null,
      lyrics: body.lyrics!,
      emotional_modifiers: body.emotional_modifiers || null,
      lyrics_model_used: body.lyrics_model_used || null,
      status: 'generating_song',
    })
    .select('id, created_at')
    .single();

  if (insertError || !songRow) {
    console.error('[generate-cloned-voice-song] DB insert failed:', insertError);
    return new Response(
      JSON.stringify({
        error: 'db_insert_failed',
        message: insertError?.message || 'Could not record the song order.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const clonedVoiceSongId: string = songRow.id;

  // ---------------- call Kie.ai upload-cover ----------------
  const kiePayload = {
    uploadUrl: voicePublicUrl,
    prompt: body.lyrics!,
    customMode: true,
    instrumental: false,
    model: SUNO_MODEL,
    style: styleString,
    title: (body.title || `cancion-${clonedVoiceSongId.slice(0, 8)}`).slice(0, 80),
    negativeTags: NEGATIVE_TAGS,
    styleWeight: STYLE_WEIGHT,
    audioWeight: AUDIO_WEIGHT,
    weirdnessConstraint: WEIRDNESS_CONSTRAINT,
    callBackUrl: KIE_CALLBACK_URL,
    ...(vocalGender ? { vocalGender } : {}),
  };

  let kieResp: Response;
  try {
    kieResp = await fetch('https://api.kie.ai/api/v1/generate/upload-cover', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(kiePayload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[generate-cloned-voice-song] Kie network error:', msg);
    await supabase
      .from('cloned_voice_songs')
      .update({ status: 'failed', error_message: `Network error contacting Kie.ai: ${msg}` })
      .eq('id', clonedVoiceSongId);
    return new Response(
      JSON.stringify({ error: 'kie_network_error', message: msg, cloned_voice_song_id: clonedVoiceSongId }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const kieData = await kieResp.json().catch(() => null);

  if (!kieResp.ok || !kieData || kieData.code !== 200) {
    const errMsg = `Kie returned ${kieResp.status}: ${kieData?.msg || JSON.stringify(kieData)?.slice(0, 200)}`;
    console.error('[generate-cloned-voice-song] Kie API error:', errMsg);
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

  const kieTaskId: string | undefined = kieData?.data?.taskId;
  if (!kieTaskId) {
    console.error('[generate-cloned-voice-song] Kie returned 200 but no taskId:', kieData);
    await supabase
      .from('cloned_voice_songs')
      .update({ status: 'failed', error_message: 'Kie returned no taskId.' })
      .eq('id', clonedVoiceSongId);
    return new Response(
      JSON.stringify({ error: 'kie_no_task_id', message: 'Kie did not return a taskId.', cloned_voice_song_id: clonedVoiceSongId }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Persist the taskId so the polling endpoint can find this row by taskId.
  const { error: updateError } = await supabase
    .from('cloned_voice_songs')
    .update({ kie_task_id: kieTaskId })
    .eq('id', clonedVoiceSongId);

  if (updateError) {
    console.warn('[generate-cloned-voice-song] Could not persist kie_task_id (non-fatal):', updateError);
    // Non-fatal — the job is running; the frontend has the id from our response.
  }

  return new Response(
    JSON.stringify({
      cloned_voice_song_id: clonedVoiceSongId,
      kie_task_id: kieTaskId,
      status: 'generating_song',
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
