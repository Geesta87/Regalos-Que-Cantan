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
import { sendPush } from '../_shared/web-push.ts';

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
      body?: string;
      subscription?: { endpoint?: string };
      endpoint?: string;
    } = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }
    const action = body.action || 'list';

    // ─── action: list ────────────────────────────────────────────────────
    if (action === 'list') {
      const { data: convos, error: cErr } = await admin
        .from('sms_conversations')
        .select('id, customer_name, phone, order_id, unread, opted_out, last_message_at')
        .order('last_message_at', { ascending: false })
        .limit(CONVERSATION_LIMIT);
      if (cErr) return json({ success: false, error: cErr.message }, 500);

      const ids = (convos || []).map((c) => c.id);
      let messagesByConvo: Record<string, unknown[]> = {};
      if (ids.length > 0) {
        const { data: msgs, error: mErr } = await admin
          .from('sms_messages')
          .select('id, conversation_id, direction, body, status, created_at')
          .in('conversation_id', ids)
          .order('created_at', { ascending: true });
        if (mErr) return json({ success: false, error: mErr.message }, 500);
        messagesByConvo = (msgs || []).reduce((acc: Record<string, unknown[]>, m) => {
          (acc[m.conversation_id] ||= []).push(m);
          return acc;
        }, {});
      }

      const conversations = (convos || []).map((c) => ({
        ...c,
        messages: messagesByConvo[c.id] || [],
      }));
      return json({ success: true, role, conversations });
    }

    // ─── action: send ────────────────────────────────────────────────────
    if (action === 'send') {
      const convoId = body.conversation_id;
      const text = (body.body || '').trim();
      if (!convoId || !text) {
        return json({ success: false, error: 'conversation_id and body required' }, 400);
      }

      const { data: convo, error: convoErr } = await admin
        .from('sms_conversations')
        .select('id, phone, opted_out')
        .eq('id', convoId)
        .single();
      if (convoErr || !convo) {
        return json({ success: false, error: 'Conversation not found' }, 404);
      }
      // Hard stop: never text someone who opted out (legal + Twilio will reject).
      if (convo.opted_out) {
        return json({ success: false, error: 'Customer has opted out (STOP) — cannot send' }, 409);
      }

      const result = await sendSms(convo.phone, text);

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
        })
        .select('id, direction, body, status, created_at')
        .single();
      if (insErr) return json({ success: false, error: insErr.message }, 500);

      await admin
        .from('sms_conversations')
        .update({ last_message_at: nowIso })
        .eq('id', convoId);

      if (!result.ok) {
        return json({ success: false, error: result.error || 'Send failed', message: inserted }, 502);
      }
      return json({ success: true, message: inserted });
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
