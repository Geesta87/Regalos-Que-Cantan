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
const SENDER_EMAIL = 'support@proactivesolutions.io';
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

// Email template for purchase confirmation
function getPurchaseEmailHtml(song: any) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f3f1; font-family: 'Helvetica Neue', Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f3f1; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #1A4338 0%, #2D5A3D 100%); padding: 40px 30px; text-align: center;">
                  <h1 style="color: #D4AF37; font-size: 32px; margin: 0; font-weight: bold;">🎵 RegalosQueCantan</h1>
                </td>
              </tr>
              
              <!-- Main Content -->
              <tr>
                <td style="padding: 40px 30px;">
                  <div style="text-align: center; margin-bottom: 30px;">
                    <div style="font-size: 60px; margin-bottom: 20px;">🎉</div>
                    <h2 style="color: #1A4338; font-size: 28px; margin: 0 0 10px;">¡Gracias por tu compra!</h2>
                    <p style="color: #666; font-size: 16px; margin: 0;">Tu canción personalizada está lista para descargar</p>
                  </div>
                  
                  <!-- Song Details Card -->
                  <div style="background: #f8f7f6; padding: 24px; border-radius: 12px; margin-bottom: 30px;">
                    <h3 style="color: #1A4338; margin: 0 0 16px; font-size: 18px;">📋 Detalles de tu canción:</h3>
                    <table width="100%" style="font-size: 15px;">
                      <tr>
                        <td style="padding: 8px 0; color: #666; width: 100px;">Para:</td>
                        <td style="padding: 8px 0; color: #1A4338; font-weight: bold;">${song.recipient_name}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #666;">De:</td>
                        <td style="padding: 8px 0; color: #1A4338; font-weight: bold;">${song.sender_name}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #666;">Género:</td>
                        <td style="padding: 8px 0; color: #1A4338; font-weight: bold; text-transform: capitalize;">${song.genre}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; color: #666;">Ocasión:</td>
                        <td style="padding: 8px 0; color: #1A4338; font-weight: bold; text-transform: capitalize;">${song.occasion || 'Especial'}</td>
                      </tr>
                    </table>
                  </div>
                  
                  <!-- Download Button -->
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${song.audio_url}" style="display: inline-block; background: linear-gradient(135deg, #D4AF37 0%, #C4A030 100%); color: #1A4338; padding: 18px 40px; border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 18px; box-shadow: 0 4px 15px rgba(212,175,55,0.4);">
                      📥 Descargar Mi Canción
                    </a>
                  </div>
                  
                  <p style="color: #888; font-size: 14px; text-align: center; margin-top: 20px;">
                    Este enlace no expira. Puedes descargar tu canción cuando quieras.
                  </p>
                </td>
              </tr>
              
              <!-- Share Section -->
              <tr>
                <td style="background: #f8f7f6; padding: 30px; text-align: center;">
                  <p style="color: #1A4338; font-weight: bold; margin: 0 0 15px;">¿Te gustó tu canción? ¡Compártela!</p>
                  <p style="color: #666; font-size: 14px; margin: 0;">
                    Sorprende a más personas con canciones personalizadas en<br>
                    <a href="https://regalosquecantan.com" style="color: #D4AF37; font-weight: bold;">regalosquecantan.com</a>
                  </p>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="padding: 30px; text-align: center; border-top: 1px solid #e4e3dc;">
                  <p style="color: #999; font-size: 12px; margin: 0 0 10px;">
                    ¿Preguntas? Responde a este correo o escríbenos a<br>
                    <a href="mailto:support@proactivesolutions.io" style="color: #1A4338;">support@proactivesolutions.io</a>
                  </p>
                  <p style="color: #ccc; font-size: 11px; margin: 0;">
                    © 2024 RegalosQueCantan. Hecho con ❤️ para ti.
                  </p>
                </td>
              </tr>
              
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
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

      // Update database
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const isVideoUpsell = session.metadata?.type === 'video_upsell';

      if (isVideoUpsell) {
        // Handle video upsell payment
        console.log('Processing VIDEO payment for song:', songId);

        const { error: videoUpdateError } = await supabase
          .from('video_orders')
          .update({
            paid: true,
            paid_at: new Date().toISOString(),
            stripe_session_id: session.id,
            status: 'pending' // ready for photo upload
          })
          .eq('song_id', songId)
          .eq('stripe_session_id', session.id);

        if (videoUpdateError) {
          console.error('Failed to update video order:', videoUpdateError);
          // Try matching by song_id only as fallback
          await supabase
            .from('video_orders')
            .update({
              paid: true,
              paid_at: new Date().toISOString(),
              status: 'pending'
            })
            .eq('song_id', songId)
            .eq('paid', false);
        }

        console.log('Video order marked as paid for song:', songId);
      } else {
        // Handle song payment
        console.log('Processing SONG payment for song:', songId);

        const { data: song, error: updateError } = await supabase
          .from('songs')
          .update({
            paid: true,
            paid_at: new Date().toISOString(),
            stripe_session_id: session.id
          })
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
          }
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
