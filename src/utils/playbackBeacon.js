// Playback failure beacon + self-recovery UX — when a customer's <audio>
// element errors, we (1) tell the backend, which verifies the file is really
// dead and auto-regenerates it (playback-beacon → _shared/dead-audio-heal.ts),
// and (2) show the customer a friendly "finishing touches" toast while polling
// for the healed audio, then reload so the new take plays. Born from the
// 2026-08-28 Kie CDN incident, where customers stared at silent players for
// 2 hours. Fire-and-forget: must NEVER break the player UI.
//
// The beacon is sent as text/plain via sendBeacon — a "simple request" that
// skips the CORS preflight, same rule the Meta CAPI beacons follow.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FN_URL = `${SUPABASE_URL}/functions/v1/playback-beacon`;

// One report per song per page-load; a retry loop on a dead src fires the
// error event repeatedly and we only need the first.
const reported = new Set();

const POLL_MS = 25000;          // heal takes ~2-3 min; poll well under that
const POLL_MAX_MS = 12 * 60000; // give the Kie→Mureka ladder time to finish
const RELOAD_CAP = 3;           // per song per browser session

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
    // Recovery UX only for source-level failures (2 = network, 4 = src not
    // supported — what a dead/403 URL produces) on a real src. An abort (1)
    // or decode blip (3) isn't a dead file and shouldn't promise a re-sing.
    const code = Number(errorCode);
    if (audioUrl && (code === 2 || code === 4 || Number.isNaN(code))) {
      startRecoveryWatch(songId, audioUrl);
    }
  } catch {
    // Telemetry must never take the player down with it.
  }
}

// ---- Customer-facing recovery: toast + poll + reload -----------------------

function startRecoveryWatch(songId, failedUrl) {
  try {
    const capKey = `rqc_heal_reloads_${songId}`;
    let reloads = 0;
    try { reloads = Number(sessionStorage.getItem(capKey)) || 0; } catch { /* private mode */ }
    if (reloads >= RELOAD_CAP) return; // stop looping — recovery email/WhatsApp will bring them back

    showHealingToast();

    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        clearInterval(timer);
        try { document.getElementById('rqc-healing-toast')?.remove(); } catch { /* gone already */ }
        return;
      }
      try {
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/songs?id=eq.${songId}&select=audio_url,status`,
          { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
        );
        if (!r.ok) return;
        const row = (await r.json())?.[0];
        // Healed = a different URL that actually serves audio again.
        if (row?.status === 'completed' && row.audio_url && row.audio_url !== failedUrl) {
          clearInterval(timer);
          try { sessionStorage.setItem(capKey, String(reloads + 1)); } catch { /* private mode */ }
          window.location.reload();
        }
      } catch { /* transient poll failure — keep waiting */ }
    }, POLL_MS);
  } catch {
    // Recovery UX is best-effort only.
  }
}

function showHealingToast() {
  try {
    if (document.getElementById('rqc-healing-toast')) return;
    const el = document.createElement('div');
    el.id = 'rqc-healing-toast';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:24px', 'transform:translateX(-50%)',
      'z-index:99999', 'max-width:92vw', 'width:360px', 'padding:14px 18px',
      'border-radius:14px', 'background:rgba(20,16,40,0.96)', 'color:#fff',
      'font-family:inherit', 'font-size:14px', 'line-height:1.45', 'text-align:center',
      'box-shadow:0 8px 30px rgba(0,0,0,0.45)', 'border:1px solid rgba(255,255,255,0.15)',
    ].join(';');
    el.innerHTML =
      '🎵 <strong>Estamos dando los últimos toques a tu canción…</strong><br>' +
      '<span style="opacity:0.85">Estará lista en unos minutos — esta página se actualizará sola.</span>';
    document.body.appendChild(el);
  } catch {
    // If the toast can't render, the poll/reload still does the real work.
  }
}
