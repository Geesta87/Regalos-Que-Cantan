// supabase/functions/verify-payment/index.ts
// Fallback endpoint: verifies payment directly with Stripe API
// Called from the success page when webhook may have failed.
// Also sends the purchase confirmation email if it hasn't been sent yet —
// in practice this almost always wins the race vs stripe-webhook because
// the browser fires it the moment the user lands on the success page,
// while Stripe's webhook takes a few seconds longer.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';
import { buildEmailParts } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string,
  category: string = 'transactional',
  preheader: string = '',
) {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set, skipping email');
    return null;
  }

  const { html: finalHtml, text: finalText } = buildEmailParts(htmlContent, preheader);

  const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SENDGRID_API_KEY}`
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER_EMAIL, name: SENDER_NAME },
      reply_to: { email: SENDER_EMAIL, name: SENDER_NAME },
      subject: subject,
      // text/plain MUST come before text/html (RFC 2046 multipart/alternative).
      content: [
        { type: 'text/plain', value: finalText },
        { type: 'text/html', value: finalHtml },
      ],
      categories: [category, 'rqc'],
      tracking_settings: {
        click_tracking: { enable: true, enable_text: false },
        open_tracking: { enable: true },
        subscription_tracking: { enable: false }
      },
      headers: {
        'List-Unsubscribe': `<mailto:hola@regalosquecantan.com?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('SendGrid error:', response.status, errorText);
    throw new Error(`SendGrid error: ${response.status}`);
  }

  console.log('Email sent successfully to:', to, '| category:', category);
  return response;
}

// Bundle-aware email template for purchase confirmation.
// Pass the full list of paid song IDs so bundle buyers get ONE link
// covering all of them — the listen page resolves comma-joined ids.
function getPurchaseEmailHtml(song: any, songIds: string[] = [song.id]) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const recipientName = song.recipient_name || 'tu ser querido';
  const songTitle = song.song_title || `Canción para ${song.recipient_name || 'ti'}`;
  const senderName = song.sender_name || 'Anónimo';
  const genre = song.genre || 'Musical';
  const occasion = song.occasion || 'Especial';
  const isCombo = songIds.length > 1;
  const songCount = songIds.length;
  const listenParam = isCombo ? `song_ids=${songIds.join(',')}` : `song_id=${song.id}`;
  const listenUrl = `https://regalosquecantan.com/listen?${listenParam}&utm_source=email&utm_medium=transactional&utm_campaign=purchase_confirmation`;
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

        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 40px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#127881; COMPRA CONFIRMADA${isCombo ? ` &middot; ${songCount} CANCIONES` : ''}</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">${isCombo ? `Tus <strong style="color:#ffd23f;">${songCount} canciones</strong> ya son` : 'Tu canci&oacute;n ya es'} <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">${isCombo ? 'tuyas.' : 'tuya.'}</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">${isCombo
            ? `Letra, melod&iacute;a y emoci&oacute;n en <strong style="color:#ffd23f;">${songCount} versiones &uacute;nicas</strong> &mdash;<br>todas listas para llegar al coraz&oacute;n de <strong style="color:#ffd23f;">${recipientName}</strong>.`
            : `Letra, melod&iacute;a y emoci&oacute;n &mdash; todo listo para<br>que llegue al coraz&oacute;n de <strong style="color:#ffd23f;">${recipientName}</strong>.`}</p>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
            <tr><td align="center" style="border-radius:8px;background-color:#ff6b35;">
              <a href="${listenUrl}" target="_blank" style="display:inline-block;padding:18px 44px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;font-size:18px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:8px;">
                &#127911; ${isCombo ? `Escuchar mis ${songCount} canciones` : 'Escuchar y Descargar'}
              </a>
            </td></tr>
          </table>
        </td></tr>

${isCombo ? `        <tr><td style="background-color:#1a0e08;padding:0 30px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,rgba(255,107,53,0.12) 0%,rgba(255,46,136,0.12) 100%);border:1.5px solid rgba(255,107,53,0.4);border-radius:16px;">
            <tr><td style="padding:18px 22px;text-align:center;">
              <p style="color:#ffd23f;font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;">&#127911;&#127911; PAQUETE DE ${songCount} CANCIONES</p>
              <p style="color:#ffffff;font-size:14px;font-weight:600;margin:0;line-height:1.5;">El bot&oacute;n de arriba abre <strong style="color:#ff8c42;">tus ${songCount} canciones</strong> en una sola p&aacute;gina.<br><span style="color:#c9b99a;font-weight:400;font-size:13px;">Usa los botones &laquo;Canci&oacute;n 1&raquo; / &laquo;Canci&oacute;n 2&raquo; arriba del reproductor para alternar entre ellas.</span></p>
            </td></tr>
          </table>
        </td></tr>
` : ''}        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#128274; Este enlace no expira &middot; ${isCombo ? `Las ${songCount} canciones est&aacute;n incluidas` : 'Escucha y descarga cuando quieras'}</p>
        </td></tr>

        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td style="background-color:#1a0e08;padding:40px 30px 10px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">&#127911; ${isCombo ? `TUS ${songCount} CANCIONES COMPRADAS` : 'TU CANCIÓN COMPRADA'}</p>
          <h3 style="font-family:'Righteous',cursive;color:#ffffff;font-size:24px;margin:0 0 24px;font-weight:400;">${isCombo ? `${songCount} canciones, un solo enlace` : 'Este regalo tiene voz propia'}</h3>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">${isCombo ? `${songCount} CANCIONES` : 'COMPRADA'}</p>
              </td>
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">${isCombo ? `TUS ${songCount} CANCIONES PERSONALIZADAS` : 'TU CANCIÓN PERSONALIZADA'}</p>
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Para <strong style="color:#ffd23f;">${recipientName}</strong> &middot; De: ${senderName}<br>Estilo: <span style="text-transform:capitalize;">${genre}</span> &middot; Ocasi&oacute;n: <span style="text-transform:capitalize;">${occasion}</span>${isCombo ? `<br><strong style="color:#ffd23f;">${songCount} versiones &uacute;nicas en el mismo enlace</strong>` : ''}</p>
                <span style="display:inline-block;width:4px;height:14px;background:#ff6b35;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:22px;background:#ff8c42;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:10px;background:#ffd23f;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:26px;background:#ff6b35;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:16px;background:#ff2e88;border-radius:2px;margin:0 1px;"></span>
              </td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gust&oacute;? Sorprende a m&aacute;s personas en <a href="https://regalosquecantan.com" style="color:#ff6b35;font-weight:700;">regalosquecantan.com</a></p>
        </td></tr>

        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td style="background-color:#1a0e08;padding:30px;text-align:center;">
          <p style="color:#a67c52;font-size:12px;margin:0 0 10px;">&iquest;Preguntas? Escr&iacute;benos a<br>
            <a href="mailto:hola@regalosquecantan.com" style="color:#ff6b35;font-weight:600;">hola@regalosquecantan.com</a>
          </p>
          <p style="color:#4a2c1a;font-size:11px;margin:0;">&copy; 2025 Regalos Que Cantan. Hecho con &#10084;&#65039; para ti.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Affiliate attribution helper ────────────────────────────────────────
// Mirrors stripe-webhook's helper. Idempotent — safe to call from both
// paths; whichever runs first records the purchase event, the other no-ops.
async function recordAffiliatePurchase(
  supabase: any,
  song: { id: string; affiliate_code: string | null; coupon_code: string | null; amount_paid: number | string | null },
  fallbackAffiliateCode: string | null
): Promise<void> {
  const affiliateCode = (song.affiliate_code || fallbackAffiliateCode || '').toString().toLowerCase().trim();
  if (!affiliateCode) return;

  const { data: validAffiliate } = await supabase
    .from('affiliates')
    .select('code')
    .eq('code', affiliateCode)
    .eq('active', true)
    .maybeSingle();
  if (!validAffiliate) {
    console.warn(`[affiliate] purchase event skipped — code ${affiliateCode} is not an active affiliate`);
    return;
  }

  const { data: existing } = await supabase
    .from('affiliate_events')
    .select('id')
    .eq('song_id', song.id)
    .eq('event_type', 'purchase')
    .maybeSingle();
  if (existing) return;

  const amount = parseFloat(String(song.amount_paid ?? '0')) || 0;
  const { error: insertErr } = await supabase
    .from('affiliate_events')
    .insert({
      affiliate_code: affiliateCode,
      event_type: 'purchase',
      song_id: song.id,
      amount,
    });
  if (insertErr) {
    console.error(`[affiliate] failed to insert purchase event for song ${song.id}:`, insertErr.message);
    return;
  }
  console.log(`[affiliate] purchase event recorded — code=${affiliateCode} song=${song.id} amount=${amount}`);

  if (song.coupon_code) {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('times_used')
      .eq('code', song.coupon_code)
      .maybeSingle();
    if (coupon) {
      await supabase
        .from('coupons')
        .update({ times_used: (coupon.times_used || 0) + 1 })
        .eq('code', song.coupon_code);
    }
  }
}

// Send the purchase confirmation email if it hasn't been sent yet for this
// Stripe session. funnel_events.purchase_email_sent (with stripe_session_id in
// metadata) is the cross-function de-dup gate — both verify-payment and
// stripe-webhook check and write it, so the email goes out exactly once.
async function sendPurchaseEmailIfNotSent(
  supabase: any,
  song: any,
  allSongIds: string[],
  email: string,
  sessionId: string,
  source: string
): Promise<void> {
  if (!email || !song) return;

  const { data: existing } = await supabase
    .from('funnel_events')
    .select('id')
    .eq('step', 'purchase_email_sent')
    .contains('metadata', { stripe_session_id: sessionId })
    .maybeSingle();

  if (existing) {
    console.log('purchase email already sent for session', sessionId, '- skipping');
    return;
  }

  const isCombo = allSongIds.length > 1;
  const subject = isCombo
    ? `🎵 Tus ${allSongIds.length} canciones para ${song.recipient_name} están listas!`
    : `🎵 Tu canción para ${song.recipient_name} está lista!`;

  let emailOk = false;
  let emailErr: string | null = null;
  try {
    await sendEmail(
      email,
      subject,
      getPurchaseEmailHtml(song, allSongIds),
      'purchase_confirmation'
    );
    emailOk = true;
    console.log('📧 Purchase email sent to:', email, 'for song(s):', allSongIds.join(','), '(source:', source + ')');
  } catch (emailError: any) {
    emailErr = emailError?.message || String(emailError);
    console.error('🔴 Failed to send purchase email:', emailErr, 'songIds:', allSongIds.join(','), 'email:', email);
  }

  try {
    await supabase.from('funnel_events').insert([{
      session_id: sessionId,
      step: emailOk ? 'purchase_email_sent' : 'purchase_email_failed',
      metadata: {
        stripe_session_id: sessionId,
        song_ids: allSongIds,
        email,
        error: emailErr,
        attempted_at: new Date().toISOString(),
        source,
      },
    }]);
  } catch (logErr) {
    console.error('Failed to log purchase email status:', logErr);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { sessionId, songId } = await req.json();

    if (!sessionId || !songId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing sessionId or songId' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // First check if song is already marked as paid
    const { data: existingSong } = await supabase
      .from('songs')
      .select('*')
      .eq('id', songId)
      .single();

    if (existingSong?.paid) {
      // Song already paid (likely by stripe-webhook winning the race for once).
      // Still make sure the email went out — if the webhook hit a SendGrid
      // error, the funnel_events row will be missing and we'll send now.
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const email = session.metadata?.email || session.customer_email || existingSong.email;
        // Parse all bundle IDs from metadata so the email covers every song.
        const allBundleIds = (session.metadata?.songId || songId)
          .split(',').map((id: string) => id.trim()).filter(Boolean);
        if (email) {
          await sendPurchaseEmailIfNotSent(supabase, existingSong, allBundleIds, email, sessionId, 'verify-payment-already-paid');
        }
        // Self-heal affiliate attribution if a previous run never logged it.
        try {
          await recordAffiliatePurchase(supabase, existingSong, session.metadata?.affiliateCode || null);
        } catch (affErr: any) {
          console.error(`[affiliate] self-heal failed for already-paid song ${existingSong.id}:`, affErr?.message || affErr);
        }
      } catch (recoveryErr) {
        console.error('Already-paid email recovery failed (non-fatal):', recoveryErr);
      }

      return new Response(
        JSON.stringify({ success: true, alreadyPaid: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Verify payment directly with Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ success: false, error: 'Payment not completed', status: session.payment_status }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // All song IDs in this checkout session (comma-joined in metadata by create-checkout).
    const allBundleIds = (session.metadata?.songId || songId)
      .split(',').map((id: string) => id.trim()).filter(Boolean);

    // Payment is confirmed by Stripe - update ALL songs in the bundle at once.
    const updateData: Record<string, any> = {
      paid: true,
      paid_at: new Date().toISOString(),
      stripe_session_id: session.id,
      stripe_payment_id: session.payment_intent as string || null,
      payment_status: 'completed',
      amount_paid: (session.amount_total || 0) / 100
    };
    if (session.metadata?.videoAddon === 'true') {
      updateData.has_video_addon = true;
      const addonCount = parseInt(session.metadata?.videoAddonCount || '1');
      updateData.video_addon_count = addonCount >= 1 ? addonCount : 1;
    }

    const { error: updateError } = await supabase
      .from('songs')
      .update(updateData)
      .in('id', allBundleIds);

    if (updateError) {
      console.error('Failed to update song(s):', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Database update failed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Fetch the primary song row for email building and the response.
    const { data: song } = await supabase
      .from('songs')
      .select('*')
      .eq('id', songId)
      .single();

    if (!song) {
      console.error('Song not found after update:', songId);
      return new Response(
        JSON.stringify({ success: false, error: 'Song not found after update' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log(`Payment verified and ${allBundleIds.length} song(s) marked as paid via fallback:`, allBundleIds.join(','));

    // Affiliate attribution: record the purchase event + bump coupon usage.
    // Idempotent — stripe-webhook will also call this and one of them will
    // be a no-op. Wrapped so a failure never breaks the success page.
    try {
      await recordAffiliatePurchase(supabase, song, session.metadata?.affiliateCode || null);
    } catch (affErr: any) {
      console.error(`[affiliate] recordAffiliatePurchase threw for song ${song.id}:`, affErr?.message || affErr);
    }

    // Send the purchase confirmation email. Wrapped so a SendGrid failure
    // never causes verify-payment to return non-200 — the user has already
    // paid and the success page contract must remain stable.
    try {
      const email = session.metadata?.email || session.customer_email || song.email;
      if (email) {
        await sendPurchaseEmailIfNotSent(supabase, song, allBundleIds, email, session.id, 'verify-payment');
      } else {
        console.warn('🟡 No email available for purchase confirmation, songId:', song.id);
      }
    } catch (emailFlowErr) {
      console.error('Purchase email flow failed (non-fatal):', emailFlowErr);
    }

    // Fire-and-forget: render a 60s social media clip. Idempotent via the
    // UNIQUE index on social_posts.song_id — if the webhook already
    // triggered the render for this song, this is a safe no-op.
    try {
      const clipResponse = await fetch(`${SUPABASE_URL}/functions/v1/render-social-clip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ songId: song.id }),
      });
      if (!clipResponse.ok) {
        console.warn(`[render-social-clip] non-2xx for ${song.id}: ${clipResponse.status}`);
      }
    } catch (clipErr: any) {
      console.warn(`[render-social-clip] trigger failed for ${song.id}:`, clipErr.message);
    }

    return new Response(
      JSON.stringify({ success: true, verified: true, songId: song.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Verify payment error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
