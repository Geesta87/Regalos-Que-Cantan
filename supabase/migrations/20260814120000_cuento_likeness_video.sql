-- Cuento Ilustrado v2 (2026-08-14): likeness tier + animated pages.
-- real_photo_url: optional real photo shown as the second-to-last page.
-- page_videos: seedance loop URLs keyed 'cover' / stanza index — progressive
-- enhancement, added after the book is already 'ready'.
ALTER TABLE cuentos ADD COLUMN IF NOT EXISTS real_photo_url text;
ALTER TABLE cuentos ADD COLUMN IF NOT EXISTS page_videos jsonb NOT NULL DEFAULT '{}'::jsonb;
