-- Create intent_classifier_baselines table for US-098
-- Tracks baseline accuracy per profile per intent for regression detection

CREATE TABLE IF NOT EXISTS intent_classifier_baselines (
  id SERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL,
  intent_type TEXT NOT NULL,
  accuracy_pct REAL NOT NULL,  -- percentage (0-100)
  sample_count INTEGER NOT NULL,  -- number of messages evaluated
  baseline_date TIMESTAMP NOT NULL,  -- when this baseline was established
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indices for efficient querying
CREATE UNIQUE INDEX IF NOT EXISTS idx_classifier_baselines_profile_intent
  ON intent_classifier_baselines(profile_id, intent_type);

CREATE INDEX IF NOT EXISTS idx_classifier_baselines_profile_id
  ON intent_classifier_baselines(profile_id);

CREATE INDEX IF NOT EXISTS idx_classifier_baselines_intent_type
  ON intent_classifier_baselines(intent_type);

CREATE INDEX IF NOT EXISTS idx_classifier_baselines_baseline_date
  ON intent_classifier_baselines(baseline_date);
