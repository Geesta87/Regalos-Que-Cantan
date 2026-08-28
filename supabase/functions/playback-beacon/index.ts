// supabase/functions/playback-beacon/index.ts
//
// Receives the frontend's playback-failure beacons (src/utils/playbackBeacon.js):
// a customer's <audio> element errored on the success / song / comparison page.
// Rows land in playback_errors; health-check pages the owner when several
// distinct songs fail in a short window (2026-08-28: Kie's CDN died and
// customers hit silent players for 2 hours before a complaint surfaced it).
//
// Contract: navigator.sendBeacon posts a text/plain JSON body — a CORS "simple
// request", so no preflight and no auth header (same rule as the Meta CAPI
// beacons). verify_jwt = false in supabase/config.toml. Always 204: a beacon
// endpoint must never make the customer's browser retry or error.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { healDeadAudio } from '../_shared/dead-audio-heal.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const raw = (await req.text()).slice(0, 2000);
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw); } catch { /* malformed beacon — drop silently */ }

    const songId = String(body.song_id || '');
    if (UUID_RE.test(songId)) {
      const audioUrl = String(body.audio_url || '').slice(0, 500);
      let audioHost = '';
      try { audioHost = new URL(audioUrl).hostname; } catch { /* not a URL */ }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from('playback_errors').insert({
        song_id: songId,
        audio_url: audioUrl,
        audio_host: audioHost,
        error_code: String(body.error_code || '').slice(0, 20),
        page: String(body.page || '').slice(0, 200),
        user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
        client_ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim().slice(0, 64),
      });

      // A real customer just hit a dead player — verify server-side (the
      // beacon is untrusted input; only the song's OWN stored URL counts) and
      // heal immediately instead of leaving them staring at silence. Runs
      // after the 204 via waitUntil so the beacon reply is never delayed.
      const verifyAndHeal = async () => {
        try {
          const { data: s } = await supabase
            .from('songs').select('id, audio_url, status').eq('id', songId).single();
          if (!s?.audio_url || s.status !== 'completed') return;
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 8000);
          let dead = 0;
          try {
            const r = await fetch(s.audio_url, { headers: { Range: 'bytes=0-256' }, signal: ctrl.signal });
            if (!(r.status === 200 || r.status === 206)) dead = r.status;
          } catch { /* network error — not proof the file is gone */ }
          finally { clearTimeout(t); }
          if (dead) {
            const action = await healDeadAudio(supabase, songId, dead, 'beacon');
            console.log(`[BEACON-HEAL] ${songId} (HTTP ${dead}) → ${action}`);
          }
        } catch (e: any) {
          console.warn(`[BEACON-HEAL] ${songId}: ${e?.message}`);
        }
      };
      try {
        (globalThis as any).EdgeRuntime?.waitUntil
          ? (globalThis as any).EdgeRuntime.waitUntil(verifyAndHeal())
          : await verifyAndHeal();
      } catch { /* heal must never break the beacon */ }
    }
  } catch (e) {
    console.error('playback-beacon error:', e?.message);
  }
  return new Response(null, { status: 204, headers: corsHeaders });
});
