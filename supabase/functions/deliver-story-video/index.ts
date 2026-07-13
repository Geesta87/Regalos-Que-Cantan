// supabase/functions/deliver-story-video/index.ts
// Deploy with: supabase functions deploy deliver-story-video --project-ref yzbvajungshqcpusfiia
//
// Pipeline EXIT: emails the customer their finished animated story video via SendGrid
// (sender hola@regalosquecantan.com, matches the other senders) and marks the order
// delivered. Called by admin-story-videos.approve_final.
//   { story_video_order_id, dry_run? }  (dry_run returns the email without sending)
// Server-to-server (no Supabase JWT) -> verify_jwt = false (config.toml).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const SENDER = 'hola@regalosquecantan.com';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

function emailHtml(recipient: string, videoUrl: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#0d0b14;font-family:'Helvetica Neue',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#1a1622;border-radius:20px;overflow:hidden;"><tr><td style="background:linear-gradient(135deg,#f20d80,#7b2ff7);padding:36px;text-align:center;"><p style="font-size:34px;margin:0 0 8px;">🎬✨</p><h1 style="color:#fff;font-size:24px;font-weight:800;margin:0;">¡Tu video animado está listo!</h1></td></tr><tr><td style="padding:32px;text-align:center;"><p style="color:#e9e3f5;font-size:16px;line-height:1.6;margin:0 0 24px;">Convertimos la historia de <strong style="color:#fff;">${recipient}</strong> en una pel&iacute;cula animada estilo Pixar, hecha a partir de su canci&oacute;n. 💛</p><a href="${videoUrl}" style="display:inline-block;background:#f20d80;color:#fff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 36px;border-radius:14px;">▶ Ver tu video</a><p style="color:#9b91ad;font-size:13px;margin:24px 0 0;">Si el bot&oacute;n no funciona, copia este enlace:<br/><span style="color:#c9bfe0;word-break:break-all;">${videoUrl}</span></p></td></tr><tr><td style="background:#13101a;padding:20px;text-align:center;border-top:1px solid #2a2436;"><p style="color:#6f6680;font-size:12px;margin:0;">Regalos Que Cantan — regalosquecantan.com</p></td></tr></table></td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const json = (c: number, o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, 'Content-Type': 'application/json' }, status: c });
  try {
    const { story_video_order_id, dry_run } = await req.json();
    if (!story_video_order_id) throw new Error('Missing story_video_order_id');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: order, error } = await supabase.from('story_video_orders')
      .select('id, video_url, song_id, state').eq('id', story_video_order_id).single();
    if (error || !order) throw new Error('order not found');
    if (!order.video_url) throw new Error('order has no video_url');

    const { data: song } = await supabase.from('songs').select('email, recipient_name, sender_name').eq('id', order.song_id).single();
    const to = song?.email;
    if (!to) throw new Error('no customer email on the song');
    const recipient = song?.recipient_name || 'tu ser querido';
    // branded link (vercel.json rewrites /animado/:orderId -> the storage mp4)
    const videoLink = `https://regalosquecantan.com/animado/${order.id}`;
    const html = emailHtml(recipient, videoLink);

    if (dry_run) return json(200, { success: true, dry_run: true, to, subject: `🎬 El video animado de ${recipient} ya está listo`, html_preview: html.slice(0, 200) + '...' });
    if (!SENDGRID_API_KEY) throw new Error('SENDGRID_API_KEY not set');

    const resp = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SENDGRID_API_KEY}` },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: SENDER, name: 'Regalos Que Cantan' },
        subject: `🎬 El video animado de ${recipient} ya está listo`,
        content: [{ type: 'text/html', value: html }],
        categories: ['story_video_delivery'],
      }),
    });
    if (!resp.ok) throw new Error(`SendGrid ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

    await supabase.from('story_video_orders').update({ state: 'delivered', delivered_at: new Date().toISOString() }).eq('id', story_video_order_id);
    return json(200, { success: true, delivered_to: to });
  } catch (e: any) {
    console.error('deliver-story-video error:', e.message);
    return json(500, { success: false, error: e.message });
  }
});
