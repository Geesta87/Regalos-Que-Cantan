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

export const OPENAI_IMAGE_ENABLED = !!OPENAI_API_KEY;
