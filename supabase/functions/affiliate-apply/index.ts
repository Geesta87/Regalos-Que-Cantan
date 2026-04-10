// supabase/functions/affiliate-apply/index.ts
// Receives the public application form from /afiliados and emails the team.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const ADMIN_EMAIL = 'hola@regalosquecantan.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name, email, social, audience, message } = await req.json();

    if (!name || !email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nombre y email son requeridos' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (SENDGRID_API_KEY) {
      const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f0f5ff;font-family:'Helvetica Neue',Arial,sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.06);"><tr><td style="background:linear-gradient(135deg,#004d40,#00796b);padding:32px;text-align:center;"><p style="font-size:28px;margin:0 0 8px;">🤝</p><h1 style="color:#fff;font-size:22px;font-weight:800;margin:0;">Nueva Solicitud de Partner</h1></td></tr><tr><td style="padding:32px;"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;"><span style="color:#64748b;font-size:13px;font-weight:600;">Nombre:</span><br/><span style="color:#1e3a5f;font-size:16px;font-weight:700;">${name}</span></td></tr><tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;"><span style="color:#64748b;font-size:13px;font-weight:600;">Email:</span><br/><span style="color:#1e3a5f;font-size:16px;font-weight:700;">${email}</span></td></tr><tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;"><span style="color:#64748b;font-size:13px;font-weight:600;">Red social:</span><br/><span style="color:#1e3a5f;font-size:16px;font-weight:700;">${social || 'No especificada'}</span></td></tr><tr><td style="padding:12px 0;border-bottom:1px solid #f1f5f9;"><span style="color:#64748b;font-size:13px;font-weight:600;">Audiencia:</span><br/><span style="color:#1e3a5f;font-size:16px;font-weight:700;">${audience || 'No especificado'}</span></td></tr>${message ? `<tr><td style="padding:12px 0;"><span style="color:#64748b;font-size:13px;font-weight:600;">Mensaje:</span><br/><span style="color:#1e3a5f;font-size:14px;">${message}</span></td></tr>` : ''}</table><div style="margin-top:24px;padding:16px;background:#ecfdf5;border-radius:12px;border:1px solid #a7f3d0;text-align:center;"><p style="color:#059669;font-size:14px;font-weight:700;margin:0;">Siguiente paso: Crear su cuenta en el Admin Dashboard</p></div></td></tr><tr><td style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;"><p style="color:#94a3b8;font-size:12px;margin:0;">RegalosQueCantan — Programa de Partners</p></td></tr></table></td></tr></table></body></html>`;

      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SENDGRID_API_KEY}`
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: ADMIN_EMAIL }] }],
          from: { email: ADMIN_EMAIL, name: 'RegalosQueCantan Partners' },
          reply_to: { email: email, name: name },
          subject: `Nueva solicitud de partner: ${name}`,
          content: [{ type: 'text/html', value: emailHtml }],
          categories: ['affiliate_application', 'rqc']
        })
      });

      if (!response.ok) {
        console.error('SendGrid error:', response.status, await response.text());
      } else {
        console.log('Application notification sent for:', name, email);
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Solicitud recibida' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Affiliate apply error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
