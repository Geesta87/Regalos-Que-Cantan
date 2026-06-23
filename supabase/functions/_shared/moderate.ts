// supabase/functions/_shared/moderate.ts
//
// Lightweight content-safety gate for buyer-supplied text that we will deliver
// to a THIRD PARTY (the gift-SMS feature texts a loved one a message the buyer
// wrote). Stops the platform from being used to harass / abuse a non-consenting
// recipient. Used by create-gift-checkout BEFORE any Stripe session is created,
// so a rejected message is never charged and never scheduled.
//
// Fails OPEN: if the Anthropic key is missing or the API errors, we ALLOW the
// message (low volume + every gift is logged with the sender's identity, so we
// can act after the fact) — blocking paying customers on our own API hiccup is
// worse than letting a rare borderline message through.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
// Fast + cheap; clear-cut abuse doesn't need a bigger model.
const MODERATION_MODEL = 'claude-haiku-4-5-20251001';

export interface ModerationResult {
  allowed: boolean;
  reason?: string;
  failedOpen?: boolean;
}

export interface GiftTextParts {
  message?: string;
  recipientName?: string;
  senderName?: string;
}

const SYSTEM_PROMPT =
  'You screen short personal gift messages that will be sent as a single SMS to a loved one ' +
  '(birthday, anniversary, "thinking of you", etc.). The sender is identified to the recipient. ' +
  'Reply with ONLY a JSON object: {"allowed": boolean, "reason": string}. ' +
  'BLOCK (allowed=false) if the text contains: threats or intimidation, harassment or bullying ' +
  'aimed at the recipient, hate speech or slurs, sexual content directed at a person, doxxing, ' +
  'extortion/scam/phishing, or instructions to harm. ' +
  'ALLOW (allowed=true) warm, neutral, sad, religious, or playful messages, inside jokes, and ' +
  'mild profanity used affectionately. When a clearly benign celebratory message is ambiguous, ALLOW. ' +
  'Keep "reason" short.';

export async function moderateGiftText(parts: GiftTextParts): Promise<ModerationResult> {
  const message = (parts.message || '').trim();
  // Nothing to screen → allow (a gift can have an empty personal note).
  if (!message) return { allowed: true };
  if (!ANTHROPIC_API_KEY) {
    console.warn('[moderate] ANTHROPIC_API_KEY unset — failing open');
    return { allowed: true, failedOpen: true };
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODERATION_MODEL,
        max_tokens: 150,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              `Screen this gift text.\n` +
              `From: ${parts.senderName || '(unknown)'}\n` +
              `To: ${parts.recipientName || '(unknown)'}\n` +
              `Message: """${message}"""`,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn('[moderate] Anthropic HTTP', res.status, '— failing open');
      return { allowed: true, failedOpen: true };
    }
    const data = await res.json();
    const raw: string = data?.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    if (parsed.allowed === false) {
      return { allowed: false, reason: String(parsed.reason || 'flagged') };
    }
    return { allowed: true };
  } catch (e) {
    console.warn('[moderate] error — failing open:', e instanceof Error ? e.message : e);
    return { allowed: true, failedOpen: true };
  }
}
