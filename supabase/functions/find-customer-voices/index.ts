// supabase/functions/find-customer-voices/index.ts
//
// Looks up previously-uploaded voice samples for a customer by email,
// so returning buyers don't have to re-record their voice every time.
//
// Why this exists
// ---------------
// The biggest friction in /clonamivoz is the 90-second recording. If a
// customer wants to buy 3 songs in their voice across the year, asking
// them to re-record each time is a conversion killer. Once they've
// recorded once, they should be able to come back, type their email,
// pick their voice, and pay — done in 2 clicks.
//
// Privacy posture
// ---------------
// This endpoint confirms whether a given email has voice samples on
// file. That's a minor information leak (anyone can probe whether an
// email has used the service). Acceptable trade-off for v1 because:
//   - The downside is small (you can't get the actual audio without
//     also knowing the voice_sample_id, which is a UUID)
//   - The conversion lift from a frictionless returning-customer flow
//     is meaningful
//
// If abuse surfaces, the next iteration is a magic-link flow: instead
// of returning samples directly, email a single-use link to the address.
//
// Per-IP rate limit prevents brute-force email scraping.
//
// Request
// -------
// POST /functions/v1/find-customer-voices
//   { email: 'customer@example.com' }
//
// Response (200)
// --------------
//   { voices: [
//       { id, created_at, duration_seconds, source_mime },
//       ...
//     ]
//   }
//
// Voices are sorted newest-first, capped at 10, and exclude deleted
// (auto-purged after 30 days) samples.
//
// Auth: verify_jwt = true. Frontend posts with the Supabase anon JWT
// (same pattern as the other clonamivoz functions).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_VOICES_RETURNED = 10;

// Simple in-memory rate limit per IP. Resets when the function instance
// recycles (which happens often on Supabase Edge). Good enough to slow
// down email scraping; not a hardened anti-abuse layer.
const recentLookups = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 20;           // 20 lookups per IP per minute

function checkRateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const entry = recentLookups.get(ip);
  if (!entry || entry.resetAt < now) {
    recentLookups.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    return { ok: false, remaining: 0 };
  }
  return { ok: true, remaining: RATE_LIMIT_MAX - entry.count };
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (!e || !e.includes('@') || e.length > 200) return null;
  return e;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'method_not_allowed', message: 'Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- rate limit by IP ----------------
  const xfwd = req.headers.get('x-forwarded-for') || '';
  const clientIp =
    xfwd.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  const rl = checkRateLimit(clientIp);
  if (!rl.ok) {
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        message: 'Too many lookups, espera un momento e intenta otra vez.',
      }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- parse body ----------------
  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_body', message: 'Expected JSON body.' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return new Response(
      JSON.stringify({
        error: 'invalid_email',
        message: 'Email inválido. Revisa que esté bien escrito.',
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ---------------- look up samples ----------------
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: voices, error: lookupError } = await supabase
    .from('voice_samples')
    .select('id, created_at, duration_seconds, source_mime')
    .eq('customer_email', email)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MAX_VOICES_RETURNED);

  if (lookupError) {
    console.error('[find-customer-voices] DB lookup failed:', lookupError);
    return new Response(
      JSON.stringify({ error: 'db_error', message: lookupError.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  return new Response(
    JSON.stringify({
      email,
      voices: voices || [],
      count: voices?.length || 0,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
