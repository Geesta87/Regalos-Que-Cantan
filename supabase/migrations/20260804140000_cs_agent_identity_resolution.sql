-- CS agent audit remediation — 2026-08-04
--
-- PROBLEM (measured over 60 days of live traffic):
--   The bot's look_up_my_order tool reads public.cs_customer_lookup, and that
--   view exposed NO email column — it could only ever match on phone. Meanwhile
--   cs-agent's "situation snapshot" DID search by email, against songs directly.
--   Two lookup paths, different data, contradictory answers: the model was
--   handed "customer identified, here is their link" by one and "no orders" by
--   the other, so it hedged and wrote "I couldn't find your order".
--   88 such drafts in 45 days; in 57 of them (65%) the order existed and the
--   owner pasted the working link seconds later.
--
-- FIX (this migration):
--   1. Add email / email_local to the view so ONE resolver can match on phone,
--      email (with domain-typo tolerance via the local-part) and recipient name.
--      New columns are APPENDED — CREATE OR REPLACE VIEW cannot reorder or drop
--      existing ones, and every existing consumer keeps working untouched.
--   2. Index what the bot actually filters on. There was NO index on
--      whatsapp_phone at all: every draft seq-scanned ~80k song rows, twice.
--   3. Preserve the pre-edit draft text (sms_messages.draft_original) so owner
--      corrections stop being destroyed by the approve-draft UPDATE.

-- ── 1. cs_customer_lookup: add identity columns ─────────────────────────────
create or replace view public.cs_customer_lookup as
select
  id,
  right(regexp_replace(coalesce(whatsapp_phone, ''::text), '[^0-9]'::text, ''::text, 'g'::text), 10) as phone_last10,
  recipient_name,
  sender_name,
  occasion,
  coalesce(genre_name, genre) as genre,
  short_code,
  status as song_status,
  audio_url is not null and audio_url <> ''::text as song_ready,
  has_video_addon,
  karaoke_video_status,
  karaoke_status,
  created_at,
  paid_at,
  paid_at is not null
    and (paid = true or payment_status = 'paid'::text)
    and (coalesce(amount_paid, 0::numeric) > 0::numeric or stripe_payment_id is not null) as is_paid,
  -- ── appended below this line (order matters: CREATE OR REPLACE can only add) ──
  lower(trim(email)) as email,
  -- Local-part only, so "juan@glail.com" still resolves "juan@gmail.com".
  -- Mirrors the domain-typo tolerance cs-agent/cs-copilot already do in code.
  lower(split_part(trim(email), '@', 1)) as email_local,
  lower(trim(recipient_name)) as recipient_name_lc
from songs s;

comment on view public.cs_customer_lookup is
  'Safe, read-only customer-facing projection of songs for the CS agent. Exposes ONLY fields a customer may see about their own order. Resolvable by phone_last10, email, email_local (typo-tolerant) or recipient_name_lc — see _shared/cs-customer-resolve.ts, the single resolver both the situation snapshot and the look_up_my_order tool go through.';

-- ── 2. Indexes for the lookups the CS agent actually performs ───────────────
-- Last-10-digits of whatsapp_phone. Previously UNINDEXED: cs-agent ran
-- `ilike whatsapp_phone '%<last10>'` on every draft, which cannot use an index
-- at all (leading wildcard) and seq-scanned the whole table.
create index if not exists idx_songs_phone_last10
  on public.songs (right(regexp_replace(coalesce(whatsapp_phone, ''), '[^0-9]', '', 'g'), 10))
  where whatsapp_phone is not null;

-- Full lower(trim(email)) index. idx_songs_lower_email_paid already exists but is
-- PARTIAL (WHERE paid), so unpaid-order lookups — the majority of "where is my
-- song" traffic — could not use it.
create index if not exists idx_songs_email_trimmed_lower
  on public.songs (lower(trim(email)))
  where email is not null;

-- Local-part, for the domain-typo fallback.
create index if not exists idx_songs_email_local
  on public.songs (lower(split_part(trim(email), '@', 1)))
  where email is not null;

-- Recipient name, the last-resort fallback the training doc tells the bot to ask
-- for when neither phone nor email resolves.
create index if not exists idx_songs_recipient_name_lower
  on public.songs (lower(trim(recipient_name)))
  where recipient_name is not null;

-- ── 3. Preserve the pre-edit draft ──────────────────────────────────────────
-- sms-admin's approve-draft did `update({ body: editedText })`, overwriting the
-- AI's original text in place. was_edited recorded THAT an edit happened but the
-- "before" was gone forever — destroying the single highest-signal training data
-- the system produces (296 owner corrections in 60 days, unrecoverable).
alter table public.sms_messages
  add column if not exists draft_original text;

comment on column public.sms_messages.draft_original is
  'The AI draft exactly as written, captured when the owner edits it before approving. NULL when the draft was sent unchanged. Never customer-visible — only `body` is ever delivered. Feeds the Bot Training edit-diff view.';

-- Same "before" text on the learning corpus, so retrieval can show the model
-- "you wrote X, the team corrected it to Y" instead of only the corrected text.
-- A correction is a far stronger teaching signal when the mistake travels with it.
alter table public.cs_examples
  add column if not exists draft_original text;

comment on column public.cs_examples.draft_original is
  'PII-redacted AI draft as originally written, when the owner edited it before approving (was_edited = true). NULL otherwise.';

-- ── 4. Retrieval: return the correction, and stop retrieving junk ───────────
-- Two changes:
--   • also return draft_original, so the prompt can show "you wrote X, the team
--     corrected it to Y" rather than only the corrected text;
--   • skip fragments. 187 of 1,709 examples are under 25 characters ("ok",
--     "gracias", a bare link). They carry no lesson and crowd out real ones.
-- RETURNS TABLE changed, so this needs DROP + CREATE. cs-agent already catches a
-- retrieval failure and falls back to recency, so the swap is safe in flight.
drop function if exists public.match_cs_examples(vector, integer);

create function public.match_cs_examples(query_embedding vector, match_count integer)
returns table(customer_msg text, reply text, was_edited boolean, draft_original text, similarity double precision)
language sql
stable
as $function$
  select customer_msg, reply, was_edited, draft_original,
         1 - (embedding <=> query_embedding) as similarity
  from cs_examples
  where embedding is not null
    and reply is not null
    and length(trim(reply)) >= 25
  order by embedding <=> query_embedding
  limit match_count;
$function$;
