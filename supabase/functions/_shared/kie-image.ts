// supabase/functions/_shared/kie-image.ts
// ===========================================================================
// GPT Image 2 via Kie.ai — same model as OpenAI direct, ~75% cheaper (Kie routes
// it on credits, ~3-6 credits ≈ $0.015-0.03/image vs ~$0.20+ direct). Task-based:
// createTask → poll recordInfo → fetch the result URL → bytes. We still ask for a
// TEXT-FREE photo (the design layer typesets copy on top). Returns null on any
// failure so callers fall back to OpenAI — nothing breaks if Kie hiccups.
// ===========================================================================

const KIE_API_KEY = Deno.env.get('KIE_API_KEY');
const KIE = 'https://api.kie.ai/api/v1/jobs';
const ASPECT = Deno.env.get('KIE_IMAGE_ASPECT') || '2:3'; // portrait, matches our ad layout

async function kieCreate(model: string, input: Record<string, unknown>): Promise<string | null> {
  if (!KIE_API_KEY) return null;
  try {
    const r = await fetch(`${KIE}/createTask`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input }),
    });
    const j = await r.json().catch(() => ({}));
    return j?.data?.taskId || j?.taskId || null;
  } catch { return null; }
}

async function kiePoll(taskId: string, pollMs?: number): Promise<Uint8Array | null> {
  const start = Date.now();
  const POLL_MS = pollMs || Number(Deno.env.get('KIE_POLL_MS')) || 90000;
  while (Date.now() - start < POLL_MS) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const ir = await fetch(`${KIE}/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${KIE_API_KEY}` } });
      const info = await ir.json().catch(() => ({}));
      const st = info?.data?.state;
      if (st === 'success') {
        const url = (JSON.parse(info.data.resultJson || '{}').resultUrls || [])[0];
        if (!url) return null;
        const img = await fetch(url);
        if (!img.ok) return null;
        return new Uint8Array(await img.arrayBuffer());
      }
      if (st === 'fail' || info?.data?.failCode) return null;
    } catch { /* keep polling until timeout */ }
  }
  return null;
}

// Text-to-image (text-free photo). Null on failure → caller falls back to OpenAI.
// aspect defaults to the ad portrait (2:3); pass e.g. '3:2' for a landscape hero.
export async function kiePhotoBytes(prompt: string, aspect: string = ASPECT, pollMs?: number): Promise<Uint8Array | null> {
  const id = await kieCreate('gpt-image-2-text-to-image', { prompt: (prompt || '').slice(0, 3800), aspect_ratio: aspect });
  return id ? await kiePoll(id, pollMs) : null;
}

// Image-to-image from a reference URL (e.g. a winning ad). Null on failure.
export async function kieEditBytes(prompt: string, refUrl: string, pollMs?: number): Promise<Uint8Array | null> {
  const id = await kieCreate('gpt-image-2-image-to-image', { prompt: (prompt || '').slice(0, 3800), input_urls: [refUrl], aspect_ratio: ASPECT });
  return id ? await kiePoll(id, pollMs) : null;
}

export const KIE_IMAGE_ENABLED = !!KIE_API_KEY;

// ---------------------------------------------------------------------------
// OpenAI direct fallback — same model family (GPT Image), but straight from
// OpenAI instead of the KIE reseller. Pricier per image (~$0.19 vs ~2-3¢) but
// reliable when KIE is degraded/down, so an ad build never dies on KIE's outage.
// ---------------------------------------------------------------------------
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
export const OPENAI_IMAGE_ENABLED = !!OPENAI_API_KEY;
export async function openaiPhotoBytes(prompt: string): Promise<Uint8Array | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      // gpt-image-1 portrait size 1024x1536 ≈ 2:3, matching our ad layout. Returns b64.
      body: JSON.stringify({ model: 'gpt-image-1', prompt: (prompt || '').slice(0, 3800), size: '1024x1536', n: 1 }),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}
