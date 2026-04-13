/**
 * US-582: Redis-backed Workflow State Storage
 *
 * Persists booking workflow state to Redis with 48-hour TTL,
 * enabling users to resume incomplete bookings from the last completed step.
 *
 * Key format: `workflow:{conversationId}:{workflowId}`
 * Value: JSON-serialized WorkflowState
 * TTL: 172800 seconds (48 hours)
 */

import Redis from 'ioredis';
import type { WorkflowState } from '../assistant/workflow-executor.js';

const TTL_SECONDS = 48 * 60 * 60; // 48 hours
const KEY_PREFIX = 'workflow';

export class RedisWorkflowStore {
  private client: Redis | null = null;
  private isConnected = false;

  constructor(redisClient?: Redis) {
    if (redisClient) {
      this.client = redisClient;
      this.isConnected = true;
    } else {
      this.initializeClient();
    }
  }

  /**
   * Initialize Redis client from environment configuration
   */
  private initializeClient(): void {
    try {
      const redisUrl = process.env.REDIS_URL;
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
      const redisPassword = process.env.REDIS_PASSWORD;

      if (redisUrl) {
        this.client = new Redis(redisUrl);
      } else {
        this.client = new Redis({
          host: redisHost,
          port: redisPort,
          ...(redisPassword ? { password: redisPassword } : {})
        });
      }

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('[RedisWorkflowStore] Connected to Redis');
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        if (process.env.NODE_ENV === 'test') {
          console.debug(`[RedisWorkflowStore] Redis error (expected in test): ${err.message}`);
        } else {
          console.error(`[RedisWorkflowStore] Redis connection error: ${err.message}`);
        }
      });

      this.client.on('close', () => {
        this.isConnected = false;
        console.log('[RedisWorkflowStore] Redis connection closed');
      });
    } catch (err) {
      console.error('[RedisWorkflowStore] Failed to initialize client:', err);
      this.isConnected = false;
    }
  }

  /**
   * Generate Redis key for workflow state
   * Format: workflow:{conversationId}:{workflowId}
   */
  private getKey(conversationId: string, workflowId: string): string {
    return `${KEY_PREFIX}:${conversationId}:${workflowId}`;
  }

  /**
   * Save workflow state to Redis with 48-hour TTL
   *
   * AC1: Workflow executor saves state hash to Redis (conversation_id key) after each step with 48h TTL
   *
   * @param conversationId - Phone number or unique conversation identifier
   * @param workflowId - Workflow ID (e.g., "booking-workflow")
   * @param state - Complete WorkflowState to persist
   * @returns Promise resolving when state is saved
   */
  async save(
    conversationId: string,
    workflowId: string,
    state: WorkflowState
  ): Promise<void> {
    if (!this.client || !this.isConnected) {
      console.warn('[RedisWorkflowStore] Redis not available, skipping state persistence');
      return;
    }

    try {
      const key = this.getKey(conversationId, workflowId);
      const serialized = JSON.stringify(state);

      // Use SET with EX for atomic save + TTL
      await this.client.setex(key, TTL_SECONDS, serialized);

      console.log(
        `[RedisWorkflowStore] Saved workflow state for ${conversationId}/${workflowId} ` +
        `(TTL: 48h, step: ${state.currentStepIndex})`
      );
    } catch (err) {
      console.error(
        `[RedisWorkflowStore] Failed to save workflow state for ${conversationId}/${workflowId}:`,
        err instanceof Error ? err.message : err
      );
      // Non-blocking: state save failure should not interrupt workflow
    }
  }

  /**
   * Load workflow state from Redis for resumption
   *
   * AC2: On new user message, check Redis for active workflow state and resume from last completed step
   *
   * @param conversationId - Phone number or unique conversation identifier
   * @param workflowId - Workflow ID to resume
   * @returns WorkflowState if found and valid, null otherwise
   */
  async load(
    conversationId: string,
    workflowId: string
  ): Promise<WorkflowState | null> {
    if (!this.client || !this.isConnected) {
      return null;
    }

    try {
      const key = this.getKey(conversationId, workflowId);
      const serialized = await this.client.get(key);

      if (!serialized) {
        return null;
      }

      const state = JSON.parse(serialized) as WorkflowState;

      console.log(
        `[RedisWorkflowStore] Resumed workflow state for ${conversationId}/${workflowId} ` +
        `(step: ${state.currentStepIndex}, collected: ${Object.keys(state.collectedData).length} fields)`
      );

      return state;
    } catch (err) {
      console.error(
        `[RedisWorkflowStore] Failed to load workflow state for ${conversationId}/${workflowId}:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  /**
   * Clear expired workflow states (manual cleanup)
   * Note: Redis handles TTL automatically, so this is optional
   * Provided for explicit cleanup if needed
   */
  async clearExpired(): Promise<number> {
    if (!this.client || !this.isConnected) {
      return 0;
    }

    try {
      // Scan for all workflow keys and check if they exist
      // (Redis will auto-delete expired keys, but we can do manual cleanup)
      const pattern = `${KEY_PREFIX}:*`;
      const keys = await this.client.keys(pattern);

      // All returned keys are non-expired (Redis auto-deletes TTL-expired keys)
      console.log(`[RedisWorkflowStore] Active workflow states: ${keys.length}`);
      return keys.length;
    } catch (err) {
      console.error('[RedisWorkflowStore] Failed to scan for expired keys:', err);
      return 0;
    }
  }

  /**
   * Explicitly delete a workflow state (e.g., on completion)
   * @param conversationId - Conversation ID
   * @param workflowId - Workflow ID
   */
  async delete(conversationId: string, workflowId: string): Promise<void> {
    if (!this.client || !this.isConnected) {
      return;
    }

    try {
      const key = this.getKey(conversationId, workflowId);
      await this.client.del(key);
      console.log(`[RedisWorkflowStore] Deleted workflow state for ${conversationId}/${workflowId}`);
    } catch (err) {
      console.error(
        `[RedisWorkflowStore] Failed to delete workflow state:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  /**
   * Graceful shutdown - close Redis connection
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        this.isConnected = false;
        console.log('[RedisWorkflowStore] Redis connection closed gracefully');
      } catch (err) {
        console.error('[RedisWorkflowStore] Error closing Redis:', err);
      }
    }
  }

  /**
   * Health check - verify Redis connectivity
   */
  isReady(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
let storeInstance: RedisWorkflowStore | null = null;

/**
 * Get or initialize the global RedisWorkflowStore instance
 */
export function getWorkflowStore(redisClient?: Redis): RedisWorkflowStore {
  if (!storeInstance) {
    storeInstance = new RedisWorkflowStore(redisClient);
  }
  return storeInstance;
}

/**
 * Initialize workflow store with custom Redis client (useful for testing)
 */
export function initializeWorkflowStore(redisClient?: Redis): RedisWorkflowStore {
  storeInstance = new RedisWorkflowStore(redisClient);
  return storeInstance;
}

/**
 * Reset store instance (for testing)
 */
export function resetWorkflowStore(): void {
  if (storeInstance) {
    storeInstance.close().catch(err => console.error('[RedisWorkflowStore] Error on reset:', err));
  }
  storeInstance = null;
}
