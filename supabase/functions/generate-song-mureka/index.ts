// supabase/functions/generate-song-mureka/index.ts
// Standalone Mureka via useapi.net provider function
// Can be called directly for testing, or used by generate-song as primary provider
// Returns 2 songs per call via useapi.net create-advanced endpoint
// Deploy with: supabase functions deploy generate-song-mureka --no-verify-jwt

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const USEAPI_TOKEN = Deno.env.get('USEAPI_TOKEN');
const MUREKA_ACCOUNT = Deno.env.get('MUREKA_ACCOUNT');
const MUREKA_MODEL = Deno.env.get('MUREKA_MODEL') || 'V9';
const MUREKA_FALLBACK_MODEL = 'V8';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Alerting (Twilio WhatsApp + SendGrid email — same envs as health-check)
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY');
const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || 'hola@regalosquecantan.com';
const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_WHATSAPP_FROM = Deno.env.get('TWILIO_WHATSAPP_FROM');
const ALERT_WHATSAPP_TO = Deno.env.get('ALERT_WHATSAPP_TO');

// Throttle: don't spam the owner — at most one credit alert every 30 minutes
let lastCreditAlertAt = 0;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;

async function sendCreditOutageAlert(reason: string, errStr: string) {
  const now = Date.now();
  if (now - lastCreditAlertAt < ALERT_COOLDOWN_MS) {
    console.log('🟡 Credit alert throttled (sent recently)');
    return;
  }
  lastCreditAlertAt = now;

  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });
  const subject = '🔴 CRITICAL: Mureka credits depleted — songs failing';
  const body = `Mureka via useapi.net rejected a song request.\n\nReason: ${reason}\nError: ${errStr.substring(0, 500)}\n\n⏰ ${timestamp}\n\nACTION: Top up credits at useapi.net immediately. Customers' songs are failing.`;

  await Promise.allSettled([
    // WhatsApp
    (async () => {
      if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ALERT_WHATSAPP_TO) return;
      try {
        const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ From: TWILIO_WHATSAPP_FROM, To: ALERT_WHATSAPP_TO, Body: `🔴 ${subject}\n\n${body}` }).toString(),
        });
        console.log('📱 WhatsApp credit alert sent');
      } catch (e: any) { console.error('WhatsApp alert error:', e.message); }
    })(),
    // Email
    (async () => {
      if (!SENDGRID_API_KEY) return;
      try {
        await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SENDGRID_API_KEY}` },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
            from: { email: 'hola@regalosquecantan.com', name: 'RQC Critical Alert' },
            subject,
            content: [{ type: 'text/plain', value: body }],
            categories: ['critical_alert', 'mureka_credits'],
          }),
        });
        console.log('📧 Email credit alert sent');
      } catch (e: any) { console.error('Email alert error:', e.message); }
    })(),
  ]);
}

function isCreditOutageError(status: number, errStr: string, errData: any): boolean {
  // 402 Payment Required is the canonical signal
  if (status === 402) return true;
  const lower = errStr.toLowerCase();
  return (
    lower.includes('insufficient') ||
    lower.includes('credit') && (lower.includes('out') || lower.includes('depleted') || lower.includes('balance')) ||
    lower.includes('payment required') ||
    lower.includes('quota exceeded') ||
    errData?.code === 'INSUFFICIENT_CREDITS' ||
    errData?.code === 'INSUFFICIENT_BALANCE'
  );
}

// =============================================================================
// useapi.net Mureka API helpers
// =============================================================================

interface UseApiCreateResponse {
  jobid: string;
  status: string;
}

interface UseApiSong {
  song_id: string;
  title: string;
  version: string;
  duration_milliseconds: number;
  mp3_url: string;
  cover: string;
  share_link: string;
  genres: string[];
  moods: string[];
}

interface UseApiJobResponse {
  jobid: string;
  feed_id: number;
  state: number; // 1=queued, 2=processing, 3=complete, 4=failed
  songs?: UseApiSong[];
  error?: string;
  code?: string;
}

async function callMurekaApi(lyrics: string, title: string, desc: string, model: string, vocalGender?: string): Promise<Response> {
  const payload: Record<string, unknown> = {
    account: MUREKA_ACCOUNT,
    lyrics: lyrics.substring(0, 5000),
    title: title,
    desc: desc.substring(0, 1000),
    model,
  };
  if (vocalGender) {
    payload.vocal_gender = vocalGender;
  }

  return fetch('https://api.useapi.net/v1/mureka/music/create-advanced', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${USEAPI_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function createMurekaJob(lyrics: string, title: string, desc: string, vocalGender?: string): Promise<UseApiCreateResponse & { modelUsed: string }> {
  let response = await callMurekaApi(lyrics, title, desc, MUREKA_MODEL, vocalGender);

  // If primary model fails, try fallback model
  let cachedErrData: any = null; // avoid double-consuming response body
  if (!response.ok && MUREKA_MODEL !== MUREKA_FALLBACK_MODEL) {
    cachedErrData = await response.json().catch(() => ({ error: 'Unknown error' }));
    const errStr = JSON.stringify(cachedErrData);

    // Only fallback on model-related errors, not auth/rate-limit errors
    const isModelError = errStr.includes('model') || errStr.includes('not supported') || errStr.includes('invalid') || response.status === 400;
    const isAuthOrRateLimit = cachedErrData.code === 'REFRESH_FAILED' || errStr.includes('REFRESH_FAILED') || errStr.includes('exceed limit') || cachedErrData.code === 9008 || errStr.includes('Too frequently');

    if (isModelError && !isAuthOrRateLimit) {
      console.warn(`Model ${MUREKA_MODEL} failed (${response.status}), retrying with fallback ${MUREKA_FALLBACK_MODEL}: ${errStr.substring(0, 200)}`);
      cachedErrData = null; // reset — new response will be read fresh
      response = await callMurekaApi(lyrics, title, desc, MUREKA_FALLBACK_MODEL, vocalGender);
      if (response.ok) {
        const data = await response.json();
        if (!data.jobid) throw new Error(`useapi.net returned no jobid: ${JSON.stringify(data)}`);
        console.log(`Fallback model ${MUREKA_FALLBACK_MODEL} succeeded`);
        return { ...data, modelUsed: MUREKA_FALLBACK_MODEL } as UseApiCreateResponse & { modelUsed: string };
      }
    }
  }

  if (!response.ok) {
    const errData = cachedErrData || await response.json().catch(() => ({ error: 'Unknown error' }));
    const errStr = JSON.stringify(errData);

    // CRITICAL: detect credit/balance depletion and alert the owner immediately.
    // Without this, the platform silently fails for every customer until manually noticed.
    if (isCreditOutageError(response.status, errStr, errData)) {
      console.error(`🔴 MUREKA CREDITS DEPLETED (HTTP ${response.status}): ${errStr}`);
      // Fire-and-forget alert (don't block error response)
      sendCreditOutageAlert(`HTTP ${response.status}`, errStr).catch(() => {});
      throw new Error(`INSUFFICIENT_CREDITS: Mureka/useapi.net out of credits — ${errStr}`);
    }

    if (errData.code === 'REFRESH_FAILED' || errStr.includes('REFRESH_FAILED')) {
      throw new Error(`REFRESH_FAILED: Mureka cookie expired, manual re-configuration needed in useapi.net`);
    }
    if (errStr.includes('exceed limit')) {
      throw new Error(`RATE_LIMIT: Too many concurrent Mureka jobs — ${errStr}`);
    }
    if (errData.code === 9008 || errStr.includes('Too frequently')) {
      throw new Error(`THROTTLED: Mureka rate limited — retry in 3 seconds`);
    }

    throw new Error(`useapi.net create-advanced failed (${response.status}): ${errStr}`);
  }

  const data = await response.json();
  if (!data.jobid) {
    throw new Error(`useapi.net returned no jobid: ${JSON.stringify(data)}`);
  }

  return { ...data, modelUsed: MUREKA_MODEL } as UseApiCreateResponse & { modelUsed: string };
}

async function pollMurekaJob(jobid: string, maxAttempts = 20, intervalMs = 5000): Promise<UseApiJobResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await fetch(`https://api.useapi.net/v1/mureka/jobs/${jobid}`, {
      headers: {
        'Authorization': `Bearer ${USEAPI_TOKEN}`,
      },
    });

    if (!response.ok) {
      console.warn(`Poll attempt ${attempt}/${maxAttempts} failed: HTTP ${response.status}`);
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      throw new Error(`useapi.net poll failed after ${maxAttempts} attempts`);
    }

    const rawData = await response.json();
    // useapi.net wraps the response: { jobid, status, response: { state, songs[] } }
    const responseState = rawData.response?.state ?? rawData.state;
    const responseStatus = rawData.status;
    console.log(`Poll ${attempt}/${maxAttempts}: response.state=${responseState}, status=${responseStatus}`);

    if (responseState === 3 || responseStatus === 'completed') {
      // Complete — unwrap the nested response into our expected format
      const data: UseApiJobResponse = {
        jobid: rawData.jobid,
        feed_id: rawData.feed_id ?? rawData.response?.feed_id,
        state: 3,
        songs: rawData.response?.songs ?? rawData.songs ?? [],
      };
      return data;
    }

    if (responseState === 4 || responseStatus === 'failed') {
      // Failed
      const errMsg = rawData.response?.error || rawData.error || 'unknown error';
      throw new Error(`Mureka job failed: ${errMsg}`);
    }

    // Still queued (1) or processing (2) — wait and retry
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  throw new Error(`Mureka job timed out after ${maxAttempts * intervalMs / 1000}s`);
}

// =============================================================================
// MAIN HANDLER — for direct testing
// =============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!USEAPI_TOKEN || !MUREKA_ACCOUNT) {
      throw new Error('USEAPI_TOKEN and MUREKA_ACCOUNT must be configured');
    }

    const body = await req.json();
    const { lyrics, title, stylePrompt, orderId, poll, vocalGender } = body;

    if (!lyrics || !stylePrompt) {
      throw new Error('lyrics and stylePrompt are required');
    }

    console.log('=== GENERATE-SONG-MUREKA (useapi.net) ===');
    console.log(`Title: ${title || 'untitled'}`);
    console.log(`Desc length: ${stylePrompt.length}`);
    console.log(`Model: ${MUREKA_MODEL} (fallback: ${MUREKA_FALLBACK_MODEL})`);
    if (vocalGender) console.log(`Vocal gender: ${vocalGender}`);

    // Step 1: Create job
    const createResult = await createMurekaJob(lyrics, title || 'Canción personalizada', stylePrompt, vocalGender);
    console.log(`Job created: ${createResult.jobid} (model: ${createResult.modelUsed})`);

    // If poll=false, return jobid immediately (for background processing)
    if (poll === false) {
      return new Response(
        JSON.stringify({
          success: true,
          jobid: createResult.jobid,
          status: 'created',
          provider: 'mureka-useapi',
          modelUsed: createResult.modelUsed,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Step 2: Poll for completion (default behavior)
    const jobResult = await pollMurekaJob(createResult.jobid);
    const songs = jobResult.songs || [];

    if (songs.length < 2) {
      console.warn(`Expected 2 songs, got ${songs.length}`);
    }

    // Normalize to RQC format
    const normalizedSongs = songs.map((s, i) => ({
      song_url: s.mp3_url,
      song_id: s.song_id,
      cover_url: s.cover,
      provider: 'mureka-useapi' as const,
      version: String(i + 1) as '1' | '2',
      duration_ms: s.duration_milliseconds,
      title: s.title,
      genres: s.genres,
      moods: s.moods,
      share_link: s.share_link,
    }));

    return new Response(
      JSON.stringify({
        success: true,
        jobid: createResult.jobid,
        song1: normalizedSongs[0] || null,
        song2: normalizedSongs[1] || null,
        provider: 'mureka-useapi',
        modelUsed: createResult.modelUsed,
        songCount: normalizedSongs.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error: any) {
    console.error('generate-song-mureka error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message, provider: 'mureka-useapi' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
