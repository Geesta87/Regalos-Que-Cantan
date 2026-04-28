-- 20260427_admin_users.sql
-- Source of truth for who can access the admin dashboard, and what role they have.
-- One row per Supabase Auth user with dashboard access.
--
-- role:
--   'admin'     — full visibility (revenue, prices, commissions)
--   'assistant' — same functions, but revenue / prices / commissions are hidden

CREATE TABLE IF NOT EXISTS admin_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'assistant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_users_role_idx ON admin_users(role);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Logged-in dashboard users can read ONLY their own row, to discover their role.
-- They cannot see other admins / assistants.
DROP POLICY IF EXISTS "admin_users self-read" ON admin_users;
CREATE POLICY "admin_users self-read"
  ON admin_users FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- No client-side writes. All INSERT/UPDATE/DELETE happens via the SQL editor
-- or service-role key (e.g. from a migration or future edge function).
-- Omitting INSERT/UPDATE/DELETE policies means RLS denies them by default.
