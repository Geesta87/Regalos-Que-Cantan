// supabase/functions/_shared/embed.ts
//
// Thin wrapper around OpenAI text embeddings (text-embedding-3-small, 1536 dims),
// used for semantic retrieval over the CS team's approved replies. Best-effort:
// returns null on any failure so callers can fall back gracefully (e.g. cs-agent
// falls back to recency-based examples).

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
export const EMBED_MODEL = 'text-embedding-3-small';
export const EMBED_DIMS = 1536;

export function isEmbedConfigured(): boolean {
  return !!OPENAI_API_KEY;
}

// Embed one or more strings in a single API call. Returns an array aligned with
// the input; any position may be null if that input was empty. Returns null for
// the WHOLE call if the request failed (so the caller can fall back).
export async function embedTexts(inputs: string[]): Promise<(number[] | null)[] | null> {
  if (!OPENAI_API_KEY) return null;
  const cleaned = inputs.map((t) => (t || '').trim().slice(0, 8000));
  // OpenAI rejects empty strings; substitute a single space and null them after.
  const forApi = cleaned.map((t) => (t.length ? t : ' '));
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: forApi }),
    });
    if (!res.ok) {
      console.warn('embedTexts: openai', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const out: (number[] | null)[] = cleaned.map((t, i) =>
      t.length ? (data?.data?.[i]?.embedding ?? null) : null,
    );
    return out;
  } catch (e) {
    console.warn('embedTexts: error', e);
    return null;
  }
}

// Convenience for a single string.
export async function embedText(input: string): Promise<number[] | null> {
  const out = await embedTexts([input]);
  return out?.[0] ?? null;
}
