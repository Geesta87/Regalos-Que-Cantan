// supabase/functions/_shared/web-push.ts
//
// Shared Web Push (RFC 8291/8292) sender used by notify-admin-push and
// sms-admin (subscription-confirmation push). Built on jsr:@negrel/webpush,
// which is WebCrypto-based and works in the Supabase Deno edge runtime
// (npm:web-push does NOT — it needs Node crypto).
//
// Required secrets:
//   VAPID_KEYS_JSON — {"publicKey":{...jwk},"privateKey":{...jwk}} pair, the
//                     same shape exportVapidKeys() produces. Generated with
//                     scripts/generate-vapid-keys.mjs (frontend embeds the
//                     matching applicationServerKey in src/lib/push.js).
//   VAPID_CONTACT   — optional contact email, defaults to hola@.

import * as webpush from 'jsr:@negrel/webpush@0.3.0';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

let appServerPromise: Promise<webpush.ApplicationServer> | null = null;

function getAppServer(): Promise<webpush.ApplicationServer> {
  if (!appServerPromise) {
    appServerPromise = (async () => {
      const keysJson = Deno.env.get('VAPID_KEYS_JSON');
      if (!keysJson) throw new Error('VAPID_KEYS_JSON secret is not set');
      const vapidKeys = await webpush.importVapidKeys(JSON.parse(keysJson), {
        extractable: false,
      });
      return await webpush.ApplicationServer.new({
        contactInformation:
          'mailto:' + (Deno.env.get('VAPID_CONTACT') || 'hola@regalosquecantan.com'),
        vapidKeys,
      });
    })();
  }
  return appServerPromise;
}

// Sends one push. `gone: true` means the subscription is dead (endpoint
// returned 404/410) and the caller should delete the row.
export async function sendPush(
  subscription: unknown,
  payload: PushPayload,
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  try {
    const appServer = await getAppServer();
    const sub = appServer.subscribe(subscription as webpush.PushSubscription);
    await sub.pushTextMessage(JSON.stringify(payload), {});
    return { ok: true };
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    const gone = status === 404 || status === 410;
    return { ok: false, gone, error: e instanceof Error ? e.message : String(e) };
  }
}
