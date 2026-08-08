-- SEO Campaign Mode — turns the advice-only SEO Coach into an agent that plans,
-- acts (with owner approval), and verifies over weeks/months.
--
-- New pieces:
--   • seo_snapshots         — weekly Search Console snapshots (ranking history,
--                             so the agent can prove "query X moved 7.6 → 4").
--   • seo_plan              — the campaign (goal + status). One active at a time.
--   • seo_plan_tasks        — concrete tasks with ready-to-apply drafts. Status
--                             flow: proposed → approved → implemented → verified
--                             (or rejected/dropped). Owner taps Approve in the
--                             SEO Coach tab; nothing changes without that tap.
--   • seo_content_overrides — the ACTING layer for title/meta changes: approved
--                             title_meta tasks publish a row here; the prerender
--                             build (scripts/prerender.mjs) reads published rows
--                             at build time and stamps them into the static HTML.
--                             Public-read RLS (content is public page metadata
--                             anyway); writes are service-role only.
--   • seo_agent_state       — kill switch + last-run bookkeeping for the weekly
--                             agent (mirrors fix_auto_state / social_pipeline_state).
--   • seo_coach_calls       — gains auto-grading columns so the weekly agent can
--                             mark recommendations implemented/working from live
--                             page fetches + GSC movement instead of waiting for
--                             a manual grade.
--
-- This migration is SCHEMA-ONLY: applying it changes nothing user-visible and
-- schedules nothing. Activating the weekly agent is a separate, deliberate step
-- (run after the seo-agent-weekly function is deployed):
--
--   select cron.schedule(
--     'seo-agent-weekly',
--     '0 15 * * 1',   -- Mondays 15:00 UTC ≈ 8am PT
--     $$ select net.http_post(
--          url:='https://yzbvajungshqcpusfiia.supabase.co/functions/v1/seo-agent-weekly',
--          headers:='{"Content-Type":"application/json"}'::jsonb,
--          body:='{}'::jsonb
--        ); $$
--   );

-- ── Weekly Search Console snapshots ─────────────────────────────────────────
create table if not exists public.seo_snapshots (
  id uuid primary key default gen_random_uuid(),
  captured_at timestamptz not null default now(),
  totals jsonb not null default '{}'::jsonb,          -- clicks/impr/ctr/pos for the 28d window
  branded_split jsonb not null default '{}'::jsonb,
  top_queries jsonb not null default '[]'::jsonb,     -- [{query, clicks, impressions, ctr, position}]
  top_pages jsonb not null default '[]'::jsonb,
  almost_ranking jsonb not null default '[]'::jsonb,  -- striking-distance list at capture time
  orders_context jsonb not null default '{}'::jsonb   -- deduped orders incl. organic floor
);
alter table public.seo_snapshots enable row level security;
create index if not exists seo_snapshots_captured_idx on public.seo_snapshots (captured_at desc);

-- ── Campaign plan ───────────────────────────────────────────────────────────
create table if not exists public.seo_plan (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  goal text not null default '',
  status text not null default 'active' check (status in ('draft', 'active', 'completed', 'archived')),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.seo_plan enable row level security;

create table if not exists public.seo_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.seo_plan(id) on delete cascade,
  title text not null,
  -- task_type drives what "apply" means:
  --   title_meta  → approved draft publishes into seo_content_overrides (auto-applied on next build)
  --   new_page    → draft carries full page copy/seoData entry; applied by a dev session after approval
  --   content_fix / link / youtube / other → checklist items with instructions in draft
  task_type text not null default 'other' check (task_type in ('title_meta', 'new_page', 'content_fix', 'link', 'youtube', 'other')),
  target_path text,                                   -- e.g. /ocasiones/dia-de-las-madres
  target_queries text[] not null default '{}',        -- queries this task is meant to move
  rationale text not null default '',
  draft jsonb not null default '{}'::jsonb,           -- {title, meta_description, body_markdown, instructions, ...}
  due_date date,                                      -- seasonal deadline where relevant
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'implemented', 'verified', 'dropped')),
  evidence jsonb not null default '{}'::jsonb,        -- what the weekly agent observed (page fetch, position moves)
  proposed_by text not null default 'coach',          -- coach | weekly_agent | owner
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  implemented_at timestamptz,
  verified_at timestamptz
);
alter table public.seo_plan_tasks enable row level security;
create index if not exists seo_plan_tasks_plan_idx on public.seo_plan_tasks (plan_id, status);

-- ── Acting layer: build-time title/meta overrides ───────────────────────────
create table if not exists public.seo_content_overrides (
  id uuid primary key default gen_random_uuid(),
  path text not null unique,                          -- route path, e.g. /ocasiones/declaracion-amor
  title text,                                         -- null = keep static value
  meta_description text,
  published boolean not null default false,
  task_id uuid references public.seo_plan_tasks(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.seo_content_overrides enable row level security;
-- The prerender build reads this with the anon key at build time. Overrides are
-- public page metadata (they ship in the HTML), so anon SELECT of published rows
-- is safe. Writes remain service-role only (no insert/update/delete policies).
create policy seo_content_overrides_public_read on public.seo_content_overrides
  for select using (published = true);

-- ── Agent state (kill switch) ───────────────────────────────────────────────
create table if not exists public.seo_agent_state (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_digest text,
  updated_at timestamptz not null default now()
);
alter table public.seo_agent_state enable row level security;
insert into public.seo_agent_state (id, enabled) values (1, true)
  on conflict (id) do nothing;

-- ── Auto-grading columns on the existing track record ───────────────────────
alter table public.seo_coach_calls
  add column if not exists auto_status text check (auto_status in ('implemented', 'working', 'not_working', 'stale')),
  add column if not exists auto_evidence text,
  add column if not exists auto_checked_at timestamptz;
