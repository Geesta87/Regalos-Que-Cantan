-- Operating cost model — the numbers that turn "ROAS advice" into "profit advice".
--
-- Owner-editable. media-buyer-daily and cos-morning-digest read the ACTIVE rows:
--   est_costs = sum(per_order) * orders + sum(monthly) / 30
--   est_profit = revenue − ad_spend − est_costs
--
-- Seeded with ESTIMATES (see notes) — the owner should correct amounts as real
-- numbers are known. Service-role only (RLS on, no policies).

create table if not exists public.operating_costs (
  key text primary key,
  label text not null,
  kind text not null check (kind in ('per_order', 'monthly')),
  amount numeric not null default 0,
  notes text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.operating_costs enable row level security;

insert into public.operating_costs (key, label, kind, amount, notes) values
  ('song_generation', 'Song generation APIs (Kie/Mureka, ~2 takes/order)', 'per_order', 0.60, 'ESTIMATE — correct me'),
  ('stripe_fees',     'Stripe processing (~2.9% + $0.30 on ~$33 AOV)',     'per_order', 1.25, 'ESTIMATE — correct me'),
  ('messaging',       'SMS/WhatsApp/email delivery per order',             'per_order', 0.10, 'ESTIMATE — correct me'),
  ('infra',           'Supabase + Vercel + misc SaaS (incl. in-house video renderer hosting)', 'monthly', 150, 'ESTIMATE — correct me')
on conflict (key) do nothing;

-- Shotstack was cancelled (replaced by the in-house FFmpeg renderer) — the row
-- was seeded on 2026-07-03 and deactivated the same day when the owner
-- confirmed. Kept here as history; do not re-seed it.
