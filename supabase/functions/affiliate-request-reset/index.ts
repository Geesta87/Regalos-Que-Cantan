// supabase/functions/affiliate-request-reset/index.ts
// Public endpoint: a partner who forgot their password submits their email.
// If it maps to an active affiliate, we email a short-lived (1 hour) reset
// link. ALWAYS returns success regardless of whether the email exists, so the
// endpoint can't be used to enumerate which emails are registered partners.
//
// Called from the affiliate login page with the Supabase anon key, so
// verify_jwt stays at the default (true) — the gateway accepts the anon JWT.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildEmailParts } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AFFILIATE_JWT_SECRET = Deno.env.get('AFFILIATE_JWT_SECRET');
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');

// Reset links are valid for 1 hour.
const RESET_TTL_MS = 60 * 60 * 1000;
const PORTAL_BASE = 'https://regalosquecantan.com';

// Mirrors affiliate-login.createToken so reset tokens are signed with the same
// HMAC scheme. The `purpose` field lets affiliate-reset-password reject any
// token that wasn't minted specifically for a password reset.
async function createToken(payload: Record<string, unknown>): Promise<string> {
  if (!AFFILIATE_JWT_SECRET) throw new Error('AFFILIATE_JWT_SECRET not configured');
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + RESET_TTL_MS }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AFFILIATE_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${header}.${body}.${sig}`;
}

function getResetEmailHtml(firstName: string, resetUrl: string): string {
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
          <p style="font-size:36px;margin:0 0 12px;">🔐</p>
          <h1 style="font-family:'Nunito',sans-serif;color:#ffffff;font-size:24px;font-weight:800;margin:0 0 4px;">RegalosQueCantan</h1>
          <p style="color:rgba(255,255,255,0.6);font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin:0;">Partner Portal</p>
        </td></tr>
        <tr><td style="padding:40px 40px 24px;text-align:center;">
          <h2 style="font-size:26px;font-weight:800;color:#1e3a5f;margin:0 0 12px;">Restablece tu contrase&ntilde;a</h2>
          <p style="font-size:16px;color:#64748b;line-height:1.7;margin:0;">Hola ${firstName}, recibimos una solicitud para restablecer la contrase&ntilde;a de tu cuenta de afiliado. Haz clic en el bot&oacute;n de abajo para crear una nueva.</p>
        </td></tr>
        <tr><td style="padding:0 40px 28px;text-align:center;"><a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;padding:18px 48px;border-radius:14px;text-decoration:none;font-weight:800;font-size:16px;font-family:'Nunito',sans-serif;box-shadow:0 8px 24px rgba(37,99,235,0.3);">Crear nueva contrase&ntilde;a &rarr;</a></td></tr>
        <tr><td style="padding:0 40px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border-radius:16px;border:1px solid #fed7aa;"><tr><td style="padding:20px 24px;text-align:center;">
            <p style="font-size:13px;color:#9a3412;line-height:1.6;margin:0;">Este enlace expira en <strong>1 hora</strong>. Si t&uacute; no solicitaste esto, puedes ignorar este correo &mdash; tu contrase&ntilde;a no cambiar&aacute;.</p>
          </td></tr></table>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:28px 40px;text-align:center;border-top:1px solid #e2e8f0;"><p style="color:#2563eb;font-size:14px;font-weight:800;margin:0 0 8px;">🎵 RegalosQueCantan</p><p style="color:#94a3b8;font-size:12px;margin:0 0 12px;"><a href="mailto:hola@regalosquecantan.com" style="color:#64748b;text-decoration:none;">hola@regalosquecantan.com</a></p><p style="color:#cbd5e1;font-size:10px;margin:0;">&copy; 2026 Regalos Que Cantan</p></td></tr>
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

  // Generic response used for every outcome so the endpoint never reveals
  // whether a given email belongs to a registered partner.
  const genericOk = () => new Response(
    JSON.stringify({ success: true, message: 'Si tu correo está registrado, te enviamos un enlace para restablecer tu contraseña.' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
  );

  try {
    if (!AFFILIATE_JWT_SECRET) {
      console.error('[affiliate-request-reset] AFFILIATE_JWT_SECRET is not set');
      // Still return generic OK to the client; log for ops.
      return genericOk();
    }

    const { email } = await req.json();
    const normalizedEmail = (email || '').toString().toLowerCase().trim();
    if (!normalizedEmail) return genericOk();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('code, name, email')
      .eq('email', normalizedEmail)
      .eq('active', true)
      .maybeSingle();

    // Unknown / inactive email → behave identically (no enumeration).
    if (!affiliate) {
      console.log('[affiliate-request-reset] no active affiliate for email (returning generic ok)');
      return genericOk();
    }

    const token = await createToken({ code: affiliate.code, email: affiliate.email, purpose: 'pwreset' });
    const resetUrl = `${PORTAL_BASE}/afiliado/reset?token=${encodeURIComponent(token)}`;

    if (SENDGRID_API_KEY) {
      try {
        const firstName = (affiliate.name || '').split(' ')[0] || 'Afiliado';
        const rawHtml = getResetEmailHtml(firstName, resetUrl);
        const { html: finalHtml, text: finalText } = buildEmailParts(
          rawHtml,
          `${firstName}, recibimos una solicitud para restablecer tu contraseña. El enlace expira en 1 hora.`,
        );
        const emailResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: affiliate.email }] }],
            from: { email: 'hola@regalosquecantan.com', name: 'RegalosQueCantan' },
            reply_to: { email: 'hola@regalosquecantan.com', name: 'RegalosQueCantan' },
            subject: '🔐 Restablece tu contraseña — RegalosQueCantan Partners',
            content: [
              { type: 'text/plain', value: finalText },
              { type: 'text/html', value: finalHtml },
            ],
            categories: ['affiliate_password_reset', 'rqc'],
            // Click tracking MUST stay off: SendGrid would rewrite the reset
            // URL, mangling the signed token in the query string.
            tracking_settings: {
              click_tracking: { enable: false, enable_text: false },
              open_tracking: { enable: false },
              subscription_tracking: { enable: false }
            },
          })
        });
        if (!emailResponse.ok) {
          console.error('[affiliate-request-reset] SendGrid error:', emailResponse.status, await emailResponse.text());
        } else {
          console.log('[affiliate-request-reset] reset email sent to affiliate:', affiliate.email);
        }
      } catch (emailError) {
        console.error('[affiliate-request-reset] failed to send reset email:', emailError);
      }
    }

    return genericOk();
  } catch (error) {
    console.error('[affiliate-request-reset] error:', error);
    // Never leak internal errors to the client for this endpoint.
    return genericOk();
  }
});
