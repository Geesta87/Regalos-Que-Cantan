-- What each house photo actually contains, so the email/ad planners can pick one
-- without a vision call per email. Populated once per photo by email-studio's
-- catalog_photos action; `focus` is the important column — it records where the
-- subject sits so a wide banner crop doesn't cut people's heads off.
create table if not exists public.creative_photo_catalog (
  path        text primary key,
  bucket      text not null default 'creative-studio',
  label       text,
  description text,
  subjects    text,
  mood        text,
  is_bw       boolean not null default false,
  brightness  text not null default 'mid'    check (brightness in ('dark','mid','bright')),
  focus       text not null default 'center' check (focus in ('top','center','bottom')),
  headroom    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.creative_photo_catalog enable row level security;
-- No policies on purpose: only the service role (edge functions) may read/write.
