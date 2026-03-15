/**
 * sticker-manager.ts — Festive sticker upload and intent mapping
 * US-923: WhatsApp sticker response for Malaysian festive season engagement
 */
import { db, pool } from './db.js';
import { festiveStickers, stickerIntents, type InsertFestiveSticker, type InsertStickerIntent } from '../../shared/schema-tables.js';
import { eq, and } from 'drizzle-orm';

let tablesEnsured = false;

async function ensureTables(): Promise<void> {
  if (tablesEnsured) return;

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS festive_stickers (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id TEXT NOT NULL DEFAULT 'pelangi',
        sticker_name TEXT NOT NULL,
        media_id TEXT,
        file_size INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'image/webp',
        uploaded_by TEXT,
        uploaded_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        UNIQUE(profile_id, sticker_name)
      );

      CREATE TABLE IF NOT EXISTS sticker_intents (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id TEXT NOT NULL DEFAULT 'pelangi',
        intent TEXT NOT NULL,
        sticker_id VARCHAR NOT NULL REFERENCES festive_stickers(id) ON DELETE CASCADE,
        greeting_text TEXT NOT NULL,
        is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(profile_id, intent)
      );

      CREATE INDEX IF NOT EXISTS idx_stickers_profile_active ON festive_stickers(profile_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_sticker_intents_profile_intent ON sticker_intents(profile_id, intent);
      CREATE INDEX IF NOT EXISTS idx_sticker_intents_enabled ON sticker_intents(is_enabled);
    `);
  } finally {
    client.release();
  }
  tablesEnsured = true;
}

export async function uploadSticker(
  profileId: string,
  stickerName: string,
  fileBuffer: Buffer,
  fileName: string,
  uploadedBy?: string
): Promise<{ id: string; fileName: string; fileSize: number }> {
  await ensureTables();

  // Validate sticker spec: webp format, ≤100KB
  if (!fileName.endsWith('.webp')) {
    throw new Error('Sticker must be in WebP format (.webp)');
  }
  if (fileBuffer.length > 100 * 1024) {
    throw new Error('Sticker must be ≤100KB');
  }

  // Insert sticker metadata (mediaId will be populated later when sent to WhatsApp)
  const result = await db.insert(festiveStickers).values({
    profileId,
    stickerName,
    fileName,
    fileSize: fileBuffer.length,
    mimeType: 'image/webp',
    uploadedBy,
    isActive: true,
  } as InsertFestiveSticker).returning({ id: festiveStickers.id });

  if (!result[0]) throw new Error('Failed to insert sticker');

  return {
    id: result[0].id,
    fileName,
    fileSize: fileBuffer.length,
  };
}

export async function listStickers(profileId: string, activeOnly: boolean = true): Promise<any[]> {
  await ensureTables();

  if (activeOnly) {
    return db.select().from(festiveStickers).where(
      and(eq(festiveStickers.profileId, profileId), eq(festiveStickers.isActive, true))
    );
  }
  return db.select().from(festiveStickers).where(eq(festiveStickers.profileId, profileId));
}

export async function getSticker(profileId: string, stickerId: string): Promise<any> {
  await ensureTables();

  const result = await db.select().from(festiveStickers).where(
    and(eq(festiveStickers.id, stickerId), eq(festiveStickers.profileId, profileId))
  );

  return result[0] || null;
}

export async function updateStickerMediaId(stickerId: string, mediaId: string): Promise<void> {
  await ensureTables();
  await db.update(festiveStickers).set({ mediaId }).where(eq(festiveStickers.id, stickerId));
}

export async function mapStickerToIntent(
  profileId: string,
  intent: string,
  stickerId: string,
  greetingText: string
): Promise<{ id: string }> {
  await ensureTables();

  // Verify sticker exists
  const sticker = await getSticker(profileId, stickerId);
  if (!sticker) throw new Error(`Sticker ${stickerId} not found`);

  const result = await db.insert(stickerIntents).values({
    profileId,
    intent,
    stickerId,
    greetingText,
    isEnabled: true,
  } as InsertStickerIntent).returning({ id: stickerIntents.id }).onConflictDoUpdate({
    target: [stickerIntents.profileId, stickerIntents.intent],
    set: { stickerId, greetingText, isEnabled: true, updatedAt: new Date() },
  });

  if (!result[0]) throw new Error('Failed to map sticker to intent');

  return { id: result[0].id };
}

export async function getStickerForIntent(profileId: string, intent: string): Promise<{ sticker: any; greeting: string } | null> {
  await ensureTables();

  const result = await db
    .select({
      greeting: stickerIntents.greetingText,
      sticker: festiveStickers,
    })
    .from(stickerIntents)
    .innerJoin(festiveStickers, eq(stickerIntents.stickerId, festiveStickers.id))
    .where(
      and(
        eq(stickerIntents.profileId, profileId),
        eq(stickerIntents.intent, intent),
        eq(stickerIntents.isEnabled, true),
        eq(festiveStickers.isActive, true)
      )
    );

  if (!result[0]) return null;

  return {
    sticker: result[0].sticker,
    greeting: result[0].greeting,
  };
}

export async function toggleStickerResponse(profileId: string, intent: string, enabled: boolean): Promise<void> {
  await ensureTables();
  await db.update(stickerIntents).set({ isEnabled: enabled, updatedAt: new Date() }).where(
    and(eq(stickerIntents.profileId, profileId), eq(stickerIntents.intent, intent))
  );
}

export async function deleteStickerIntent(profileId: string, intent: string): Promise<void> {
  await ensureTables();
  await db.delete(stickerIntents).where(
    and(eq(stickerIntents.profileId, profileId), eq(stickerIntents.intent, intent))
  );
}
