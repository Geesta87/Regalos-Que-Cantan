// supabase/functions/admin-songs/index.ts
// Authenticated reader for the admin dashboard.
//
// Why this exists: the dashboard used to read `songs` directly from the
// browser with the anon key. That meant anyone with the URL could see
// every customer's email, phone and payment amounts. Now reads go through
// this function, which:
//   1. Requires a valid Supabase Auth JWT (verified by the platform gateway
//      because supabase/config.toml has [functions.admin-songs] with
//      verify_jwt = true — the default; explicit for clarity).
//   2. Looks up the caller in `admin_users` to find their role.
//   3. For role = 'assistant', strips price / payment-amount fields from
//      every row before returning. The numbers never reach their browser,
//      so DevTools can't reveal them.
//
// Deploy with: supabase functions deploy admin-songs --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Same column set the dashboard previously requested.
const SONG_LIST_COLUMNS = [
  'id', 'created_at', 'email', 'recipient_name', 'sender_name',
  'genre', 'genre_name', 'sub_genre', 'occasion', 'voice_type',
  'session_id', 'stripe_session_id', 'stripe_payment_id', 'payment_status',
  'paid', 'paid_at', 'amount_paid',
  'coupon_code', 'affiliate_code', 'utm_source',
  'audio_url', 'whatsapp_phone', 'download_count', 'downloaded',
  'has_video_addon',
].join(',');

// Fields that reveal payment amounts. Wiped out for the assistant role.
// We KEEP `paid`, `paid_at`, `payment_status`, `stripe_payment_id` so the
// "Pagado / Pendiente" badge still works — the assistant just can't see how
// much was paid.
const REVENUE_FIELDS = ['amount_paid'];

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

    // Resolve the caller from their JWT. We use the anon-key client + the
    // user's token so getUser() identifies them.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }
    const userId = userData.user.id;

    // Service-role client for everything else. We've verified WHO the caller
    // is; from here on we apply our own role check.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (roleErr || !roleRow) {
      return json({ success: false, error: 'No admin access' }, 403);
    }

    const role = roleRow.role as 'admin' | 'assistant';
    const isAssistant = role === 'assistant';

    // Parse request
    let body: { action?: string; songId?: string } = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const action = body.action || 'list';

    // ─── action: detail ──────────────────────────────────────────────────
    if (action === 'detail') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const { data, error } = await admin
        .from('songs')
        .select('*')
        .eq('id', body.songId)
        .single();
      if (error) return json({ success: false, error: error.message }, 500);
      const song = isAssistant ? redactForAssistant(data) : data;
      return json({ success: true, role, song });
    }

    // ─── action: list (default) ──────────────────────────────────────────
    const { data, error } = await admin
      .from('songs')
      .select(SONG_LIST_COLUMNS)
      .order('created_at', { ascending: false })
      .range(0, 49999);

    if (error) return json({ success: false, error: error.message }, 500);

    const songs = isAssistant ? (data || []).map(redactForAssistant) : (data || []);

    return json({ success: true, role, songs });
  } catch (err) {
    console.error('admin-songs error:', err);
    return json({ success: false, error: String(err?.message || err) }, 500);
  }
});
