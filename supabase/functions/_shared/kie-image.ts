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

async function kiePoll(taskId: string): Promise<Uint8Array | null> {
  const start = Date.now();
  while (Date.now() - start < 90000) {
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
export async function kiePhotoBytes(prompt: string): Promise<Uint8Array | null> {
  const id = await kieCreate('gpt-image-2-text-to-image', { prompt: (prompt || '').slice(0, 3800), aspect_ratio: ASPECT });
  return id ? await kiePoll(id) : null;
}

// Image-to-image from a reference URL (e.g. a winning ad). Null on failure.
export async function kieEditBytes(prompt: string, refUrl: string): Promise<Uint8Array | null> {
  const id = await kieCreate('gpt-image-2-image-to-image', { prompt: (prompt || '').slice(0, 3800), input_urls: [refUrl], aspect_ratio: ASPECT });
  return id ? await kiePoll(id) : null;
}

export const KIE_IMAGE_ENABLED = !!KIE_API_KEY;
