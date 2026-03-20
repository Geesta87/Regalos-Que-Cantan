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

// Helper function to send emails via SendGrid
async function sendEmail(to: string, subject: string, htmlContent: string) {
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
      subject: subject,
      content: [{ type: 'text/html', value: htmlContent }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('SendGrid error:', response.status, errorText);
    throw new Error(`SendGrid error: ${response.status}`);
  }

  console.log('Email sent successfully to:', to);
  return response;
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

    // Handle successful payment
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const songId = session.metadata?.songId;
      const email = session.metadata?.email || session.customer_email;

      if (!songId) {
        throw new Error('No songId in metadata');
      }

      console.log('Processing payment for song:', songId);

      // Extract amount and UTM attribution from Stripe session
      const amountPaid = session.amount_total ? (session.amount_total / 100) : null;
      const metaUtmSource = session.metadata?.utm_source || null;
      const metaUtmMedium = session.metadata?.utm_medium || null;
      const metaUtmCampaign = session.metadata?.utm_campaign || null;
      const metaFromEmail = session.metadata?.from_email_campaign || null;

      // Update database
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const updateData: Record<string, any> = {
        paid: true,
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        stripe_session_id: session.id,
        amount_paid: amountPaid
      };
      // Only overwrite UTMs if they exist in metadata (don't null out existing values)
      if (metaUtmSource) updateData.utm_source = metaUtmSource;
      if (metaUtmMedium) updateData.utm_medium = metaUtmMedium;
      if (metaUtmCampaign) updateData.utm_campaign = metaUtmCampaign;
      if (metaFromEmail) updateData.from_email_campaign = metaFromEmail;

      const { data: song, error: updateError } = await supabase
        .from('songs')
        .update(updateData)
        .eq('id', songId)
        .select()
        .single();

      if (updateError) {
        throw new Error('Failed to update song: ' + updateError.message);
      }

      console.log('Song marked as paid:', song.id);

      // Send email with download link via SendGrid
      if (email) {
        try {
          await sendEmail(
            email,
            `🎵 Tu canción para ${song.recipient_name} está lista!`,
            getPurchaseEmailHtml(song)
          );
        } catch (emailError) {
          console.error('Failed to send email:', emailError);
          // Don't fail the webhook if email fails
        }
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
