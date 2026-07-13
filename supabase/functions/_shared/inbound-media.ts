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
//
// VOICE NOTES (added): the same download+store path also handles inbound audio
// (WhatsApp voice notes / MMS audio) via storeInboundVoice, and
// transcribeVoiceMessage runs OpenAI Whisper in the background to fill in the
// message body so the transcript is searchable and the AI can read it.

import { triggerCsAgent, runInBackground } from './trigger-cs-agent.ts';
import { maybeSendOutOfOffice } from './out-of-office.ts';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
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

// ── Voice notes ─────────────────────────────────────────────────────────────

// MIME → a file extension Whisper + the storage object can use.
function audioExt(type: string): string {
  const sub = ((type || '').split(';')[0].split('/')[1] || 'ogg').replace('x-', '');
  const map: Record<string, string> = {
    mpeg: 'mp3', mp3: 'mp3', ogg: 'ogg', opus: 'ogg', oga: 'ogg', amr: 'amr',
    wav: 'wav', webm: 'webm', mp4: 'mp4', m4a: 'm4a', aac: 'aac', '3gpp': '3gp',
  };
  return map[sub] || sub;
}

// Download + store an inbound VOICE NOTE (audio). Mirrors storeInboundImage but
// for audio/* and returns the raw bytes too, so the caller can transcribe them
// in the background without re-downloading. Best-effort → null on any failure.
// deno-lint-ignore no-explicit-any
export async function storeInboundVoice(
  admin: any,
  opts: { conversationId: string; mediaUrl: string; contentType: string },
): Promise<{ path: string; type: string; bytes: Uint8Array } | null> {
  try {
    if (!opts.mediaUrl) return null;
    // Strip any MIME parameters ("audio/ogg; codecs=opus" → "audio/ogg") so the
    // bucket's allowed_mime_types exact-match check accepts it.
    const cleanType = (opts.contentType || '').split(';')[0].trim().toLowerCase();
    if (!cleanType.startsWith('audio/')) return null;
    const headers: Record<string, string> = {};
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      headers['Authorization'] = 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    }
    const res = await fetch(opts.mediaUrl, { headers });
    if (!res.ok) {
      console.warn('inbound-media: voice fetch failed', res.status);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) {
      console.warn('inbound-media: voice bad size', buf.length);
      return null;
    }
    const path = `voice/${opts.conversationId}/${crypto.randomUUID()}.${audioExt(cleanType)}`;
    const { error } = await admin.storage
      .from(MEDIA_BUCKET)
      .upload(path, buf, { contentType: cleanType, upsert: false });
    if (error) {
      console.warn('inbound-media: voice upload failed', error.message);
      return null;
    }
    return { path, type: cleanType, bytes: buf };
  } catch (e) {
    console.warn('inbound-media: voice error', e);
    return null;
  }
}

// Whisper transcription of raw audio bytes. No language hint — customers speak
// Spanish or English, so we let Whisper auto-detect. Bounded by a timeout so a
// hung request can't wedge the background task. Returns null on any failure.
async function whisperTranscribe(bytes: Uint8Array, type: string): Promise<string | null> {
  if (!OPENAI_API_KEY) {
    console.warn('inbound-media: OPENAI_API_KEY missing — skipping transcription');
    return null;
  }
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), `voice.${audioExt(type)}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      console.warn('inbound-media: Whisper failed', resp.status, (await resp.text()).slice(0, 200));
      return null;
    }
    const data = await resp.json();
    return (String(data?.text || '')).trim() || null;
  } catch (e) {
    console.warn('inbound-media: Whisper error', (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Background pipeline for a stored voice note: transcribe the bytes, write the
// transcript onto the message row, then run the normal out-of-office / AI-draft
// follow-up AFTER the transcript is in place (so the agent reads real text, not
// an empty body). Fire-and-forget — never throws into the webhook.
export function transcribeVoiceMessage(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    messageId: string;
    bytes: Uint8Array;
    contentType: string;
    conversationId: string;
    phone: string;
    channel: 'sms' | 'whatsapp';
    replyable: boolean;
    lastAutoReplyAt: string | null;
  },
): void {
  runInBackground(
    (async () => {
      const transcript = await whisperTranscribe(opts.bytes, opts.contentType);
      if (transcript) {
        const { error } = await admin
          .from('sms_messages')
          .update({ body: transcript })
          .eq('id', opts.messageId);
        if (error) console.warn('inbound-media: transcript update failed', error.message);
      }
      // Follow-up AFTER the transcript lands.
      if (opts.replyable) {
        try {
          const r = await maybeSendOutOfOffice(admin, {
            conversationId: opts.conversationId,
            phone: opts.phone,
            channel: opts.channel,
            lastAutoReplyAt: opts.lastAutoReplyAt,
          });
          if (!r.sent) await triggerCsAgent(opts.conversationId);
        } catch (e) {
          console.warn('inbound-media: voice follow-up failed', (e as Error).message);
        }
      }
    })(),
  );
}
