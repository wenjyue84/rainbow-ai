/**
 * conversation-timestamp-validator.ts — Conversation Message Timestamp Integrity Validator (US-644)
 *
 * Detects out-of-order consecutive message timestamps in conversation history.
 * Uses a Generator to lazily yield violations, enabling early-exit and streaming.
 *
 * Also provides a startup health check that samples conversations across all profiles
 * and reports the % with correct timestamp ordering.
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ConversationTimestampValidator');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TimestampWarning {
  /** ID of the out-of-order message */
  messageId: number;
  /** ISO 8601 timestamp of the out-of-order message */
  messageTimestamp: string;
  /** ID of the preceding message */
  prevMessageId: number;
  /** ISO 8601 timestamp of the preceding message */
  prevMessageTimestamp: string;
  /** Conversation phone key */
  phone: string;
}

export interface TimestampIntegrityReport {
  /** Total conversations sampled */
  total: number;
  /** Conversations with no ordering issues */
  healthy: number;
  /** Conversations with at least one out-of-order message pair */
  unhealthy: number;
  /** Percentage of healthy conversations (0–100) */
  healthPercent: number;
  /** Whether any ordering violations were found */
  hasIssues: boolean;
  /** Per-profile breakdown */
  profiles: Record<string, { total: number; healthy: number }>;
}

// ─── Core Generator ───────────────────────────────────────────────────────────

/**
 * Validate that messages are in ascending timestamp order.
 *
 * Yields a TimestampWarning for each consecutive pair where the later message
 * has a timestamp before the preceding message.
 *
 * Messages should be passed in DB insertion/arrival order (e.g. ORDER BY id ASC).
 * Only consecutive adjacent pairs are checked — this detects common network
 * reordering and clock-skew scenarios.
 *
 * @param messages - Message rows in arrival order, each with id, timestamp, phone
 */
export function* validateMessageOrdering(
  messages: ReadonlyArray<{ id: number; timestamp: Date; phone: string }>,
): Generator<TimestampWarning> {
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (curr.timestamp < prev.timestamp) {
      yield {
        messageId: curr.id,
        messageTimestamp: curr.timestamp.toISOString(),
        prevMessageId: prev.id,
        prevMessageTimestamp: prev.timestamp.toISOString(),
        phone: curr.phone,
      };
    }
  }
}

// ─── Startup Health Check ─────────────────────────────────────────────────────

const SAMPLE_PER_PROFILE = 10;

/**
 * Startup health check: sample up to SAMPLE_PER_PROFILE (10) random conversations
 * from each profile, validate message timestamp ordering, and report % healthy.
 *
 * Logs a WARNING if any out-of-order conversations are found.
 * Non-fatal — server continues regardless of result.
 *
 * @returns TimestampIntegrityReport with % healthy and per-profile breakdown
 */
export async function checkConversationTimestampIntegrity(): Promise<TimestampIntegrityReport> {
  const report: TimestampIntegrityReport = {
    total: 0,
    healthy: 0,
    unhealthy: 0,
    healthPercent: 100,
    hasIssues: false,
    profiles: {},
  };

  try {
    const { pool } = await import('./db.js');

    // 1. Get distinct profiles and a random sample of conversations per profile
    const profilesResult = await pool.query<{ profile_id: string }>(
      `SELECT DISTINCT profile_id FROM rainbow_conversations WHERE profile_id IS NOT NULL AND deleted_at IS NULL`
    );

    const profiles: string[] = profilesResult.rows.map(r => r.profile_id);

    if (profiles.length === 0) {
      logger.info('[US-644] Timestamp integrity check: no conversations found, skipping');
      return report;
    }

    for (const profileId of profiles) {
      report.profiles[profileId] = { total: 0, healthy: 0 };

      // Sample random conversations for this profile
      const sampleResult = await pool.query<{ phone: string }>(
        `SELECT phone FROM rainbow_conversations
         WHERE profile_id = $1 AND deleted_at IS NULL
         ORDER BY RANDOM()
         LIMIT $2`,
        [profileId, SAMPLE_PER_PROFILE]
      );

      const phones = sampleResult.rows.map(r => r.phone);

      for (const phone of phones) {
        report.total++;
        report.profiles[profileId].total++;

        // Fetch messages for this conversation in insertion order (by id)
        const msgsResult = await pool.query<{ id: number; timestamp: Date; phone: string }>(
          `SELECT id, timestamp, phone FROM rainbow_messages
           WHERE phone = $1 AND deleted_at IS NULL
           ORDER BY id ASC`,
          [phone]
        );

        const messages = msgsResult.rows;
        if (messages.length <= 1) {
          // Single or empty conversation — always healthy
          report.healthy++;
          report.profiles[profileId].healthy++;
          continue;
        }

        let conversationHealthy = true;
        for (const warning of validateMessageOrdering(messages)) {
          conversationHealthy = false;
          report.hasIssues = true;
          logger.warn(
            `[US-644] Startup check: Message ${warning.messageId} ts=${warning.messageTimestamp} before ${warning.prevMessageId} ts=${warning.prevMessageTimestamp}`,
            { phone, profileId }
          );
        }

        if (conversationHealthy) {
          report.healthy++;
          report.profiles[profileId].healthy++;
        } else {
          report.unhealthy++;
        }
      }
    }

    // Calculate health percentage
    report.healthPercent =
      report.total > 0 ? Math.round((report.healthy / report.total) * 100) : 100;

    if (report.hasIssues) {
      logger.warn(
        `[US-644] Timestamp integrity: ${report.healthy}/${report.total} conversations healthy (${report.healthPercent}%) — out-of-order messages detected`,
        { profiles: report.profiles }
      );
    } else {
      logger.info(
        `[US-644] Timestamp integrity: ${report.total} conversations sampled, all healthy (100%)`,
        { profiles: report.profiles }
      );
    }
  } catch (err: any) {
    logger.warn(`[US-644] Timestamp integrity check failed: ${err.message}`);
  }

  return report;
}
