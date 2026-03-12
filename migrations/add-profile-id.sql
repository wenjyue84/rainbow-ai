-- Multi-Profile Support: Add profile_id columns
-- Safe to run before deploying new code (additive only)

ALTER TABLE rainbow_conversations ADD COLUMN IF NOT EXISTS profile_id TEXT DEFAULT 'pelangi';
ALTER TABLE rainbow_messages ADD COLUMN IF NOT EXISTS profile_id TEXT DEFAULT 'pelangi';
ALTER TABLE rainbow_conversation_state ADD COLUMN IF NOT EXISTS profile_id TEXT DEFAULT 'pelangi';

CREATE INDEX IF NOT EXISTS idx_conversations_profile ON rainbow_conversations(profile_id);
CREATE INDEX IF NOT EXISTS idx_messages_profile ON rainbow_messages(profile_id);
