// supabase/functions/create-affiliate/index.ts
// Admin endpoint: creates a new affiliate row, optional matching coupon, and emails credentials.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as hexEncode } from 'https://deno.land/std@0.168.0/encoding/hex.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HASH_SALT = Deno.env.get('AFFILIATE_JWT_SECRET') || 'rqc-affiliate-secret-2026';
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');

async function hashPassword(password: string): Promise<string> {
  const data = new TextEncoder().encode(HASH_SALT + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new TextDecoder().decode(hexEncode(new Uint8Array(hash)));
}

function getWelcomeEmailHtml(name: string, email: string, password: string, code: string, couponCode: string | null): string {
  const firstName = name.split(' ')[0];
  const affiliateLink = `https://regalosquecantan.com/?ref=${code}`;
  const loginUrl = 'https://regalosquecantan.com/afiliado';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background-color:#f0f5ff;font-family:'Nunito','Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f5ff;padding:0;">
    <tr><td align="center" style="padding:24px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr><td style="background:linear-gradient(135deg,#1e3a5f,#1d4ed8);padding:40px 40px 32px;text-align:center;">
          <p style="font-size:36px;margin:0 0 12px;">🎵</p>
          <h1 style="font-family:'Nunito',sans-serif;color:#ffffff;font-size:24px;font-weight:800;margin:0 0 4px;">RegalosQueCantan</h1>
          <p style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0;">Partner Portal</p>
        </td></tr>
        <tr><td style="padding:40px 40px 24px;text-align:center;">
          <h2 style="font-size:28px;font-weight:800;color:#1e3a5f;margin:0 0 12px;">¡Bienvenido, ${firstName}!</h2>
          <p style="font-size:16px;color:#64748b;line-height:1.7;margin:0;">Tu cuenta de afiliado ha sido creada. Estas listo para empezar a ganar <strong style="color:#1e3a5f;">20% de comision</strong> por cada venta que generes.</p>
        </td></tr>
        <tr><td style="padding:0 40px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f7ff;border-radius:16px;border:1px solid #dbeafe;">
            <tr><td style="padding:28px;">
              <p style="font-size:12px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Tus credenciales de acceso</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600;">Portal:</td><td style="padding:8px 0;text-align:right;"><a href="${loginUrl}" style="color:#2563eb;font-weight:700;text-decoration:none;font-size:14px;">${loginUrl}</a></td></tr>
                <tr><td colspan="2" style="border-bottom:1px solid #e2e8f0;"></td></tr>
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600;">Email:</td><td style="padding:8px 0;text-align:right;color:#1e3a5f;font-weight:700;font-size:14px;">${email}</td></tr>
                <tr><td colspan="2" style="border-bottom:1px solid #e2e8f0;"></td></tr>
                <tr><td style="padding:8px 0;color:#64748b;font-size:14px;font-weight:600;">Contrasena:</td><td style="padding:8px 0;text-align:right;color:#1e3a5f;font-weight:700;font-size:14px;font-family:monospace;">${password}</td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 40px 24px;text-align:center;"><a href="${loginUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;padding:18px 48px;border-radius:14px;text-decoration:none;font-weight:800;font-size:16px;font-family:'Nunito',sans-serif;box-shadow:0 8px 24px rgba(37,99,235,0.3);">Iniciar Sesion →</a></td></tr>
        <tr><td style="padding:0 40px;"><div style="height:1px;background:#e2e8f0;"></div></td></tr>
        <tr><td style="padding:24px 40px;">
          <p style="font-size:12px;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:2px;margin:0 0 16px;">Tus herramientas</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:12px;"><tr><td style="padding:16px 20px;"><p style="font-size:11px;color:#2563eb;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;">Tu link de afiliado</p><p style="font-size:14px;color:#1e3a5f;font-weight:600;margin:0;word-break:break-all;">${affiliateLink}</p></td></tr></table>
          ${couponCode ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;"><tr><td style="padding:16px 20px;"><p style="font-size:11px;color:#1d4ed8;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;">Tu codigo de descuento</p><p style="font-size:20px;color:#1e3a5f;font-weight:800;letter-spacing:4px;margin:0;">${couponCode}</p></td></tr></table>` : ''}
        </td></tr>
        <tr><td style="padding:0 40px 32px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#ecfdf5;border-radius:16px;border:1px solid #a7f3d0;"><tr><td style="padding:24px 28px;text-align:center;"><p style="font-size:12px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px;">¿Como funciona?</p><p style="font-size:14px;color:#475569;line-height:1.7;margin:0;">Comparte tu link o codigo con tu audiencia. Cada vez que alguien compre una cancion a traves de ti, ganas <strong style="color:#059669;">20% de comision</strong>. Ves todo en tiempo real desde tu dashboard.</p></td></tr></table></td></tr>
        <tr><td style="background:#f8fafc;padding:28px 40px;text-align:center;border-top:1px solid #e2e8f0;"><p style="color:#2563eb;font-size:14px;font-weight:800;margin:0 0 8px;">🎵 RegalosQueCantan</p><p style="color:#94a3b8;font-size:12px;margin:0 0 12px;"><a href="mailto:hola@regalosquecantan.com" style="color:#64748b;text-decoration:none;">hola@regalosquecantan.com</a></p><p style="color:#cbd5e1;font-size:10px;margin:0;">© 2026 Regalos Que Cantan</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name, email, code, couponCode, password } = await req.json();

    if (!name || !email || !code || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nombre, email, código y contraseña son requeridos' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const passwordHash = await hashPassword(password);

    const { data: affiliate, error: affError } = await supabase
      .from('affiliates')
      .insert({
        name,
        email: email.toLowerCase().trim(),
        code: code.toLowerCase().trim(),
        password_hash: passwordHash,
        coupon_code: couponCode || null,
        commission_pct: 20,
        active: true,
        onboarded: false
      })
      .select()
      .single();

    if (affError) {
      return new Response(
        JSON.stringify({ success: false, error: affError.message }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (couponCode) {
      await supabase
        .from('coupons')
        .upsert({
          code: couponCode.toUpperCase().trim(),
          type: 'percentage',
          discount: 10,
          active: true,
          max_uses: null,
          times_used: 0
        }, { onConflict: 'code' });
    }

    if (SENDGRID_API_KEY) {
      try {
        const firstName = name.split(' ')[0];
        const emailResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SENDGRID_API_KEY}`
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: email.toLowerCase().trim() }] }],
            from: { email: 'hola@regalosquecantan.com', name: 'RegalosQueCantan' },
            reply_to: { email: 'hola@regalosquecantan.com', name: 'RegalosQueCantan' },
            subject: `🎵 ${firstName}, bienvenido al programa de afiliados de RegalosQueCantan`,
            content: [{ type: 'text/html', value: getWelcomeEmailHtml(name, email.toLowerCase().trim(), password, code.toLowerCase().trim(), couponCode || null) }],
            categories: ['affiliate_welcome', 'rqc'],
            tracking_settings: {
              click_tracking: { enable: true, enable_text: false },
              open_tracking: { enable: true },
              subscription_tracking: { enable: false }
            }
          })
        });

        if (!emailResponse.ok) {
          console.error('SendGrid error:', emailResponse.status, await emailResponse.text());
        } else {
          console.log('Welcome email sent to affiliate:', email);
        }
      } catch (emailError) {
        console.error('Failed to send welcome email:', emailError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        affiliate: {
          id: affiliate.id,
          code: affiliate.code,
          name: affiliate.name,
          email: affiliate.email,
          coupon_code: affiliate.coupon_code
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Create affiliate error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
