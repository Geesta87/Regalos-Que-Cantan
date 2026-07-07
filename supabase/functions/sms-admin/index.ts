// supabase/functions/sms-admin/index.ts
//
// Authenticated read/send endpoint for the admin dashboard "💬 Mensajes SMS"
// tab (src/components/admin/SmsInboxTab.jsx).
//
// Auth pattern is identical to admin-songs:
//   1. Platform gateway verifies the Supabase Auth JWT (config.toml has
//      [functions.sms-admin] verify_jwt = true).
//   2. We resolve the caller via getUser() and require a row in admin_users.
//      Both 'admin' and 'assistant' may use the inbox — there are no
//      revenue-sensitive fields here, so no redaction is needed.
//
// Contract with the frontend (SmsInboxTab.jsx):
//   GET                                   → { success, role, conversations: [...] }
//   POST { action: 'send', conversation_id, body }   → { success, message }
//   POST { action: 'mark-read', conversation_id }     → { success }
//   POST { action: 'save-push-subscription', subscription }  → { success }
//       (stores the device's web-push subscription + fires a confirmation
//        push so the admin instantly sees notifications working)
//   POST { action: 'remove-push-subscription', endpoint }    → { success }
//
// Each conversation in the list carries its full message history:
//   { id, customer_name, phone, order_id, unread, opted_out,
//     last_message_at, messages: [ { id, direction, body, status, created_at } ] }
//
// Deploy with: supabase functions deploy sms-admin --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendSms } from '../_shared/send-sms.ts';
import { sendWhatsApp } from '../_shared/send-whatsapp.ts';
import { sendPush } from '../_shared/web-push.ts';
import { redactPII } from '../_shared/cs-redact.ts';
import { DEFAULT_OO_MESSAGE } from '../_shared/out-of-office.ts';

// Deliver an outbound message on the conversation's channel, optionally with an
// image (mediaUrl must be a publicly-fetchable URL — we pass a short-lived
// signed Storage URL).
async function deliver(channel: string, to: string, body: string, mediaUrl?: string) {
  return channel === 'whatsapp'
    ? await sendWhatsApp(to, body, mediaUrl)
    : await sendSms(to, body, mediaUrl);
}

// Private bucket for customer-service image attachments. We only ever expose
// short-lived signed URLs (to Twilio at send time, and to the admin thread on
// each load) — the objects are never public.
const MEDIA_BUCKET = 'cs-media';
const MEDIA_SIGN_TTL = 3600; // seconds

// Decode a base64 data URL ("data:image/png;base64,AAAA…") to bytes + mime.
function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m) return null;
  const contentType = m[1];
  if (!contentType.startsWith('image/')) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, contentType };
  } catch {
    return null;
  }
}

// Attach freshly-signed media_url to any messages that carry a media_path, so
// the thread can render the image. Best-effort — a signing failure just omits
// the URL rather than breaking the inbox.
// deno-lint-ignore no-explicit-any
async function attachMediaUrls(admin: any, messages: any[]): Promise<void> {
  const withMedia = messages.filter((m) => m && m.media_path);
  if (!withMedia.length) return;
  const paths = withMedia.map((m) => m.media_path as string);
  try {
    const { data } = await admin.storage.from(MEDIA_BUCKET).createSignedUrls(paths, MEDIA_SIGN_TTL);
    const byPath: Record<string, string> = {};
    for (const row of data || []) {
      if (row?.path && row?.signedUrl) byPath[row.path] = row.signedUrl;
    }
    for (const m of withMedia) m.media_url = byPath[m.media_path] || null;
  } catch (e) {
    console.warn('attachMediaUrls failed', e);
  }
}

// Save an owner-approved / owner-sent reply as a learning example for cs-agent.
// Pairs it with the customer's most recent inbound message. Best-effort: never
// let a capture failure break the reply. Links/emails/phones are redacted.
async function captureExample(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: { conversationId: string; channel: string; reply: string; wasEdited: boolean; source: string },
) {
  try {
    const { data: lastIn } = await admin
      .from('sms_messages')
      .select('body')
      .eq('conversation_id', opts.conversationId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    await admin.from('cs_examples').insert({
      channel: opts.channel || 'sms',
      customer_msg: redactPII(lastIn?.body || ''),
      reply: redactPII(opts.reply),
      was_edited: opts.wasEdited,
      source: opts.source,
    });
  } catch (e) {
    console.warn('captureExample failed', e);
  }
}

// Best-effort: find the ONE song a fix request should target, from the phone on
// the conversation. Prefers a paid, already-generated song, newest first. Returns
// null when it can't confidently pick one — the person working the queue links it.
async function resolveSongForPhone(
  // deno-lint-ignore no-explicit-any
  admin: any,
  phone: string,
): Promise<{ id: string; recipient_name: string | null } | null> {
  const last10 = String(phone || '').replace(/\D/g, '').slice(-10);
  if (last10.length < 10) return null;
  const { data } = await admin
    .from('songs')
    .select('id, recipient_name, audio_url, paid, paid_at, payment_status')
    .ilike('whatsapp_phone', `%${last10}`)
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = data || [];
  if (!rows.length) return null;
  // deno-lint-ignore no-explicit-any
  const isPaid = (s: any) => s.paid === true || s.payment_status === 'paid' || !!s.paid_at;
  // deno-lint-ignore no-explicit-any
  const withAudio = rows.filter((s: any) => s.audio_url);
  const pick =
    withAudio.find(isPaid) || withAudio[0] || rows.find(isPaid) || rows[0];
  return pick ? { id: String(pick.id), recipient_name: pick.recipient_name ?? null } : null;
}

// Create (or refresh) an open song-fix request from an approved cs-agent draft.
// Idempotent per conversation: if an open request already exists for this
// conversation, update its text instead of stacking duplicates.
async function createSongFixRequest(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    conversationId: string;
    phone: string;
    customerName: string | null;
    whatToChange: string;
    sourceMessage: string | null;
  },
): Promise<{ created: boolean; song_linked: boolean }> {
  const song = await resolveSongForPhone(admin, opts.phone);
  const context = {
    customer_name: opts.customerName || null,
    phone: opts.phone || null,
    recipient_name: song?.recipient_name || null,
    source: 'cs-agent',
    source_message: opts.sourceMessage || null,
  };

  // Reuse an existing OPEN request for this conversation (don't stack copies).
  const { data: existing } = await admin
    .from('song_fix_requests')
    .select('id')
    .eq('conversation_id', opts.conversationId)
    .in('status', ['pending', 'in_progress', 'awaiting_approval'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from('song_fix_requests')
      .update({
        customer_request: opts.whatToChange,
        context,
        ...(song?.id ? { song_id: song.id } : {}),
      })
      .eq('id', existing.id);
    return { created: false, song_linked: !!song?.id };
  }

  await admin.from('song_fix_requests').insert({
    song_id: song?.id || null,
    conversation_id: opts.conversationId,
    customer_request: opts.whatToChange,
    context,
    status: 'pending',
    created_by: 'cs-agent',
  });
  return { created: true, song_linked: !!song?.id };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// How many conversations the inbox loads at once. The SMS tables are small
// (one row per customer phone), so a flat cap is fine — no pagination yet.
const CONVERSATION_LIMIT = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ success: false, error: 'Missing Authorization header' }, 401);
    }

    // Resolve WHO the caller is from their JWT.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: 'Invalid session' }, 401);
    }

    // Service-role client for the actual data access.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: roleRow, error: roleErr } = await admin
      .from('admin_users')
      .select('role')
      .eq('user_id', userData.user.id)
      .single();
    if (roleErr || !roleRow) {
      return json({ success: false, error: 'No admin access' }, 403);
    }
    const role = roleRow.role as 'admin' | 'assistant';

    // ─── Parse action (GET = list) ───────────────────────────────────────
    let body: {
      action?: string;
      conversation_id?: string;
      message_id?: string;
      body?: string;
      channel?: string; // 'sms' | 'whatsapp' — which channel to reply on
      subscription?: { endpoint?: string };
      endpoint?: string;
      out_of_office?: boolean;
      out_of_office_message?: string;
      media_data_url?: string; // "data:image/png;base64,…" for an image attachment
      phone?: string;           // start-conversation: the recipient's number
    } = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = body.action || 'list';

    // ─── action: list ────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: convos, error: cErr } = await admin
        .from('sms_conversations')
        .select('id, customer_name, phone, order_id, unread, opted_out, last_message_at, channel')
        .order('last_message_at', { ascending: false })
        .limit(CONVERSATION_LIMIT);
      if (cErr) return json({ success: false, error: cErr.message }, 500);

      const ids = (convos || []).map((c) => c.id);
      let messagesByConvo: Record<string, unknown[]> = {};
      if (ids.length > 0) {
        const { data: msgs, error: mErr } = await admin
          .from('sms_messages')
          .select('id, conversation_id, direction, body, status, created_at, channel, ai_generated, needs_human, media_path, media_type')
          .in('conversation_id', ids)
          .order('created_at', { ascending: true });
        if (mErr) return json({ success: false, error: mErr.message }, 500);
        // Sign media URLs for any image attachments so the thread can show them.
        await attachMediaUrls(admin, msgs || []);
        messagesByConvo = (msgs || []).reduce((acc: Record<string, unknown[]>, m) => {
          (acc[m.conversation_id] ||= []).push(m);
          return acc;
        }, {});
      }

      const conversations = (convos || []).map((c) => ({
        ...c,
        messages: messagesByConvo[c.id] || [],
      }));

      // Out-of-office toggle state (shared cs_agent_settings singleton). Returned
      // with the inbox so the header toggle reflects the real state on load.
      const { data: ooRow } = await admin
        .from('cs_agent_settings')
        .select('out_of_office, out_of_office_message')
        .eq('id', 1)
        .maybeSingle();
      const settings = {
        out_of_office: !!ooRow?.out_of_office,
        out_of_office_message: (ooRow?.out_of_office_message || '').trim() || DEFAULT_OO_MESSAGE,
      };

      return json({ success: true, role, conversations, settings });
    }

    // ─── action: set-out-of-office ───────────────────────────────────────
    // Flip the out-of-office auto-reply on/off and (optionally) edit the
    // message customers receive while the team is away.
    if (action === 'set-out-of-office') {
      const oo = !!body.out_of_office;
      const update: Record<string, unknown> = { id: 1, out_of_office: oo };
      // Only overwrite the message when one was provided (blank = keep current).
      if (typeof body.out_of_office_message === 'string') {
        const trimmed = body.out_of_office_message.trim();
        if (trimmed) update.out_of_office_message = trimmed;
      }
      const { error: ooErr } = await admin
        .from('cs_agent_settings')
        .upsert(update, { onConflict: 'id' });
      if (ooErr) return json({ success: false, error: ooErr.message }, 500);

      const { data: ooRow } = await admin
        .from('cs_agent_settings')
        .select('out_of_office, out_of_office_message')
        .eq('id', 1)
        .maybeSingle();
      return json({
        success: true,
        settings: {
          out_of_office: !!ooRow?.out_of_office,
          out_of_office_message: (ooRow?.out_of_office_message || '').trim() || DEFAULT_OO_MESSAGE,
        },
      });
    }

    // ─── action: send ────────────────────────────────────────────────────
    if (action === 'send') {
      const convoId = body.conversation_id;
      const text = (body.body || '').trim();
      const hasMedia = typeof body.media_data_url === 'string' && body.media_data_url.length > 0;
      // A message needs SOMETHING to send — text or an image.
      if (!convoId || (!text && !hasMedia)) {
        return json({ success: false, error: 'conversation_id and body or media required' }, 400);
      }

      const { data: convo, error: convoErr } = await admin
        .from('sms_conversations')
        .select('id, phone, opted_out, channel')
        .eq('id', convoId)
        .single();
      if (convoErr || !convo) {
        return json({ success: false, error: 'Conversation not found' }, 404);
      }
      // Hard stop: never text someone who opted out (legal + Twilio will reject).
      if (convo.opted_out) {
        return json({ success: false, error: 'Customer has opted out (STOP) — cannot send' }, 409);
      }

      const sendCh = body.channel || convo.channel || 'sms';

      // Upload the image (if any) to the private bucket and sign a short-lived
      // URL for Twilio to fetch. Done BEFORE sending so a bad upload never sends
      // a broken link.
      let mediaPath: string | null = null;
      let mediaType: string | null = null;
      let mediaSignedUrl: string | undefined;
      if (hasMedia) {
        const decoded = decodeDataUrl(body.media_data_url!);
        if (!decoded) {
          return json({ success: false, error: 'Attachment must be a base64 image data URL' }, 400);
        }
        if (decoded.bytes.length > 5_242_880) {
          return json({ success: false, error: 'Attachment too large (max 5MB)' }, 413);
        }
        const ext = (decoded.contentType.split('/')[1] || 'png').replace('jpeg', 'jpg');
        mediaPath = `${convoId}/${crypto.randomUUID()}.${ext}`;
        mediaType = decoded.contentType;
        const { error: upErr } = await admin.storage
          .from(MEDIA_BUCKET)
          .upload(mediaPath, decoded.bytes, { contentType: decoded.contentType, upsert: false });
        if (upErr) return json({ success: false, error: `Upload failed: ${upErr.message}` }, 500);
        const { data: signed, error: signErr } = await admin.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(mediaPath, MEDIA_SIGN_TTL);
        if (signErr || !signed?.signedUrl) {
          return json({ success: false, error: 'Could not sign media URL' }, 500);
        }
        mediaSignedUrl = signed.signedUrl;
      }

      // Reply on the channel the dashboard is viewing (SMS tab → sms,
      // WhatsApp tab → whatsapp). Falls back to the conversation's channel.
      const result = await deliver(sendCh, convo.phone, text, mediaSignedUrl);

      // Record the outbound message regardless of send outcome, so the thread
      // reflects what was attempted. status mirrors the Twilio result.
      const nowIso = new Date().toISOString();
      const { data: inserted, error: insErr } = await admin
        .from('sms_messages')
        .insert({
          conversation_id: convoId,
          direction: 'outbound',
          body: text,
          status: result.ok ? (result.status || 'sent') : 'failed',
          twilio_sid: result.sid || null,
          channel: sendCh,
          media_path: mediaPath,
          media_type: mediaType,
        })
        .select('id, direction, body, status, created_at, channel, ai_generated, needs_human, media_path, media_type')
        .single();
      if (insErr) return json({ success: false, error: insErr.message }, 500);
      // Give the client a signed URL so it can show the image right away.
      if (inserted && mediaSignedUrl) (inserted as Record<string, unknown>).media_url = mediaSignedUrl;

      await admin
        .from('sms_conversations')
        .update({ last_message_at: nowIso })
        .eq('id', convoId);

      if (!result.ok) {
        return json({ success: false, error: result.error || 'Send failed', message: inserted }, 502);
      }
      // Learn from this manual reply (owner's own voice). Text only — skip
      // image-only messages (nothing to learn for the bot's writing style).
      if (text) {
        await captureExample(admin, { conversationId: convoId, channel: sendCh, reply: text, wasEdited: false, source: 'manual' });
      }
      return json({ success: true, message: inserted });
    }

    // ─── action: approve-draft ───────────────────────────────────────────
    // The owner approves an AI-drafted reply (optionally after editing it). We
    // send it on the conversation's channel and flip THAT draft row to a normal
    // outbound status — we do not insert a second row.
    if (action === 'approve-draft') {
      const convoId = body.conversation_id;
      const messageId = body.message_id;
      const editedText = (body.body || '').trim(); // optional edit; '' = keep draft text
      if (!convoId || !messageId) {
        return json({ success: false, error: 'conversation_id and message_id required' }, 400);
      }

      const { data: draft, error: dErr } = await admin
        .from('sms_messages')
        .select('id, conversation_id, body, status, direction, channel, proposed_action')
        .eq('id', messageId)
        .single();
      if (dErr || !draft) return json({ success: false, error: 'Draft not found' }, 404);
      if (draft.conversation_id !== convoId || draft.status !== 'draft' || draft.direction !== 'outbound') {
        return json({ success: false, error: 'Not an approvable draft' }, 409);
      }

      const { data: convo, error: cErr } = await admin
        .from('sms_conversations')
        .select('id, phone, opted_out, channel, customer_name')
        .eq('id', convoId)
        .single();
      if (cErr || !convo) return json({ success: false, error: 'Conversation not found' }, 404);
      if (convo.opted_out) {
        return json({ success: false, error: 'Customer has opted out (STOP) — cannot send' }, 409);
      }

      const text = editedText || draft.body;
      // Send the draft on its OWN channel (the channel of the message it replies to).
      const draftCh = draft.channel || convo.channel || 'sms';
      const result = await deliver(draftCh, convo.phone, text);
      const nowIso = new Date().toISOString();

      const { data: updated, error: uErr } = await admin
        .from('sms_messages')
        .update({
          body: text,
          status: result.ok ? (result.status || 'sent') : 'failed',
          twilio_sid: result.sid || null,
          needs_human: false,
          // Quality signal for the dashboard: did the owner change the draft
          // before approving it?
          was_edited: !!(editedText && editedText !== draft.body),
          // Re-stamp to the SEND time. The draft was created when the AI wrote
          // it, but the customer may have sent more messages before the owner
          // approved — without this the approved reply appears mid-thread
          // instead of at the bottom where it actually went out.
          created_at: nowIso,
        })
        .eq('id', messageId)
        .select('id, direction, body, status, created_at, channel, ai_generated, needs_human')
        .single();
      if (uErr) return json({ success: false, error: uErr.message }, 500);

      await admin.from('sms_conversations').update({ last_message_at: nowIso }).eq('id', convoId);

      if (!result.ok) {
        return json({ success: false, error: result.error || 'Send failed', message: updated }, 502);
      }
      // Learn from this approved reply — edits count as corrections.
      await captureExample(admin, {
        conversationId: convoId,
        channel: draftCh,
        reply: text,
        wasEdited: !!(editedText && editedText !== draft.body),
        source: 'approve',
      });

      // Execute the draft's PROPOSED side action — the owner's approval of the
      // draft is the authorization. v1: resend the customer's PAID song link by
      // email via recover-song (sends only that email's own paid songs to that
      // same email, so nothing can leak to a third party).
      let sideAction: string | undefined;
      const pa = (draft as Record<string, any>).proposed_action;
      if (pa?.type === 'song_fix_request') {
        // Queue a song fix for the "Fix Song" tab. The team makes the change and
        // the OWNER releases it — nothing about the song changes here.
        const whatToChange = String(pa.what_to_change || '').trim();
        if (whatToChange) {
          try {
            const { data: lastIn } = await admin
              .from('sms_messages')
              .select('body')
              .eq('conversation_id', convoId)
              .eq('direction', 'inbound')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            const r = await createSongFixRequest(admin, {
              conversationId: convoId,
              phone: convo.phone,
              customerName: convo.customer_name ?? null,
              whatToChange,
              sourceMessage: lastIn?.body ?? null,
            });
            sideAction = r.created
              ? `Solicitud de arreglo creada${r.song_linked ? '' : ' (falta vincular la canción)'}`
              : 'Solicitud de arreglo actualizada';
          } catch (e) {
            sideAction = `No se pudo crear la solicitud de arreglo: ${String(e).slice(0, 80)}`;
            console.error('approve-draft song_fix_request failed', e);
          }
        }
      } else if (pa?.type === 'resend_email') {
        const paEmail = String(pa.email || '').trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paEmail)) {
          try {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/recover-song`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
              body: JSON.stringify({ email: paEmail, action: 'send', which: 'paid' }),
            });
            const rj = await r.json().catch(() => ({}));
            sideAction = rj?.emailSent
              ? `Enlace reenviado por correo a ${paEmail}`
              : `Sin canciones pagadas para ${paEmail} — no se envió correo`;
          } catch (e) {
            sideAction = `Reenvío por correo falló: ${String(e).slice(0, 80)}`;
            console.error('approve-draft resend_email failed', e);
          }
        }
      }

      return json({ success: true, message: updated, side_action: sideAction });
    }

    // ─── action: discard-draft ───────────────────────────────────────────
    if (action === 'discard-draft') {
      const messageId = body.message_id;
      if (!messageId) return json({ success: false, error: 'message_id required' }, 400);
      const { error: updErr } = await admin
        .from('sms_messages')
        .update({ status: 'discarded', needs_human: false })
        .eq('id', messageId)
        .eq('status', 'draft');
      if (updErr) return json({ success: false, error: updErr.message }, 500);
      return json({ success: true });
    }

    // ─── action: start-conversation ──────────────────────────────────────
    // Reach out to a phone number the owner types in (new outbound thread).
    // WhatsApp free-text only works inside the customer's 24h window; if it
    // fails, we AUTO FALL BACK to SMS so the message still gets through.
    if (action === 'start-conversation') {
      const text = (body.body || '').trim();
      const wantCh = body.channel === 'whatsapp' ? 'whatsapp' : 'sms';
      const rawPhone = (body.phone || '').trim();
      const digits = rawPhone.replace(/\D/g, '');
      if (digits.length < 10) return json({ success: false, error: 'Enter a valid phone number' }, 400);
      if (!text) return json({ success: false, error: 'Message is required' }, 400);
      // Normalize to E.164 (assume US when 10 digits).
      const phone = rawPhone.startsWith('+')
        ? `+${digits}`
        : digits.length === 10 ? `+1${digits}` : `+${digits}`;

      // Find or create the conversation for this number.
      const { data: existing } = await admin
        .from('sms_conversations').select('id, opted_out').eq('phone', phone).maybeSingle();
      if (existing?.opted_out) {
        return json({ success: false, error: 'This number opted out (STOP) — cannot message it' }, 409);
      }
      let conversationId = existing?.id as string | undefined;
      if (!conversationId) {
        // Best-effort: enrich name/order from a matching paid song (same as the webhooks).
        let customerName: string | null = null;
        let orderId: string | null = null;
        try {
          const last10 = digits.slice(-10);
          const { data: song } = await admin
            .from('songs').select('id, recipient_name, sender_name, whatsapp_phone')
            .ilike('whatsapp_phone', `%${last10}`).order('created_at', { ascending: false }).limit(1).maybeSingle();
          if (song) { customerName = song.sender_name || song.recipient_name || null; orderId = song.id || null; }
        } catch (_e) { /* enrichment optional */ }
        const { data: created, error: cErr } = await admin
          .from('sms_conversations')
          .insert({ phone, customer_name: customerName, order_id: orderId, unread: 0, last_message_at: new Date().toISOString(), channel: wantCh })
          .select('id').single();
        if (cErr || !created) return json({ success: false, error: cErr?.message || 'Could not create conversation' }, 500);
        conversationId = created.id;
      }

      // Send, with WhatsApp → SMS fallback.
      let sendCh = wantCh;
      let result = wantCh === 'whatsapp' ? await sendWhatsApp(phone, text) : await sendSms(phone, text);
      let fellBack = false;
      if (wantCh === 'whatsapp' && !result.ok) {
        sendCh = 'sms';
        fellBack = true;
        result = await sendSms(phone, text);
      }

      const nowIso = new Date().toISOString();
      const { data: inserted, error: insErr } = await admin
        .from('sms_messages')
        .insert({
          conversation_id: conversationId,
          direction: 'outbound',
          body: text,
          status: result.ok ? (result.status || 'sent') : 'failed',
          twilio_sid: result.sid || null,
          channel: sendCh,
        })
        .select('id, direction, body, status, created_at, channel, ai_generated, needs_human, media_path, media_type')
        .single();
      if (insErr) return json({ success: false, error: insErr.message }, 500);
      await admin.from('sms_conversations').update({ last_message_at: nowIso, channel: sendCh }).eq('id', conversationId);

      if (!result.ok) {
        return json({ success: false, error: result.error || 'Send failed', conversation_id: conversationId, message: inserted }, 502);
      }
      return json({ success: true, conversation_id: conversationId, channel_used: sendCh, fell_back: fellBack, message: inserted });
    }

    // ─── action: mark-read ───────────────────────────────────────────────
    if (action === 'mark-read') {
      if (!body.conversation_id) {
        return json({ success: false, error: 'conversation_id required' }, 400);
      }
      const { error: updErr } = await admin
        .from('sms_conversations')
        .update({ unread: 0 })
        .eq('id', body.conversation_id);
      if (updErr) return json({ success: false, error: updErr.message }, 500);
      return json({ success: true });
    }

    // ─── action: save-push-subscription ──────────────────────────────────
    if (action === 'save-push-subscription') {
      const sub = body.subscription;
      if (!sub?.endpoint) {
        return json({ success: false, error: 'subscription with endpoint required' }, 400);
      }
      const { error: upsertErr } = await admin
        .from('push_subscriptions')
        .upsert(
          {
            user_id: userData.user.id,
            endpoint: sub.endpoint,
            subscription: sub,
            user_agent: req.headers.get('user-agent') || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'endpoint' },
        );
      if (upsertErr) return json({ success: false, error: upsertErr.message }, 500);

      // Confirmation push — proves the whole pipeline end-to-end on the spot.
      const test = await sendPush(sub, {
        title: '🔔 Notificaciones activadas',
        body: 'Te avisaremos aquí cuando un cliente mande un mensaje.',
        url: '/admin/dashboard?tab=sms',
        tag: 'rqc-confirm',
      });
      return json({ success: true, test_push_ok: test.ok, test_push_error: test.error });
    }

    // ─── action: remove-push-subscription ────────────────────────────────
    if (action === 'remove-push-subscription') {
      if (!body.endpoint) {
        return json({ success: false, error: 'endpoint required' }, 400);
      }
      const { error: delErr } = await admin
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', body.endpoint);
      if (delErr) return json({ success: false, error: delErr.message }, 500);
      return json({ success: true });
    }

    return json({ success: false, error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
