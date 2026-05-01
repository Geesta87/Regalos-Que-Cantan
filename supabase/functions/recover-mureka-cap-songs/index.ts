// supabase/functions/recover-mureka-cap-songs/index.ts
// One-shot recovery for songs that failed during the 2026-05-01 Mureka quota-cap outage.
// Resubmits via Kie.ai (Suno V4_5) and sends an apology email with the preview link.
//
// Invocation: POST with optional ?songId=<uuid> to force a specific row, or ?dryRun=1
// to see who would be processed without acting. Without songId, picks the most recent
// failed row per (lower(email), recipient_name) that hasn't already been recovered.
//
// Idempotent — skips customers who already have a completed song after the outage start.
// Processes ONE customer per invocation. Caller loops until remaining=0.
//
// Deploy with: supabase functions deploy recover-mureka-cap-songs --project-ref yzbvajungshqcpusfiia

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const KIE_MODEL = Deno.env.get('KIE_MODEL') || 'V4_5';
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

// Mureka quota cap began at ~14:04 UTC on 2026-05-01. Window upper-bound left open.
const OUTAGE_START = '2026-05-01 14:00:00+00';

// ---------------------------------------------------------------------------
// APOLOGY EMAIL — adapted from recover-outage-songs (2026-04-26 outage)
// ---------------------------------------------------------------------------

function getApologyEmailHtml(song: any, previewLink: string) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const recipient = song.recipient_name || 'tu ser querido';
  const songTitle = `Canción para ${recipient}`;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Righteous&family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#1a0e08;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;padding:0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1a0e08;">

        <tr><td style="background:linear-gradient(135deg,#3a1d10 0%,#2a1408 100%);padding:24px 30px;text-align:center;border-bottom:2px solid #ff6b35;">
          <p style="color:#ffd23f;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">&iexcl;Disc&uacute;lpanos!</p>
          <p style="color:#ffffff;font-size:15px;line-height:1.6;margin:0;">Tuvimos un problema t&eacute;cnico que ya est&aacute; resuelto.<br>Tu canci&oacute;n para <strong style="color:#ffd23f;">${recipient}</strong> ya est&aacute; lista para escuchar.</p>
        </td></tr>

        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:40px 30px 30px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 16px;">&#10024; TU REGALO TE EST&Aacute; ESPERANDO &#10024;</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:34px;margin:0 0 4px;font-weight:400;">Hola, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:30px;margin:0 0 20px;font-weight:400;">Tu canci&oacute;n ya <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">est&aacute; viva.</span></h2>
          <p style="color:#c9b99a;font-size:15px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo est&aacute; listo.<br>Haz clic abajo para escucharla.</p>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="${previewLink}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127925; Escuchar Mi Canci&oacute;n
          </a>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#127873; Tu canci&oacute;n est&aacute; guardada y lista para preview &middot; Sin compromiso</p>
        </td></tr>

        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td style="background-color:#1a0e08;padding:30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">PREVIA</p>
              </td>
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">TU CANCI&Oacute;N PERSONALIZADA</p>
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0;">Hecha con amor para <strong style="color:#ffd23f;">${recipient}</strong> &middot; Estilo: <span style="text-transform:capitalize;">${song.genre || 'Musical'}</span></p>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gusta? Compra la canci&oacute;n completa por solo <strong style="color:#ff6b35;">$29.99 USD</strong></p>
        </td></tr>

        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td style="background-color:#1a0e08;padding:30px;text-align:center;">
          <p style="color:#a67c52;font-size:12px;margin:0 0 10px;">Gracias por tu paciencia. Si tienes preguntas escr&iacute;benos a<br>
            <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a>
          </p>
          <p style="color:#4a2c1a;font-size:11px;margin:0;">&copy; 2026 Regalos Que Cantan. Hecho con &#10084;&#65039; para ti.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendApologyEmail(to: string, recipientName: string, song: any, previewLink: string) {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set — skipping email');
    return false;
  }
  const subject = `🎧 ¡Disculpa la espera! Tu canción para ${recipientName} ya está lista`;
  const html = getApologyEmailHtml(song, previewLink);
  const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SENDGRID_API_KEY}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
      categories: ['outage_recovery_2026_05_01', 'transactional', 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: {
        'List-Unsubscribe': `<mailto:hola@regalosquecantan.com?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error('SendGrid error:', resp.status, errText.substring(0, 200));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// KIE.AI helpers
// ---------------------------------------------------------------------------

interface KieTrack {
  id?: string;
  audioUrl?: string;
  imageUrl?: string;
  title?: string;
  duration?: number;
  modelName?: string;
}

async function submitToKie(lyrics: string, title: string, style: string, vocalGender: 'm' | 'f', callbackUrl: string): Promise<string> {
  const payload = {
    prompt: lyrics.substring(0, 5000),
    customMode: true,
    instrumental: false,
    model: KIE_MODEL,
    callBackUrl: callbackUrl,
    style: style.substring(0, 1000),
    title: title.substring(0, 80),
    vocalGender,
  };
  const resp = await fetch('https://api.kie.ai/api/v1/generate', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KIE_API_KEY}`,
      'Content-Type': 'application/json',
    },
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
  return data.data.taskId;
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

// ---------------------------------------------------------------------------
// HANDLER
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    if (!KIE_API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'KIE_API_KEY env var missing on Supabase' }),
        { headers: responseHeaders, status: 200 });
    }

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dryRun') === '1';
    const targetSongId = url.searchParams.get('songId') || undefined;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Pick next candidate ----
    let candidate: any = null;

    if (targetSongId) {
      const { data, error } = await supabase.from('songs').select('*').eq('id', targetSongId).single();
      if (error) throw new Error(`Lookup by songId failed: ${error.message}`);
      if (data?.status !== 'failed') {
        return new Response(JSON.stringify({
          ok: true, skipped: true, reason: `song ${targetSongId} status is '${data?.status}', not 'failed'`,
        }), { headers: responseHeaders, status: 200 });
      }
      candidate = data;
    } else {
      // Most recent failed row per (lower(email), recipient_name) within outage window,
      // matching the known failure-message patterns, skipping customers who have a
      // completed song after the outage start.
      const { data: allFailed, error: fbErr } = await supabase
        .from('songs')
        .select('*')
        .eq('status', 'failed')
        .gte('created_at', OUTAGE_START)
        .order('created_at', { ascending: false })
        .limit(500);
      if (fbErr) throw new Error(`Candidate query failed: ${fbErr.message}`);

      const matches = (allFailed || []).filter((row) => {
        const e = (row.error_message || '').toLowerCase();
        return (
          e.includes('unexpected state: 4') ||
          e.includes('exceed limit') ||
          e.includes('no retry payload saved') ||
          e.includes('generate multiple task exceed limit')
        );
      });

      const latestPerCustomer = new Map<string, any>();
      for (const row of matches) {
        const key = `${(row.email || '').toLowerCase().trim()}|${row.recipient_name || ''}`;
        if (!latestPerCustomer.has(key)) latestPerCustomer.set(key, row);
      }

      for (const row of latestPerCustomer.values()) {
        const { count } = await supabase
          .from('songs')
          .select('id', { count: 'exact', head: true })
          .ilike('email', row.email)
          .eq('recipient_name', row.recipient_name)
          .eq('status', 'completed')
          .gt('created_at', OUTAGE_START);
        if ((count ?? 0) === 0) {
          candidate = row;
          break;
        }
      }
    }

    if (!candidate) {
      return new Response(JSON.stringify({ ok: true, processed: 0, remaining: 0, message: 'No more candidates' }),
        { headers: responseHeaders, status: 200 });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dryRun: true, candidate: {
          id: candidate.id, email: candidate.email, recipient_name: candidate.recipient_name,
          sender_name: candidate.sender_name, genre: candidate.genre, voice_type: candidate.voice_type,
          lyrics_len: candidate.lyrics?.length, style_len: candidate.style_used?.length,
        },
      }), { headers: responseHeaders, status: 200 });
    }

    // ---- LOCK the row ----
    const { data: locked, error: lockErr } = await supabase
      .from('songs')
      .update({ status: 'recovering' })
      .eq('id', candidate.id)
      .eq('status', 'failed')
      .select()
      .single();

    if (lockErr || !locked) {
      return new Response(JSON.stringify({
        ok: true, processed: 0, skipped: true,
        reason: `Could not lock row ${candidate.id} (already claimed?): ${lockErr?.message}`,
      }), { headers: responseHeaders, status: 200 });
    }

    console.log(`[RECOVERY] Locked row ${locked.id} for ${locked.email} / ${locked.recipient_name}`);

    if (!locked.lyrics || !locked.style_used) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: 'Recovery aborted: missing lyrics or style_used',
      }).eq('id', locked.id);
      return new Response(JSON.stringify({
        ok: false, processed: 0, songId: locked.id, error: 'missing lyrics or style_used',
      }), { headers: responseHeaders, status: 200 });
    }

    // ---- Submit to Kie ----
    const vocalGender: 'm' | 'f' = locked.voice_type === 'female' ? 'f' : 'm';
    const title = `Canción para ${locked.recipient_name || 'ti'}`;
    const callbackUrl = `${SUPABASE_URL}/functions/v1/song-callback`;

    let taskId: string;
    try {
      taskId = await submitToKie(locked.lyrics, title, locked.style_used, vocalGender, callbackUrl);
      console.log(`[RECOVERY] Kie taskId: ${taskId}`);
    } catch (e: any) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: `Recovery submit failed: ${e.message}`.substring(0, 500),
      }).eq('id', locked.id);
      return new Response(JSON.stringify({ ok: false, songId: locked.id, error: e.message }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- Poll until done ----
    let tracks: KieTrack[];
    try {
      tracks = await pollKieUntilDone(taskId);
    } catch (e: any) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: `Recovery poll failed: ${e.message}`.substring(0, 500),
        kie_task_id: taskId,
        provider: 'kie',
      }).eq('id', locked.id);
      return new Response(JSON.stringify({ ok: false, songId: locked.id, taskId, error: e.message }),
        { headers: responseHeaders, status: 200 });
    }

    const track1 = tracks[0];
    const track2 = tracks[1];

    if (!track1?.audioUrl) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: `Recovery: no audioUrl in track[0]`,
        kie_task_id: taskId,
        provider: 'kie',
      }).eq('id', locked.id);
      return new Response(JSON.stringify({ ok: false, songId: locked.id, taskId, error: 'no track[0].audioUrl' }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- UPDATE v1 row ----
    const { error: updateErr } = await supabase.from('songs').update({
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
      version: 1,
      error_message: null,
      regenerate_count: (locked.regenerate_count || 0) + 1,
    }).eq('id', locked.id);

    if (updateErr) {
      console.error(`[RECOVERY] Failed to update v1 row ${locked.id}: ${updateErr.message}`);
      return new Response(JSON.stringify({ ok: false, songId: locked.id, taskId, error: updateErr.message }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- INSERT v2 sibling ----
    let v2Id: string | null = null;
    if (track2?.audioUrl) {
      const { data: v2Row, error: insertErr } = await supabase.from('songs').insert({
        recipient_name: locked.recipient_name,
        sender_name: locked.sender_name,
        relationship: locked.relationship,
        relationship_custom: locked.relationship_custom,
        genre: locked.genre,
        genre_name: locked.genre_name,
        sub_genre: locked.sub_genre,
        sub_genre_name: locked.sub_genre_name,
        occasion: locked.occasion,
        occasion_custom: locked.occasion_custom,
        emotional_tone: locked.emotional_tone,
        details: locked.details,
        email: locked.email,
        lyrics: locked.lyrics,
        style_used: locked.style_used,
        artist_inspiration: locked.artist_inspiration,
        voice_type: locked.voice_type,
        session_id: locked.session_id,
        coupon_code: locked.coupon_code,
        version: 2,
        audio_url: track2.audioUrl,
        preview_url: track2.audioUrl,
        original_audio_url: track2.audioUrl,
        image_url: track2.imageUrl || locked.image_url,
        status: 'completed',
        needs_reupload: true,
        kie_task_id: taskId,
        task_id: taskId,
        kie_payload: JSON.stringify(track2),
        provider: 'kie',
        paid: false,
        platform: locked.platform,
        utm_source: locked.utm_source,
        utm_medium: locked.utm_medium,
        utm_campaign: locked.utm_campaign,
        affiliate_code: locked.affiliate_code,
        template: locked.template,
      }).select('id').single();
      if (insertErr) {
        console.warn(`[RECOVERY] Failed to insert v2 sibling for ${locked.id}: ${insertErr.message}`);
      } else {
        v2Id = v2Row?.id;
      }
    }

    // ---- Send apology email ----
    let emailSent = false;
    if (locked.email) {
      const previewLink = `https://regalosquecantan.com/preview/${locked.id}`;
      emailSent = await sendApologyEmail(locked.email, locked.recipient_name || 'ti', locked, previewLink);
    }

    // ---- Count remaining ----
    const { data: remainingRows } = await supabase
      .from('songs')
      .select('email, recipient_name, error_message')
      .eq('status', 'failed')
      .gte('created_at', OUTAGE_START)
      .limit(500);
    const remainingMatches = (remainingRows || []).filter((row) => {
      const e = (row.error_message || '').toLowerCase();
      return (
        e.includes('unexpected state: 4') ||
        e.includes('exceed limit') ||
        e.includes('no retry payload saved') ||
        e.includes('generate multiple task exceed limit')
      );
    });
    const remainingDistinct = new Set(
      remainingMatches.map((r) => `${(r.email || '').toLowerCase().trim()}|${r.recipient_name || ''}`)
    ).size;

    return new Response(JSON.stringify({
      ok: true,
      processed: 1,
      songId: locked.id,
      v2Id,
      email: locked.email,
      recipient: locked.recipient_name,
      previewLink: `https://regalosquecantan.com/preview/${locked.id}`,
      emailSent,
      taskId,
      remainingDistinct,
    }), { headers: responseHeaders, status: 200 });

  } catch (e: any) {
    console.error('[RECOVERY] Unexpected error:', e?.message);
    return new Response(JSON.stringify({ ok: false, error: e?.message }),
      { headers: responseHeaders, status: 500 });
  }
});
