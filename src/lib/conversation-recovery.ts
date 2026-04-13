/**
 * conversation-recovery.ts — Conversation Recovery from Transient Provider Failures (US-586)
 *
 * RedisBackedRecovery snapshots full conversation state to Redis after each successfully
 * processed message. On AI provider timeout or transient error, the recovery handler pulls
 * the snapshot and retries with original context preserved.
 *
 * Architecture:
 * 1. After successful AI response: snapshot(conversationId, state) → Redis with 24h TTL
 * 2. On provider timeout/503: restore(conversationId) → returns full conversation context
 * 3. Retry message processing with restored context
 *
 * TTL: 24 hours (86400 seconds) — covers multi-day conversation gaps
 */

import type Redis from 'ioredis';
import type { ConversationState } from '../assistant/types.js';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('ConversationRecovery');

const RECOVERY_KEY_PREFIX = 'recovery:conversation:';
const RECOVERY_TTL_SECONDS = 86400; // 24 hours

/**
 * RedisBackedRecovery manages conversation state snapshots for failure recovery.
 * Provides synchronous API with async-fire-and-forget Redis operations.
 */
export class RedisBackedRecovery {
  private _redis: Redis | null = null;

  /**
   * Attach a Redis client for snapshot/restore operations.
   */
  attachRedis(client: Redis): void {
    this._redis = client;
    logger.info('Redis client attached for conversation recovery');
  }

  /**
   * Snapshot full conversation state to Redis with 24-hour TTL.
   * Called after each successfully processed AI response.
   *
   * @param conversationId - Unique conversation identifier (e.g., phone number)
   * @param state - Full ConversationState including messages, metadata, etc.
   */
  snapshot(conversationId: string, state: ConversationState): void {
    if (!this._redis) {
      logger.warn(`[US-586] Redis not available, snapshot skipped for conv=${conversationId}`);
      return;
    }

    const key = `${RECOVERY_KEY_PREFIX}${conversationId}`;
    const serialized = JSON.stringify(state);

    // Fire-and-forget async operation to avoid blocking message processing
    this._redis
      .set(key, serialized, 'EX', RECOVERY_TTL_SECONDS)
      .then(() => {
        logger.debug(
          `[US-586] Snapshot OK conv=${conversationId.slice(-4)} ` +
          `size=${serialized.length} bytes msg_count=${state.messages.length} ttl=24h`
        );
      })
      .catch(err => {
        logger.error(`[US-586] Snapshot FAIL conv=${conversationId}: ${err.message}`);
      });
  }

  /**
   * Restore full conversation state from Redis snapshot.
   * Called when a transient provider error (timeout, 503) is detected.
   *
   * @param conversationId - Unique conversation identifier
   * @returns Full ConversationState if snapshot exists, null otherwise
   * @throws Error if Redis JSON deserialization fails
   */
  async restore(conversationId: string): Promise<ConversationState | null> {
    if (!this._redis) {
      logger.warn(`[US-586] Redis not available, restore failed for conv=${conversationId}`);
      return null;
    }

    const key = `${RECOVERY_KEY_PREFIX}${conversationId}`;

    try {
      const serialized = await this._redis.get(key);
      if (!serialized) {
        logger.warn(`[US-586] No snapshot found conv=${conversationId}`);
        return null;
      }

      const state = JSON.parse(serialized) as ConversationState;
      logger.info(
        `[US-586] Restore OK conv=${conversationId.slice(-4)} ` +
        `msg_count=${state.messages.length} pushName=${state.pushName}`
      );
      return state;
    } catch (err: any) {
      logger.error(`[US-586] Restore FAIL conv=${conversationId}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Manually invalidate a snapshot (e.g., on conversation reset or user logout).
   * Fire-and-forget async delete.
   */
  invalidate(conversationId: string): void {
    if (!this._redis) {
      return;
    }

    const key = `${RECOVERY_KEY_PREFIX}${conversationId}`;
    this._redis.del(key).catch(err => {
      logger.error(`[US-586] Invalidate FAIL conv=${conversationId}: ${err.message}`);
    });
  }
}

/** Singleton instance shared across the process. */
export const conversationRecovery = new RedisBackedRecovery();

/**
 * Initialize the singleton with a Redis client.
 * Call this during server startup after Redis connection is confirmed.
 */
export function initConversationRecovery(redis: Redis): void {
  conversationRecovery.attachRedis(redis);
}
