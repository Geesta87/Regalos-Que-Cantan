// Generates a VAPID key pair for Web Push and prints:
//   1. VAPID_KEYS_JSON  — JWK pair, store as a Supabase secret (server side)
//   2. applicationServerKey — base64url public key, safe to embed in frontend
//
// Output format matches what jsr:@negrel/webpush importVapidKeys() expects
// (the same shape its own exportVapidKeys() produces).
//
// Run: node scripts/generate-vapid-keys.mjs

const subtle = globalThis.crypto.subtle;

const keyPair = await subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const publicKey = await subtle.exportKey('jwk', keyPair.publicKey);
const privateKey = await subtle.exportKey('jwk', keyPair.privateKey);

// applicationServerKey = base64url of the raw (uncompressed point) public key.
const raw = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
const appServerKey = Buffer.from(raw).toString('base64url');

console.log('VAPID_KEYS_JSON (Supabase secret — keep private):');
console.log(JSON.stringify({ publicKey, privateKey }));
console.log('');
console.log('applicationServerKey (public, goes in frontend):');
console.log(appServerKey);
