// supabase/functions/animado-notify/index.ts
// Deploy with: supabase functions deploy animado-notify --project-ref yzbvajungshqcpusfiia
//
// Fulfillment nudges for the Animado pipeline, via SendGrid (sender hola@regalosquecantan.com):
//   { mode:'reminders' }            -> CRON: emails customers who paid but haven't uploaded a
//                                      photo yet (awaiting_photo > 1h, not reminded in 24h).
//                                      Capped at 4 reminders per order, then it stops nagging.
//   { mode:'redo', order_id, reason? } -> emails one customer asking for a better/clearer photo
//                                      (called by admin-story-videos when a likeness is rejected).
//
// Both link the customer back to their success page (where the upload lives), keyed by SONG ID.
// Server-to-server / pg_cron -> verify_jwt = false.
//
// NOTE (2026-08-13): rewritten from the DEPLOYED source. The repo copy had fallen
// far behind production — missing the 'clarify' mode, ALL SMS sending, the
// 4-reminder cap, and the shared email shell. Deploying that copy would have
// stripped those from production.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { renderEmail } from '../_shared/email-shell.ts';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER = 'hola@regalosquecantan.com';
const BASE_URL = 'https://regalosquecantan.com';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Keyed by SONG ID, deliberately — NOT the Stripe session.
//
// This link used to carry session_id, and session_id is what authorizes
// charge-upsell against the customer's saved card (charge-upsell accepts a
// charge when the session matches the song's). That made every photo-reminder
// email and SMS a one-tap "$5" charge waiting to happen for anyone who saw it —
// a forwarded message, a shared phone, an inbox someone else opens.
//
// It only carried the session because confirm-animado-order could not find the
// film any other way. Since 2026-08-13 that function resolves an existing order
// from song ids (read-only, no charge authority), so the reminder can point at
// the same upload screen without handing out the ability to bill anyone.
//
// The upload itself never needed the session: every handler on the success page
// (sign / attach / analyze / confirm-cast) keys on the story_video_order id.
function uploadLink(songId: string) {
  return `${BASE_URL}/success?song_ids=${encodeURIComponent(songId)}`;
}

// Rebuilt on the shared brand shell (_shared/email-shell.ts). The upload link is
// passed straight through as ctaHref — the URL is unchanged from the caller, so
// both modes keep pointing at the same /success upload page they always did.
function emailHtml(recipient: string, link: string, redo: boolean, reason?: string) {
  const name = recipient;
  if (redo) {
    return renderEmail({
      palette: 'reminder',
      hero: 'photos',
      preheader: 'Necesitamos otra foto más clara para empezar tu película animada.',
      eyebrow: 'Necesitamos otra foto',
      headline: `Necesitamos otra foto de <span style="color:#f0c780;">${name}</span>.`,
      sub: `La foto que subiste no nos deja capturar bien su parecido. &iquest;Nos mandas otra m&aacute;s clara, de frente y con buena luz?${reason ? ` (${reason})` : ''}`,
      ctaText: 'Subir otra foto&nbsp;&nbsp;&#8594;',
      ctaHref: link,
      subcopy: 'Con una foto n&iacute;tida el resultado queda incre&iacute;ble.',
    });
  }
  return renderEmail({
    palette: 'reminder',
    hero: 'photos',
    preheader: 'Ya pagaste tu película animada — solo falta una buena foto.',
    eyebrow: 'Solo falta tu foto',
    headline: `Tu pel&iacute;cula de <span style="color:#f0c780;">${name}</span> te espera.`,
    sub: 'Ya pagaste la pel&iacute;cula animada &mdash; solo necesitamos una buena foto para empezar.',
    ctaText: 'Subir mi foto&nbsp;&nbsp;&#8594;',
    ctaHref: link,
    subcopy: 'Toma un minuto &mdash; y arrancamos tu pel&iacute;cula.',
  });
}

async function send(to: string, subject: string, html: string, category: string) {
  if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: SENDER, name: 'Regalos Que Cantan' },
      subject, content: [{ type: 'text/html', value: html }], categories: [category],
    }),
  });
  if (!r.ok) throw new Error(`SendGrid ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { mode, order_id, reason } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // helper: load an order + its song's email/recipient
    const loadOrder = async (id: string) => {
      const { data: o } = await supabase.from('story_video_orders')
        .select('id, song_id, stripe_session_id, state').eq('id', id).single();
      if (!o) return null;
      const { data: s } = await supabase.from('songs').select('email, recipient_name').eq('id', o.song_id).single();
      return { o, email: s?.email, recipient: s?.recipient_name || 'tu ser querido' };
    };

    if (mode === 'redo') {
      if (!order_id) throw new Error('Missing order_id');
      const r = await loadOrder(order_id);
      // The stripe_session_id check stays as a PAID-ness proxy even though the
      // link no longer uses it — dropping it here would start emailing orders
      // that have never been gated before. Widening who gets mail is a separate
      // decision from de-fanging the link, so it is deliberately left alone.
      if (!r || !r.email || !r.o.stripe_session_id) return json(200, { sent: false, reason: 'missing email/session' });
      await send(r.email, `📸 Necesitamos otra foto para el video de ${r.recipient}`,
        emailHtml(r.recipient, uploadLink(r.o.song_id), true, reason),
        'animado_photo_redo');
      return json(200, { sent: true });
    }

    if (mode === 'clarify') {
      // Group-photo disambiguation: the uploaded photo has several people and we
      // need the customer to tell us which one is the recipient (and who they are),
      // with a WhatsApp/SMS link for a fast reply. Admin-triggered.
      if (!order_id) throw new Error('Missing order_id');
      const { data: o } = await supabase.from('story_video_orders').select('id, song_id').eq('id', order_id).single();
      if (!o) return json(200, { sent: false, reason: 'order not found' });
      const { data: s } = await supabase.from('songs').select('email, recipient_name, sender_name').eq('id', o.song_id).single();
      if (!s?.email) return json(200, { sent: false, reason: 'no email on order' });
      const recipient = s.recipient_name || 'tu ser querido';
      const sender = s.sender_name || '';
      const wa = `https://wa.me/18183065193?text=${encodeURIComponent(`Hola, soy ${sender} (película animada de ${recipient}). Les confirmo quién es quién en la foto.`)}`;
      const html = renderEmail({
        palette: 'reminder',
        hero: 'photos',
        preheader: 'Necesitamos saber quién es quién en tu foto para tu película animada.',
        eyebrow: 'Una pregunta rápida',
        headline: `¿Quién es <span style="color:#f0c780;">${recipient}</span> en la foto?`,
        sub: `Estamos creando tu pel&iacute;cula animada para ${recipient} y queremos que quede perfecta. En la foto que nos enviaste aparecen <b>varias personas</b>, as&iacute; que para animar exactamente a quienes deben salir necesitamos que nos confirmes dos cositas:<br><br><b>1.</b> &iquest;Cu&aacute;l de las personas es ${recipient}?<br><b>2.</b> &iquest;Cu&aacute;l eres t&uacute;${sender ? `, ${sender}` : ''}?<br><br>Puedes describirlas por su ropa o su lugar en la foto. Y si tienes una foto donde se vea bien el rostro de ${recipient} sola, a&uacute;n mejor.`,
        ctaText: 'Responder por WhatsApp&nbsp;&nbsp;&#8594;',
        ctaHref: wa,
        subcopy: 'O m&aacute;ndanos un SMS al +1 (818) 306-5193 &mdash; as&iacute; nos coordinamos m&aacute;s r&aacute;pido.',
      });
      await send(s.email, `📸 Una pregunta rápida sobre tu película animada de ${recipient}`, html, 'animado_clarify');
      return json(200, { sent: true, to: s.email });
    }

    // default: reminders cron
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();        // paid > 1h ago
    const reCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // not reminded in 24h
    const { data: due } = await supabase.from('story_video_orders')
      .select('id, song_id, stripe_session_id, photo_reminder_at, photo_reminder_count, created_at, customer_phone')
      .eq('state', 'awaiting_photo')
      // Same reasoning as the redo branch: kept as a paid-ness gate, not because
      // the link needs it. Removing it would widen the reminder audience.
      .not('stripe_session_id', 'is', null)
      .lt('created_at', cutoff)
      .lt('photo_reminder_count', 4)   // stop after 4 reminders — don't nag forever
      .or(`photo_reminder_at.is.null,photo_reminder_at.lt.${reCutoff}`)
      .limit(25);

    let sent = 0, smsSent = 0;
    for (const o of due || []) {
      const { data: s } = await supabase.from('songs')
        .select('email, recipient_name, whatsapp_phone, sms_consent_at').eq('id', o.song_id).single();
      if (!s?.email) continue;
      const who = s.recipient_name || 'tu ser querido';
      const link = uploadLink(o.song_id);
      let delivered = false;
      // 1) email (primary channel, unchanged)
      try {
        await send(s.email, `📸 Tu película animada de ${who} te espera`,
          emailHtml(who, link, false), 'animado_photo_reminder');
        delivered = true;
      } catch (e) { console.error('reminder email failed', o.id, (e as any).message); }
      // 2) SMS — closes the loop for buyers who ignore email, but SPARINGLY: texts
      //    are more intrusive than email and over-texting risks STOP opt-outs +
      //    carrier filtering. So SMS fires on ONLY the 1st reminder and the last
      //    (4th) one — at most 2 texts, while all 4 emails still go. reminderNum is
      //    0-indexed: 0 = first send, 3 = final (the query caps count < 4).
      //    Phone source: the order's customer_phone (captured on the upload screen =
      //    clear intent), else the song's whatsapp_phone ONLY if consent was recorded.
      //    Best-effort: an SMS failure never blocks the email flow or the stamp.
      const reminderNum = o.photo_reminder_count ?? 0;
      const smsThisTime = reminderNum === 0 || reminderNum === 3;
      const smsTo = smsThisTime ? (o.customer_phone || (s.sms_consent_at ? s.whatsapp_phone : null)) : null;
      if (smsTo) {
        try {
          const r = await sendSms(String(smsTo),
            `Regalos Que Cantan: Tu película animada de ${who} ya está pagada — solo falta tu foto para crearla. Súbela aquí: ${link}`);
          if (r.ok) { delivered = true; smsSent++; }
          else console.warn('reminder sms not sent', o.id, r.error);
        } catch (e) { console.error('reminder sms failed', o.id, (e as any).message); }
      }
      // stamp only if at least one channel went out, so a total failure retries next run
      if (delivered) {
        await supabase.from('story_video_orders').update({
          photo_reminder_at: new Date().toISOString(),
          photo_reminder_count: (o.photo_reminder_count ?? 0) + 1,
        }).eq('id', o.id);
        sent++;
      }
    }
    return json(200, { sent, smsSent, candidates: (due || []).length });
  } catch (e: any) {
    console.error('animado-notify error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
