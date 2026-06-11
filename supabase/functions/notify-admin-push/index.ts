// supabase/functions/notify-admin-push/index.ts
//
// Fans out a web-push notification to every admin device that enabled
// notifications (rows in push_subscriptions). Called SERVER-TO-SERVER only —
// today from twilio-sms-webhook when a customer texts us.
//
// verify_jwt = false (config.toml): callers are other edge functions holding
// the service-role key, not user sessions. Because the gateway lets anyone
// through, we require the Bearer token to BE the service-role key — without
// it this endpoint would be a public notification-spam cannon.
//
// Contract: POST { title, body, url?, tag?, audience? } → { success, sent, removed }
//   audience: 'all' (default) → every subscribed device
//             'admin'         → only devices whose user has admin_users.role
//                               = 'admin'. Revenue-bearing pushes (💰 sale
//                               amounts) MUST use 'admin' — assistants like
//                               Ivan must never see pricing, mirroring the
//                               dashboard's revenue redaction.
// Dead subscriptions (endpoint 404/410) are deleted as we go.
//
// Deploy with: supabase functions deploy notify-admin-push --project-ref yzbvajungshqcpusfiia

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendPush } from '../_shared/web-push.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (bearer !== SUPABASE_SERVICE_ROLE_KEY) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const { title, body, url, tag, audience } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ success: false, error: 'title and body required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: allSubs, error } = await admin
      .from('push_subscriptions')
      .select('endpoint, subscription, user_id');
    if (error) throw error;

    let subs = allSubs || [];
    if (audience === 'admin') {
      // Revenue-bearing push: deliver only to full admins. Devices whose
      // user_id is missing or maps to 'assistant' are skipped entirely.
      const { data: adminRows, error: roleErr } = await admin
        .from('admin_users')
        .select('user_id')
        .eq('role', 'admin');
      if (roleErr) throw roleErr;
      const adminIds = new Set((adminRows || []).map((r) => String(r.user_id)));
      subs = subs.filter((s) => s.user_id && adminIds.has(String(s.user_id)));
    }

    let sent = 0;
    let removed = 0;
    for (const row of subs) {
      const result = await sendPush(row.subscription, { title, body, url, tag });
      if (result.ok) {
        sent++;
      } else if (result.gone) {
        await admin.from('push_subscriptions').delete().eq('endpoint', row.endpoint);
        removed++;
      } else {
        console.warn('notify-admin-push: send failed', result.error);
      }
    }

    return new Response(JSON.stringify({ success: true, sent, removed }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('notify-admin-push error:', e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
