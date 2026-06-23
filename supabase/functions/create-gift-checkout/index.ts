// supabase/functions/create-gift-checkout/index.ts
//
// Creates a Stripe checkout session for the $5 "send this song as a scheduled
// surprise text" add-on, bought from the success page.
//
// Flow
// ----
//   1. Buyer fills the gift modal (recipient name + phone, THEIR name, a personal
//      message, a day/time) — the frontend converts the chosen local time to a
//      UTC instant using the buyer's own timezone and POSTs it here.
//   2. We validate (phone, future time, attestation), then run a Claude
//      moderation pass on the message. If it's abusive we STOP here — no row,
//      no Stripe session, no charge — and tell the buyer to revise.
//   3. We insert a scheduled_gift_messages row (status='awaiting_payment',
//      moderation_status='approved') and create the $5 Stripe session tagged
//      metadata.type='gift_sms' + gift_id.
//   4. Return { checkout_url }. After payment, stripe-webhook flips the row to
//      'scheduled'; the every-minute send-scheduled-gift-sms cron does the
//      actual Twilio scheduling/sending. We never touch Twilio here.
//
// Auth: verify_jwt = true. Frontend posts with the Supabase anon JWT (same as
// recover-song / create-clonamivoz-checkout).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@13.10.0?target=deno';
import { moderateGiftText } from '../_shared/moderate.ts';

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
const BASE_URL = Deno.env.get('BASE_URL') || 'https://regalosquecantan.com';

const PRICE_CENTS = 500; // $5.00 USD — edit here to change the price.
const MAX_MESSAGE_LEN = 300;
// Guardrails on the chosen send time (UTC instant from the browser).
const MIN_LEAD_MS = 2 * 60 * 1000;            // at least 2 min out (no past times)
const MAX_LEAD_MS = 365 * 24 * 3600 * 1000;   // at most ~1 year out

interface RequestBody {
  song_id?: string;
  recipient_name?: string;
  recipient_phone?: string;
  buyer_name?: string;
  personal_message?: string;
  send_at?: string;        // ISO-8601 UTC instant
  buyer_timezone?: string; // IANA tz, e.g. America/New_York
  email?: string;
  attestation?: boolean;
}

function toE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

function bad(status: number, error: string, message: string) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return bad(405, 'method_not_allowed', 'Use POST.');

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return bad(400, 'invalid_body', 'Expected JSON body.');
  }

  // ---------------- validate inputs ----------------
  if (!body.song_id) return bad(400, 'missing_song_id', 'song_id is required.');

  const buyerName = (body.buyer_name || '').trim();
  if (!buyerName) {
    return bad(400, 'missing_buyer_name', 'Tu nombre es requerido (el regalo no es anónimo).');
  }

  const to = toE164(body.recipient_phone || '');
  if (!to) {
    return bad(400, 'invalid_phone', 'El número de celular del destinatario no es válido.');
  }

  if (body.attestation !== true) {
    return bad(400, 'attestation_required', 'Debes confirmar que es un regalo bienvenido.');
  }

  const sendAtMs = Date.parse(body.send_at || '');
  if (!body.send_at || Number.isNaN(sendAtMs)) {
    return bad(400, 'invalid_send_at', 'La fecha y hora de envío no son válidas.');
  }
  const lead = sendAtMs - Date.now();
  if (lead < MIN_LEAD_MS) {
    return bad(400, 'send_at_too_soon', 'Elige una hora al menos unos minutos en el futuro.');
  }
  if (lead > MAX_LEAD_MS) {
    return bad(400, 'send_at_too_far', 'La fecha de envío es demasiado lejana.');
  }

  const message = (body.personal_message || '').trim().slice(0, MAX_MESSAGE_LEN);
  const recipientName = (body.recipient_name || '').trim() || null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---------------- the song must exist and be paid ----------------
  const { data: song, error: songErr } = await supabase
    .from('songs')
    .select('id, paid, payment_status, email, recipient_name')
    .eq('id', body.song_id)
    .maybeSingle();
  if (songErr) return bad(500, 'db_error', songErr.message);
  if (!song) return bad(404, 'song_not_found', 'No encontramos esa canción.');
  if (!(song.paid === true || song.payment_status === 'paid')) {
    return bad(409, 'song_not_paid', 'Solo se pueden enviar canciones ya pagadas.');
  }

  const buyerEmail =
    (body.email || song.email || '').trim().toLowerCase() || null;

  // ---------------- moderation gate (before any charge) ----------------
  const verdict = await moderateGiftText({
    message,
    recipientName: recipientName || undefined,
    senderName: buyerName,
  });
  if (!verdict.allowed) {
    return bad(
      422,
      'message_rejected',
      'Tu mensaje no pasó nuestra revisión. Por favor reescríbelo en un tono amable.',
    );
  }

  // ---------------- create the gift row (unpaid) ----------------
  const { data: gift, error: insertErr } = await supabase
    .from('scheduled_gift_messages')
    .insert({
      song_id: song.id,
      buyer_email: buyerEmail,
      buyer_name: buyerName,
      recipient_name: recipientName,
      recipient_phone: to,
      personal_message: message || null,
      send_at: new Date(sendAtMs).toISOString(),
      buyer_timezone: (body.buyer_timezone || '').slice(0, 64) || null,
      status: 'awaiting_payment',
      moderation_status: 'approved',
      amount_cents: PRICE_CENTS,
      attestation_accepted: true,
      marketing_excluded: true,
    })
    .select('id')
    .single();
  if (insertErr || !gift) {
    return bad(500, 'db_error', insertErr?.message || 'No se pudo guardar el regalo.');
  }

  // ---------------- Stripe checkout session ----------------
  const productName = recipientName
    ? `Envío sorpresa por mensaje — para ${recipientName}`
    : 'Envío sorpresa de tu canción por mensaje';

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      ...(buyerEmail ? { customer_email: buyerEmail } : {}),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: PRICE_CENTS,
            product_data: {
              name: productName,
              description: 'Programamos el envío de tu canción por mensaje de texto el día y la hora que elegiste.',
            },
          },
        },
      ],
      metadata: { type: 'gift_sms', gift_id: gift.id, songId: song.id },
      payment_intent_data: {
        metadata: { type: 'gift_sms', gift_id: gift.id, songId: song.id },
      },
      success_url: `${BASE_URL}/success?song_ids=${song.id}&gift=scheduled&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/success?song_ids=${song.id}&gift=cancelled`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[create-gift-checkout] Stripe session create failed:', msg);
    // Roll the draft back so it can't linger as an orphan awaiting_payment row.
    await supabase.from('scheduled_gift_messages').delete().eq('id', gift.id);
    return bad(502, 'stripe_error', msg);
  }

  await supabase
    .from('scheduled_gift_messages')
    .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
    .eq('id', gift.id);

  return new Response(
    JSON.stringify({ gift_id: gift.id, stripe_session_id: session.id, checkout_url: session.url }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
