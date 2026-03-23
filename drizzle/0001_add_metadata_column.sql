-- US-119: Add metadata column to rainbow_conversations for language preference persistence
ALTER TABLE "rainbow_conversations" ADD COLUMN "metadata" text;
