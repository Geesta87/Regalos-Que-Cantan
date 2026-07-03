// supabase/functions/_shared/inbound-media.ts
//
// When a customer sends an IMAGE over SMS/WhatsApp, Twilio delivers a MediaUrl
// (auth-protected) rather than the bytes. This downloads it (with the Twilio
// credentials), stores it in the private cs-media bucket, and returns the
// storage path so the inbound message can reference it — the admin thread then
// shows it (signed URL) and cs-agent can SEE it (Claude vision).
//
// Best-effort: returns null on any failure so a media hiccup never blocks
// capturing the customer's message.

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const MEDIA_BUCKET = 'cs-media';
const MAX_BYTES = 8_000_000;

// deno-lint-ignore no-explicit-any
export async function storeInboundImage(
  admin: any,
  opts: { conversationId: string; mediaUrl: string; contentType: string },
): Promise<{ path: string; type: string } | null> {
  try {
    if (!opts.mediaUrl) return null;
    if (!opts.contentType || !opts.contentType.startsWith('image/')) return null; // images only for now
    const headers: Record<string, string> = {};
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      headers['Authorization'] = 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    }
    const res = await fetch(opts.mediaUrl, { headers });
    if (!res.ok) {
      console.warn('inbound-media: fetch failed', res.status);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      console.warn('inbound-media: bad size', buf.length);
      return null;
    }
    const ext = (opts.contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = `inbound/${opts.conversationId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(path, buf, { contentType: opts.contentType, upsert: false });
    if (error) {
      console.warn('inbound-media: upload failed', error.message);
      return null;
    }
    return { path, type: opts.contentType };
  } catch (e) {
    console.warn('inbound-media: error', e);
    return null;
  }
}
