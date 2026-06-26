// ---------------------------------------------------------------------------
// OpenAI image engine — the "good engine" (gpt-image-2), shared across Creative
// Studio so the daily batch, the art-director chat, and the ad templates all
// produce the same premium quality.
//
// SYNCHRONOUS: unlike Kie (fire a task → poll later), gpt-image-2 returns the
// finished image in the same request. Callers generate → renderAd → upload →
// mark 'ready' inline, no poller needed. We still only ask the model for a
// TEXT-FREE photo (the design layer typesets the real copy on top) — that's the
// #1 anti-"AI slop" rule.
// ---------------------------------------------------------------------------

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const IMG_MODEL = Deno.env.get('OPENAI_IMAGE_MODEL') || 'gpt-image-2';
const IMG_QUALITY = Deno.env.get('OPENAI_IMAGE_QUALITY') || 'high';
const IMG_SIZE = Deno.env.get('OPENAI_IMAGE_SIZE') || '1024x1536'; // ~portrait, good for feed

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

// Generate a text-free photo and return its raw PNG bytes (null on failure /
// missing key — callers fall back or mark the row failed).
export async function gptPhotoBytes(prompt: string): Promise<Uint8Array | null> {
  if (!OPENAI_API_KEY) return null;
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMG_MODEL, prompt: (prompt || '').slice(0, 3800), n: 1, size: IMG_SIZE, quality: IMG_QUALITY }),
  });
  if (!r.ok) { console.warn('gptPhotoBytes', r.status, (await r.text()).slice(0, 200)); return null; }
  const j = await r.json().catch(() => ({}));
  const b64 = j?.data?.[0]?.b64_json;
  return b64 ? b64ToBytes(b64) : null;
}

// Reference-based generation (image-to-image) via gpt-image-2's /images/edits.
// Feeds a REAL reference image (e.g. a winning ad) so the output inherits its
// look/style/composition instead of being invented from a text description. Used
// for "make more ads like this one". Returns text-free PNG bytes (design layer
// adds copy on top), null on failure. Phrase prompts as "in the style of the
// reference" — gpt-image-2 safety rejects "transform this person" phrasing.
export async function gptEditBytes(prompt: string, refBytes: Uint8Array, mime = 'image/png'): Promise<Uint8Array | null> {
  if (!OPENAI_API_KEY) return null;
  const form = new FormData();
  form.append('model', IMG_MODEL);
  form.append('prompt', (prompt || '').slice(0, 3800));
  form.append('size', IMG_SIZE);
  form.append('quality', IMG_QUALITY);
  form.append('n', '1');
  const ext = /jpe?g/.test(mime) ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
  form.append('image', new Blob([refBytes], { type: mime }), `reference.${ext}`);
  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form,
  });
  if (!r.ok) { console.warn('gptEditBytes', r.status, (await r.text()).slice(0, 300)); return null; }
  const j = await r.json().catch(() => ({}));
  const b64 = j?.data?.[0]?.b64_json;
  return b64 ? b64ToBytes(b64) : null;
}

// Fetch a remote image (e.g. a Meta ad creative) → bytes + mime for use as a
// reference in gptEditBytes. Null on failure.
export async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = r.headers.get('content-type') || 'image/jpeg';
    return { bytes: new Uint8Array(await r.arrayBuffer()), mime };
  } catch { return null; }
}

export const OPENAI_IMAGE_ENABLED = !!OPENAI_API_KEY;
