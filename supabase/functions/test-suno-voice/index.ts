// supabase/functions/test-suno-voice/index.ts
//
// TEMPORARY TEST HARNESS — Suno Voice (real voice cloning) evaluation.
// 2026-08-08. Isolated: reads voice_samples + Storage for signed URLs only;
// writes NOTHING to customer tables. Delete this function (and its
// config.toml block + TEST_SUNO_VOICE_TOKEN secret) once the Suno Voice
// bake-off vs upload-cover is decided.
//
// Why it exists
// -------------
// The Kie Suno Voice APIs (POST /api/v1/voice/validate → GET
// /api/v1/voice/validate-info → POST /api/v1/voice/generate → voiceId,
// then personaId on /api/v1/generate) are being quality-tested against the
// current upload-cover pipeline. KIE_API_KEY lives only in Supabase
// secrets, so this function relays operator-driven calls to Kie.
//
// Auth
// ----
// verify_jwt = true (anon JWT at the gateway) AND a mandatory
// x-test-token header matching the TEST_SUNO_VOICE_TOKEN secret. If the
// secret is unset the function refuses everything — locked by default.
//
// Actions (POST JSON)
// -------------------
//   { action: 'kie', method: 'GET'|'POST', path: '/api/v1/...', body? }
//       → relays to https://api.kie.ai<path>, returns { status, data }
//   { action: 'sign', storage_path, bucket?, ttl_seconds? }
//       → signed URL for a Storage object (default bucket customer-voice)
//   { action: 'latest_samples', limit? }
//       → newest voice_samples rows so the operator can find a fresh recording

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-test-token',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const TEST_TOKEN = Deno.env.get('TEST_SUNO_VOICE_TOKEN');

const DEFAULT_BUCKET = 'customer-voice';

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  if (!TEST_TOKEN) return json(403, { error: 'harness_locked', message: 'TEST_SUNO_VOICE_TOKEN not set.' });
  if (req.headers.get('x-test-token') !== TEST_TOKEN) return json(403, { error: 'bad_token' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_body' });
  }

  const action = body.action;

  if (action === 'kie') {
    if (!KIE_API_KEY) return json(500, { error: 'kie_key_missing' });
    const method = body.method === 'GET' ? 'GET' : 'POST';
    const path = typeof body.path === 'string' ? body.path : '';
    if (!path.startsWith('/api/v1/')) {
      return json(400, { error: 'bad_path', message: 'path must start with /api/v1/' });
    }
    let resp: Response;
    try {
      resp = await fetch(`https://api.kie.ai${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${KIE_API_KEY}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' && body.body !== undefined ? { body: JSON.stringify(body.body) } : {}),
      });
    } catch (e) {
      return json(502, { error: 'kie_network_error', message: e instanceof Error ? e.message : String(e) });
    }
    const data = await resp.json().catch(async () => ({ raw: (await resp.text().catch(() => '')).slice(0, 500) }));
    return json(200, { status: resp.status, data });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (action === 'sign') {
    const storagePath = typeof body.storage_path === 'string' ? body.storage_path : '';
    if (!storagePath) return json(400, { error: 'missing_storage_path' });
    const bucket = typeof body.bucket === 'string' && body.bucket ? body.bucket : DEFAULT_BUCKET;
    const ttl = typeof body.ttl_seconds === 'number' ? Math.min(body.ttl_seconds, 7 * 86400) : 86400;
    const signed = await supabase.storage.from(bucket).createSignedUrl(storagePath, ttl);
    if (signed.error || !signed.data?.signedUrl) {
      return json(502, { error: 'sign_failed', message: signed.error?.message });
    }
    return json(200, { signed_url: signed.data.signedUrl, expires_in: ttl });
  }

  if (action === 'latest_samples') {
    const limit = typeof body.limit === 'number' ? Math.min(body.limit, 20) : 5;
    const { data, error } = await supabase
      .from('voice_samples')
      .select('id, created_at, storage_path, duration_seconds, source_mime, deleted_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return json(502, { error: 'db_error', message: error.message });
    return json(200, { samples: data });
  }

  return json(400, { error: 'unknown_action', message: "action must be 'kie', 'sign', or 'latest_samples'" });
});
