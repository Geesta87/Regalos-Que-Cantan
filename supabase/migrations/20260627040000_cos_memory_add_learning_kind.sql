-- Let the Chief of Staff record compounding LEARNINGS (test outcomes, what won/lost)
-- as a distinct memory kind, so her playbook grows over time instead of re-learning.
alter table public.cos_memory drop constraint if exists cos_memory_kind_check;
alter table public.cos_memory add constraint cos_memory_kind_check
  check (kind in ('preference','rule','decision','fact','learning'));
