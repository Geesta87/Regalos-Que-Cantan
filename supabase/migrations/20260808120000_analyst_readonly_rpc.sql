-- Business Analyst read-only SQL gateway.
-- APPLIED LIVE 2026-08-08 (as migrations analyst_readonly_rpc +
-- analyst_readonly_rpc_invoker_fix; this file is the consolidated result).
--
-- The business-analyst edge function lets a Claude agent answer the owner's
-- questions by querying the database. The agent must NEVER be able to write,
-- no matter what SQL it produces (prompt injection through a question, a model
-- mistake, anything). Defense in depth:
--
--   1. analyst_readonly is a dedicated NOLOGIN role with SELECT-only grants.
--   2. analyst_run_sql() is SECURITY INVOKER and drops into that role
--      (SET LOCAL ROLE) before executing, so even SQL that sneaks past the
--      text checks physically cannot write — Postgres itself rejects it.
--      (SECURITY DEFINER cannot SET ROLE — error 42501 — which is why the
--      invoker + membership-grant shape is used: service_role is granted
--      analyst_readonly membership and is the only role allowed to execute.)
--   3. Belt-and-suspenders text checks: must start with SELECT/WITH, no write
--      or DDL keywords (blocks WITH-based DELETE/UPDATE too), single
--      statement only.
--   4. 8s statement timeout and a hard 200-row cap (the agent aggregates in
--      SQL; it never needs raw row dumps — songs is ~82k rows and growing).
--
-- Verified live 2026-08-08: SELECT works; UPDATE rejected (P0001); CTE
-- delete rejected (P0001).

do $$ begin
  if not exists (select from pg_roles where rolname = 'analyst_readonly') then
    create role analyst_readonly nologin;
  end if;
end $$;

grant usage on schema public to analyst_readonly;
grant select on all tables in schema public to analyst_readonly;
alter default privileges in schema public grant select on tables to analyst_readonly;
grant analyst_readonly to service_role;

create or replace function public.analyst_run_sql(q text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin
  if q is null or btrim(q) = '' then
    raise exception 'empty query';
  end if;
  if q !~* '^\s*(select|with)\M' then
    raise exception 'only SELECT / WITH queries are allowed';
  end if;
  if q ~* '\m(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|call|do|refresh|reindex|cluster|listen|notify|reset|comment|lock|prepare|deallocate|merge)\M' then
    raise exception 'write/DDL keywords are not allowed';
  end if;
  if position(';' in rtrim(q, E' ;\n\t')) > 0 then
    raise exception 'multiple statements are not allowed';
  end if;

  perform set_config('statement_timeout', '8000', true);
  set local role analyst_readonly;
  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (select * from (%s) analyst_raw limit 200) t',
    rtrim(q, E' ;\n\t')  -- a trailing semicolon would break the subquery wrapper
  ) into result;
  reset role;
  return result;
end $$;

revoke all on function public.analyst_run_sql(text) from public;
revoke all on function public.analyst_run_sql(text) from anon;
revoke all on function public.analyst_run_sql(text) from authenticated;
grant execute on function public.analyst_run_sql(text) to service_role;
