// supabase/functions/_shared/cuba-ip-block.ts
//
// Offline Cuba IP detection for generate-song's country gate.
//
// WHY: Roly's viral video (July 2026) drove a wave of song generations from
// Cuba — 32 creators / 47 Kie generations in 3 days with ZERO possibility of
// purchase, because Stripe cannot process Cuban cards under the US embargo
// (OFAC). Every Cuban generation is a guaranteed credit loss, so we decline
// generation up front with a friendly message instead.
//
// HOW: Cuba's registry-delegated IPv4 blocks embedded as sorted
// [startInt, endInt] pairs + binary search. No external geo API is called at
// runtime (privacy + latency + no per-request cost).
//
// PRECISION RULE — Cuba ONLY, zero spillover: every block below is confirmed
// Cuba by ALL of (a) geo-whois-asn-country, (b) DB-IP lite, and (c) iptoasn
// routing data (ETECSA autonomous system), cross-checked 2026-07-02. These
// are the LACNIC registry delegations to Cuban operators. Tiny ambiguous
// slices that only ONE database called Cuba (iCloud Private Relay egress
// 104.28.x, Brown University 138.16.x, Telcel Mexico 177.253.x slivers, etc.)
// are deliberately EXCLUDED — better to let a rare Cuban visitor through
// than to ever block a paying customer from another country.
// Cuban allocations essentially never change (embargo — no new
// registrations), so this list does not need frequent refreshing.

const ipToInt = (ip: string): number | null => {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null; // IPv6 or garbage — not matchable here
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n;
};

// Sorted, non-overlapping [start, end] inclusive ranges.
// 14 blocks, ~256k addresses — the entirety of Cuba's meaningful IPv4 space.
const CUBA_RANGES: Array<[number, number]> = [
  [2563637248, 2563768319], // 152.206.0.0/15   (152.206.0.0 - 152.207.255.255) ETECSA
  [2845704192, 2845769727], // 169.158.0.0/16   (169.158.0.0 - 169.158.255.255) ETECSA
  [3051479040, 3051487231], // 181.225.224.0/19 (181.225.224.0 - 181.225.255.255)
  [3188080640, 3188088831], // 190.6.64.0/19    (190.6.64.0 - 190.6.95.255)
  [3188690944, 3188695039], // 190.15.144.0/20  (190.15.144.0 - 190.15.159.255)
  [3193729024, 3193733119], // 190.92.112.0/20  (190.92.112.0 - 190.92.127.255)
  [3194683392, 3194687487], // 190.107.0.0/20   (190.107.0.0 - 190.107.15.255)
  [3355447296, 3355447551], // 200.0.16.0/24    (200.0.16.0 - 200.0.16.255)
  [3355449344, 3355450367], // 200.0.24.0/22    (200.0.24.0 - 200.0.27.255)
  [3355773952, 3355774975], // 200.5.12.0/22    (200.5.12.0 - 200.5.15.255)
  [3356332032, 3356334079], // 200.13.144.0/21  (200.13.144.0 - 200.13.151.255)
  [3356372992, 3356375039], // 200.14.48.0/21   (200.14.48.0 - 200.14.55.255)
  [3359080448, 3359096831], // 200.55.128.0/18  (200.55.128.0 - 200.55.191.255) ETECSA
  [3386687488, 3386695679], // 201.220.192.0/19 (201.220.192.0 - 201.220.223.255)
];

/** True when the dotted-quad IPv4 address geolocates to Cuba. IPv6 or
 *  unparseable input returns false (fail-open: never block on bad data). */
export function isCubaIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  const n = ipToInt(ip);
  if (n === null) return false;
  let lo = 0, hi = CUBA_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (n < CUBA_RANGES[mid][0]) hi = mid - 1;
    else if (n > CUBA_RANGES[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}
