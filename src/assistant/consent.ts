/**
 * WhatsApp Opt-In Consent Capture (US-424)
 *
 * Records first-contact consent for every inbound JID.
 * WhatsApp Business Messaging Policy requires businesses to obtain explicit
 * opt-in consent before sending messages. An inbound message from a guest
 * constitutes implied consent ('inbound_message' method).
 *
 * Consent records are retained independently of the 90-day data-retention
 * purge cycle (they are never deleted by the retention scheduler).
 *
 * Storage: consent_records table (created via pool.query — no db:push needed).
 * Lookup:  SHA-256 hash of canonical phone key (no raw PII stored).
 * Cache:   In-memory Set for O(1) "already recorded" checks.
 */
import crypto from 'crypto';
import { pool, dbReady } from '../lib/db.js';
import { canonicalPhoneKey } from './conversation-db.js';

// ─── In-memory cache (jid_hash → true, already recorded) ────────────
const consentCache = new Set<string>();
let cacheLoaded = false;

// ─── Hash helper ──────────────────────────────────────────────────────
export function hashJid(phone: string): string {
  const key = canonicalPhoneKey(phone);
  return crypto.createHash('sha256').update(key).digest('hex');
}

// ─── Table bootstrap ─────────────────────────────────────────────────
async function ensureConsentTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consent_records (
      id           BIGSERIAL PRIMARY KEY,
      jid_hash     TEXT        NOT NULL UNIQUE,
      profile_id   TEXT        NOT NULL DEFAULT 'pelangi',
      consent_method TEXT      NOT NULL DEFAULT 'inbound_message',
      first_contact_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_consent_records_jid_hash
      ON consent_records(jid_hash);
  `);
}

// ─── Startup: load cache + ensure table ─────────────────────────────
export async function loadConsentCache(): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) {
      cacheLoaded = true;
      return;
    }
    await ensureConsentTable();
    const result = await pool.query<{ jid_hash: string }>(
      'SELECT jid_hash FROM consent_records'
    );
    consentCache.clear();
    for (const row of result.rows) {
      consentCache.add(row.jid_hash);
    }
    cacheLoaded = true;
    console.log(`[Consent] Loaded ${consentCache.size} consent records into cache`);
  } catch (error) {
    console.error('[Consent] Failed to load consent cache:', error);
    cacheLoaded = true; // Don't block startup
  }
}

/** Returns true if consent has already been recorded for this JID. */
export function hasConsent(phone: string): boolean {
  return consentCache.has(hashJid(phone));
}

/**
 * Record first-contact consent for a JID (idempotent).
 * Uses INSERT … ON CONFLICT DO NOTHING so concurrent calls are safe.
 * Non-throwing: failures are logged but never propagate to the pipeline.
 */
export async function recordConsent(phone: string, profileId: string = 'pelangi'): Promise<void> {
  const jidHash = hashJid(phone);
  if (consentCache.has(jidHash)) return; // Already recorded — fast exit

  try {
    const ready = await dbReady;
    if (!ready) return;

    await pool.query(
      `INSERT INTO consent_records (jid_hash, profile_id, consent_method)
       VALUES ($1, $2, 'inbound_message')
       ON CONFLICT (jid_hash) DO NOTHING`,
      [jidHash, profileId]
    );
    consentCache.add(jidHash);
    console.log(`[Consent] First-contact consent recorded for profile=${profileId} hash=${jidHash.slice(0, 12)}…`);
  } catch (error) {
    console.error('[Consent] Failed to record consent (non-fatal):', error);
  }
}

/**
 * Retrieve a consent record by raw JID (for admin API).
 * Returns null if no record exists.
 */
export async function getConsentByJid(phone: string): Promise<{
  jid_hash: string;
  profile_id: string;
  consent_method: string;
  first_contact_at: Date;
  ip_address: string | null;
} | null> {
  const jidHash = hashJid(phone);
  try {
    const result = await pool.query<{
      jid_hash: string;
      profile_id: string;
      consent_method: string;
      first_contact_at: Date;
      ip_address: string | null;
    }>(
      `SELECT jid_hash, profile_id, consent_method, first_contact_at, ip_address
       FROM consent_records
       WHERE jid_hash = $1
       LIMIT 1`,
      [jidHash]
    );
    return result.rows[0] ?? null;
  } catch (error) {
    console.error('[Consent] Failed to fetch consent record:', error);
    return null;
  }
}
