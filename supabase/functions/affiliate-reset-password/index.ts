// supabase/functions/affiliate-reset-password/index.ts
// Public endpoint: completes a password reset. Takes the signed token from the
// emailed link (minted by affiliate-request-reset with purpose='pwreset') plus
// the new password, verifies the token, and overwrites the affiliate's hash.
//
// Called from /afiliado/reset with the Supabase anon key, so verify_jwt stays
// at the default (true) — the gateway accepts the anon JWT. The real check is
// the HMAC token verification below.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { encode as hexEncode } from 'https://deno.land/std@0.168.0/encoding/hex.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AFFILIATE_JWT_SECRET = Deno.env.get('AFFILIATE_JWT_SECRET');
// Must match create-affiliate / affiliate-login so the new hash verifies on
// the next login. Defaults to AFFILIATE_JWT_SECRET like the other functions.
const PASSWORD_PEPPER = Deno.env.get('AFFILIATE_PASSWORD_PEPPER') || AFFILIATE_JWT_SECRET;

const MIN_PASSWORD_LENGTH = 6;

async function hashPassword(password: string): Promise<string> {
  if (!PASSWORD_PEPPER) throw new Error('Password pepper not configured');
  const data = new TextEncoder().encode(PASSWORD_PEPPER + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new TextDecoder().decode(hexEncode(new Uint8Array(hash)));
}

// Mirrors affiliate-data.verifyToken, plus a purpose check so a normal 7-day
// login token can't be replayed here to hijack a password reset.
async function verifyResetToken(token: string): Promise<Record<string, unknown> | null> {
  if (!AFFILIATE_JWT_SECRET) return null;
  try {
    const [header, body, sig] = token.split('.');
    if (!header || !body || !sig) return null;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(AFFILIATE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, signature, new TextEncoder().encode(`${header}.${body}`));
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.purpose !== 'pwreset') return null;
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const fail = (msg: string, status = 400) => new Response(
    JSON.stringify({ success: false, error: msg }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status }
  );

  try {
    if (!AFFILIATE_JWT_SECRET) {
      console.error('[affiliate-reset-password] AFFILIATE_JWT_SECRET is not set');
      return fail('Server misconfigured', 500);
    }

    const { token, password } = await req.json();
    if (!token || !password) return fail('Token y contraseña son requeridos');
    if (String(password).length < MIN_PASSWORD_LENGTH) {
      return fail(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`);
    }

    const payload = await verifyResetToken(String(token));
    if (!payload) return fail('El enlace de restablecimiento es inválido o ha expirado. Solicita uno nuevo.', 401);

    const code = String(payload.code || '').toLowerCase().trim();
    if (!code) return fail('Token inválido', 401);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Confirm the affiliate still exists and is active before writing.
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('code')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle();
    if (!affiliate) return fail('Cuenta no encontrada o inactiva', 404);

    const passwordHash = await hashPassword(String(password));
    const { error: updateErr } = await supabase
      .from('affiliates')
      .update({ password_hash: passwordHash })
      .eq('code', code);
    if (updateErr) {
      console.error('[affiliate-reset-password] update failed:', updateErr.message);
      return fail('No se pudo actualizar la contraseña. Intenta de nuevo.', 500);
    }

    console.log('[affiliate-reset-password] password reset for affiliate code:', code);
    return new Response(
      JSON.stringify({ success: true, message: 'Tu contraseña ha sido actualizada. Ya puedes iniciar sesión.' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('[affiliate-reset-password] error:', error);
    return fail('Error del servidor. Intenta de nuevo.', 500);
  }
});
