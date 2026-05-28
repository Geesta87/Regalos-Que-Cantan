// supabase/functions/clonamivoz-test-bypass-payment/index.ts
//
// TEMPORARY testing-only endpoint. Lets the Clone Mi Voz preview→full-song
// flow run end-to-end WITHOUT paying via Stripe.
//
// Mirrors exactly what clonamivoz-stripe-webhook does on a successful
// checkout.session.completed:
//   1. Mark the cloned_voice_songs row paid=true, status='paid'
//   2. Server-to-server call into generate-cloned-voice-song
//
// Gated by env var CLONAMIVOZ_BYPASS_ENABLED. If that's not set to 'true',
// the function returns 403. To re-enable the paywall, just unset the
// secret — the function stops working without a code change.
//
// Frontend exposes a "Skip Payment (Testing)" button in /clonamivoz that
// calls this. Production buy button still routes through Stripe normally.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLONAMIVOZ_BYPASS_ENABLED = Deno.env.get('CLONAMIVOZ_BYPASS_ENABLED') === 'true';

const GENERATE_SONG_URL = `${SUPABASE_URL}/functions/v1/generate-cloned-voice-song`;

interface RequestBody {
  cloned_voice_song_id?: string;
  customer_email?: string;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!CLONAMIVOZ_BYPASS_ENABLED) {
    return json({
      error: 'bypass_disabled',
      message: 'Payment bypass is disabled. Set the Supabase secret CLONAMIVOZ_BYPASS_ENABLED=true to enable for testing.',
    }, 403);
  }

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
  if (!body.cloned_voice_song_id) return json({ error: 'missing_cloned_voice_song_id' }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ----- Load the row (same shape the webhook uses) -----
  const { data: row, error: loadError } = await supabase
    .from('cloned_voice_songs')
    .select(
      'id, status, paid, voice_sample_id, recipient_name, occasion, relationship, story, genre_slug, language, title, lyrics, emotional_modifiers, lyrics_model_used, customer_email'
    )
    .eq('id', body.cloned_voice_song_id)
    .maybeSingle();

  if (loadError) return json({ error: 'db_load_failed', message: loadError.message }, 500);
  if (!row) return json({ error: 'row_not_found' }, 404);

  // Idempotency: if already paid (real or bypassed), don't re-trigger.
  if (row.paid) {
    return json({
      success: true,
      already_paid: true,
      cloned_voice_song_id: row.id,
    });
  }

  // ----- Mark paid via bypass marker (so we can identify these in admin) -----
  const paidAtIso = new Date().toISOString();
  const bypassMarker = `TEST_BYPASS_${Date.now()}`;
  const emailToUse = body.customer_email || row.customer_email;

  const { error: paidUpdateError } = await supabase
    .from('cloned_voice_songs')
    .update({
      paid: true,
      paid_at: paidAtIso,
      status: 'paid',
      stripe_payment_intent: bypassMarker,
      customer_email: emailToUse,
    })
    .eq('id', body.cloned_voice_song_id);

  if (paidUpdateError) {
    return json({ error: 'mark_paid_failed', message: paidUpdateError.message }, 500);
  }

  // ----- Trigger generate-cloned-voice-song (same as webhook does) -----
  try {
    const genResp = await fetch(GENERATE_SONG_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // CRITICAL: pass the existing row id so generate-cloned-voice-song
        // UPDATES it (writing kie_task_id back) instead of inserting a new
        // row. Without this, the frontend polls a row that never gets a
        // kie_task_id and times out while Suno actually finishes on a
        // different (orphan) row.
        cloned_voice_song_id: body.cloned_voice_song_id,
        voice_sample_id: row.voice_sample_id,
        recipient_name: row.recipient_name,
        occasion: row.occasion,
        relationship: row.relationship,
        story: row.story,
        genre_slug: row.genre_slug,
        language: row.language || 'es',
        title: row.title,
        lyrics: row.lyrics,
        emotional_modifiers: row.emotional_modifiers,
        lyrics_model_used: row.lyrics_model_used,
        customer_email: emailToUse,
      }),
    });

    if (!genResp.ok) {
      const errText = await genResp.text().catch(() => '');
      await supabase
        .from('cloned_voice_songs')
        .update({
          status: 'failed',
          error_message: `BYPASS: generation failed (HTTP ${genResp.status}). ${errText.slice(0, 200)}`,
        })
        .eq('id', body.cloned_voice_song_id);
      return json({
        error: 'generation_failed',
        status: genResp.status,
        message: errText.slice(0, 500),
      }, 502);
    }

    const genJson = await genResp.json().catch(() => null);
    return json({
      success: true,
      bypassed_payment: true,
      cloned_voice_song_id: body.cloned_voice_song_id,
      paid_at: paidAtIso,
      bypass_marker: bypassMarker,
      kie_task_id: genJson?.kie_task_id,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('cloned_voice_songs')
      .update({
        status: 'failed',
        error_message: `BYPASS: ${msg}`,
      })
      .eq('id', body.cloned_voice_song_id);
    return json({ error: 'generation_network_error', message: msg }, 502);
  }
});
