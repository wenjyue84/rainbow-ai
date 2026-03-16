-- US-1001: Row-Level Security for tenant-scoped tables
-- Idempotent: safe to run multiple times
--
-- PREREQUISITES:
--   1. Run as a superuser or a role with CREATE on these tables.
--   2. The application role must NOT have BYPASSRLS.
--   3. The admin/reporting role MUST have BYPASSRLS:
--        ALTER ROLE <admin_role> BYPASSRLS;
--   4. Set DATABASE_ADMIN_URL env var to a connection string for the BYPASSRLS role.
--
-- USAGE:
--   psql "$DATABASE_URL" -f migrations/rls-enable.sql

-- ─── Enable RLS on tenant-scoped tables ──────────────────────────────────────

ALTER TABLE rainbow_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rainbow_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_predictions    ENABLE ROW LEVEL SECURITY;

-- ─── Force RLS even for table owners ─────────────────────────────────────────
-- Without FORCE, the table owner can bypass RLS. Enable FORCE to ensure
-- even the owning role is subject to the policy (unless it has BYPASSRLS).

ALTER TABLE rainbow_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE rainbow_messages      FORCE ROW LEVEL SECURITY;
ALTER TABLE escalation_events     FORCE ROW LEVEL SECURITY;
ALTER TABLE intent_predictions    FORCE ROW LEVEL SECURITY;

-- ─── Drop existing policies (idempotent re-creation) ─────────────────────────

DROP POLICY IF EXISTS rls_tenant_rainbow_conversations ON rainbow_conversations;
DROP POLICY IF EXISTS rls_tenant_rainbow_messages      ON rainbow_messages;
DROP POLICY IF EXISTS rls_tenant_escalation_events     ON escalation_events;
DROP POLICY IF EXISTS rls_tenant_intent_predictions    ON intent_predictions;

-- ─── Create tenant-isolation policies ────────────────────────────────────────
--
-- current_setting('app.current_tenant', TRUE) uses the lenient form:
--   TRUE → returns NULL instead of raising an error when the setting is missing.
--
-- Rows are accessible when:
--   a) The tenant variable matches profile_id  (normal tenant query)
--   b) The tenant variable is NULL or ''       (legacy / admin fallback)
--      NOTE: remove clauses (b) once all callers use withTenantContext().
--
-- INSERT / UPDATE rows are additionally checked with WITH CHECK to ensure the
-- written profile_id matches the active tenant.

CREATE POLICY rls_tenant_rainbow_conversations ON rainbow_conversations
  FOR ALL
  USING (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  )
  WITH CHECK (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  );

CREATE POLICY rls_tenant_rainbow_messages ON rainbow_messages
  FOR ALL
  USING (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  )
  WITH CHECK (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  );

CREATE POLICY rls_tenant_escalation_events ON escalation_events
  FOR ALL
  USING (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  )
  WITH CHECK (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  );

CREATE POLICY rls_tenant_intent_predictions ON intent_predictions
  FOR ALL
  USING (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  )
  WITH CHECK (
    profile_id = current_setting('app.current_tenant', TRUE)
    OR current_setting('app.current_tenant', TRUE) IS NULL
    OR current_setting('app.current_tenant', TRUE) = ''
  );

-- ─── Verification query ───────────────────────────────────────────────────────
-- Run this after applying the migration to confirm RLS is active.

SELECT
  schemaname,
  tablename,
  rowsecurity AS rls_enabled,
  forcerowsecurity AS rls_forced
FROM pg_tables
WHERE tablename IN (
  'rainbow_conversations',
  'rainbow_messages',
  'escalation_events',
  'intent_predictions'
)
ORDER BY tablename;
