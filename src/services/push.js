// Web-push helpers for the admin dashboard ("Mensajes SMS" tab).
//
// The flow: the device's browser creates a push subscription against its own
// push service (Google/Apple), and we store it via sms-admin so the
// notify-admin-push edge function can wake this device when a customer texts.
//
// iPhone caveat: iOS only allows web push for sites ADDED TO THE HOME SCREEN
// (iOS 16.4+). In Safari-tab mode `PushManager` simply doesn't exist, so we
// detect that and tell the user to install the app first.

// Public VAPID key (safe to embed — the private half lives only in the
// Supabase secret VAPID_KEYS_JSON). Regenerating the pair invalidates every
// existing subscription, so don't rotate casually.
export const VAPID_PUBLIC_KEY =
  'BEC4b16CB5amd8T0DC2bR5I_W-t79ysS5aKUGRF8VNzrky3fPoKIHAQEfDOPHUlrxZHHVAKr1Bl5L2-k6kjnMAI';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function getPushSupport() {
  const ua = navigator.userAgent || '';
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { supported, isIos, isStandalone };
}

export async function getCurrentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return null;
  return await reg.pushManager.getSubscription();
}

async function callSmsAdmin(accessToken, body) {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-admin`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`sms-admin ${res.status}`);
  return await res.json();
}

// Asks permission, subscribes this device, and stores the subscription.
// Throws Error('permission-denied') if the user blocks the prompt.
export async function enablePushNotifications(accessToken) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('permission-denied');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  await callSmsAdmin(accessToken, {
    action: 'save-push-subscription',
    subscription: sub.toJSON(),
  });
  return sub;
}

export async function disablePushNotifications(accessToken) {
  const sub = await getCurrentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await callSmsAdmin(accessToken, { action: 'remove-push-subscription', endpoint });
}
