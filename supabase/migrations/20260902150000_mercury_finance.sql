-- Mercury Bank → P&L Finance system, Phase 1 (the ledger).
-- Design doc: docs/pnl-financial-agent-mercury.md
--
-- mercury-sync (pg_cron, nightly) pulls every transaction from the Mercury
-- business account via their READ-ONLY API token and lands it here;
-- finance-data (verify_jwt=true, OWNER-only — role='admin', invisible to
-- assistants) serves the admin Finance tab. This system can only READ the
-- bank — the token type is architecturally unable to move money.
-- Service-role only (RLS on, no policies).

create table if not exists public.mercury_accounts (
  id                text primary key,          -- Mercury account UUID
  name              text,
  kind              text,                      -- checking / savings / treasury / …
  status            text,
  current_balance   numeric,
  available_balance numeric,
  raw               jsonb,
  synced_at         timestamptz not null default now()
);
alter table public.mercury_accounts enable row level security;

create table if not exists public.mercury_transactions (
  id                 text primary key,         -- Mercury transaction UUID
  account_id         text not null,
  amount             numeric not null,         -- Mercury convention: negative = money OUT, positive = money IN
  counterparty_name  text,
  counterparty_clean text,                     -- lowercased/normalized for rule matching
  status             text,                     -- pending|sent|cancelled|failed|reversed|blocked
  kind               text,                     -- externalTransfer|creditCardTransaction|internalTransfer|…
  mercury_category   text,                     -- Mercury's own enum (Software, Advertising, …)
  bank_description   text,
  note               text,
  created_at_mercury timestamptz,
  posted_at          timestamptz,
  -- OUR P&L bucket. Deliberately NOT check-constrained: the category set is
  -- owner-evolvable (whitelist enforced in finance-data instead).
  category           text not null default 'other',
  category_source    text not null default 'default'
                     check (category_source in ('default','mercury','rule','manual','agent')),
  is_transfer        boolean not null default false, -- internal moves; excluded from P&L (would double-count)
  dashboard_link     text,
  raw                jsonb,
  synced_at          timestamptz not null default now(),
  alerted_at         timestamptz               -- big-debit alert already sent (dedupe)
);
alter table public.mercury_transactions enable row level security;
create index if not exists idx_mercury_txn_posted   on public.mercury_transactions (posted_at desc);
create index if not exists idx_mercury_txn_created  on public.mercury_transactions (created_at_mercury desc);
create index if not exists idx_mercury_txn_category on public.mercury_transactions (category);
create index if not exists idx_mercury_txn_cpty     on public.mercury_transactions (counterparty_clean);

-- Vendor → category rules. First match wins (priority asc, then newest).
-- pattern is a lowercase SUBSTRING matched against counterparty_clean.
create table if not exists public.mercury_category_rules (
  id         uuid primary key default gen_random_uuid(),
  pattern    text not null,
  category   text not null,
  priority   int  not null default 100,
  hit_count  int  not null default 0,
  created_by text,                              -- 'seed' | admin email
  created_at timestamptz not null default now()
);
alter table public.mercury_category_rules enable row level security;

-- Single-row sync bookkeeping. backfill_done=false ⇒ next run pulls
-- MERCURY_BACKFILL_MONTHS (default 24) of history without firing alerts.
create table if not exists public.mercury_sync_state (
  id             int primary key default 1 check (id = 1),
  last_synced_at timestamptz,
  backfill_done  boolean not null default false,
  last_error     text,
  updated_at     timestamptz not null default now()
);
alter table public.mercury_sync_state enable row level security;
insert into public.mercury_sync_state (id) values (1) on conflict (id) do nothing;

-- Seed rules for the vendors this business already pays every month
-- (memory/CLAUDE.md stack list). Owner recategorizations land at priority 10
-- and beat these.
insert into public.mercury_category_rules (pattern, category, priority, created_by) values
  ('stripe',      'revenue_stripe',      50, 'seed'),
  ('facebook',    'ads_meta',            50, 'seed'),
  ('facebk',      'ads_meta',            50, 'seed'),
  ('meta platf',  'ads_meta',            50, 'seed'),
  ('kie',         'ai_apis',             50, 'seed'),
  ('useapi',      'ai_apis',             50, 'seed'),
  ('mureka',      'ai_apis',             50, 'seed'),
  ('anthropic',   'ai_apis',             50, 'seed'),
  ('openai',      'ai_apis',             50, 'seed'),
  ('supabase',    'infra',               50, 'seed'),
  ('vercel',      'infra',               50, 'seed'),
  ('google cloud','infra',               50, 'seed'),
  ('shotstack',   'infra',               50, 'seed'),
  ('twilio',      'messaging',           50, 'seed'),
  ('sendgrid',    'messaging',           50, 'seed'),
  -- NOTE: no 'mercury' → fees_bank seed. It matched "Mercury Credit" card-bill
  -- payments and own-account transfer legs (removed in prod 2026-09-02;
  -- mercury-sync marks those is_transfer instead). AmEx bill payments get
  -- 'other' — Mercury mislabels them as bank fees, and the card's real spend
  -- mix is invisible to the bank feed (owner recategorizes in the tab).
  ('american express', 'other',           40, 'seed'),
  ('irs',         'taxes',               50, 'seed'),
  ('franchise tax','taxes',              50, 'seed')
on conflict do nothing;

-- ───────────────────────────────────────────────────────────────────────────
-- Aggregation RPCs (the songs-table lesson: aggregate in SQL, never fetch
-- thousands of rows into an edge function). SECURITY DEFINER + execute revoked
-- from anon/authenticated: only the service role (finance-data, after its own
-- role='admin' gate) can call them. Months/days bucketed America/Los_Angeles.
-- P&L counts pending+sent, excludes transfers and failed/cancelled/etc.

create or replace function public.mercury_pnl(p_months int default 13)
returns table(month text, category text, total numeric, txn_count bigint)
language sql stable security definer set search_path = public as $$
  select to_char(date_trunc('month', coalesce(posted_at, created_at_mercury) at time zone 'America/Los_Angeles'), 'YYYY-MM') as month,
         category,
         sum(amount) as total,
         count(*) as txn_count
  from mercury_transactions
  where is_transfer = false
    and status in ('pending','sent')
    and coalesce(posted_at, created_at_mercury) >=
        (date_trunc('month', now() at time zone 'America/Los_Angeles') - make_interval(months => greatest(p_months,1) - 1)) at time zone 'America/Los_Angeles'
  group by 1, 2
  order by 1 desc, 3 asc
$$;

create or replace function public.mercury_cashflow_daily(p_days int default 90)
returns table(day date, inflow numeric, outflow numeric)
language sql stable security definer set search_path = public as $$
  select (coalesce(posted_at, created_at_mercury) at time zone 'America/Los_Angeles')::date as day,
         sum(case when amount > 0 then amount else 0 end)  as inflow,
         sum(case when amount < 0 then -amount else 0 end) as outflow
  from mercury_transactions
  where is_transfer = false
    and status in ('pending','sent')
    and coalesce(posted_at, created_at_mercury) >= now() - make_interval(days => greatest(p_days,1))
  group by 1
  order by 1
$$;

create or replace function public.mercury_top_counterparties(p_days int default 30)
returns table(counterparty text, total_out numeric, txn_count bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(counterparty_name, '(unknown)') as counterparty,
         sum(-amount) as total_out,
         count(*) as txn_count
  from mercury_transactions
  where is_transfer = false
    and status in ('pending','sent')
    and amount < 0
    and coalesce(posted_at, created_at_mercury) >= now() - make_interval(days => greatest(p_days,1))
  group by 1
  order by 2 desc
  limit 10
$$;

revoke all on function public.mercury_pnl(int)                from public, anon, authenticated;
revoke all on function public.mercury_cashflow_daily(int)     from public, anon, authenticated;
revoke all on function public.mercury_top_counterparties(int) from public, anon, authenticated;
