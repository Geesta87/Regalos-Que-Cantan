// supabase/functions/recover-outage-songs/index.ts
// One-shot recovery for songs that failed during the 2026-04-26 Mureka balance outage.
// Processes ONE customer per invocation: locks the most recent failed row per (email, recipient),
// regenerates via generate-song-mureka, updates v1 + creates v2 sibling, sends apology email.
// Idempotent: skips customers who already have a completed song after the outage.
// Deploy: supabase functions deploy recover-outage-songs --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildUnsubscribeHeaders } from '../_shared/unsubscribe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

const OUTAGE_START = '2026-04-26 12:30:00+00';
const OUTAGE_END = '2026-04-26 16:30:00+00';

// ---------------------------------------------------------------------------
// EMAIL TEMPLATE — apology + preview link
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

        <!-- Apology Banner -->
        <tr><td style="background:linear-gradient(135deg,#3a1d10 0%,#2a1408 100%);padding:24px 30px;text-align:center;border-bottom:2px solid #ff6b35;">
          <p style="color:#ffd23f;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">&iexcl;Disc&uacute;lpanos!</p>
          <p style="color:#ffffff;font-size:15px;line-height:1.6;margin:0;">Tuvimos un problema t&eacute;cnico que ya est&aacute; resuelto.<br>Tu canci&oacute;n para <strong style="color:#ffd23f;">${recipient}</strong> ya est&aacute; lista para escuchar.</p>
        </td></tr>

        <!-- Hero -->
        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:40px 30px 30px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 16px;">&#10024; TU REGALO TE EST&Aacute; ESPERANDO &#10024;</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:34px;margin:0 0 4px;font-weight:400;">Hola, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:30px;margin:0 0 20px;font-weight:400;">Tu canci&oacute;n ya <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">est&aacute; viva.</span></h2>
          <p style="color:#c9b99a;font-size:15px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo est&aacute; listo.<br>Haz clic abajo para escucharla.</p>
        </td></tr>

        <!-- CTA Button -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="${previewLink}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127925; Escuchar Mi Canci&oacute;n
          </a>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#127873; Tu canci&oacute;n est&aacute; guardada y lista para preview &middot; Sin compromiso</p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Song Card -->
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

        <!-- Price -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gusta? Compra la canci&oacute;n completa por solo <strong style="color:#ff6b35;">$29.99 USD</strong></p>
        </td></tr>

        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
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
      categories: ['outage_recovery_2026_04_26', 'transactional', 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false },
      },
      headers: await buildUnsubscribeHeaders(to),
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
// HANDLER
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dryRun') === '1';
    const targetSongId = url.searchParams.get('songId') || undefined;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Pick next candidate ----
    // Most recent failed row per (lower(email), recipient_name) within outage window,
    // skipping customers who already have a completed song after outage end.
    let candidate: any = null;

    if (targetSongId) {
      const { data, error } = await supabase
        .from('songs')
        .select('*')
        .eq('id', targetSongId)
        .single();
      if (error) throw new Error(`Lookup by songId failed: ${error.message}`);
      if (data?.status !== 'failed') {
        return new Response(JSON.stringify({
          ok: true, skipped: true, reason: `song ${targetSongId} status is '${data?.status}', not 'failed'`,
        }), { headers: responseHeaders, status: 200 });
      }
      candidate = data;
    } else {
      // Find candidates via SQL (most recent failed per customer, not yet rescued)
      const { data: candidates, error: candErr } = await supabase.rpc('get_outage_recovery_candidates', {
        outage_start: OUTAGE_START,
        outage_end: OUTAGE_END,
      }).limit(1);

      if (candErr) {
        // RPC might not exist — fall back to direct query.
        // Fetch ALL failed rows in outage window (cap 500) and dedupe by (email, recipient)
        // keeping the most recent per customer. Avoids the "limit 50 hides remaining customers"
        // bug where rows from already-recovered customers fill the result window.
        const { data: allFailed, error: fbErr } = await supabase
          .from('songs')
          .select('*')
          .eq('status', 'failed')
          .gte('created_at', OUTAGE_START)
          .lte('created_at', OUTAGE_END)
          .ilike('error_message', '%balance is not enough%')
          .order('created_at', { ascending: false })
          .limit(500);
        if (fbErr) throw new Error(`Candidate query failed: ${fbErr.message}`);

        const latestPerCustomer = new Map<string, any>();
        for (const row of allFailed || []) {
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
            .gt('created_at', OUTAGE_END);
          if ((count ?? 0) === 0) {
            candidate = row;
            break;
          }
        }
      } else {
        candidate = candidates?.[0];
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

    // ---- LOCK the row by setting status='recovering' (atomic claim) ----
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

    // ---- Validate inputs ----
    if (!locked.lyrics || !locked.style_used) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: 'Recovery aborted: missing lyrics or style_used',
      }).eq('id', locked.id);
      return new Response(JSON.stringify({
        ok: false, processed: 0, songId: locked.id,
        error: 'missing lyrics or style_used',
      }), { headers: responseHeaders, status: 200 });
    }

    // ---- Call generate-song-mureka ----
    // Mureka API expects full words: 'female' or 'male' (not 'f'/'m')
    const vocalGender = locked.voice_type === 'female' ? 'female' : 'male';
    const title = `Canción para ${locked.recipient_name || 'ti'}`;

    console.log(`[RECOVERY] Calling generate-song-mureka for row ${locked.id}`);
    const genResp = await fetch(`${SUPABASE_URL}/functions/v1/generate-song-mureka`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        lyrics: locked.lyrics,
        title,
        stylePrompt: locked.style_used,
        vocalGender,
        poll: true,
      }),
    });

    const genData = await genResp.json().catch(() => ({}));
    if (!genResp.ok || !genData.success) {
      const errMsg = genData.error || `HTTP ${genResp.status}`;
      console.error(`[RECOVERY] generate-song-mureka failed for ${locked.id}: ${errMsg}`);
      // Reset status back to failed so we can retry
      await supabase.from('songs').update({
        status: 'failed',
        error_message: `Recovery attempt failed: ${errMsg}`.substring(0, 500),
      }).eq('id', locked.id);
      return new Response(JSON.stringify({
        ok: false, processed: 0, songId: locked.id, error: errMsg,
      }), { headers: responseHeaders, status: 200 });
    }

    const song1 = genData.song1;
    const song2 = genData.song2;
    const jobId = genData.jobid;

    if (!song1?.song_url) {
      await supabase.from('songs').update({
        status: 'failed',
        error_message: `Recovery: generate-song-mureka returned no song1`,
      }).eq('id', locked.id);
      return new Response(JSON.stringify({ ok: false, songId: locked.id, error: 'no song1' }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- UPDATE v1 row with song1 ----
    const { error: updateErr } = await supabase.from('songs').update({
      audio_url: song1.song_url,
      preview_url: song1.song_url,
      original_audio_url: song1.song_url,
      status: 'completed',
      needs_reupload: true,
      mureka_job_id: jobId,
      mureka_payload: JSON.stringify(song1),
      provider: 'mureka-useapi',
      version: 1,
      error_message: null,
      regenerate_count: (locked.regenerate_count || 0) + 1,
    }).eq('id', locked.id);

    if (updateErr) {
      console.error(`[RECOVERY] Failed to update v1 row ${locked.id}: ${updateErr.message}`);
      return new Response(JSON.stringify({ ok: false, songId: locked.id, error: updateErr.message }),
        { headers: responseHeaders, status: 200 });
    }

    // ---- INSERT v2 sibling (clone v1's metadata, attach song2) ----
    let v2Id: string | null = null;
    if (song2?.song_url) {
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
        audio_url: song2.song_url,
        preview_url: song2.song_url,
        original_audio_url: song2.song_url,
        status: 'completed',
        needs_reupload: true,
        mureka_job_id: jobId,
        mureka_payload: JSON.stringify(song2),
        provider: 'mureka-useapi',
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
    const { count: remaining } = await supabase
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', OUTAGE_START)
      .lte('created_at', OUTAGE_END)
      .ilike('error_message', '%balance is not enough%');

    return new Response(JSON.stringify({
      ok: true,
      processed: 1,
      songId: locked.id,
      v2Id,
      email: locked.email,
      recipient: locked.recipient_name,
      previewLink: `https://regalosquecantan.com/preview/${locked.id}`,
      emailSent,
      jobId,
      remainingFailed: remaining ?? null,
    }), { headers: responseHeaders, status: 200 });

  } catch (e: any) {
    console.error('[RECOVERY] Unexpected error:', e.message);
    return new Response(JSON.stringify({ ok: false, error: e.message }),
      { headers: responseHeaders, status: 500 });
  }
});
