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

// ─── Affiliate attribution helpers ───────────────────────────────────────
// These run at the moment a song flips to paid. They are intentionally
// idempotent against webhook retries: Stripe will redeliver checkout.session
// .completed if our handler ever returns non-2xx, and verify-payment can
// also reach us in parallel from the success page.
//
// Idempotency model: there is exactly one `purchase` event per song. We
// SELECT-then-INSERT under that invariant. Coupon usage is incremented only
// when the INSERT actually creates a new row, so a redelivery is a no-op.

async function recordAffiliatePurchase(
  supabase: any,
  song: { id: string; affiliate_code: string | null; coupon_code: string | null; amount_paid: number | string | null },
  fallbackAffiliateCode: string | null
): Promise<void> {
  const affiliateCode = (song.affiliate_code || fallbackAffiliateCode || '').toString().toLowerCase().trim();
  if (!affiliateCode) {
    return; // not an affiliate-attributed sale
  }

  // Verify the affiliate exists & is active. Guards against stale codes
  // surviving on a song row after the affiliate was deactivated.
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

  // Idempotency check (one purchase event per song)
  const { data: existing } = await supabase
    .from('affiliate_events')
    .select('id')
    .eq('song_id', song.id)
    .eq('event_type', 'purchase')
    .maybeSingle();
  if (existing) {
    return;
  }

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

  // Bump coupon usage ONCE per song. Safe even if multiple webhooks race —
  // the SELECT above gates this whole branch behind a successful INSERT.
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
              <p style="font-family:'Righteous',cursive;color:#ff6b35;font-size:36px;margin:0 0 4px;font-weight:400;">10% OFF</p>
              <p style="color:#c9b99a;font-size:14px;margin:0 0 12px;">Usa este c&oacute;digo al momento de pagar:</p>
              <div style="display:inline-block;background:#2a1408;border:1px solid #ff6b35;border-radius:8px;padding:10px 24px;">
                <span style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:4px;font-family:monospace;">VUELVE10</span>
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
  const recipientName = song.recipient_name || 'tu ser querido';
  const songTitle = song.song_title || `Canci\u00f3n para ${song.recipient_name || 'ti'}`;
  const senderName = song.sender_name || 'An\u00f3nimo';
  const genre = song.genre || 'Musical';
  const occasion = song.occasion || 'Especial';
  // Use durable /listen page link, NOT the raw audio_url (which can change as audio
  // moves from Mureka CDN → Supabase Storage). The page handles all URL states.
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

        <!-- Dark Hero Section -->
        <tr><td style="background:linear-gradient(180deg,#2a1408 0%,#1a0e08 100%);padding:50px 30px 40px;text-align:center;">
          <p style="color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px;">&#127881; COMPRA CONFIRMADA</p>
          <h1 style="font-family:'Righteous',cursive;color:#ffffff;font-size:36px;margin:0 0 4px;font-weight:400;">Oye, ${firstName}...</h1>
          <h2 style="font-family:'Righteous',cursive;color:#ffffff;font-size:32px;margin:0 0 24px;font-weight:400;">Tu canci&oacute;n ya es <span style="background:linear-gradient(135deg,#ff6b35,#ff8c42);padding:2px 12px;border-radius:8px;">tuya.</span></h2>
          <p style="color:#c9b99a;font-size:16px;margin:0;line-height:1.7;">Letra, melod&iacute;a y emoci&oacute;n &mdash; todo listo para<br>que llegue al coraz&oacute;n de <strong style="color:#ffd23f;">${recipientName}</strong>.</p>
        </td></tr>

        <!-- Download CTA Button -->
        <tr><td style="background-color:#1a0e08;padding:10px 30px 16px;text-align:center;">
          <a href="${listenUrl}" style="display:inline-block;background:linear-gradient(135deg,#ff6b35 0%,#ff8c42 100%);color:#ffffff;padding:18px 44px;border-radius:50px;text-decoration:none;font-weight:800;font-size:18px;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;box-shadow:0 4px 20px rgba(255,107,53,0.4);">
            &#127911; Escuchar y Descargar
          </a>
        </td></tr>

        <tr><td style="background-color:#1a0e08;padding:0 30px 30px;text-align:center;">
          <p style="color:#a67c52;font-size:13px;margin:0;">&#128274; Este enlace no expira &middot; Escucha y descarga cuando quieras</p>
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
                <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 8px;font-family:'Righteous',cursive;">${songTitle}</p>
                <p style="color:#a67c52;font-size:13px;margin:0 0 12px;">Para <strong style="color:#ffd23f;">${recipientName}</strong> &middot; De: ${senderName}<br>Estilo: <span style="text-transform:capitalize;">${genre}</span> &middot; Ocasi&oacute;n: <span style="text-transform:capitalize;">${occasion}</span></p>
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
    
    // Verify webhook signature.
    // IMPORTANT: must use constructEventAsync in Deno — constructEvent uses
    // Node's sync crypto which is not available in the Edge Functions runtime
    // and throws "use constructEventAsync()" → 400 on every webhook.
    const event = await stripe.webhooks.constructEventAsync(
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

      // ✅ IDEMPOTENCY CHECK: if song already paid AND email already sent, skip.
      // If song already paid but email NOT sent (e.g. verify-payment marked it
      // paid first but its SendGrid call failed), fall through and send now.
      const { data: existingPaid } = await supabase
        .from('songs')
        .select('*')
        .eq('id', songIds[0])
        .single();

      if (existingPaid?.paid && existingPaid?.stripe_session_id === session.id) {
        // Self-heal affiliate attribution if a previous run (verify-payment
        // or an earlier deploy) marked the song paid without recording the
        // purchase event. recordAffiliatePurchase is idempotent — no-op if
        // the event already exists.
        try {
          await recordAffiliatePurchase(supabase, existingPaid, session.metadata?.affiliateCode || null);
        } catch (affErr: any) {
          console.error(`[affiliate] self-heal failed for already-paid song ${existingPaid.id}:`, affErr?.message || affErr);
        }

        const { data: emailEvent } = await supabase
          .from('funnel_events')
          .select('id')
          .eq('step', 'purchase_email_sent')
          .contains('metadata', { stripe_session_id: session.id })
          .maybeSingle();

        if (emailEvent) {
          console.log('⏭️ Already processed (paid + email sent):', session.id);
          return new Response(JSON.stringify({ received: true, status: 'already_processed' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
          });
        }

        // Paid but email not sent — recover by sending email now and returning.
        console.log('🟡 Already paid but no purchase_email_sent — sending email now for session:', session.id);
        const recoveryEmail = session.metadata?.email || session.customer_email || existingPaid.email;
        if (recoveryEmail) {
          let emailOk = false;
          let emailErr: string | null = null;
          try {
            await sendEmail(
              recoveryEmail,
              `🎵 Tu canción para ${existingPaid.recipient_name} está lista!`,
              getPurchaseEmailHtml(existingPaid),
              'purchase_confirmation'
            );
            emailOk = true;
            console.log('📧 Purchase email sent (recovery) to:', recoveryEmail, 'song:', existingPaid.id);
          } catch (emailError: any) {
            emailErr = emailError?.message || String(emailError);
            console.error('🔴 Failed to send recovery purchase email:', emailErr);
          }
          try {
            await supabase.from('funnel_events').insert([{
              session_id: session.id,
              step: emailOk ? 'purchase_email_sent' : 'purchase_email_failed',
              metadata: {
                stripe_session_id: session.id,
                song_ids: songIds,
                email: recoveryEmail,
                error: emailErr,
                attempted_at: new Date().toISOString(),
                source: 'stripe-webhook-recovery',
              },
            }]);
          } catch (logErr) {
            console.error('Failed to log recovery purchase email status:', logErr);
          }
        } else {
          console.warn('🟡 Already-paid recovery: no email available for song', existingPaid.id);
        }
        return new Response(JSON.stringify({ received: true, status: 'paid_email_recovered' }), {
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

        // Affiliate attribution: record the purchase event + bump coupon
        // usage. Idempotent against webhook retries. Wrapped so a failure
        // never blocks the payment flow — the customer has paid and
        // everything downstream (email, social clip) must still run.
        try {
          await recordAffiliatePurchase(supabase, song, session.metadata?.affiliateCode || null);
        } catch (affErr: any) {
          console.error(`[affiliate] recordAffiliatePurchase threw for song ${sid}:`, affErr?.message || affErr);
        }

        // Fire-and-forget: render a 60s social media clip for this paid song.
        // render-social-clip is idempotent (UNIQUE index on social_posts.song_id)
        // and gated by SOCIAL_CLIPS_ENABLED env var. Failures here MUST NOT
        // block the payment flow — wrapped in try/catch + 3s race timeout so
        // even a hung edge-function call can never delay the webhook response.
        try {
          const clipPromise = fetch(`${SUPABASE_URL}/functions/v1/render-social-clip`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ songId: sid }),
          });
          const timeoutPromise = new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('render-social-clip trigger timeout')), 3000)
          );
          const clipResponse = await Promise.race([clipPromise, timeoutPromise]);
          if (!clipResponse.ok) {
            console.warn(`[render-social-clip] non-2xx for ${sid}: ${clipResponse.status}`);
          }
        } catch (clipErr: any) {
          console.warn(`[render-social-clip] trigger failed for ${sid}:`, clipErr?.message || clipErr);
        }
      }

      // Send email with download link via SendGrid (use first song for template).
      // De-dup against funnel_events so verify-payment + webhook can't both
      // send. Log success/failure so admin + health-check can detect issues.
      if (email && firstSong) {
        const { data: existingEmailEvent } = await supabase
          .from('funnel_events')
          .select('id')
          .eq('step', 'purchase_email_sent')
          .contains('metadata', { stripe_session_id: session.id })
          .maybeSingle();

        if (existingEmailEvent) {
          console.log('⏭️ purchase email already sent for session', session.id, '- skipping');
        } else {
          let emailOk = false;
          let emailErr: string | null = null;
          try {
            await sendEmail(
              email,
              `🎵 Tu canción para ${firstSong.recipient_name} está lista!`,
              getPurchaseEmailHtml(firstSong),
              'purchase_confirmation'
            );
            emailOk = true;
            console.log('📧 Purchase email sent to:', email, 'for songs:', songIds);
          } catch (emailError: any) {
            emailErr = emailError?.message || String(emailError);
            console.error('🔴 Failed to send purchase email:', emailErr, 'songId:', firstSong.id, 'email:', email);
          }
          try {
            await supabase.from('funnel_events').insert([{
              session_id: session.id,
              step: emailOk ? 'purchase_email_sent' : 'purchase_email_failed',
              metadata: {
                stripe_session_id: session.id,
                song_ids: songIds,
                email,
                error: emailErr,
                attempted_at: new Date().toISOString(),
                source: 'stripe-webhook',
              },
            }]);
          } catch (logErr) {
            console.error('Failed to log purchase email status:', logErr);
          }
        }
      } else if (firstSong && !email) {
        console.warn('🟡 No email on session for songId:', firstSong.id);
        try {
          await supabase.from('funnel_events').insert([{
            session_id: session.id,
            step: 'purchase_email_skipped_no_email',
            metadata: { stripe_session_id: session.id, song_ids: songIds },
          }]);
        } catch {}
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
            session_id: session.id,
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
                  ? `${siteUrl}/listen?song_ids=${songIds.join(',')}&coupon=VUELVE10`
                  : `${siteUrl}/listen?song_id=${songIds[0]}&coupon=VUELVE10`;

                await sendEmail(
                  email,
                  `🎵 ${song.recipient_name ? `Tu canción para ${song.recipient_name}` : 'Tu canción'} te espera — 10% OFF`,
                  getAbandonedCheckoutEmailHtml(song, listenUrl),
                  'checkout_recovery'
                );

                // Log that we sent the recovery email (prevents duplicates)
                await supabase
                  .from('funnel_events')
                  .insert([{
                    session_id: session.id,
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
            session_id: session.id,
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

    // ========== HANDLE REFUNDS (affiliate commission reversal) ==========
    // Subscribe to `charge.refunded` in the Stripe Dashboard for this to fire.
    // We log a negative-amount `refund` event scoped to the original song so
    // affiliate-data subtracts it from commission. Idempotent per (song_id,
    // refund_id) — Stripe may redeliver the event.
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id || null;

      if (!paymentIntentId) {
        console.warn('[refund] charge.refunded with no payment_intent — skipping');
      } else {
        // Find the affected songs. stripe_payment_id is set by verify-payment
        // when it wins the race; if only stripe-webhook ran, we need to
        // resolve via the checkout session.
        let { data: refundedSongs } = await supabase
          .from('songs')
          .select('id, affiliate_code, coupon_code, amount_paid, stripe_session_id')
          .eq('stripe_payment_id', paymentIntentId);

        if (!refundedSongs || refundedSongs.length === 0) {
          // Fall back: ask Stripe which session this PI belongs to, then
          // look up the song(s) by stripe_session_id.
          try {
            const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
            const session = sessions.data[0];
            if (session) {
              const { data: viaSession } = await supabase
                .from('songs')
                .select('id, affiliate_code, coupon_code, amount_paid, stripe_session_id')
                .eq('stripe_session_id', session.id);
              refundedSongs = viaSession || [];
            }
          } catch (lookupErr: any) {
            console.error('[refund] session lookup failed for PI', paymentIntentId, lookupErr?.message || lookupErr);
          }
        }

        if (!refundedSongs || refundedSongs.length === 0) {
          console.warn('[refund] no song found for charge', charge.id, 'PI', paymentIntentId);
        } else {
          // Total refunded so far on this charge in dollars.
          const refundedTotal = (charge.amount_refunded || 0) / 100;
          // Use the latest refund in the charge as the de-dup key.
          const latestRefund = (charge.refunds?.data || [])[0];
          const refundIdKey = latestRefund?.id || `charge_${charge.id}`;

          for (const song of refundedSongs) {
            if (!song.affiliate_code) continue; // not affiliate-attributed

            // Idempotency: one refund event per (song, refund-id).
            const { data: existing } = await supabase
              .from('affiliate_events')
              .select('id, amount, created_at')
              .eq('song_id', song.id)
              .eq('event_type', 'refund');

            // If we've already logged a refund event for this exact refund_id
            // (encoded in created_at-tagged metadata isn't available, so we
            // gate on absolute total), skip. Simplest: only one refund event
            // per song. If the customer is partially refunded multiple times
            // we use the cumulative total for the latest entry.
            const refundAmount = Math.min(refundedTotal, parseFloat(String(song.amount_paid || '0')) || refundedTotal);

            if (existing && existing.length > 0) {
              // Already have a refund event — update if the cumulative
              // amount changed (e.g. second partial refund).
              const prevAmount = Math.abs(parseFloat(String(existing[0].amount || '0')) || 0);
              if (Math.abs(refundAmount - prevAmount) < 0.005) {
                continue; // no change
              }
              await supabase
                .from('affiliate_events')
                .update({ amount: -refundAmount })
                .eq('id', existing[0].id);
              console.log(`[refund] updated existing refund event for song ${song.id} → -${refundAmount}`);
            } else {
              await supabase.from('affiliate_events').insert({
                affiliate_code: song.affiliate_code,
                event_type: 'refund',
                song_id: song.id,
                amount: -refundAmount,
              });
              console.log(`[refund] recorded refund event — code=${song.affiliate_code} song=${song.id} amount=-${refundAmount} refund=${refundIdKey}`);
            }
          }

          // Mark the song(s) as refunded so the admin dashboard reflects it.
          for (const song of refundedSongs) {
            await supabase
              .from('songs')
              .update({ payment_status: 'refunded' })
              .eq('id', song.id);
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
