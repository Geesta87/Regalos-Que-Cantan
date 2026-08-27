-- Ops Agent: staged customer-support/ops actions that require explicit owner approval.
-- The admin-dashboard Ops Agent (ops-agent edge function) NEVER executes a write
-- directly from chat — a row lands here as 'pending', the tab shows a Confirm/Cancel
-- card, and only on Confirm does ops-agent run the actual operation (video retry,
-- order-data fix, delivery resend, karaoke retry, fix-song intake).
-- Same pattern as cos_pending_actions (migration 20260626120000).
-- Service-role only (reached via the admin-gated ops-agent edge function).
create table if not exists public.ops_pending_actions (
  id           uuid primary key default gen_random_uuid(),
  action_type  text not null check (action_type in (
                 'retry_render',        -- re-dispatch a video_orders render (admin-videos 'retry')
                 'reset_for_reupload',  -- wipe a video order's photos so the customer can re-upload
                 'update_order',        -- fix songs row data (whitelisted columns only)
                 'resend_delivery',     -- recover-song action='send' which='paid'
                 'retry_karaoke',       -- test-karaoke re-extraction
                 'fix_song_intake'      -- song-fix-queue create-intake (lyric/wording fixes)
               )),
  target_type  text not null check (target_type in ('song','video_order','customer')),
  target_id    text,                                  -- song id / video_order id / email
  target_name  text,                                  -- human label: "María (cliente@gmail.com)"
  params       jsonb not null default '{}'::jsonb,    -- action-specific payload
  summary      text,                                  -- human-readable card text
  status       text not null default 'pending' check (status in ('pending','done','failed','cancelled')),
  result       text,                                  -- execution outcome / error
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table public.ops_pending_actions enable row level security;
create index if not exists idx_ops_pending_actions_status on public.ops_pending_actions (status, created_at desc);
