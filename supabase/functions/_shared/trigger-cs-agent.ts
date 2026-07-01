// supabase/functions/_shared/trigger-cs-agent.ts
//
// Fire-and-forget trigger that asks the cs-agent function to draft a reply for a
// conversation. Called by the inbound webhooks (twilio-sms-webhook,
// whatsapp-webhook) right after they store a customer's message.
//
// Why a separate function call instead of inline: drafting calls Claude, which
// takes a few seconds. A Twilio webhook must respond FAST (a slow 200 makes
// Twilio retry). So the webhook returns immediately and lets this run in the
// background via EdgeRuntime.waitUntil (see runInBackground below).
//
// cs-agent itself decides whether to actually draft (checks the master switch,
// opt-out state, and that the latest message is an inbound customer message).
// This helper does no gating — it just wakes cs-agent up.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

export function triggerCsAgent(conversationId: string): Promise<void> {
  return fetch(`${SUPABASE_URL}/functions/v1/cs-agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ conversation_id: conversationId }),
  })
    .then(() => {})
    .catch((e) => console.warn('trigger-cs-agent: cs-agent call failed', e));
}

// Run a promise past the HTTP response when the platform supports it
// (Supabase Edge / Deno Deploy expose EdgeRuntime.waitUntil). Falls back to a
// best-effort fire-and-forget so it still works locally.
export function runInBackground(p: Promise<unknown>): void {
  try {
    // deno-lint-ignore no-explicit-any
    const er = (globalThis as any).EdgeRuntime;
    if (er && typeof er.waitUntil === 'function') {
      er.waitUntil(p);
      return;
    }
  } catch (_e) {
    // fall through
  }
  // No waitUntil available — let it run detached.
  void p;
}
