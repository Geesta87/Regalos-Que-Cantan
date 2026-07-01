-- ───────────────────────────────────────────────────────────────────────────
-- Automated hot-lead WhatsApp outreach
--
-- 1. hotlead_autosend toggle on cs_agent_settings (master on/off; defaults OFF).
-- 2. get_hotlead_candidates(limit) — returns leads eligible for an automated
--    WhatsApp nudge, doing all the heavy filtering IN SQL (the songs table is
--    large — see project memory). A lead is eligible when:
--      • has a WhatsApp phone + recipient + email + a ready song (audio_url)
--      • NOT paid, and the person has NOT paid on ANY order (by email OR phone)
--        → the moment they buy, they stop being a lead and are excluded
--      • not already contacted (whatsapp_sent_at is null)
--      • created between 30 min and 72 h ago (grace period so genuine buyers
--        finish first; freshness cap so we never nudge cold weeks-old leads)
--      • not opted out (STOP) in sms_conversations
--    Deduped by phone (one message per person), newest song first, song ids
--    aggregated so the /comparison link covers all their songs.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.cs_agent_settings
  add column if not exists hotlead_autosend boolean not null default false;

create or replace function public.get_hotlead_candidates(p_limit int default 25)
returns table (
  phone text, email text, sender_name text,
  recipient_name text, genre text, song_ids text, newest timestamptz
)
language sql
stable
as $$
  with unpaid_recent as (
    select s.id, s.whatsapp_phone, s.email, s.sender_name, s.recipient_name,
           coalesce(s.genre_name, s.genre) as genre, s.created_at
    from public.songs s
    where s.whatsapp_phone is not null and s.whatsapp_phone <> ''
      and s.recipient_name is not null and s.recipient_name <> ''
      and s.email is not null and s.email <> ''
      and s.audio_url is not null and s.audio_url <> ''
      and s.whatsapp_sent_at is null
      and (s.paid is distinct from true) and (s.payment_status is distinct from 'paid')
      and s.created_at between now() - interval '72 hours' and now() - interval '30 minutes'
  ),
  paid_emails as (
    select distinct lower(email) as e from public.songs where paid = true and email is not null
  ),
  paid_phones as (
    select distinct whatsapp_phone as p from public.songs where paid = true and whatsapp_phone is not null
  ),
  opted_out as (
    select right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) as last10
    from public.sms_conversations where opted_out = true
  ),
  eligible as (
    select u.* from unpaid_recent u
    where lower(u.email) not in (select e from paid_emails)
      and u.whatsapp_phone not in (select p from paid_phones)
      and right(regexp_replace(u.whatsapp_phone, '[^0-9]', '', 'g'), 10)
          not in (select last10 from opted_out)
  )
  select
    e.whatsapp_phone as phone,
    max(e.email) as email,
    max(e.sender_name) as sender_name,
    (array_agg(e.recipient_name order by e.created_at desc))[1] as recipient_name,
    (array_agg(e.genre order by e.created_at desc))[1] as genre,
    string_agg(e.id::text, ',' order by e.created_at desc) as song_ids,
    max(e.created_at) as newest
  from eligible e
  group by e.whatsapp_phone
  order by max(e.created_at) desc
  limit p_limit;
$$;

revoke all on function public.get_hotlead_candidates(int) from anon, authenticated;
