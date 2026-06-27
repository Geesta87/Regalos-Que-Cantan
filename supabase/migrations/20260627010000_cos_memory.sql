-- Chief of Staff long-term memory: durable facts the owner tells Sofía so she
-- remembers across chats and applies them automatically — preferences, standing
-- rules, decisions. Loaded into her system prompt every turn; written via her
-- `remember` tool. Service-role only (reached through the admin-gated assistant).
create table if not exists public.cos_memory (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'fact' check (kind in ('preference','rule','decision','fact')),
  content    text not null,
  created_at timestamptz not null default now()
);
alter table public.cos_memory enable row level security;
create index if not exists idx_cos_memory_kind on public.cos_memory (kind, created_at desc);
