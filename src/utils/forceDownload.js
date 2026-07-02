// Download helpers that work in EVERY browser, including in-app webviews
// (Facebook, Instagram, Messenger, TikTok). Those webviews ignore the
// <a download> attribute and render blob: URLs as a broken black page, so
// blob-based downloads must never be the first choice there.

export function isInAppBrowser() {
  const ua = navigator.userAgent || navigator.vendor || '';
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Messenger|Line\/|TikTok|musical_ly|Snapchat/i.test(ua);
}

// Supabase storage public URLs accept ?download=<filename>: the server then
// responds with Content-Disposition: attachment, which triggers a real
// download in every browser — no fetch, no blob, no download attribute.
export function attachmentUrl(fileUrl, filename) {
  try {
    const u = new URL(fileUrl);
    if (u.pathname.includes('/storage/v1/object/')) {
      u.searchParams.set('download', filename);
      return u.toString();
    }
  } catch {
    // not a parseable URL — fall through
  }
  return null;
}

function clickAnchor(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  if (filename) a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function forceDownload(fileUrl, filename) {
  if (!fileUrl) return;

  // Preferred path: let the storage server force the download.
  const direct = attachmentUrl(fileUrl, filename);
  if (direct) {
    clickAnchor(direct, filename);
    return;
  }

  // File hosted elsewhere (e.g. provider temp CDN). In-app browsers can't do
  // blob downloads, so open the file itself — the webview's player at least
  // lets the user play/save it instead of showing a dead blob: page.
  if (isInAppBrowser()) {
    window.open(fileUrl, '_blank');
    return;
  }

  const res = await fetch(fileUrl);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  clickAnchor(objUrl, filename);
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}
