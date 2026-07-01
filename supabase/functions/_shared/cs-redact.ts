// supabase/functions/_shared/cs-redact.ts
//
// Strip personally-identifying / order-specific data from a string before it is
// stored as a customer-service learning example. We keep the wording/tone (so
// the bot can learn the owner's voice) but remove links, emails, and phone
// numbers so one customer's data can never resurface in another customer's
// draft. Real order data always comes from the look_up_my_order tool.

export function redactPII(s: string | null | undefined): string {
  return (s || '')
    .replace(/https?:\/\/\S+/gi, '[ENLACE]')                    // URLs
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[CORREO]')       // emails
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[TELÉFONO]')            // phone-like runs
    .trim();
}
