// supabase/functions/admin-cloned-voice-songs/index.ts
//
// Admin-dashboard reader for the Clone Mi Voz tier. Mirrors the auth
// pattern of admin-songs (Supabase Auth JWT + admin_users.role lookup)
// but reads from public.cloned_voice_songs, NOT public.songs.
//
// Kept as a separate function from admin-songs so:
//   - admin-songs/index.ts is NOT modified (one of the user's 3 untouched
//     files — bugs there block the main funnel admin view)
//   - Both 'admin' and 'assistant' roles can view orders (delivery work
//     needs visibility for both); 'assistant' has revenue fields wiped
//   - Future iterations of the clonamivoz admin (refunds, manual song
//     regenerate, etc) can land here without touching the main admin code
//
// Actions
// -------
//   action: 'list'   → list of recent cloned_voice_songs, newest first
//   action: 'detail' → full row including story + lyrics for one id
//
// Auth: verify_jwt = true. Dashboard posts with the logged-in Supabase
// user's JWT (the platform gateway validates it before our handler runs).
//
// Deploy with: supabase functions deploy admin-cloned-voice-songs --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Columns for the LIST view. Exclude `story` and `lyrics` from list
// payloads — they can be long and the table view doesn't need them.
// Both come back via the 'detail' action.
const LIST_COLUMNS = [
  'id',
  'created_at',
  'customer_email',
  'recipient_name',
  'occasion',
  'relationship',
  'genre_slug',
  'language',
  'title',
  'status',
  'paid',
  'paid_at',
  'amount_cents',
  'stripe_session_id',
  'stripe_payment_intent',
  'preview_audio_url',
  'preview_completed_at',
  'permanent_audio_urls',
  'suno_audio_urls',
  'kie_task_id',
  'preview_kie_task_id',
  'error_message',
  'completed_at',
  'voice_sample_id',
].join(',');

const DETAIL_COLUMNS = LIST_COLUMNS + ',story,lyrics,emotional_modifiers,lyrics_model_used';

// Revenue fields hidden from 'assistant' role. Matches admin-songs's
// posture — Ivan can see orders + deliver them, but can't see how much
// was charged.
const REVENUE_FIELDS = ['amount_cents'];

function redactForAssistant<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const f of REVENUE_FIELDS) {
    if (f in out) out[f] = null;
  }
  return out as T;
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

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    // Identify the caller from their JWT.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }
    const userId = userData.user.id;

    // Service-role client for the actual data + role check.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();

    if (roleErr) {
      console.error('[admin-cloned-voice-songs] admin_users lookup failed:', roleErr);
      return json({ success: false, error: 'Auth lookup failed' }, 500);
    }
    if (!roleRow) {
      return json({ success: false, error: 'Not authorized' }, 403);
    }
    const role = roleRow.role as 'admin' | 'assistant';
    if (role !== 'admin' && role !== 'assistant') {
      return json({ success: false, error: 'Unknown role' }, 403);
    }

    // ---------------- parse body ----------------
    let body: { action?: string; id?: string; limit?: number } = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        return json({ success: false, error: 'Invalid JSON body' }, 400);
      }
    }
    const action = body.action || 'list';

    if (action === 'list') {
      const limit = Math.min(Math.max(body.limit || 500, 1), 5000);
      const { data, error } = await admin
        .from('cloned_voice_songs')
        .select(LIST_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[admin-cloned-voice-songs] list failed:', error);
        return json({ success: false, error: error.message }, 500);
      }

      const rows = data || [];
      const out = role === 'assistant' ? rows.map(redactForAssistant) : rows;
      return json({ success: true, role, count: out.length, songs: out });
    }

    if (action === 'detail') {
      if (!body.id) {
        return json({ success: false, error: 'Missing id' }, 400);
      }
      const { data, error } = await admin
        .from('cloned_voice_songs')
        .select(DETAIL_COLUMNS)
        .eq('id', body.id)
        .maybeSingle();

      if (error) {
        console.error('[admin-cloned-voice-songs] detail failed:', error);
        return json({ success: false, error: error.message }, 500);
      }
      if (!data) {
        return json({ success: false, error: 'Not found' }, 404);
      }
      const out = role === 'assistant' ? redactForAssistant(data) : data;
      return json({ success: true, role, song: out });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[admin-cloned-voice-songs] unhandled error:', msg);
    return json({ success: false, error: msg }, 500);
  }
});
