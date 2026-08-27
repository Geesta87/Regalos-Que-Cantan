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

// Kie.ai (Suno) enforces a HARD 200-character cap on the `negativeTags` field.
// The combined voice-clone-protection negatives (NEGATIVE_TAGS) + each genre's
// musical negatives blow past it for EVERY genre (219-419 chars). When that
// happens Kie returns HTTP 200 with the body
// "the length of music negativeTags cannot exceed 200 characters" and the
// generation fails. Cap the combined list at 200 chars, keeping the
// clone-protection tags (top priority for a voice product, and always < 200)
// and dropping trailing genre tags at a comma boundary so we never ship a
// half-written tag. KEEP IN SYNC with generate-cloned-voice-preview.
const KIE_NEGATIVE_TAGS_MAX = 200;
function capNegativeTags(combined: string): string {
  if (combined.length <= KIE_NEGATIVE_TAGS_MAX) return combined;
  const truncated = combined.slice(0, KIE_NEGATIVE_TAGS_MAX);
  const lastComma = truncated.lastIndexOf(',');
  return (lastComma > 0 ? truncated.slice(0, lastComma) : truncated).trim();
}

// Lyrics arrive from generate-cloned-voice-lyrics with SPANISH section markers
// ([Verso 1], [Coro], [Puente], …) regardless of the lyric language. Suno is
// English-trained and sings unrecognized Spanish markers literally (or blurs
// the section boundary), so translate them to the English equivalents before
// submitting — exactly what generate-song does on its provider path. Also strip
// any leaked instruction artifact (an English "(spoken, …)" cue, or a lowercase
// fill-in placeholder like [lugar]) that the model would otherwise vocalize.
// KEEP IN SYNC with generate-song's stripSpokenProsodyCue + englishifyLyricsMarkers.
function stripSpokenProsodyCue(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/[ \t]*\(\s*spoken[^)]*\)/gi, '')
    .replace(/[ \t]*\[[a-záéíóúñ][^\]]*\]/g, '')
    .replace(/[ \t]+$/gm, '');
}
function englishifyLyricsMarkers(lyrics: string): string {
  if (!lyrics) return lyrics;
  return stripSpokenProsodyCue(lyrics)
    .replace(/\[Verso Final\]/gi, '[Final Verse]')
    .replace(/\[Verso (\d+)\]/gi, '[Verse $1]')
    .replace(/\[Verso\]/gi, '[Verse]')
    .replace(/\[Coro Final\]/gi, '[Final Chorus]')
    .replace(/\[Coro\]/gi, '[Chorus]')
    .replace(/\[Puente\]/gi, '[Bridge]')
    .replace(/\[Pre-Coro\]/gi, '[Pre-Chorus]')
    .replace(/\[Hablado\]/gi, '[Spoken Word]');
}

// Genre catalog — moved to _shared/clonamivoz-genres.ts on 2026-08-27 so
// this function, generate-cloned-voice-preview, and
// generate-cloned-voice-lyrics can never drift apart again (the old
// three-copy setup is how the English genres shipped without lyric hints).
// Styles remain INSTRUMENTATION-ONLY — vocal directives fight the cloned
// voice; see the shared module's header for the full rules.
assertStyleLengths('generate-cloned-voice-song');


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

  // When the caller already has a cloned_voice_songs row (the Stripe
  // webhook or the testing-bypass path, both of which create a row at
  // preview time and then mark it paid), they pass the existing id and
  // we UPDATE that row instead of inserting a duplicate. Without this,
  // the song generator creates a second row with the kie_task_id while
  // the frontend keeps polling the first row — which never gets the
  // kie_task_id — and the customer times out waiting.
  cloned_voice_song_id?: string;

  // Suno Voice engine (2026-08-08): Kie voice-creation TASK ID from
  // clonamivoz-voice-enroll — doubles as the personaId for
  // /api/v1/generate. Usually NOT passed by the webhook/bypass callers;
  // when absent we read it off the existing row (the preview stored it),
  // so the paid song is guaranteed to use the same voice the customer
  // heard in the preview. Absent everywhere → legacy upload-cover.
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
  // Combine the always-on voice-clone-protection negatives with the
  // genre-specific musical negatives. Suno accepts a long comma-separated
  // list here.
  const negativeTagsCombined = capNegativeTags(`${NEGATIVE_TAGS}, ${genre.negativeTags}`);
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

  // ---------------- upsert cloned_voice_songs row ----------------
  // If the caller passed an existing cloned_voice_song_id (Stripe webhook
  // or testing bypass), UPDATE that row. Otherwise (direct frontend call),
  // INSERT a new one. This prevents the duplicate-row bug where the song
  // generator was always inserting a fresh row, leaving the original
  // (paid) row stuck without a kie_task_id and the frontend polling
  // forever.
  const songFields = {
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
    // Only set when explicitly provided — an UPDATE must never wipe the
    // voice_task_id the preview stored on the row.
    ...(body.voice_task_id ? { voice_task_id: body.voice_task_id } : {}),
  };

  let clonedVoiceSongId: string;
  // Engine selection: explicit body param wins; otherwise the existing
  // row's voice_task_id (stored at preview time). Stays null → legacy
  // upload-cover engine, exactly as before 2026-08-08.
  let voiceTaskId: string | null = body.voice_task_id || null;
  if (body.cloned_voice_song_id) {
    const { data: updatedRow, error: updateError } = await supabase
      .from('cloned_voice_songs')
      .update(songFields)
      .eq('id', body.cloned_voice_song_id)
      .select('id, voice_task_id')
      .single();
    if (updateError || !updatedRow) {
      console.error('[generate-cloned-voice-song] DB update failed:', updateError);
      return new Response(
        JSON.stringify({
          error: 'db_update_failed',
          message: updateError?.message || 'Could not update the song order.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    clonedVoiceSongId = updatedRow.id;
    if (!voiceTaskId && updatedRow.voice_task_id) voiceTaskId = updatedRow.voice_task_id;
  } else {
    const { data: songRow, error: insertError } = await supabase
      .from('cloned_voice_songs')
      .insert(songFields)
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
    clonedVoiceSongId = songRow.id;
  }

  // ---------------- call Kie.ai (persona engine or upload-cover) ----------------
  // Suno Voice engine (2026-08-08): with an enrolled voice, use
  // /api/v1/generate + personaId (= the Kie voice-creation task id). The
  // cover-tuning knobs (styleWeight/audioWeight/weirdness) and uploadUrl
  // are upload-cover-only and must NOT be sent on the persona path.
  const kieEndpoint = voiceTaskId
    ? 'https://api.kie.ai/api/v1/generate'
    : 'https://api.kie.ai/api/v1/generate/upload-cover';
  const kiePayload = voiceTaskId
    ? {
        personaId: voiceTaskId,
        prompt: englishifyLyricsMarkers(body.lyrics!),
        customMode: true,
        instrumental: false,
        model: SUNO_MODEL,
        style: styleString,
        title: (body.title || `cancion-${clonedVoiceSongId.slice(0, 8)}`).slice(0, 80),
        negativeTags: negativeTagsCombined,
        callBackUrl: KIE_CALLBACK_URL,
        ...(vocalGender ? { vocalGender } : {}),
      }
    : {
        uploadUrl: voicePublicUrl,
        prompt: englishifyLyricsMarkers(body.lyrics!),
        customMode: true,
        instrumental: false,
        model: SUNO_MODEL,
        style: styleString,
        // Combined voice-clone protections + per-genre musical rejections.
        title: (body.title || `cancion-${clonedVoiceSongId.slice(0, 8)}`).slice(0, 80),
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
