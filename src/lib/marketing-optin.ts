/**
 * marketing-optin.ts — Double Opt-In Flow for WhatsApp Marketing (US-969)
 *
 * Implements Meta's 2025 WhatsApp Business Policy and Malaysia PDPA 2024
 * requirements for documented, specific, informed, and revocable consent.
 *
 * Flow:
 *   1. Admin/checkin adds guest to marketing list → initiateDoubleOptIn()
 *      - Sends pre-approved opt-in confirmation template (business-initiated)
 *      - Creates marketing_subscriptions row with status='pending', expiresAt=+48h
 *   2. Guest replies 'YES' (or synonyms) → confirmMarketingOptIn()
 *      - Updates status → 'confirmed', sets confirmedAt
 *      - Sends free-form service message as confirmation receipt
 *   3. Guest replies 'STOP' (or synonyms) → revokeMarketingConsent()
 *      - Updates status → 'revoked', sets revokedAt
 *      - Complements existing opt_outs table (marketing-specific revocation)
 *   4. Scheduler (every 1h) → expirePendingConsents()
 *      - Sets status='expired' for pending rows past expiresAt
 *
 * Guard: isAllowedToReceiveMarketing(phone, profileId)
 *   Returns true only when status='confirmed'.
 *
 * Audit: exportMarketingConsentAudit(profileId)
 *   Returns all rows for compliance export.
 */

import { pool } from './db.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('MarketingOptIn');

// ─── Constants ──────────────────────────────────────────────────────

/** 48-hour window before pending consent expires */
export const CONSENT_EXPIRY_MS = 48 * 60 * 60 * 1000;

/**
 * Keywords that confirm marketing opt-in (case-insensitive exact match).
 * Guest must send one of these after receiving the confirmation template.
 */
const CONFIRM_KEYWORDS = new Set(['yes', 'ya', '是', 'setuju', 'ok', 'okay', 'confirm']);

/**
 * Keywords that revoke marketing consent (case-insensitive exact match).
 * STOP is handled here for marketing-specific revocation; the global
 * opt-out system (src/assistant/opt-out.ts) handles all-messaging opt-out.
 */
const REVOKE_KEYWORDS = new Set(['stop', 'berhenti', '停止', 'unsubscribe', 'opt out', 'no', 'tidak', 'tak']);

// ─── Keyword Matchers ───────────────────────────────────────────────

/** Returns true if the trimmed text is a marketing opt-in confirmation keyword */
export function isMarketingConfirmKeyword(text: string): boolean {
  return CONFIRM_KEYWORDS.has(text.trim().toLowerCase());
}

/** Returns true if the trimmed text is a marketing consent revocation keyword */
export function isMarketingRevokeKeyword(text: string): boolean {
  return REVOKE_KEYWORDS.has(text.trim().toLowerCase());
}

// ─── Types ──────────────────────────────────────────────────────────

export type ConsentStatus = 'pending' | 'confirmed' | 'revoked' | 'expired';

export interface MarketingConsentRecord {
  phone: string;
  profileId: string | null;
  consentStatus: ConsentStatus;
  channel: string | null;
  collectedVia: string | null;
  optInSentAt: Date | null;
  confirmedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Ensure Table ────────────────────────────────────────────────────

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured || !pool) return;
  _tableEnsured = true;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketing_subscriptions (
        id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        phone           VARCHAR(64) NOT NULL,
        profile_id      TEXT        NOT NULL DEFAULT 'pelangi',
        consent_status  VARCHAR(16) NOT NULL DEFAULT 'pending',
        channel         VARCHAR(32) NOT NULL DEFAULT 'admin_add',
        collected_via   TEXT,
        opt_in_sent_at  TIMESTAMPTZ,
        confirmed_at    TIMESTAMPTZ,
        revoked_at      TIMESTAMPTZ,
        expires_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (phone, profile_id)
      );
      CREATE INDEX IF NOT EXISTS idx_marketing_sub_status
        ON marketing_subscriptions(consent_status);
      CREATE INDEX IF NOT EXISTS idx_marketing_sub_expires_at
        ON marketing_subscriptions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_marketing_sub_profile_status
        ON marketing_subscriptions(profile_id, consent_status);
    `);
    logger.info('Table ready');
  } catch (err: any) {
    logger.warn(`Table bootstrap warn: ${err.message}`);
  }
}

// ─── Core Flow ──────────────────────────────────────────────────────

/**
 * Step 1: Add a phone to the marketing list and send the opt-in confirmation
 * template.  Creates (or resets) a marketing_subscriptions row with
 * status='pending' and a 48-hour expiry.
 *
 * The caller is responsible for the actual template send (via Baileys/Cloud API);
 * this function records the pending state.  Returns the record so the caller can
 * compose the template message with business name + message types.
 *
 * @param phone       E.164 phone number (JID before @s.whatsapp.net)
 * @param profileId   Property profile ('pelangi' | 'southern' | 'makan-moments')
 * @param channel     How the contact was added ('checkin' | 'web_form' | 'admin_add' | 'qr_code')
 * @param collectedVia  Optional IP/source identifier for PDPA audit trail
 */
export async function initiateDoubleOptIn(
  phone: string,
  profileId: string = 'pelangi',
  channel: string = 'admin_add',
  collectedVia?: string
): Promise<MarketingConsentRecord | null> {
  if (!pool) {
    logger.warn('DB not ready — cannot initiate double opt-in');
    return null;
  }
  await ensureTable();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONSENT_EXPIRY_MS);

  try {
    const { rows } = await pool.query<{
      id: string;
      phone: string;
      profile_id: string;
      consent_status: string;
      channel: string;
      collected_via: string | null;
      opt_in_sent_at: Date | null;
      confirmed_at: Date | null;
      revoked_at: Date | null;
      expires_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO marketing_subscriptions
         (phone, profile_id, consent_status, channel, collected_via, opt_in_sent_at, expires_at, updated_at)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $5)
       ON CONFLICT (phone, profile_id) DO UPDATE
         SET consent_status  = CASE
               WHEN marketing_subscriptions.consent_status = 'revoked' THEN 'revoked'
               ELSE 'pending'
             END,
             channel         = EXCLUDED.channel,
             collected_via   = COALESCE(EXCLUDED.collected_via, marketing_subscriptions.collected_via),
             opt_in_sent_at  = CASE
               WHEN marketing_subscriptions.consent_status = 'revoked' THEN marketing_subscriptions.opt_in_sent_at
               ELSE EXCLUDED.opt_in_sent_at
             END,
             expires_at      = CASE
               WHEN marketing_subscriptions.consent_status = 'revoked' THEN marketing_subscriptions.expires_at
               ELSE EXCLUDED.expires_at
             END,
             updated_at      = EXCLUDED.updated_at
       RETURNING *`,
      [phone, profileId, channel, collectedVia ?? null, now, expiresAt]
    );

    const row = rows[0];
    if (!row) return null;

    if (row.consent_status === 'revoked') {
      logger.warn(`Phone ${phone} has revoked consent — opt-in not re-initiated`);
    } else {
      logger.info(`Double opt-in initiated for ${phone} (profile=${profileId}, channel=${channel}, expires=${expiresAt.toISOString()})`);
    }

    return rowToRecord(row);
  } catch (err: any) {
    logger.warn(`initiateDoubleOptIn failed for ${phone}: ${err.message}`);
    return null;
  }
}

/**
 * Step 2: Confirm marketing opt-in when guest replies with a confirmation keyword.
 * Updates status → 'confirmed' and records confirmedAt timestamp.
 * Returns true if a pending record was found and confirmed.
 */
export async function confirmMarketingOptIn(
  phone: string,
  profileId: string = 'pelangi'
): Promise<boolean> {
  if (!pool) return false;
  await ensureTable();

  const now = new Date();
  try {
    const { rowCount } = await pool.query(
      `UPDATE marketing_subscriptions
       SET consent_status = 'confirmed',
           confirmed_at   = $3,
           updated_at     = $3
       WHERE phone         = $1
         AND profile_id    = $2
         AND consent_status = 'pending'`,
      [phone, profileId, now]
    );

    const confirmed = (rowCount ?? 0) > 0;
    if (confirmed) {
      logger.info(`Marketing opt-in confirmed for ${phone} (profile=${profileId})`, {
        phone, profileId, event: 'marketing_optin_confirmed',
      });
    }
    return confirmed;
  } catch (err: any) {
    logger.warn(`confirmMarketingOptIn failed for ${phone}: ${err.message}`);
    return false;
  }
}

/**
 * Step 3: Revoke marketing consent (STOP or admin action).
 * Updates status → 'revoked' and records revokedAt.
 * Idempotent — if already revoked, returns false.
 */
export async function revokeMarketingConsent(
  phone: string,
  profileId: string = 'pelangi'
): Promise<boolean> {
  if (!pool) return false;
  await ensureTable();

  const now = new Date();
  try {
    // Upsert: if no record exists, create a revoked one (e.g., STOP before ever being added)
    const { rowCount } = await pool.query(
      `INSERT INTO marketing_subscriptions (phone, profile_id, consent_status, revoked_at, updated_at)
       VALUES ($1, $2, 'revoked', $3, $3)
       ON CONFLICT (phone, profile_id) DO UPDATE
         SET consent_status = 'revoked',
             revoked_at     = COALESCE(marketing_subscriptions.revoked_at, EXCLUDED.revoked_at),
             updated_at     = EXCLUDED.updated_at
       WHERE marketing_subscriptions.consent_status <> 'revoked'`,
      [phone, profileId, now]
    );

    const revoked = (rowCount ?? 0) > 0;
    if (revoked) {
      logger.info(`Marketing consent revoked for ${phone} (profile=${profileId})`, {
        phone, profileId, event: 'marketing_consent_revoked',
      });
    }
    return revoked;
  } catch (err: any) {
    logger.warn(`revokeMarketingConsent failed for ${phone}: ${err.message}`);
    return false;
  }
}

// ─── Guard ───────────────────────────────────────────────────────────

/**
 * Returns true only if the contact has status='confirmed'.
 * Use this guard before sending any proactive marketing message.
 */
export async function isAllowedToReceiveMarketing(
  phone: string,
  profileId: string = 'pelangi'
): Promise<boolean> {
  if (!pool) return false;
  await ensureTable();

  try {
    const { rows } = await pool.query<{ consent_status: string }>(
      `SELECT consent_status FROM marketing_subscriptions
       WHERE phone = $1 AND profile_id = $2
       LIMIT 1`,
      [phone, profileId]
    );
    return rows[0]?.consent_status === 'confirmed';
  } catch (err: any) {
    logger.warn(`isAllowedToReceiveMarketing check failed for ${phone}: ${err.message}`);
    return false;
  }
}

// ─── Scheduler: expire pending consents ─────────────────────────────

/**
 * Mark pending records past their expiresAt as 'expired'.
 * Run on a schedule (e.g., every 60 minutes).
 * Returns count of records expired.
 */
export async function expirePendingConsents(): Promise<number> {
  if (!pool) return 0;
  await ensureTable();

  const now = new Date();
  try {
    const { rowCount } = await pool.query(
      `UPDATE marketing_subscriptions
       SET consent_status = 'expired',
           updated_at     = $1
       WHERE consent_status = 'pending'
         AND expires_at     < $1`,
      [now]
    );
    const count = rowCount ?? 0;
    if (count > 0) {
      logger.info(`Expired ${count} pending marketing consent(s) past 48h deadline`);
    }
    return count;
  } catch (err: any) {
    logger.warn(`expirePendingConsents failed: ${err.message}`);
    return 0;
  }
}

/** Start hourly scheduler to expire pending consents */
let _schedulerStarted = false;
export function startConsentExpiryScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;
  // Run immediately, then every hour
  expirePendingConsents().catch(() => {});
  setInterval(() => expirePendingConsents().catch(() => {}), 60 * 60 * 1000).unref();
  logger.info('Consent expiry scheduler started (interval: 1h)');
}

// ─── Lookup & Audit ─────────────────────────────────────────────────

/** Get consent record for a single phone/profile */
export async function getMarketingConsentRecord(
  phone: string,
  profileId: string = 'pelangi'
): Promise<MarketingConsentRecord | null> {
  if (!pool) return null;
  await ensureTable();

  try {
    const { rows } = await pool.query<{
      id: string;
      phone: string;
      profile_id: string;
      consent_status: string;
      channel: string;
      collected_via: string | null;
      opt_in_sent_at: Date | null;
      confirmed_at: Date | null;
      revoked_at: Date | null;
      expires_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT * FROM marketing_subscriptions
       WHERE phone = $1 AND profile_id = $2
       LIMIT 1`,
      [phone, profileId]
    );
    return rows[0] ? rowToRecord(rows[0]) : null;
  } catch (err: any) {
    logger.warn(`getMarketingConsentRecord failed: ${err.message}`);
    return null;
  }
}

/** List all marketing subscriptions for a profile (for admin UI) */
export async function listMarketingSubscriptions(
  profileId?: string,
  status?: ConsentStatus,
  limit = 500
): Promise<MarketingConsentRecord[]> {
  if (!pool) return [];
  await ensureTable();

  const conditions: string[] = [];
  const params: any[] = [];

  if (profileId) {
    params.push(profileId);
    conditions.push(`profile_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`consent_status = $${params.length}`);
  }
  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const { rows } = await pool.query(
      `SELECT * FROM marketing_subscriptions
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return rows.map(rowToRecord);
  } catch (err: any) {
    logger.warn(`listMarketingSubscriptions failed: ${err.message}`);
    return [];
  }
}

// ─── Internal helpers ────────────────────────────────────────────────

function rowToRecord(row: any): MarketingConsentRecord {
  return {
    phone: row.phone,
    profileId: row.profile_id,
    consentStatus: row.consent_status as ConsentStatus,
    channel: row.channel,
    collectedVia: row.collected_via,
    optInSentAt: row.opt_in_sent_at,
    confirmedAt: row.confirmed_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
