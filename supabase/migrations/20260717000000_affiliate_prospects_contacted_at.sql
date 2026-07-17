-- Track when a prospect was first contacted so the Recruit Partners tab can
-- surface a "follow up" list (contacted N+ days ago with no reply). Additive,
-- nullable — existing rows stay null (never contacted). Set by
-- affiliate-recruiter-admin's `status` action when a prospect moves to 'contacted'.
alter table public.affiliate_prospects
  add column if not exists contacted_at timestamptz;
