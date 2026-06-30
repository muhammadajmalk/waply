-- ============================================================
-- 024_api_keys.sql — External API keys for programmatic access.
--
-- Allows account members to generate API keys for sending
-- WhatsApp messages via a REST API (Bearer token auth).
--
-- Key lifecycle
--   1. User creates a key via POST /api/keys (returns the raw
--      key exactly once).
--   2. The raw key is never stored — only its SHA-256 hash +
--      an 8-char prefix (for indexed lookups) are persisted.
--   3. A key can be revoked via DELETE /api/keys/[id], which
--      sets revoked_at. Revoked keys are excluded from auth
--      lookups.
--   4. last_used_at is updated asynchronously on each
--      successful auth to help users audit key usage.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- SHA-256 hex digest of the raw key (64 chars).
  key_hash TEXT NOT NULL UNIQUE,
  -- First 8 hex chars of the hash — used for indexed prefix
  -- lookups (WHERE key_hash LIKE prefix || '%').
  key_prefix TEXT NOT NULL,
  -- The last four chars of the raw key so users can identify
  -- which key they're looking at in the UI without storing
  -- the full secret.
  key_tail TEXT NOT NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

-- Index for prefix lookups during authentication.
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
  ON api_keys(key_prefix)
  WHERE revoked_at IS NULL;

-- Index for listing keys per account.
CREATE INDEX IF NOT EXISTS idx_api_keys_account
  ON api_keys(account_id, created_at DESC);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
--
-- Account members (agent+) can manage their own keys.
-- ============================================================

-- SELECT: any member of the account can see keys.
DROP POLICY IF EXISTS api_keys_select ON api_keys;
CREATE POLICY api_keys_select ON api_keys FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

-- INSERT: agent+ can create keys.
DROP POLICY IF EXISTS api_keys_insert ON api_keys;
CREATE POLICY api_keys_insert ON api_keys FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND created_by_user_id = auth.uid()
  );

-- UPDATE: agent+ can update keys (e.g. revoke).
DROP POLICY IF EXISTS api_keys_update ON api_keys;
CREATE POLICY api_keys_update ON api_keys FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

-- DELETE: admin+ can delete keys.
DROP POLICY IF EXISTS api_keys_delete ON api_keys;
CREATE POLICY api_keys_delete ON api_keys FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- ENABLE REALTIME (optional — for live key-list updates)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'api_keys'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE api_keys;
  END IF;
END $$;
