// Playback failure beacon — tells the backend when a customer's <audio> element
// errors, so health-check can page the owner about customer-audible breakage
// (2026-08-28: Kie's CDN died and customers hit silent players for 2 hours
// before anyone knew). Fire-and-forget: must NEVER break the player UI.
//
// Sent as text/plain via sendBeacon — a "simple request" that skips the CORS
// preflight, same rule the Meta CAPI beacons follow.

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/playback-beacon`;

// One report per song per page-load; a retry loop on a dead src fires the
// error event repeatedly and we only need the first.
const reported = new Set();

export function reportPlaybackError(songId, audioUrl, errorCode) {
  try {
    if (!songId || reported.has(songId)) return;
    reported.add(songId);
    const payload = JSON.stringify({
      song_id: songId,
      audio_url: audioUrl || '',
      error_code: String(errorCode ?? ''),
      page: window.location.pathname,
    });
    const blob = new Blob([payload], { type: 'text/plain' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(FN_URL, blob);
    } else {
      fetch(FN_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch {
    // Telemetry must never take the player down with it.
  }
}
