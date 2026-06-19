// supabase/functions/animado-notify/index.ts
// Deploy with: supabase functions deploy animado-notify --project-ref yzbvajungshqcpusfiia
//
// Fulfillment nudges for the Animado pipeline, via SendGrid (sender hola@regalosquecantan.com):
//   { mode:'reminders' }            -> CRON: emails customers who paid but haven't uploaded a
//                                      photo yet (awaiting_photo > 1h, not reminded in 24h).
//   { mode:'redo', order_id, reason? } -> emails one customer asking for a better/clearer photo
//                                      (called by admin-story-videos when a likeness is rejected).
//
// Both link the customer back to their success page (where the upload lives), keyed by the
// Stripe session. Server-to-server / pg_cron -> verify_jwt = false.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER = 'hola@regalosquecantan.com';
const BASE_URL = 'https://regalosquecantan.com';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function uploadLink(sessionId: string, songId: string) {
  return `${BASE_URL}/success?session_id=${encodeURIComponent(sessionId)}&song_id=${encodeURIComponent(songId)}`;
}

function emailHtml(recipient: string, link: string, redo: boolean, reason?: string) {
  const lead = redo
    ? `Queremos que <strong>${recipient}</strong> salga perfecto en su película animada, pero la foto que recibimos no nos sirvió del todo${reason ? ` (${reason})` : ''}. ¿Nos mandas otra más clara?`
    : `¡Ya casi! Para empezar la película animada de <strong>${recipient}</strong> solo nos falta <strong>una buena foto</strong>.`;
  const tips = `De frente · buena luz · rostro cercano · sin lentes de sol ni gorra`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0d0b14;font-family:'Helvetica Neue',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#1a1622;border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#f5b942,#f20d80);padding:34px;text-align:center;"><p style="font-size:32px;margin:0 0 8px;">🎬📸</p><h1 style="color:#1a1020;font-size:23px;font-weight:800;margin:0;">${redo ? 'Necesitamos otra foto' : 'Solo falta una foto'}</h1></td></tr><tr><td style="padding:32px;text-align:center;"><p style="color:#e9e3f5;font-size:16px;line-height:1.6;margin:0 0 22px;">${lead}</p><a href="${link}" style="display:inline-block;background:#f20d80;color:#fff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 36px;border-radius:14px;">📸 Subir la foto</a><p style="color:#9b91ad;font-size:13px;margin:22px 0 0;line-height:1.6;">✅ ${tips}</p><p style="color:#6f6680;font-size:12px;margin:18px 0 0;">Si el botón no funciona, copia este enlace:<br/><span style="color:#c9bfe0;word-break:break-all;">${link}</span></p></td></tr><tr><td style="background:#13101a;padding:18px;text-align:center;border-top:1px solid #2a2436;"><p style="color:#6f6680;font-size:12px;margin:0;">Regalos Que Cantan — regalosquecantan.com</p></td></tr></table></td></tr></table></body></html>`;
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
      if (!r || !r.email || !r.o.stripe_session_id) return json(200, { sent: false, reason: 'missing email/session' });
      await send(r.email, `📸 Necesitamos otra foto para el video de ${r.recipient}`,
        emailHtml(r.recipient, uploadLink(r.o.stripe_session_id, r.o.song_id), true, reason),
        'animado_photo_redo');
      return json(200, { sent: true });
    }

    // default: reminders cron
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();        // paid > 1h ago
    const reCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // not reminded in 24h
    const { data: due } = await supabase.from('story_video_orders')
      .select('id, song_id, stripe_session_id, photo_reminder_at, created_at')
      .eq('state', 'awaiting_photo')
      .not('stripe_session_id', 'is', null)
      .lt('created_at', cutoff)
      .or(`photo_reminder_at.is.null,photo_reminder_at.lt.${reCutoff}`)
      .limit(25);

    let sent = 0;
    for (const o of due || []) {
      const { data: s } = await supabase.from('songs').select('email, recipient_name').eq('id', o.song_id).single();
      if (!s?.email) continue;
      try {
        await send(s.email, `📸 Tu película animada de ${s.recipient_name || 'tu ser querido'} te espera`,
          emailHtml(s.recipient_name || 'tu ser querido', uploadLink(o.stripe_session_id, o.song_id), false),
          'animado_photo_reminder');
        await supabase.from('story_video_orders').update({ photo_reminder_at: new Date().toISOString() }).eq('id', o.id);
        sent++;
      } catch (e) { console.error('reminder send failed', o.id, (e as any).message); }
    }
    return json(200, { sent, candidates: (due || []).length });
  } catch (e: any) {
    console.error('animado-notify error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
