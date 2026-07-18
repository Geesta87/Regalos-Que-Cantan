-- Browser-safe preview copy for the dashboard player: camera codecs
-- (DJI H.265 / 10-bit H.264) play audio over a black frame in Chrome, so
-- clip-prepare transcodes a 720p H.264 preview when the source needs it.
-- (Already applied to the live db via execute_sql on 2026-07-17.)
alter table clip_projects add column if not exists preview_url text;
