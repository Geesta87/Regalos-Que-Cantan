// supabase/functions/_shared/translate.ts
//
// Cheap batch translation to English, used as a READING AID in the admin inbox
// so an assistant who doesn't read Spanish can follow a conversation and
// understand what an AI draft says before approving it. It never touches what a
// customer receives — customers are always messaged in Spanish.
//
// Best-effort by design: returns an array aligned with the input (null in any
// position it couldn't translate), or null for the WHOLE call on failure, so
// callers can cache what worked and simply retry the rest on a later load.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Haiku is plenty for translation and keeps this ~a fraction of a cent per
// message. One line to change if we ever want a stronger model.
const TRANSLATE_MODEL = Deno.env.get('CS_TRANSLATE_MODEL') || 'claude-haiku-4-5-20251001';

// Guard rails so one huge message can't blow the request up. A chat message is
// short; anything past this is almost certainly pasted noise.
const MAX_CHARS_PER_ITEM = 2000;

export function isTranslateConfigured(): boolean {
  return !!ANTHROPIC_API_KEY;
}

// Translate a batch of (Spanish, mostly) messages to English in a SINGLE call.
// Returns an array the same length/order as `inputs`. A position is null when
// that input was empty. Returns null for the whole call if the request failed
// or the model's output couldn't be aligned back to the inputs (so nothing gets
// mis-attributed to the wrong message).
export async function translateBatch(inputs: string[]): Promise<(string | null)[] | null> {
  if (!ANTHROPIC_API_KEY) return null;
  if (!inputs.length) return [];

  const cleaned = inputs.map((t) => (t || '').trim().slice(0, MAX_CHARS_PER_ITEM));
  // Only send the non-empty ones to the model; empties stay null.
  const idxToSend: number[] = [];
  const toSend: string[] = [];
  cleaned.forEach((t, i) => { if (t.length) { idxToSend.push(i); toSend.push(t); } });
  if (!toSend.length) return cleaned.map(() => null);

  // We hand the model a numbered JSON array and ask for a JSON array of the same
  // length back. Numbering + a strict length check keeps translations pinned to
  // the right message even inside a big batch.
  const payload = JSON.stringify(toSend.map((t, i) => ({ i, text: t })));

  const system =
    'You are a translation engine for a customer-service inbox. You receive a JSON array of ' +
    'objects {i, text}, where each `text` is a short chat message (usually Spanish, sometimes ' +
    'English or Portuguese). Translate each `text` to natural, faithful English. If a text is ' +
    'already English, return it essentially unchanged. Preserve links, prices, names, emojis and ' +
    'line breaks. Do NOT add commentary, notes, or quotation marks. Respond with ONLY a JSON array ' +
    'of objects {i, en} — the SAME length and the SAME `i` values as the input, in the same order.';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        max_tokens: 4000,
        system,
        messages: [{ role: 'user', content: payload }],
      }),
    });
    if (!res.ok) {
      console.warn('translateBatch: anthropic', res.status, await res.text().catch(() => ''));
      return null;
    }
    const data = await res.json();
    const raw = (data?.content?.[0]?.text || '').trim();
    // Pull the JSON array out even if the model wrapped it in prose/fences.
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== toSend.length) return null;

    // Map results back by their `i` (fall back to positional if `i` is missing).
    const out: (string | null)[] = cleaned.map(() => null);
    parsed.forEach((row: unknown, pos: number) => {
      const r = row as { i?: number; en?: unknown };
      const origIdx = typeof r?.i === 'number' && idxToSend.includes(r.i) ? r.i : idxToSend[pos];
      const en = typeof r?.en === 'string' ? r.en.trim() : '';
      if (origIdx != null && en) out[origIdx] = en;
    });
    return out;
  } catch (e) {
    console.warn('translateBatch: error', e);
    return null;
  }
}

// Convenience for a single string (used by cs-agent to translate one draft).
export async function translateOne(input: string): Promise<string | null> {
  const out = await translateBatch([input]);
  return out?.[0] ?? null;
}
