-- US-528: Create rainbow_config_audit table for profile separation validation
-- Stores hourly audit results from profile separation checks

CREATE TABLE IF NOT EXISTS rainbow_config_audit (
  id SERIAL PRIMARY KEY,
  audit_type TEXT NOT NULL DEFAULT 'profile_separation',
  profile_pair TEXT NOT NULL,
  contamination_score NUMERIC(4, 3) NOT NULL,
  detected_duplicates JSONB NOT NULL DEFAULT '[]',
  audit_time TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Index for faster queries on profile_pair and audit_type
CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_profile_pair
  ON rainbow_config_audit(profile_pair);

CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_audit_time
  ON rainbow_config_audit(audit_time DESC);

CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_type_time
  ON rainbow_config_audit(audit_type, audit_time DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_rainbow_config_audit_type_pair
  ON rainbow_config_audit(audit_type, profile_pair);
