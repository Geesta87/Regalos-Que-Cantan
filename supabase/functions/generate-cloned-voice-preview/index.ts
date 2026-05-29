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
//     genre_slug:            'romantico|balada|banda|corrido|ranchera|mariachi',
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

// Genre style strings — TRIMMED to instrumentation only. Must match
// generate-cloned-voice-song so the preview accurately represents what
// the full song will sound like. See song function for the rationale
// (vocal-style directives were drowning out the cloned voice).
// ---------------------------------------------------------------------------
// Genre catalog — KEEP IN SYNC with the identically-named object in
// supabase/functions/generate-cloned-voice-song/index.ts. If you add a slug
// or change a style/negativeTags here, copy the same change there. Otherwise
// the preview and the full song will be generated with different prompts and
// the customer will pay $69 for a song that sounds nothing like the preview.
// See the song-generator file for the full documentation of why these
// strings are what they are.
// ---------------------------------------------------------------------------
interface GenreStyle {
  style: string;
  negativeTags: string;
}

// Kie.ai 1000-char cap on `style` — see generate-cloned-voice-song for full
// documentation. Keep each style string under ~950 chars (safety margin).
const GENRES: Record<string, GenreStyle> = {
  romantico: {
    style:
      'intimate romantic Latin ballad, acoustic-forward dedication song, wedding-ceremony quality, candlelit intimacy, vocal-forward. ' +
      'Instruments: nylon acoustic guitar primary with fingerpicked arpeggios, soft grand piano with sustained voicings, gentle string quartet pads, minimal or no percussion in verses, upright bass sustained whole notes, optional flute or oboe answering melody in breaks. ' +
      'Tempo: 65-85 BPM intimate ballad pace, breathing room between phrases, heartbeat rhythm. ' +
      'Vibe: deep romantic confession, eternal love vow, proposal moment warmth, wedding first dance, forever love. ' +
      'Mix: clean modern production, vocal-forward, warm acoustic presence, subtle tasteful reverb.',
    negativeTags:
      'party music, fast dance, aggressive sounds, electronic production, brass-heavy banda, trap beats, 808 bass, EDM, rock distortion, reggaeton, uptempo',
  },

  balada: {
    style:
      'classic orchestral Latin ballad, grand 1970s-80s ballad en español, dramatic crooner-style Latin ballad with cinematic orchestra, telenovela-climax cinematic love song. ' +
      'Instruments: full string orchestra with sweeping legato as central emotional engine, grand piano with sustained voicings and arpeggiated fills, soft timpani at dramatic transitions, harp arpeggios on choruses, french horn warmth, flute or oboe answering melodies, brushed drums on later choruses, full orchestral crescendo into final chorus. ' +
      'Tempo: 60-80 BPM very slow, dramatic pauses, rubato phrasing, grand theatrical pacing. ' +
      'Vibe: grand romantic gestures, theatrical tearjerker, telenovela climax, standing ovation, golden-age Latin drama. ' +
      'Mix: cinematic orchestral production, wide stereo strings, vocal centered, lush concert-hall reverb.',
    negativeTags:
      'fast rhythms, electronic beats, rock guitars, trap, party music, uptempo dance, modern urban, lo-fi, hip-hop, EDM, reggaeton, banda brass, mariachi instrumentation',
  },

  banda: {
    style:
      'classic banda sinaloense, traditional Sinaloa brass band, authentic 15-piece banda, ceremonial Mexican banda, golden-age recording quality, banda for romantic dedication. ' +
      'Instruments: full 15+ piece brass — trumpet section playing fanfare lines and harmonized melodies, trombone section providing midrange counter-lines, clarinet section playing high ornamental runs, sousaphone or tuba driving oom-pah quarter-note bass pulse, tarola snare backbeat with rolls into choruses, tambora rhythmic foundation. ' +
      'Tempo: 90-110 BPM moderate, 2/4 polka-derived feel, festive but not breakneck. ' +
      'Vibe: authentic Sinaloa pride, timeless festive elegance, classic polish, Mexican brass band heritage, plaza fiesta. ' +
      'Mix: live-band brass presence, midrange-forward, audible tuba on every quarter, tarola crisp, vocal cleanly above brass.',
    negativeTags:
      'lo-fi production, trap beats, 808 bass, electronic sounds, rock guitars, modern urban beats, slow ballads only, quebradita pace, sad sierreño, corridos tumbados, EDM, synth pads, autotune',
  },

  corrido: {
    style:
      'authentic 1990s Sinaloa corrido, pure rural rancho corrido from Sierra de Sinaloa, narrative balladeer storytelling, accordion-and-bajo-sexto with slapped tololoche oom-pah, cassette direct-to-tape aesthetic. ' +
      'Instruments: diatonic 3-row button accordion as sole melodic lead with TREBLY reedy midrange timbre, accordion fills with grace notes and scalar runs, bajo sexto 12-string percussive downstrokes on roots and fifths, TOLOLOCHE upright bass with prominent SLAP technique driving the oom-pah pattern, optional requinto sierreño for ornaments, sparse or no drums. ' +
      'Tempo: 85-105 BPM deliberate storytelling pace, 2/4 polka pulse with tololoche slap, never rushed. ' +
      'Vibe: rural Sinaloa rancho 1990s, Culiacán cantina midnight, weathered balladeer, bone-dry vintage mix, raw 90s production. ' +
      'Mix: dry mic placement, mono or narrow stereo, present accordion midrange, audible tololoche slap, no doubling, no compression pumping.',
    negativeTags:
      'modern 2010s 2020s corrido production, slick radio polish, full drum kit, snare-heavy modern kit, electric bass guitar, saxophone, brass section, trumpets, full banda brass, mariachi violins, strings, trap beats, 808 bass, autotune, heavy reverb, vocal doubling, corridos tumbados, corridos alterados, sierreño melancholy, synthesizers, cumbia, EDM',
  },

  ranchera: {
    style:
      'slow dramatic ranchera ballad, emotional Mexican ranchera, golden-age ranchera tradition, mariachi-backed serenata ranchera for romantic dedication, theatrical sustained instrumental phrasing. ' +
      'Instruments: mariachi violin section with sustained emotional legato bowing, trumpet fanfare between verses then soft sustained notes during vocal lines, vihuela gentle strumming, guitarrón deep bass on beats 1 and 3, classical guitar arpeggios, optional harp arpeggios on choruses. ' +
      'Tempo: 50-70 BPM very slow, dramatic pauses, rubato phrasing, ballad with generous breathing room. ' +
      'Vibe: deep sorrow or deep love, dramatic heartbreak, crying-in-your-drink cantina emotion, tearful dedication, tequila and tears, mariachi at 3am. ' +
      'Mix: live mariachi room sound, violins front and center, guitarrón warm in low end, vocal up-front and clear.',
    negativeTags:
      'upbeat rhythms, electronic beats, happy party vibes, trap, fast tempo, dance energy, modern urban, rock, EDM, banda brass dominance, autotune, hip-hop, reggaeton, synth pads',
  },

  mariachi: {
    style:
      'romantic mariachi ballad, serenata mariachi, soft tender mariachi love song, moonlit serenade, violin-led romantic mariachi, intimate courtship mariachi, classic Mexican romantic mariachi. ' +
      'Instruments: violin section prominent with sustained legato bowing and vibrato carrying melodic answers to vocal phrases, soft muted trumpets playing gentle sustained notes (never blaring fanfares), delicate guitarrón bass on roots and fifths, vihuela soft arpeggios, classical guitar fingerpicking, optional cello sustained warmth. ' +
      'Tempo: 60-80 BPM slow tender pace, breathing room between phrases, serenata tempo. ' +
      'Vibe: serenata under the balcony, moonlit courtship, deep vulnerable romance, tearful dedications, wedding first dance, proposal moment, roses and candles. ' +
      'Mix: warm ensemble live-feel room sound, violins front-of-stage, vocal up-front and intimate, gentle small-venue reverb.',
    negativeTags:
      'fast dance, brass-heavy banda, aggressive sounds, uptempo party, electronic production, trap, rock, EDM, quebradita pace, hip-hop, autotune, modern urban beats, K-pop',
  },

  pop_ballad_en: {
    style:
      'modern English pop ballad, contemporary radio-ready pop ballad, intimate emotional pop ballad in the style of Ed Sheeran, Sam Smith, Lewis Capaldi, Adele ballads, piano-driven, vocal-forward dedication. ' +
      'Instruments: grand piano as primary harmonic engine with sustained voicings and arpeggiated fills, soft fingerpicked acoustic guitar doubling the piano, lush string pad swells building on each chorus, gentle programmed kick on backbeat or no drums in verses, subtle bass holding root notes, optional cello warmth in low-mid, light reverb-tail effects. ' +
      'Tempo: 70-90 BPM modern emotional ballad pace, breathing room between phrases. ' +
      'Vibe: intimate dedication, wedding first dance, gut-punch emotional climax, candlelit confession, modern Spotify-playlist heartfelt. ' +
      'Mix: clean modern studio production, vocal-forward, wide stereo strings on chorus, tight tasteful reverb.',
    negativeTags:
      'trap beats, 808 bass, autotune-heavy, EDM drops, fast dance, aggressive rock distortion, dubstep, hip-hop production, mariachi, banda brass, country pedal steel, reggaeton',
  },

  country_en: {
    style:
      'modern country ballad, contemporary Nashville country dedication in the style of Luke Combs, Chris Stapleton, Tim McGraw, Lady A ballads, heartfelt country love ballad, acoustic-forward with pedal steel, Americana-leaning radio country. ' +
      'Instruments: fingerpicked acoustic guitar primary as rhythmic foundation, pedal steel with sustained crying bends carrying emotional answers, gentle brushed snare on backbeat and warm kick, warm fretless or upright bass walking lines, optional fiddle answering melody in breaks, harmonica on bridges, dobro slide guitar under vocal. ' +
      'Tempo: 75-95 BPM modern country mid-tempo ballad pace. ' +
      'Vibe: heartfelt small-town love story, front porch confession, wedding song, dirt road dedication, country radio heartfelt, faith and family warmth. ' +
      'Mix: clean Nashville studio sheen, warm midrange, vocal up-front, pedal steel just behind vocal, tasteful room reverb.',
    negativeTags:
      'trap beats, 808 bass, EDM, autotune-heavy, mariachi, banda brass, reggaeton, dubstep, hip-hop, electronic dance, K-pop, heavy rock distortion, synthwave',
  },

  rnb_soul_en: {
    style:
      'smooth modern R&B soul ballad, contemporary slow-jam R&B in the style of John Legend, H.E.R., Daniel Caesar, Anderson .Paak ballads, neo-soul love dedication, warm soulful R&B. ' +
      'Instruments: warm Rhodes electric piano with sustained voicings and subtle tremolo, soft groove drums with brushed-feel kick and snare and tasteful hi-hat shuffle, melodic fingered bass with sliding fills and walking turnarounds, subtle horn pads sustained beneath rhythm section, occasional Rhodes lead fills between vocal phrases, gentle clean electric guitar single-note licks, optional muted trumpet accent. ' +
      'Tempo: 70-90 BPM slow-jam R&B pace, sensual groove. ' +
      'Vibe: candlelit intimate confession, slow-dance soul, neo-soul warmth, late-night dedication, sensual heartfelt R&B groove. ' +
      'Mix: warm analog-leaning production, vocal-forward, lush low-mid presence on Rhodes, tasteful pocket groove.',
    negativeTags:
      'trap beats, mariachi, banda brass, country fiddle, country pedal steel, hardcore hip-hop, autotune-heavy, EDM, dubstep, rock distortion, fast dance, K-pop, reggaeton, heavy 808',
  },

  acoustic_singer_en: {
    style:
      'intimate acoustic singer-songwriter ballad, sparse minimal solo acoustic dedication, raw honest acoustic confession ballad, vocal-forward acoustic ballad in the style of Phoebe Bridgers, Ben Howard, Damien Rice, Bon Iver acoustic moments. ' +
      'Instruments: single fingerpicked acoustic guitar as primary and often only instrument, optional light brushed snare (no full drum kit), no drums in verses, subtle upright bass sustained notes, optional cello sustained warmth or single sustained violin pad, room ambience and natural microphone bleed. ' +
      'Tempo: 65-85 BPM intimate confessional pace, generous breathing room between phrases. ' +
      'Vibe: stripped-down emotional confession, candlelit dedication, intimate room recording, raw honest vulnerability, modern indie folk warmth, wedding ceremony acoustic. ' +
      'Mix: dry acoustic intimacy, vocal up-front and very present, minimal reverb (just natural room), close and intimate.',
    negativeTags:
      'trap, EDM, banda brass, mariachi, full band production, heavy drums, dance beats, autotune, electronic, K-pop, hip-hop, reggaeton, rock distortion, dubstep, heavy 808',
  },
};

// Sanity guard — see generate-cloned-voice-song for explanation.
const KIE_STYLE_MAX = 1000;
for (const [slug, g] of Object.entries(GENRES)) {
  if (g.style.length > KIE_STYLE_MAX) {
    console.error(
      `[generate-cloned-voice-preview] FATAL: genre "${slug}" style is ${g.style.length} chars, exceeds Kie cap of ${KIE_STYLE_MAX}`
    );
  }
}

// Legacy mapping for any caller still expecting a string-only map.
const GENRE_STYLES: Record<string, string> = Object.fromEntries(
  Object.entries(GENRES).map(([slug, g]) => [slug, g.style])
);

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
  const genre = GENRES[genreSlug];
  if (!genre) {
    return new Response(
      JSON.stringify({
        error: 'invalid_genre',
        message: `genre_slug must be one of: ${Object.keys(GENRES).join(', ')}`,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  const styleString = genre.style;
  // Combined voice-clone-protection + per-genre musical negatives.
  const negativeTagsCombined = `${NEGATIVE_TAGS}, ${genre.negativeTags}`;
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

  const kiePayload = {
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
    kieResp = await fetch('https://api.kie.ai/api/v1/generate/upload-cover', {
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
