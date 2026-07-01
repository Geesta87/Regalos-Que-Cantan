-- Bot Training panel: owner-editable knowledge for the customer-service rep.
-- When knowledge_doc is non-empty, cs-agent uses it instead of the built-in
-- _shared/cs-knowledge.ts default. Edited via the cs-training-admin function.
alter table public.cs_agent_settings
  add column if not exists knowledge_doc text;
