-- Allow the Chief of Staff to stage a "duplicate & scale a winning campaign"
-- action (approval-gated like the others).
alter table public.cos_pending_actions drop constraint if exists cos_pending_actions_action_type_check;
alter table public.cos_pending_actions add constraint cos_pending_actions_action_type_check
  check (action_type in ('pause','resume','set_budget','extract_creative','duplicate_scale'));
