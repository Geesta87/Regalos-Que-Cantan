// src/utils/trackSongAccess.js
//
// Proof-of-consumption beacon (chargeback defense, 2026-08-19).
//
// Fires a tiny event to the track-song-access edge function when a customer
// opens their song page, presses play, or downloads. The function logs it to
// song_access_log with IP + user agent — the "customer actually took the
// product" evidence that wins fraudulent-dispute cases.
//
// Fire-and-forget by design: never throws, never blocks the UI, and uses
// keepalive so a download navigation doesn't cancel the request. Dedupes
// play events per song per page load so scrubbing doesn't spam the log.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://yzbvajungshqcpusfiia.supabase.co';
const ENDPOINT = `${SUPABASE_URL}/functions/v1/track-song-access`;

const firedOnce = new Set(); // `${action}:${ids}` fired this page load

export function trackSongAccess(songIds, action, { once = false } = {}) {
  try {
    const ids = Array.isArray(songIds) ? songIds.filter(Boolean).join(',') : String(songIds || '');
    if (!ids) return;
    const key = `${action}:${ids}`;
    if (once && firedOnce.has(key)) return;
    firedOnce.add(key);
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ song_id: ids, action }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never let telemetry break the page */
  }
}
