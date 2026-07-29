-- Organic / referral attribution on orders.
--
-- WHY: utm_source only exists on links we control (ads, email, tagged social).
-- Visitors who find us through Google search arrive with a clean URL, so 61% of
-- paid orders had utm_source = NULL and organic revenue was unmeasurable.
-- The frontend now captures document.referrer on landing and passes it through
-- create-checkout into these columns.
--
-- Additive and nullable: nothing existing reads or writes them, and utm_source
-- is never overwritten — reporting uses coalesce(utm_source, referrer_source).
-- Privacy: hostname and landing path only, never the full referring URL.

alter table public.songs add column if not exists referrer_source text;  -- e.g. 'google-organic', 'ai-referral', 'direct'
alter table public.songs add column if not exists referrer_host text;    -- raw hostname, for verification/debugging
alter table public.songs add column if not exists landing_path text;     -- which page they entered on (which SEO page earns)

-- Paid-order attribution queries filter on paid + paid_at and group by source.
create index if not exists songs_referrer_source_paid_idx
  on public.songs (referrer_source, paid_at)
  where paid = true;
