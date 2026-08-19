// supabase/functions/track-song-access/index.ts
//
// Proof-of-consumption logger for chargeback defense (2026-08-19).
//
// The customer pages (/success, /song/:ids) fire a small beacon here when the
// page is opened, when the audio is first played, and when a download button
// is clicked. Each event lands in `song_access_log` with the caller's IP and
// user agent — which is exactly the evidence ("the customer downloaded the
// MP3 at 8:15 PM from IP x.x.x.x, three minutes after paying") that wins a
// "cardholder didn't authorize" dispute. `download` events also increment
// songs.download_count, which the admin dashboard already displays but which
// nothing ever wrote until now.
//
// Called with navigator.sendBeacon / fetch(keepalive) from public pages, so
// no Supabase JWT is attached: supabase/config.toml pins verify_jwt = false
// for this function. Because it is unauthenticated, it validates that every
// song id exists before writing, accepts only the fixed action vocabulary,
// and writes nothing else — worst case an attacker can add noise rows to a
// log table that only the service role can read.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ACTIONS = new Set([
  'success_page_view', 'song_page_view', 'play', 'download', 'share_link_open',
]);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    // Accept one id or a comma-separated list (the delivery links carry both
    // songs of a 2-pack in one URL).
    const rawIds: string[] = String(body.song_id || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean)
      .slice(0, 4); // a cart never exceeds a handful of songs

    if (!ALLOWED_ACTIONS.has(action) || rawIds.length === 0) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
      });
    }

    const xfwd = req.headers.get('x-forwarded-for') || '';
    const ip = (xfwd.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '').slice(0, 100);
    const userAgent = (req.headers.get('user-agent') || '').slice(0, 300);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Only log ids that are real songs — keeps junk out of the evidence trail.
    const { data: existing } = await supabase
      .from('songs')
      .select('id')
      .in('id', rawIds);
    const validIds: string[] = (existing || []).map((r: { id: string }) => r.id);
    if (validIds.length === 0) {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      });
    }

    const rows = validIds.map((song_id) => ({ song_id, action, ip, user_agent: userAgent }));
    const { error: insErr } = await supabase.from('song_access_log').insert(rows);
    if (insErr) console.error('[track-song-access] insert failed:', insErr.message);

    // Downloads also bump the per-song counter shown in the admin dashboard.
    if (action === 'download') {
      for (const id of validIds) {
        const { error: rpcErr } = await supabase.rpc('increment_download_count', { p_song_id: id });
        if (rpcErr) console.warn('[track-song-access] download_count bump failed:', rpcErr.message);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e) {
    console.error('[track-song-access] error:', e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ ok: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
