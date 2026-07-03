-- Step 3: semantic retrieval over the team's approved replies.
--
-- Instead of feeding the bot the last N approved replies blindly, we embed each
-- example's customer message and, at draft time, retrieve the ones most SIMILAR
-- to the incoming question — so the bot learns from relevant precedent every
-- time, and improves automatically as more replies are approved.
--
-- Embeddings: OpenAI text-embedding-3-small (1536 dims). cs-agent embeds new/
-- unembedded examples lazily (a few per run) so the corpus fills in on its own.

create extension if not exists vector;

alter table cs_examples
  add column if not exists embedding vector(1536);

-- Top-K semantic match. Cosine distance (<=>); returns the closest approved
-- replies. No ivfflat index yet — the table is small (hundreds of rows) so a
-- flat scan is fast; add an index when it grows into the tens of thousands.
create or replace function match_cs_examples(query_embedding vector(1536), match_count int)
returns table (customer_msg text, reply text, was_edited boolean, similarity float)
language sql stable as $$
  select customer_msg, reply, was_edited, 1 - (embedding <=> query_embedding) as similarity
  from cs_examples
  where embedding is not null
    and reply is not null
    and length(trim(reply)) > 0
  order by embedding <=> query_embedding
  limit match_count;
$$;
