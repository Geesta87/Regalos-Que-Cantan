// supabase/functions/regenerate-paid-song-kie/index.ts
//
// Targeted, in-place re-generation of an ALREADY-PAID song pair through
// Kie.ai (Suno) ONLY — used when a customer asks for a small lyric/detail
// edit (e.g. a wrong year) after their song was generated on the Suno
// fallback. Unlike recover-mureka-cap-songs (which picks failed candidates,
// inserts a NEW v2, and emails a "buy for $29.99" preview), this function:
//
//   • edits the two EXISTING rows in place (v1 + v2), preserving paid /
//     paid_at / stripe_session_id / version, so the customer's existing
//     /song/<id> link simply starts playing the corrected song;
//   • sends NO email (the built-in preview email is a buy-prompt, wrong for
//     a paying customer) — the owner reviews the result and notifies the
//     customer separately;
//   • re-uses the proven submitToKie + pollKieUntilDone flow from
//     recover-mureka-cap-songs, plus the gender-prefix / negative-tag /
//     styleWeight tuning from generate-song's callKieProvider so the
//     corrected re-run matches how the original paid song was produced.
//
// Body: { v1Id, v2Id, lyrics, details? }  (lyrics already corrected by caller)
//   - track[0] -> v1Id (version 1), track[1] -> v2Id (version 2)
//
// Invoked manually from admin/CLI (no user JWT) — verify_jwt = false, called
// with the anon/publishable key as Bearer. KIE_API_KEY only exists in the
// edge runtime, which is why this runs as a function rather than a script.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
// V5_5 only — V4_5 failed the 2026-06-12 regional-Mexican bake-off.
const KIE_MODEL = Deno.env.get('KIE_MODEL') || 'V5_5';

// Strip the inline English prosody cue (e.g. "(spoken, no melody, …)") that the
// genre prompts inject on [Hablado] lines. Suno/Mureka treat any parenthetical
// as content and sing it aloud — most audibly at the start of corridos. Legacy
// songs stored before generate-song was fixed still carry the cue, so scrub it
// on regeneration too. Mirrors generate-song's stripSpokenProsodyCue.
function stripSpokenProsodyCue(lyrics: string): string {
  if (!lyrics) return lyrics;
  return lyrics
    .replace(/[ \t]*\(\s*spoken[^)]*\)/gi, '')
    // Drop leaked lowercase fill-in placeholders ([lugar], [nombre], …); real
    // section markers are always capitalized, so a lowercase bracket is an
    // instruction artifact the model would otherwise sing. Mirrors generate-song.
    .replace(/[ \t]*\[[a-záéíóúñ][^\]]*\]/g, '')
    .replace(/[ \t]+$/gm, '');
}

// Translate Spanish section markers so Suno recognizes the structure — same
// mapping generate-song applies before sending to Kie.
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

interface KieTrack {
  id?: string;
  audioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  modelName?: string;
}

// Mirrors generate-song's callKieProvider payload (gender prefix at the front
// of the style for positional priority, opposite-gender negatives, and the
// styleWeight/weirdness/audioWeight tuning) so the corrected re-run sounds like
// the original paid generation rather than the leaner recover-* path.
async function submitToKie(
  lyrics: string,
  title: string,
  styleUsed: string,
  voiceType: string,
  callbackUrl: string,
): Promise<{ taskId: string; styleSent: string }> {
  const vocalGender: 'm' | 'f' = voiceType === 'female' ? 'f' : 'm';
  const genderLabel = vocalGender === 'f'
    ? 'solo female vocalist, female voice'
    : 'solo male vocalist, male voice, masculine vocal';
  const oppositeGenderTags = vocalGender === 'f'
    ? 'male voice, male vocal, baritone, bass voice, deep male voice'
    : 'female voice, female vocal, soprano, female harmony, high female voice';

  // Suno is English-trained and non-deterministic — some takes drift into
  // English ad-libs / English-accented vocals even with all-Spanish lyrics.
  // The site is Spanish-only, so pin the language hard: reinforce in the style
  // AND block English explicitly in the negatives.
  const languageTags = 'Spanish-language vocals, sung entirely in Spanish, letra completamente en español, Mexican Spanish pronunciation';
  const englishNegatives = 'English lyrics, English language, English vocals, English words, spoken English, English ad-libs';

  const style = `${genderLabel}, ${languageTags}, ${styleUsed}`.substring(0, 1000);
  const safeLyrics = englishifyLyricsMarkers(lyrics).substring(0, 5000);

  const payload: Record<string, unknown> = {
    prompt: safeLyrics,
    customMode: true,
    instrumental: false,
    model: KIE_MODEL,
    callBackUrl: callbackUrl,
    style,
    title: title.substring(0, 80),
    vocalGender,
    negativeTags: `${oppositeGenderTags}, ${englishNegatives}`.substring(0, 200),
    styleWeight: 0.85,
    weirdnessConstraint: 0.3,
    audioWeight: 0.7,
  };

  const resp = await fetch('https://api.kie.ai/api/v1/generate', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'unknown');
    throw new Error(`kie.ai generate ${resp.status}: ${errText.substring(0, 200)}`);
  }
  const data = await resp.json();
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`kie.ai code=${data.code}: ${data.msg || 'no taskId'}`);
  }
  return { taskId: data.data.taskId, styleSent: style };
}

async function pollKieUntilDone(taskId: string, maxAttempts = 24, intervalMs = 8000): Promise<KieTrack[]> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
      headers: { 'Authorization': `Bearer ${KIE_API_KEY}` },
    });
    if (!resp.ok) {
      console.warn(`Poll ${attempt}/${maxAttempts}: HTTP ${resp.status}`);
    } else {
      const json = await resp.json();
      const status = json?.data?.status;
      const tracks: KieTrack[] = json?.data?.response?.sunoData ?? [];
      console.log(`Poll ${attempt}/${maxAttempts}: status=${status}, tracks=${tracks.length}`);

      if (status === 'SUCCESS') return tracks;

      if (status === 'GENERATE_AUDIO_FAILED' || status === 'CREATE_TASK_FAILED' || status === 'SENSITIVE_WORD_ERROR' || status === 'CALLBACK_EXCEPTION') {
        throw new Error(`kie.ai task ${taskId} ended in status ${status}`);
      }
    }
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`kie.ai task ${taskId} did not complete within ${(maxAttempts * intervalMs) / 1000}s`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    if (!KIE_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'KIE_API_KEY env var missing on Supabase' }),
        { headers: responseHeaders, status: 200 });
    }

    const body = await req.json().catch(() => ({}));
    const v1Id: string | undefined = body?.v1Id;
    const v2Id: string | undefined = body?.v2Id;
    const lyrics: string | undefined = body?.lyrics;
    const details: string | undefined = body?.details;

    if (!v1Id || !lyrics) {
      return new Response(JSON.stringify({ ok: false, error: 'v1Id and lyrics are required' }),
        { headers: responseHeaders, status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Load the v1 row for style / voice / metadata ----
    const { data: v1, error: v1Err } = await supabase
      .from('songs')
      .select('id, recipient_name, voice_type, style_used, regenerate_count, image_url, paid')
      .eq('id', v1Id)
      .single();
    if (v1Err || !v1) {
      return new Response(JSON.stringify({ ok: false, error: `v1 lookup failed: ${v1Err?.message || 'not found'}` }),
        { headers: responseHeaders, status: 200 });
    }
    if (!v1.style_used) {
      return new Response(JSON.stringify({ ok: false, error: 'v1 row is missing style_used' }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- Persist the corrected lyrics (+ details) on both rows up front ----
    const lyricEdit: Record<string, unknown> = { lyrics };
    if (typeof details === 'string') lyricEdit.details = details;
    await supabase.from('songs').update(lyricEdit).eq('id', v1Id);
    if (v2Id) await supabase.from('songs').update(lyricEdit).eq('id', v2Id);

    // ---- Submit to Kie / Suno ----
    const title = `Canción para ${v1.recipient_name || 'ti'}`;
    const callbackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;
    const { taskId, styleSent } = await submitToKie(lyrics, title, v1.style_used, v1.voice_type, callbackUrl);
    console.log(`[REGEN] Kie taskId: ${taskId} for v1=${v1Id} v2=${v2Id ?? 'none'}`);

    // ---- Poll until done ----
    const tracks = await pollKieUntilDone(taskId);
    const track1 = tracks[0];
    const track2 = tracks[1];

    if (!track1?.audioUrl) {
      return new Response(JSON.stringify({ ok: false, taskId, error: 'no audioUrl in track[0]' }),
        { headers: responseHeaders, status: 200 });
    }

    const newRegenCount = (v1.regenerate_count || 0) + 1;

    // ---- Swap v1 audio in place (preserve paid / version / stripe link) ----
    const { error: u1 } = await supabase.from('songs').update({
      audio_url: track1.audioUrl,
      preview_url: track1.audioUrl,
      original_audio_url: track1.audioUrl,
      ...(track1.imageUrl ? { image_url: track1.imageUrl } : {}),
      status: 'completed',
      needs_reupload: true,
      kie_task_id: taskId,
      task_id: taskId,
      kie_payload: JSON.stringify(track1),
      provider: 'kie',
      error_message: null,
      regenerate_count: newRegenCount,
    }).eq('id', v1Id);
    if (u1) {
      return new Response(JSON.stringify({ ok: false, taskId, error: `v1 update failed: ${u1.message}` }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- Swap v2 audio in place (if a v2 row + a second track exist) ----
    let v2Updated = false;
    if (v2Id && track2?.audioUrl) {
      const { error: u2 } = await supabase.from('songs').update({
        audio_url: track2.audioUrl,
        preview_url: track2.audioUrl,
        original_audio_url: track2.audioUrl,
        ...(track2.imageUrl ? { image_url: track2.imageUrl } : {}),
        status: 'completed',
        needs_reupload: true,
        kie_task_id: taskId,
        task_id: taskId,
        kie_payload: JSON.stringify(track2),
        provider: 'kie',
        error_message: null,
        regenerate_count: newRegenCount,
      }).eq('id', v2Id);
      if (u2) console.warn(`[REGEN] v2 update failed: ${u2.message}`);
      else v2Updated = true;
    }

    return new Response(JSON.stringify({
      ok: true,
      taskId,
      styleSent,
      v1Id,
      v1Url: track1.audioUrl,
      v2Id: v2Id ?? null,
      v2Url: v2Updated ? track2?.audioUrl : null,
      v2Updated,
      songLink: `https://regalosquecantan.com/song/${v1Id}`,
      tracksReturned: tracks.length,
    }), { headers: responseHeaders, status: 200 });

  } catch (e: any) {
    console.error('[REGEN] error:', e?.message);
    return new Response(JSON.stringify({ ok: false, error: e?.message }),
      { headers: responseHeaders, status: 200 });
  }
});
