-- Admin read access to the $5 scheduled gift-SMS upsell rows.
-- scheduled_gift_messages has RLS on with NO policies on purpose (recipient
-- phones must stay unreachable from the public anon key), so the dashboard
-- reads it through this security-definer RPC instead. Rows only come back for
-- logged-in admin_users members; everyone else gets an empty set.
create or replace function gift_sms_admin_list(limit_n int default 300)
returns setof public.scheduled_gift_messages
language sql stable security definer set search_path = public as $$
  select g.*
  from scheduled_gift_messages g
  where exists (select 1 from admin_users au where au.user_id = auth.uid())
  order by g.created_at desc
  limit least(greatest(coalesce(limit_n, 300), 1), 1000);
$$;

revoke all on function gift_sms_admin_list(int) from public, anon;
grant execute on function gift_sms_admin_list(int) to authenticated, service_role;
