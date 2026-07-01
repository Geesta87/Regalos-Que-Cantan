// supabase/functions/notify-upsell-ready/index.ts
// Deploy with: supabase functions deploy notify-upsell-ready --project-ref yzbvajungshqcpusfiia
//
// Async "your extra is ready" notifier. When a PAID upsell finishes — the $9.99
// slideshow video (inhouse-video-callback) or the karaoke sing-along video
// (api/render-lyric-video.js) — this emails + SMSes the customer ONE link to
// /success?song_ids=..., which surfaces everything they bought (song + video +
// karaoke + instrumental download). Upsells finish minutes to DAYS after the song,
// and nothing used to tell the customer; this closes that gap.
//
//   POST { song_id, kind?: 'video' | 'karaoke' }   (kind is just for the label/logs)
//
// De-dupe: an ATOMIC claim on songs.upsell_ready_notified_at with a cooldown, so if
// the video and karaoke land close together the customer gets ONE message, not two.
//
// Called server-to-server (no Supabase JWT) -> verify_jwt = false (config.toml).
// Best-effort: callers fire-and-forget; a notification failure never blocks delivery.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER = 'hola@regalosquecantan.com';
const SITE = 'https://regalosquecantan.com';
const WA_SUPPORT = 'https://wa.me/18183065193';
const COOLDOWN_HOURS = 3; // collapse a near-simultaneous video+karaoke into one message
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

// Same paid-confirmation gate the SMS auto-sender uses: a real Stripe confirmation,
// not an abandoned checkout or a $0 free order.
function isStripeConfirmed(s: Record<string, unknown>): boolean {
  if (!s.paid_at) return false;
  if (s.paid !== true && s.payment_status !== 'paid') return false;
  const amt = s.amount_paid != null ? parseFloat(String(s.amount_paid)) : 0;
  return amt > 0 || !!s.stripe_payment_id;
}

function toE164(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  if (d.length >= 11 && d.length <= 15) return '+' + d;
  return null;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function emailHtml(recipient: string, what: string, link: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0d0b14;font-family:'Helvetica Neue',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#1a1622;border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#f5b942,#f74da6);padding:36px;text-align:center;"><p style="font-size:34px;margin:0 0 8px;">🎉</p><h1 style="color:#fff;font-size:24px;font-weight:800;margin:0;">¡${cap(what)} ya está listo!</h1></td></tr><tr><td style="padding:32px;text-align:center;"><p style="color:#e9e3f5;font-size:16px;line-height:1.6;margin:0 0 8px;">${cap(what)} para <strong style="color:#fff;">${recipient}</strong> ya está listo. 💛</p><p style="color:#b8aecb;font-size:14px;line-height:1.6;margin:0 0 24px;">Abre este enlace para ver y descargar <strong>todo lo que compraste</strong> en un solo lugar — tu canción, tu video y tu karaoke.</p><a href="${link}" style="display:inline-block;background:#f74da6;color:#fff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 36px;border-radius:14px;">▶ Ver todo lo que compraste</a><p style="color:#9b91ad;font-size:13px;margin:24px 0 0;">Si el bot&oacute;n no funciona, copia este enlace:<br/><span style="color:#c9bfe0;word-break:break-all;">${link}</span></p></td></tr><tr><td style="background:#13101a;padding:20px;text-align:center;border-top:1px solid #2a2436;"><p style="color:#6f6680;font-size:12px;margin:0;">Regalos Que Cantan — regalosquecantan.com</p></td></tr></table></td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });

  try {
    const { song_id, kind, dry_run } = await req.json();
    if (!song_id) throw new Error('missing song_id');
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: song } = await admin.from('songs').select(
      'id, email, recipient_name, sender_name, whatsapp_phone, short_code, stripe_session_id, ' +
      'has_video, has_video_addon, karaoke_video_status, karaoke_status, ' +
      'paid, payment_status, paid_at, amount_paid, stripe_payment_id, sms_consent_at, upsell_ready_notified_at',
    ).eq('id', song_id).single();
    if (!song) throw new Error('song not found');
    if (!isStripeConfirmed(song)) return json(200, { ok: true, skipped: 'not_paid' });

    // Consolidated link across ALL songs in this purchase (bundle-aware): /success
    // shows the song(s) + video + karaoke + instrumental, and polls as they land.
    let ids = [song_id as string];
    if (song.stripe_session_id) {
      const { data: sibs } = await admin.from('songs')
        .select('id, created_at').eq('stripe_session_id', song.stripe_session_id)
        .order('created_at', { ascending: true });
      if (sibs && sibs.length) ids = sibs.map((s) => s.id as string);
    }
    const link = `${SITE}/success?song_ids=${ids.join(',')}`;

    // Label what just landed (the page itself shows everything either way).
    const videoReady = song.has_video === true;
    const karaokeReady = song.karaoke_video_status === 'ready';
    let what = 'tu extra';
    if (videoReady && karaokeReady) what = 'tu video y tu karaoke';
    else if (videoReady) what = 'tu video';
    else if (karaokeReady) what = 'tu karaoke para cantar';
    else if (kind === 'video') what = 'tu video';
    else if (kind === 'karaoke') what = 'tu karaoke para cantar';

    const recipient = String(song.recipient_name || 'tu ser querido').trim();
    const senderName = String(song.sender_name || '').trim();
    const subject = `🎉 ¡${cap(what)} para ${recipient} ya está listo!`;

    // SMS eligibility (consent + phone) — computed up front so the dry-run can preview it.
    const phone = String(song.whatsapp_phone || '').trim();
    const consentOk = !!song.sms_consent_at &&
      new Date(String(song.sms_consent_at)).getTime() > Date.now() - 30 * 24 * 3600 * 1000;

    // dry_run: show exactly what WOULD be sent — no claim, no send, no stamp.
    if (dry_run) {
      return json(200, {
        ok: true, dry_run: true, song_id, what, subject, link,
        would_email: song.email || null,
        would_sms: phone && consentOk ? toE164(phone) : null,
      });
    }

    // ATOMIC de-dupe claim: only proceed if we haven't notified within the cooldown.
    // If a concurrent video+karaoke both reach here, only the row-claim winner sends.
    const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600 * 1000).toISOString();
    const { data: claimed } = await admin
      .from('songs')
      .update({ upsell_ready_notified_at: new Date().toISOString() })
      .eq('id', song_id)
      .or(`upsell_ready_notified_at.is.null,upsell_ready_notified_at.lt.${cutoff}`)
      .select('id');
    if (!claimed || claimed.length === 0) return json(200, { ok: true, skipped: 'deduped' });

    // ---- EMAIL (transactional fulfillment — always send if we have an address) ----
    let emailed = false;
    if (song.email && SENDGRID_API_KEY) {
      try {
        const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SENDGRID_API_KEY}` },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: song.email }] }],
            from: { email: SENDER, name: 'Regalos Que Cantan' },
            subject: `🎉 ¡${cap(what)} para ${recipient} ya está listo!`,
            content: [{ type: 'text/html', value: emailHtml(recipient, what, link) }],
            categories: ['upsell_ready'],
          }),
        });
        emailed = resp.ok;
        if (!resp.ok) console.error('notify-upsell-ready sendgrid', resp.status, (await resp.text()).slice(0, 200));
      } catch (e) { console.error('notify-upsell-ready email error', (e as Error).message); }
    }

    // ---- SMS (only with consent + phone + not opted-out), mirroring send-song-ready-sms ----
    let texted = false;
    if (phone && consentOk) {
      const to = toE164(phone);
      if (to) {
        const { data: oo } = await admin.from('sms_conversations').select('opted_out').eq('phone', to).maybeSingle();
        if (!oo?.opted_out) {
          const greet = senderName ? `¡Hola ${senderName}!` : '¡Hola!';
          const body = `${greet} 🎉\n${cap(what)} para ${recipient} ya está listo. Aquí tienes TODO lo que compraste en un solo enlace:\n${link}\n¿Preguntas? WhatsApp: ${WA_SUPPORT}\nResponde STOP para dejar de recibir mensajes.`;
          const r = await sendSms(to, body);
          texted = r.ok;
          if (r.ok) {
            // Best-effort inbox log so it threads with replies (mirror send-song-ready-sms).
            try {
              const nowIso = new Date().toISOString();
              const { data: convo } = await admin.from('sms_conversations').select('id').eq('phone', to).maybeSingle();
              let conversationId = convo?.id as string | undefined;
              if (!conversationId) {
                const { data: created } = await admin.from('sms_conversations')
                  .insert({ phone: to, customer_name: senderName || null, order_id: song_id, last_message_at: nowIso })
                  .select('id').single();
                conversationId = created?.id as string | undefined;
              } else {
                await admin.from('sms_conversations').update({ last_message_at: nowIso }).eq('id', conversationId);
              }
              if (conversationId) {
                await admin.from('sms_messages').insert({
                  conversation_id: conversationId, direction: 'outbound', body, status: r.status || 'sent', twilio_sid: r.sid || null,
                });
              }
            } catch (logErr) { console.warn('notify-upsell-ready inbox log skipped', (logErr as Error).message); }
          } else {
            console.error('notify-upsell-ready sms failed', r.error);
          }
        }
      }
    }

    return json(200, { ok: true, song_id, what, link, emailed, texted });
  } catch (e) {
    console.error('notify-upsell-ready error:', e instanceof Error ? e.message : e);
    return json(500, { ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});
