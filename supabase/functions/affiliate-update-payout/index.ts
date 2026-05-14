// supabase/functions/affiliate-update-payout/index.ts
// Lets a logged-in affiliate save / update their payout info (Zelle, Venmo,
// PayPal, bank, etc) from their dashboard so the owner knows where to send
// commission. Same HMAC-token auth as affiliate-data / affiliate-complete-
// onboarding — token in `Authorization: Bearer <token>`, signed with
// AFFILIATE_JWT_SECRET, verified internally.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const AFFILIATE_JWT_SECRET = Deno.env.get('AFFILIATE_JWT_SECRET');

// Whitelist of payout methods we accept. Keeping this server-side prevents
// arbitrary text from landing in the column (e.g. injection into emails).
const ALLOWED_METHODS = new Set(['zelle', 'venmo', 'paypal', 'bank', 'other']);

async function verifyToken(token: string): Promise<Record<string, unknown> | null> {
  if (!AFFILIATE_JWT_SECRET) return null;
  try {
    const [header, body, sig] = token.split('.');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(AFFILIATE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signature = Uint8Array.from(atob(sig), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(`${header}.${body}`)
    );
    if (!valid) return null;
    const payload = JSON.parse(atob(body));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Fail closed if the JWT signing secret is not configured. Without this we
  // would silently fall back to a public default and let anyone forge tokens.
  if (!AFFILIATE_JWT_SECRET) {
    console.error('[affiliate-update-payout] AFFILIATE_JWT_SECRET is not set');
    return json({ success: false, error: 'Server misconfigured' }, 500);
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    const payload = await verifyToken(token);
    if (!payload) {
      return json({ success: false, error: 'Token inválido o expirado' }, 401);
    }
    const affiliateCode = (payload.code as string || '').toLowerCase().trim();
    if (!affiliateCode) return json({ success: false, error: 'Token sin código' }, 401);

    const body = await req.json().catch(() => ({}));
    const rawMethod = String(body?.payout_method || '').toLowerCase().trim();
    const rawHandle = String(body?.payout_handle || '').trim();
    const rawNotes = String(body?.payout_notes || '').trim();

    if (!rawMethod) {
      return json({ success: false, error: 'Selecciona un método de pago' }, 400);
    }
    if (!ALLOWED_METHODS.has(rawMethod)) {
      return json({ success: false, error: 'Método de pago no soportado' }, 400);
    }
    if (!rawHandle) {
      return json({ success: false, error: 'Falta el dato de tu método de pago' }, 400);
    }
    // Soft length caps — protect the column / email rendering from abuse.
    if (rawHandle.length > 200 || rawNotes.length > 500) {
      return json({ success: false, error: 'Datos demasiado largos' }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: updated, error } = await supabase
      .from('affiliates')
      .update({
        payout_method: rawMethod,
        payout_handle: rawHandle,
        payout_notes: rawNotes || null,
        payout_updated_at: new Date().toISOString(),
      })
      .eq('code', affiliateCode)
      .select('payout_method, payout_handle, payout_notes, payout_updated_at')
      .single();

    if (error) {
      console.error('[affiliate-update-payout] update failed:', error.message);
      return json({ success: false, error: 'No pudimos guardar tu información' }, 500);
    }

    return json({ success: true, payout: updated });
  } catch (err) {
    console.error('[affiliate-update-payout] error:', err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
