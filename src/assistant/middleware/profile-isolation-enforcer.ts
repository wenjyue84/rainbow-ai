/**
 * Pipeline Middleware: Profile Isolation Enforcer
 *
 * Blocks message routing to intents that do not belong to the active profile.
 * Prevents accidental cross-profile message leakage at execution time by
 * checking the resolved intent against the profile's intent whitelist.
 *
 * Profile isolation is enforced at the intent routing level:
 * - Each profile has a curated whitelist of valid intents
 * - An intent not in the whitelist for the active profile is a violation
 * - Violations are rejected and logged to the audit trail
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface IntentWhitelists {
  [profile: string]: string[];
}

/**
 * Load the intent whitelists JSON file (synchronous — called once at module load).
 */
function loadWhitelists(): IntentWhitelists {
  const whitelistPath = path.join(__dirname, '../data/intent-whitelists.json');
  try {
    const content = fs.readFileSync(whitelistPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    console.warn('[ProfileIsolationEnforcer] Could not load intent-whitelists.json — enforcement disabled');
    return {};
  }
}

// Cache at module level — file is small and changes rarely.
let _whitelists: IntentWhitelists | null = null;

function getWhitelists(): IntentWhitelists {
  if (!_whitelists) {
    _whitelists = loadWhitelists();
  }
  return _whitelists;
}

/**
 * Invalidate the cached whitelists (useful in tests / after file changes).
 */
export function invalidateWhitelistCache(): void {
  _whitelists = null;
}

// ─── Violation type ────────────────────────────────────────────────────────

export interface ProfileIsolationViolation {
  profileId: string;
  intent: string;
  messagePreview: string;  // First 120 chars of message text
  timestamp: number;       // Unix ms
}

// ─── Core check ────────────────────────────────────────────────────────────

/**
 * Check whether the given intent is allowed for the given profile.
 *
 * Returns null if allowed, or a ProfileIsolationViolation if the intent is
 * not in the profile's whitelist.
 *
 * @param profileId - Active profile (e.g. 'makan', 'pelangi', 'southern')
 * @param intent    - Resolved intent to check (e.g. 'booking', 'menu_query')
 * @param messageText - Raw message text (for audit preview)
 */
export function checkProfileIsolation(
  profileId: string,
  intent: string,
  messageText: string
): ProfileIsolationViolation | null {
  const whitelists = getWhitelists();
  const whitelist = whitelists[profileId];

  // No whitelist for this profile — skip enforcement (fail open to avoid outages).
  if (!whitelist) {
    return null;
  }

  // Universal intents that are always allowed regardless of profile
  const UNIVERSAL_INTENTS = new Set(['unknown', 'cancel_workflow']);

  if (UNIVERSAL_INTENTS.has(intent)) {
    return null;
  }

  if (whitelist.includes(intent)) {
    return null;
  }

  // Intent is not in this profile's whitelist — violation.
  return {
    profileId,
    intent,
    messagePreview: messageText.slice(0, 120),
    timestamp: Date.now(),
  };
}

// ─── Audit logging ─────────────────────────────────────────────────────────

/**
 * Log a profile isolation violation to rainbow_config_audit.
 * Fire-and-forget — errors are swallowed so callers don't break.
 */
export async function logProfileIsolationViolation(
  violation: ProfileIsolationViolation
): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.warn('[ProfileIsolationEnforcer] No DATABASE_URL — audit logging skipped');
    return;
  }

  try {
    await pool.query(
      `INSERT INTO rainbow_config_audit (action, changed_by, after_json, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [
        'profile_isolation_violation',
        violation.profileId,
        JSON.stringify({
          profile_id: violation.profileId,
          blocked_intent: violation.intent,
          message_preview: violation.messagePreview,
          timestamp: violation.timestamp,
        }),
      ]
    );
    console.warn(
      `[ProfileIsolationEnforcer] ⛔ Intent blocked: profile="${violation.profileId}" ` +
      `intent="${violation.intent}" preview="${violation.messagePreview.slice(0, 40)}..."`
    );
  } catch (err: any) {
    console.error('[ProfileIsolationEnforcer] Failed to log violation:', err.message);
  }
}

// ─── Middleware entry point ────────────────────────────────────────────────

/**
 * Middleware: Enforce profile isolation before intent routing.
 *
 * Call this AFTER the intent has been classified but BEFORE action dispatch.
 * If the intent is not in the profile's whitelist:
 * 1. Logs the violation to the audit trail (fire-and-forget)
 * 2. Returns a rejection result to halt pipeline processing
 *
 * @param profileId   - Active profile resolved from the message's instanceId
 * @param intent      - Classified intent about to be dispatched
 * @param messageText - Raw message text (for audit logging preview)
 * @returns `{ continue: false, reason }` if blocked, `null` if allowed
 */
export async function enforceProfileIsolation(
  profileId: string,
  intent: string,
  messageText: string
): Promise<{ continue: false; reason: string } | null> {
  const violation = checkProfileIsolation(profileId, intent, messageText);

  if (violation) {
    logProfileIsolationViolation(violation).catch(() => {});
    return {
      continue: false,
      reason: `profile_isolation_violation:${violation.intent}@${violation.profileId}`,
    };
  }

  return null;
}
