-- US-548: Add index for efficient cursor-based message pagination
-- Supports keyset pagination on (phone, id DESC) for O(log n) retrieval
-- The rainbow_messages table uses 'phone' as conversation identifier and
-- 'id' (serial) as the monotonically increasing message cursor key.
CREATE INDEX IF NOT EXISTS idx_rainbow_messages_pagination
  ON rainbow_messages(phone, id DESC)
  WHERE deleted_at IS NULL;
