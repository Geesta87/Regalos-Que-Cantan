-- Allow the Chief of Staff to stage a "build a lookalike audience" action
-- (approval-gated; on confirm it uploads recent buyers + creates a Meta lookalike).
alter table public.cos_pending_actions drop constraint if exists cos_pending_actions_action_type_check;
alter table public.cos_pending_actions add constraint cos_pending_actions_action_type_check
  check (action_type in ('pause','resume','set_budget','extract_creative','duplicate_scale','create_lookalike'));
