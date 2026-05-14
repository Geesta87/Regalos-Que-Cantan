// supabase/functions/affiliate-login/index.ts
// Authenticates an affiliate via email + password and returns a signed JWT.
// IMPORTANT: AFFILIATE_JWT_SECRET must be set as a Supabase project secret.

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

// Password hashing pepper. Decoupled from JWT signing so the JWT secret can
// rotate without invalidating passwords. Defaults to AFFILIATE_JWT_SECRET so
// existing affiliates (whose passwords were hashed with that value) keep
// verifying — to rotate the JWT secret later, first set AFFILIATE_PASSWORD
// _PEPPER to the CURRENT value of AFFILIATE_JWT_SECRET, then rotate the JWT
// secret to a fresh random value. A future migration to per-user salts
// (bcrypt) can supersede this.
const PASSWORD_PEPPER = Deno.env.get('AFFILIATE_PASSWORD_PEPPER') || AFFILIATE_JWT_SECRET;

async function hashPassword(password: string): Promise<string> {
  if (!PASSWORD_PEPPER) throw new Error('Password pepper not configured');
  const data = new TextEncoder().encode(PASSWORD_PEPPER + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new TextDecoder().decode(hexEncode(new Uint8Array(hash)));
}

async function createToken(payload: Record<string, unknown>): Promise<string> {
  if (!AFFILIATE_JWT_SECRET) throw new Error('AFFILIATE_JWT_SECRET not configured');
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify({ ...payload, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AFFILIATE_JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${header}.${body}`)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${header}.${body}.${sig}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Fail closed if the JWT signing secret is not configured. Without it the
  // function would have to fall back to a public default and let anyone
  // forge tokens for any affiliate's dashboard.
  if (!AFFILIATE_JWT_SECRET) {
    console.error('[affiliate-login] AFFILIATE_JWT_SECRET is not set');
    return new Response(
      JSON.stringify({ success: false, error: 'Server misconfigured' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email y contraseña son requeridos' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: affiliate, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .eq('active', true)
      .single();

    if (error || !affiliate) {
      return new Response(
        JSON.stringify({ success: false, error: 'Credenciales inválidas' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const passwordHash = await hashPassword(password);
    if (passwordHash !== affiliate.password_hash) {
      return new Response(
        JSON.stringify({ success: false, error: 'Credenciales inválidas' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const token = await createToken({
      affiliateId: affiliate.id,
      code: affiliate.code,
      email: affiliate.email
    });

    return new Response(
      JSON.stringify({
        success: true,
        token,
        affiliate: {
          id: affiliate.id,
          code: affiliate.code,
          name: affiliate.name,
          email: affiliate.email,
          instagram: affiliate.instagram,
          commission_pct: affiliate.commission_pct,
          coupon_code: affiliate.coupon_code,
          onboarded: affiliate.onboarded
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Affiliate login error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
