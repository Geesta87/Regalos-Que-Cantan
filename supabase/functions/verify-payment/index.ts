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

async function sendEmail(to: string, subject: string, htmlContent: string, category: string = 'transactional') {
  if (!SENDGRID_API_KEY) {
    console.warn('SENDGRID_API_KEY not set, skipping email');
    return null;
  }

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
      content: [{ type: 'text/html', value: htmlContent }],
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

function getPurchaseEmailHtml(song: any) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const recipientName = song.recipient_name || 'tu ser querido';
  const songTitle = song.song_title || `Canción para ${song.recipient_name || 'ti'}`;
  const senderName = song.sender_name || 'Anónimo';
  const genre = song.genre || 'Musical';
  const occasion = song.occasion || 'Especial';
  const listenUrl = `https://regalosquecantan.com/listen?song_id=${song.id}&utm_source=email&utm_medium=transactional&utm_campaign=purchase_confirmation`;
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
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#127881; COMPRA CONFIRMADA</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">Tu canci&oacute;n ya es <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">tuya.</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo listo para<br>que llegue al coraz&oacute;n de <strong style="color:#ffd23f;">${recipientName}</strong>.</p>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="${listenUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127911; Escuchar y Descargar
          </a>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#128274; Este enlace no expira &middot; Escucha y descarga cuando quieras</p>
        </td></tr>

        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <tr><td style="background-color:#1a0e08;padding:40px 30px 10px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">&#127911; TU CANCI&Oacute;N COMPRADA</p>
          <h3 style="font-family:'Righteous',cursive;color:#ffffff;font-size:24px;margin:0 0 24px;font-weight:400;">Este regalo tiene voz propia</h3>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">COMPRADA</p>
              </td>
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">TU CANCI&Oacute;N PERSONALIZADA</p>
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Para <strong style="color:#ffd23f;">${recipientName}</strong> &middot; De: ${senderName}<br>Estilo: <span style="text-transform:capitalize;">${genre}</span> &middot; Ocasi&oacute;n: <span style="text-transform:capitalize;">${occasion}</span></p>
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

// Send the purchase confirmation email if it hasn't been sent yet for this
// Stripe session. funnel_events.purchase_email_sent (with stripe_session_id in
// metadata) is the cross-function de-dup gate — both verify-payment and
// stripe-webhook check and write it, so the email goes out exactly once.
async function sendPurchaseEmailIfNotSent(
  supabase: any,
  song: any,
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

  let emailOk = false;
  let emailErr: string | null = null;
  try {
    await sendEmail(
      email,
      `🎵 Tu canción para ${song.recipient_name} está lista!`,
      getPurchaseEmailHtml(song),
      'purchase_confirmation'
    );
    emailOk = true;
    console.log('📧 Purchase email sent to:', email, 'for song:', song.id, '(source:', source + ')');
  } catch (emailError: any) {
    emailErr = emailError?.message || String(emailError);
    console.error('🔴 Failed to send purchase email:', emailErr, 'songId:', song.id, 'email:', email);
  }

  try {
    await supabase.from('funnel_events').insert([{
      session_id: sessionId,
      step: emailOk ? 'purchase_email_sent' : 'purchase_email_failed',
      metadata: {
        stripe_session_id: sessionId,
        song_ids: [song.id],
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
        if (email) {
          await sendPurchaseEmailIfNotSent(supabase, existingSong, email, sessionId, 'verify-payment-already-paid');
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

    // Payment is confirmed by Stripe - update the database
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
    }
    const { data: song, error: updateError } = await supabase
      .from('songs')
      .update(updateData)
      .eq('id', songId)
      .select()
      .single();

    if (updateError) {
      console.error('Failed to update song:', updateError);
      return new Response(
        JSON.stringify({ success: false, error: 'Database update failed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    console.log('Payment verified and song marked as paid via fallback:', songId);

    // Send the purchase confirmation email. Wrapped so a SendGrid failure
    // never causes verify-payment to return non-200 — the user has already
    // paid and the success page contract must remain stable.
    try {
      const email = session.metadata?.email || session.customer_email || song.email;
      if (email) {
        await sendPurchaseEmailIfNotSent(supabase, song, email, session.id, 'verify-payment');
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
