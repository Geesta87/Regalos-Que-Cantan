-- Track WHEN the owner's seasonal push was last edited, separately from the row's
-- generic updated_at (which style_notes saves also bump, so it cannot answer
-- "how old is this push?").
--
-- Why this exists: on 2026-08-17 the Ads Coach kept pitching a 4th of July angle
-- six weeks after the holiday, because creative_studio_config.promo_notes still
-- held a one-off June brief and every generator injects it as "OWNER'S CURRENT
-- PUSH". Nothing in the system knew how old that instruction was, so nothing
-- could question it. With this column the brief carries its own age and the
-- generators can flag (or ignore) a push that has gone stale.
alter table creative_studio_config
  add column if not exists promo_updated_at timestamptz;

-- Best available backfill: updated_at is an UPPER BOUND on when the promo was
-- written (a later style_notes save may have bumped it), so the computed age is
-- conservative — never older than reality.
update creative_studio_config
  set promo_updated_at = updated_at
  where promo_updated_at is null;

comment on column creative_studio_config.promo_updated_at is
  'When promo_notes was last written. Feeds the staleness warning in brandContext() so generators stop obeying an expired seasonal push.';
