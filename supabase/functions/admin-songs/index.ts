// supabase/functions/admin-songs/index.ts
// Authenticated reader + delivery-tracker for the admin dashboard.
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
// As of 2026-04-30 also handles WhatsApp-delivery tracking:
//   - action: 'mark-sent'         → set songs.whatsapp_sent_at = now() for one song
//   - action: 'unmark-sent'       → clear it (admin mistake recovery)
//   - action: 'bulk-mark-sent'    → set it for an array of song ids
//   - action: 'backfill-sent'     → set it for every paid+phone song with
//                                    created_at <= cutoff that's currently NULL
//
// As of 2026-05-06 also handles manual email-delivery tracking:
//   - action: 'mark-email-sent'   → set songs.email_sent_at = now() for one song
//   - action: 'unmark-email-sent' → clear it
//
// Delivery-tracking writes are allowed for BOTH 'admin' and 'assistant' roles
// — Ivan (assistant) and the owner (admin) both operate the dashboard, and a
// click by either one needs to sync to the other so neither double-sends to
// a customer. Only revenue-sensitive actions (backfill-sent, which is a bulk
// admin-only sweep) stay restricted.
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

// Same column set the dashboard previously requested, plus whatsapp_sent_at
// (Pending to Send tab) and admin_dismissed_at (Stuck/failed counter).
const SONG_LIST_COLUMNS = [
  'id', 'created_at', 'email', 'recipient_name', 'sender_name',
  'genre', 'genre_name', 'sub_genre', 'occasion', 'voice_type',
  'session_id', 'stripe_session_id', 'stripe_payment_id', 'payment_status',
  'paid', 'paid_at', 'amount_paid',
  'coupon_code', 'affiliate_code', 'utm_source',
  'audio_url', 'whatsapp_phone', 'whatsapp_sent_at', 'email_sent_at', 'download_count', 'downloaded',
  'has_video_addon', 'karaoke_url', 'karaoke_status', 'admin_dismissed_at', 'status',
  // version + mureka_job_id power the V1/V2 label in the admin orders list:
  // each song creation produces 2 rows that share a mureka_job_id, one per
  // generated audio variant (version 1, version 2).
  'version', 'mureka_job_id',
  // provider decides whether the "Fix a Song" card offers a surgical section fix
  // (Kie) or only a full re-roll (Mureka) — needed on list/version rows before
  // the lazy `detail` load, else already-fixed Kie songs falsely read as Mureka.
  'provider',
  // Fix footprint — so the list can flag songs that were repaired.
  'fixed_at', 'fix_count',
  // Manual (Zelle/cash) paid marker — so the list can show it + allow undo.
  'marked_paid_at', 'marked_paid_source',
  // Small modal-only fields are safe to include in the list (each adds a few
  // bytes per row). `details` and `lyrics` are NOT in the list — the table has
  // 24k+ rows and avg(lyrics)+avg(details) ≈ 1.6 KB/row, so including them
  // pushed the response past the edge function's memory ceiling and the call
  // started returning 546 (Resource Limit Exceeded), which made the dashboard
  // render "0 songs". Those two fields are lazy-loaded via the `detail` action
  // when the order-details modal opens — see fetchSongDetails in AdminDashboard.jsx.
  'relationship', 'last_downloaded_at',
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
    let body: {
      action?: string;
      songId?: string;
      songIds?: string[];
      cutoff?: string;
      search?: string;
      searchField?: string;
      limit?: number;
      amount?: number;
      source?: string;
    } = {};
    if (req.method === 'POST') {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const action = body.action || 'list';

    // ─── action: mark-paid / unmark-paid ──────────────────────────────────
    // Manually mark a song paid (e.g. customer paid via Zelle) so it counts as
    // a regular paid song everywhere and survives any unpaid-storage cleanup.
    // Admin-only (not assistants). Writes the same fields Stripe does, plus a
    // marker so it's auditable + reversible.
    if (action === 'mark-paid' || action === 'unmark-paid') {
      if (isAssistant) return json({ success: false, error: 'Only admins can change payment status' }, 403);
      if (!body.songId) return json({ success: false, error: 'songId required' }, 400);

      if (action === 'unmark-paid') {
        // Only revert songs that were MANUALLY marked — never undo a real Stripe payment.
        const { data: s } = await admin.from('songs').select('marked_paid_at').eq('id', body.songId).single();
        if (!s) return json({ success: false, error: 'song not found' }, 404);
        if (!s.marked_paid_at) return json({ success: false, error: 'This song was not manually marked — only manual (Zelle) marks can be undone.' }, 400);
        const { error } = await admin.from('songs').update({
          paid: false, payment_status: null, paid_at: null, amount_paid: null, payment_method: null,
          marked_paid_at: null, marked_paid_source: null, marked_paid_by: null,
        }).eq('id', body.songId);
        if (error) return json({ success: false, error: error.message }, 500);
        return json({ success: true, songId: body.songId, paid: false });
      }

      const now = new Date().toISOString();
      const amount = (body.amount != null && !Number.isNaN(Number(body.amount))) ? Number(body.amount) : null;
      const source = (body.source && String(body.source).trim()) ? String(body.source).trim().slice(0, 40) : 'zelle';
      const update: Record<string, unknown> = {
        paid: true,
        payment_status: 'paid',
        paid_at: now,
        // payment_method is the established Zelle tag (88 songs already use it)
        // and the storage-cleanup guard protects payment_method<>'zelle'.
        payment_method: source,
        marked_paid_at: now,
        marked_paid_source: source,
        marked_paid_by: (userData.user.email || userId).slice(0, 120),
      };
      // amount_paid intentionally left as-is unless explicitly passed — keeps
      // manual payments from inflating revenue reports (matches prior reconciliation).
      if (amount != null) update.amount_paid = amount;
      const { error } = await admin.from('songs').update(update).eq('id', body.songId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, songId: body.songId, paid: true, markedPaidAt: now, source, amountPaid: amount });
    }

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

    // ─── action: mark-sent (admin or assistant) ──────────────────────────
    // Sets whatsapp_sent_at to NOW() for one song. Idempotent — calling it
    // twice doesn't re-stamp; we keep the original send time. Both roles can
    // call this so a click by either operator syncs to the other (otherwise
    // we double-send to the customer).
    if (action === 'mark-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: nowIso })
        .eq('id', body.songId)
        .is('whatsapp_sent_at', null) // don't overwrite an existing send time
        .select('id, whatsapp_sent_at')
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      // If maybeSingle returned null it means it was already marked — return
      // the existing timestamp so the UI still updates correctly.
      let finalRow = data;
      if (!finalRow) {
        const { data: existing } = await admin
          .from('songs')
          .select('id, whatsapp_sent_at')
          .eq('id', body.songId)
          .maybeSingle();
        finalRow = existing;
      }
      return json({ success: true, song: finalRow });
    }

    // ─── action: unmark-sent (admin or assistant) ────────────────────────
    // Recovery for "oops, I clicked the wrong button". Clears the timestamp.
    if (action === 'unmark-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const { error } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: null })
        .eq('id', body.songId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ─── action: bulk-mark-sent (admin or assistant) ─────────────────────
    // Stamps an array of songs in a single round-trip. Used by the bulk
    // "Marcar seleccionadas como enviadas" button on the Por Enviar tab.
    if (action === 'bulk-mark-sent') {
      const ids = Array.isArray(body.songIds) ? body.songIds : [];
      if (ids.length === 0) {
        return json({ success: false, error: 'songIds required' }, 400);
      }
      if (ids.length > 500) {
        return json({ success: false, error: 'Too many ids (max 500)' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { error, count } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: nowIso }, { count: 'exact' })
        .in('id', ids)
        .is('whatsapp_sent_at', null);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, updated: count ?? 0, sentAt: nowIso });
    }

    // ─── action: mark-email-sent (admin or assistant) ────────────────────
    // Sets email_sent_at to NOW() for one song. Used by the small "email
    // sent?" checkbox shown next to the customer's email on paid orders that
    // don't have a WhatsApp number — when the song link has been delivered
    // manually via the Mi Canción recovery flow. Idempotent.
    if (action === 'mark-email-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { data, error } = await admin
        .from('songs')
        .update({ email_sent_at: nowIso })
        .eq('id', body.songId)
        .is('email_sent_at', null)
        .select('id, email_sent_at')
        .maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      let finalRow = data;
      if (!finalRow) {
        const { data: existing } = await admin
          .from('songs')
          .select('id, email_sent_at')
          .eq('id', body.songId)
          .maybeSingle();
        finalRow = existing;
      }
      return json({ success: true, song: finalRow });
    }

    // ─── action: unmark-email-sent (admin or assistant) ──────────────────
    if (action === 'unmark-email-sent') {
      if (!body.songId) {
        return json({ success: false, error: 'songId required' }, 400);
      }
      const { error } = await admin
        .from('songs')
        .update({ email_sent_at: null })
        .eq('id', body.songId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ─── action: backfill-sent (admin only) ──────────────────────────────
    // One-click "everything paid before <cutoff> is already sent" helper so
    // the Por Enviar queue isn't flooded on day one. Cutoff is an ISO
    // timestamp; we only touch rows that are paid, have a phone, and
    // currently have whatsapp_sent_at = NULL.
    if (action === 'backfill-sent') {
      if (isAssistant) return json({ success: false, error: 'Admin only' }, 403);
      const cutoff = body.cutoff;
      if (!cutoff || isNaN(new Date(cutoff).getTime())) {
        return json({ success: false, error: 'cutoff (ISO timestamp) required' }, 400);
      }
      const nowIso = new Date().toISOString();
      const { error, count } = await admin
        .from('songs')
        .update({ whatsapp_sent_at: nowIso }, { count: 'exact' })
        .eq('paid', true)
        .not('whatsapp_phone', 'is', null)
        .is('whatsapp_sent_at', null)
        .lte('created_at', cutoff);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, updated: count ?? 0, sentAt: nowIso });
    }

    // ─── action: list (default) ──────────────────────────────────────────
    // When `search` is provided we filter server-side across email,
    // recipient_name, sender_name and whatsapp_phone (case-insensitive). This
    // is what the admin dashboard's Lookup tab calls — without this branch
    // the function returned the entire songs table (~40k rows) and the
    // frontend rendered them all as "results for <whatever>", which felt
    // like the page refreshing and losing the match the admin was about to
    // click. See AdminDashboard.jsx → lookupServerResults useEffect.
    const search = typeof body.search === 'string' ? body.search.trim() : '';
    const searchField = typeof body.searchField === 'string' ? body.searchField : 'all';
    const requestedLimit = typeof body.limit === 'number' && Number.isFinite(body.limit) ? body.limit : null;

    let query = admin
      .from('songs')
      .select(SONG_LIST_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) {
      // Strip PostgREST .or() syntax-breaking chars before interpolating.
      // These never appear in real names / emails / phone numbers so dropping
      // them is a no-op for valid lookup queries.
      const safeSearch = search.replace(/["\\,()]/g, '');
      if (safeSearch) {
        const pattern = `%${safeSearch}%`;
        if (searchField === 'email') {
          query = query.ilike('email', pattern);
        } else if (searchField === 'name') {
          query = query.or(`recipient_name.ilike."${pattern}",sender_name.ilike."${pattern}"`);
        } else if (searchField === 'phone') {
          query = query.ilike('whatsapp_phone', pattern);
        } else {
          query = query.or(
            `email.ilike."${pattern}",recipient_name.ilike."${pattern}",sender_name.ilike."${pattern}",whatsapp_phone.ilike."${pattern}"`
          );
        }
      }
    }

    // For a search request, cap at 500 rows (matches the limit the dashboard
    // requests). For the no-search dashboard fetch, return only the most recent
    // working set. The songs table has grown past 40k rows; the old 50k ceiling
    // meant this branch pulled essentially the whole table into the function,
    // which blew past the edge runtime's ~256 MB memory limit and returned
    // HTTP 546 (Resource Limit Exceeded) — the dashboard couldn't load at all.
    // Lifetime totals now come from get_admin_song_stats() below (computed in
    // Postgres), and all-history lookups go through the search branch above.
    const maxRows = search ? 500 : 10000;
    const limit = Math.min(Math.max(requestedLimit ?? maxRows, 1), maxRows);
    query = query.range(0, limit - 1);

    const { data, error, count } = await query;
    if (error) return json({ success: false, error: error.message }, 500);

    const songs = isAssistant ? (data || []).map(redactForAssistant) : (data || []);

    // Lifetime stats over the FULL table, aggregated in the database so we never
    // pull every row into the function. Revenue is redacted for the assistant
    // role (same rule as the per-row amount_paid redaction above). Only needed
    // for the dashboard's no-search fetch; the Lookup tab doesn't use it.
    let stats = null;
    if (!search) {
      const { data: statsRow, error: statsErr } = await admin.rpc(
        'get_admin_song_stats',
        { redact_revenue: isAssistant }
      );
      if (statsErr) {
        console.error('admin-songs stats rpc error:', statsErr);
      } else {
        stats = statsRow;
      }
    }

    return json({ success: true, role, songs, stats, total_count: count ?? songs.length });
  } catch (err) {
    console.error('admin-songs error:', err);
    return json({ success: false, error: String(err?.message || err) }, 500);
  }
});
