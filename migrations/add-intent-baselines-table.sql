-- Create rainbow_intent_baselines table for US-487
-- Tracks F1 score baseline per profile for intent classification drift detection

CREATE TABLE IF NOT EXISTS rainbow_intent_baselines (
  id SERIAL PRIMARY KEY,
  profile_id TEXT NOT NULL,
  f1_score REAL NOT NULL,  -- F1 score (0-1)
  message_count INTEGER NOT NULL,  -- number of correctly classified messages in baseline window
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indices for efficient querying
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_baselines_profile_id
  ON rainbow_intent_baselines(profile_id);

CREATE INDEX IF NOT EXISTS idx_intent_baselines_updated_at
  ON rainbow_intent_baselines(updated_at);
