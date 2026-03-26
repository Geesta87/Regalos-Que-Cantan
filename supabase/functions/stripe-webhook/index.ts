// supabase/functions/stripe-webhook/index.ts
// Deploy with: supabase functions deploy stripe-webhook

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

// SendGrid API for sending emails
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER_EMAIL = 'hola@regalosquecantan.com';
const SENDER_NAME = 'RegalosQueCantan';

// Helper function to send emails via SendGrid (with tracking + deliverability)
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

// Email template for checkout abandonment recovery
function getAbandonedCheckoutEmailHtml(song: any, listenUrl: string) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const recipientName = song.recipient_name || 'tu ser querido';
  const songTitle = song.song_title || `Canción para ${recipientName}`;
  const genre = song.genre || 'Musical';
  const occasion = song.occasion || 'Especial';
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

        <!-- Hero Section -->
        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 30px;text-align:center;">
          <p style="color:#ff6b35;font-size:42px;margin:0 0 16px;">&#127925;</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 8px;font-weight:400;">${firstName}, tu canci&oacute;n</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:28px;margin:0 0 20px;font-weight:400;">para <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">${recipientName}</span> te espera</h2>
          <p style="color:#c9b99a;font-size:15px;margin:0;line-height:1.7;">Notamos que no completaste tu compra.<br>Tu canci&oacute;n personalizada sigue lista para ti.</p>
        </td></tr>

        <!-- Song Card -->
        <tr><td style="background-color:#1a0e08;padding:20px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <td width="100" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">LISTA</p>
              </td>
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:18px 20px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 4px;">TU CANCI&Oacute;N PERSONALIZADA</p>
                <p style="color:#ffffff;font-size:15px;font-weight:700;margin:0 0 6px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:12px;margin:0;">Para <strong style="color:#ffd23f;">${recipientName}</strong><br>
                <span style="text-transform:capitalize;">${genre}</span> &middot; <span style="text-transform:capitalize;">${occasion}</span></p>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Listen CTA -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 10px;text-align:center;">
          <a href="${listenUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127911; Escuchar y Completar Compra
          </a>
        </td></tr>

        <!-- Discount Section -->
        <tr><td style="background-color:#1a0e08;padding:20px 30px;text-align:center;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:2px dashed #ff6b35;border-radius:16px;overflow:hidden;">
            <tr><td style="background:rgba(255,107,53,0.08);padding:24px 20px;text-align:center;">
              <p style="color:#ffd23f;font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">&#127873; REGALO EXCLUSIVO PARA TI</p>
              <p style="font-family:'Righteous',cursive;color:#ff6b35;font-size:36px;margin:0 0 4px;font-weight:400;">15% OFF</p>
              <p style="color:#c9b99a;font-size:14px;margin:0 0 12px;">Usa este c&oacute;digo al momento de pagar:</p>
              <div style="display:inline-block;background:#2a1408;border:1px solid #ff6b35;border-radius:8px;padding:10px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:4px;font-family:monospace;">VUELVE15</span>
              </div>
              <p style="color:#a67c52;font-size:12px;margin:12px 0 0;">V&aacute;lido por 24 horas &middot; Solo para esta canci&oacute;n</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Urgency -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 20px;text-align:center;">
          <p style="color:#c9b99a;font-size:14px;margin:0;line-height:1.6;">
            &#9200; Las canciones se guardan por <strong style="color:#ffd23f;">tiempo limitado</strong>.<br>
            No dejes pasar esta sorpresa &uacute;nica.
          </p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
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

// Email template for purchase confirmation (dark gradient design)
function getPurchaseEmailHtml(song: any) {
  const firstName = (song.sender_name || '').split(' ')[0] || 'Amigo';
  const songTitle = song.song_title || `Canci\u00f3n para ${song.recipient_name || 'ti'}`;
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

        <!-- Dark Hero Section -->
        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 40px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#127881; COMPRA CONFIRMADA</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, \${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">Tu canci&oacute;n ya es <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">tuya.</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo listo para<br>que llegue al coraz&oacute;n de <strong style="color:#ffd23f;">\${song.recipient_name || 'tu ser querido'}</strong>.</p>
        </td></tr>

        <!-- Download CTA Button -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="\${song.audio_url}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#128229; Descargar Mi Canci&oacute;n
          </a>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#128274; Este enlace no expira &middot; Descarga cuando quieras</p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Song Preview Section -->
        <tr><td style="background-color:#1a0e08;padding:40px 30px 10px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 12px;">&#127911; TU CANCI&Oacute;N COMPRADA</p>
          <h3 style="font-family:'Righteous',cursive;color:#ffffff;font-size:24px;margin:0 0 24px;font-weight:400;">Este regalo tiene voz propia</h3>
        </td></tr>

        <!-- Song Card -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;">
            <tr>
              <!-- Play Button Column -->
              <td width="120" style="background:linear-gradient(135deg,#ff6b35 0%,#c2693a 100%);text-align:center;vertical-align:middle;padding:20px;">
                <div style="width:50px;height:50px;background:rgba(255,255,255,0.2);border-radius:50%;margin:0 auto 8px;line-height:50px;font-size:24px;">&#9654;</div>
                <p style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0;">COMPRADA</p>
              </td>
              <!-- Song Info Column -->
              <td style="background:linear-gradient(135deg,#2a1408 0%,#1a0e08 100%);padding:20px 24px;vertical-align:middle;">
                <p style="color:#ff6b35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin:0 0 6px;">TU CANCI&Oacute;N PERSONALIZADA</p>
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">\${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Para <strong style="color:#ffd23f;">\${song.recipient_name || 'tu ser querido'}</strong> &middot; De: \${song.sender_name || 'An&oacute;nimo'}<br>Estilo: <span style="text-transform:capitalize;">\${song.genre || 'Musical'}</span> &middot; Ocasi&oacute;n: <span style="text-transform:capitalize;">\${song.occasion || 'Especial'}</span></p>
                <!-- Mini Waveform -->
                <span style="display:inline-block;width:4px;height:14px;background:#ff6b35;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:22px;background:#ff8c42;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:10px;background:#ffd23f;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:26px;background:#ff6b35;border-radius:2px;margin:0 1px;"></span>
                <span style="display:inline-block;width:4px;height:16px;background:#ff2e88;border-radius:2px;margin:0 1px;"></span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Share Section -->
        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#c9b99a;font-size:15px;margin:0;">&iquest;Te gust&oacute;? Sorprende a m&aacute;s personas en <a href="https://regalosquecantan.com" style="color:#ff6b35;font-weight:700;">regalosquecantan.com</a></p>
        </td></tr>

        <!-- Gradient Divider -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#ff6b35,#ffd23f,#ff2e88);font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Footer -->
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

serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  
  if (!signature) {
    return new Response('No signature', { status: 400 });
  }

  try {
    const body = await req.text();
    
    // Verify webhook signature
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );

    console.log('Webhook event:', event.type);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ========== HANDLE SUCCESSFUL PAYMENT ==========
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const songIdMeta = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      if (!songIdMeta) {
        throw new Error('No songId in metadata');
      }

      // Support comma-separated song IDs for bundle purchases
      const songIds = songIdMeta.split(',').map((id: string) => id.trim()).filter(Boolean);

      // ✅ IDEMPOTENCY CHECK: Skip if this session was already processed
      const { data: existingPaid } = await supabase
        .from('songs')
        .select('id, paid, stripe_session_id')
        .eq('id', songIds[0])
        .single();

      if (existingPaid?.paid && existingPaid?.stripe_session_id === session.id) {
        console.log('⏭️ Already processed session:', session.id, '- skipping');
        return new Response(JSON.stringify({ received: true, status: 'already_processed' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }

      console.log('Processing payment for songs:', songIds);

      // Extract amount and UTM attribution from Stripe session
      const amountPaid = session.amount_total ? (session.amount_total / 100) : null;
      const metaUtmSource = session.metadata?.utm_source || null;
      const metaUtmMedium = session.metadata?.utm_medium || null;
      const metaUtmCampaign = session.metadata?.utm_campaign || null;
      const metaFromEmail = session.metadata?.from_email_campaign || null;

      const updateData: Record<string, any> = {
        paid: true,
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_session_id: session.id,
        amount_paid: amountPaid
      };
      // Video addon flag from checkout metadata
      if (session.metadata?.videoAddon === 'true') {
        updateData.has_video_addon = true;
      }
      // Only overwrite UTMs if they exist in metadata (don't null out existing values)
      if (metaUtmSource) updateData.utm_source = metaUtmSource;
      if (metaUtmMedium) updateData.utm_medium = metaUtmMedium;
      if (metaUtmCampaign) updateData.utm_campaign = metaUtmCampaign;
      if (metaFromEmail) updateData.from_email_campaign = metaFromEmail;

      // Update ALL songs in the bundle
      let firstSong = null;
      for (const sid of songIds) {
        const { data: song, error: updateError } = await supabase
          .from('songs')
          .update(updateData)
          .eq('id', sid)
          .select()
          .single();

        if (updateError) {
          console.error(`Failed to update song ${sid}:`, updateError.message);
          continue;
        }

        console.log('Song marked as paid:', song.id);
        if (!firstSong) firstSong = song;
      }

      // Send email with download link via SendGrid (use first song for template)
      if (email && firstSong) {
        try {
          await sendEmail(
            email,
            `🎵 Tu canción para ${firstSong.recipient_name} está lista!`,
            getPurchaseEmailHtml(firstSong),
            'purchase_confirmation'
          );
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
          // Don't fail the webhook if email fails
        }
      }
    }

    // ========== HANDLE EXPIRED CHECKOUT (Stripe abandonment tracking + recovery email) ==========
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object as Stripe.Checkout.Session;
      const songIdMeta = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      console.log('⏰ Checkout session expired:', session.id, 'email:', email, 'songIds:', songIdMeta);

      // Log the abandoned checkout to funnel_events for analytics
      if (songIdMeta) {
        const songIds = songIdMeta.split(',').map((id: string) => id.trim()).filter(Boolean);

        await supabase
          .from('funnel_events')
          .insert([{
            step: 'checkout_expired',
            metadata: {
              stripe_session_id: session.id,
              song_ids: songIds,
              email: email,
              amount: session.amount_total ? (session.amount_total / 100) : null,
              expired_at: new Date().toISOString()
            }
          }]);

        console.log('📊 Logged checkout_expired event for songs:', songIds);

        // ========== SEND RECOVERY EMAIL ==========
        if (email && songIds.length > 0) {
          try {
            // Fetch the first song to check if already paid (they may have retried successfully)
            const { data: song } = await supabase
              .from('songs')
              .select('*')
              .eq('id', songIds[0])
              .single();

            if (song && !song.paid) {
              // Check we haven't already sent a recovery email for this session
              const { data: existingEvent } = await supabase
                .from('funnel_events')
                .select('id')
                .eq('step', 'checkout_recovery_email_sent')
                .contains('metadata', { stripe_session_id: session.id })
                .maybeSingle();

              if (!existingEvent) {
                const siteUrl = 'https://regalosquecantan.com';
                const listenUrl = songIds.length > 1
                  ? `${siteUrl}/listen?song_ids=${songIds.join(',')}&coupon=VUELVE15`
                  : `${siteUrl}/listen?song_id=${songIds[0]}&coupon=VUELVE15`;

                await sendEmail(
                  email,
                  `🎵 ${song.recipient_name ? `Tu canción para ${song.recipient_name}` : 'Tu canción'} te espera — 15% OFF`,
                  getAbandonedCheckoutEmailHtml(song, listenUrl),
                  'checkout_recovery'
                );

                // Log that we sent the recovery email (prevents duplicates)
                await supabase
                  .from('funnel_events')
                  .insert([{
                    step: 'checkout_recovery_email_sent',
                    metadata: {
                      stripe_session_id: session.id,
                      song_ids: songIds,
                      email: email,
                      sent_at: new Date().toISOString()
                    }
                  }]);

                console.log('📧 Recovery email sent to:', email, 'for songs:', songIds);
              } else {
                console.log('⏭️ Recovery email already sent for session:', session.id);
              }
            } else {
              console.log('⏭️ Song already paid, skipping recovery email for:', songIds[0]);
            }
          } catch (emailError) {
            console.error('Failed to send recovery email:', emailError);
            // Don't fail the webhook if email fails
          }
        }
      }
    }

    // ========== HANDLE FAILED PAYMENT ==========
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const songIdMeta = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      console.log('❌ Payment failed:', session.id, 'email:', email);

      // Log the failed payment for analytics
      if (songIdMeta) {
        await supabase
          .from('funnel_events')
          .insert([{
            step: 'payment_failed',
            metadata: {
              stripe_session_id: session.id,
              song_ids: songIdMeta.split(',').map((id: string) => id.trim()),
              email: email,
              failed_at: new Date().toISOString()
            }
          }]);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400 }
    );
  }
});
