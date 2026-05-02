-- Hard IP blocklist consulted by generate-song before any rate-limit math.
-- Used for abusers who've demonstrated intent to evade the soft caps —
-- the actual case that motivated this: an attacker who'd already burned
-- 90+ unpaid songs across 9 fake @myyahoo.com emails started typo'ing
-- the recipient name (Yanely → Janely) so the per-(sender,recipient)
-- soft cap stopped matching.
--
-- Once an IP is in here, every generate-song request from it returns 403
-- before any DB count or Mureka call — recipient-name variations, email
-- rotation, and sender-name changes are all irrelevant.

CREATE TABLE IF NOT EXISTS blocked_ips (
  ip          TEXT        PRIMARY KEY,
  reason      TEXT,
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE blocked_ips IS
  'Admin-curated IP blocklist consulted by generate-song. Add an IP here to immediately stop new song generations from that origin. Lookup happens before any rate-limit arithmetic so blocks are immediate.';
