/**
 * US-582: Workflow State Resumption from Redis
 *
 * Tests for multi-turn workflow state persistence and resumption.
 * Verifies:
 * - State saved to Redis after each step
 * - State resumed from Redis on new message
 * - TTL expiry detection
 * - Conversation isolation (different conversation IDs don't interfere)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Redis from 'ioredis';
import { createMemoryRedis } from './fixtures/memory-redis.js';
import type { WorkflowState } from '../src/assistant/workflow-executor.js';
import {
  createWorkflowState,
  loadOrCreateWorkflowState,
  persistWorkflowState,
} from '../src/assistant/workflow-executor.js';
import {
  RedisWorkflowStore,
  resetWorkflowStore,
  initializeWorkflowStore,
} from '../src/lib/redis-workflow-store.js';

// Mock configStore to avoid undefined errors in tests
vi.mock('../src/assistant/config-store.js', () => ({
  configStore: {
    getWorkflows: () => ({
      workflows: [
        { id: 'booking-workflow', name: 'Booking', steps: [] },
        { id: 'inquiry-workflow', name: 'Inquiry', steps: [] },
      ]
    }),
    getWorkflow: () => ({ payment: { forward_to: '+60127088789' } }),
    getSettings: () => ({
      sentiment_analysis: { consecutive_threshold: 0.6 }
    }),
    getRouting: () => ({}),
    getIntents: () => ({}),
    on: () => {}, // EventEmitter method stub
    once: () => {}, // EventEmitter method stub
    off: () => {}, // EventEmitter method stub
  }
}));

describe('US-582: Workflow State Resumption from Redis', () => {
  let mockRedis: Redis;

  beforeEach(() => {
    // Use memory Redis for testing (no external service required)
    mockRedis = createMemoryRedis();
    resetWorkflowStore();
    initializeWorkflowStore(mockRedis);
  });

  afterEach(async () => {
    resetWorkflowStore();
    if (mockRedis) {
      await mockRedis.flushall();
      await mockRedis.disconnect();
    }
  });

  describe('AC1: Workflow state persistence with 48h TTL', () => {
    it('should save workflow state to Redis after step execution', async () => {
      const store = new RedisWorkflowStore(mockRedis);
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      const state: WorkflowState = {
        workflowId,
        currentStepIndex: 1,
        collectedData: { guest_name: 'John Doe', check_in_date: '2026-04-15' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      // Save state
      await store.save(conversationId, workflowId, state);

      // Verify stored in Redis
      const key = `workflow:${conversationId}:${workflowId}`;
      const ttl = await mockRedis.ttl(key);
      const stored = await mockRedis.get(key);

      expect(stored).toBeDefined();
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(48 * 60 * 60); // 48 hours in seconds

      const parsedState = JSON.parse(stored!);
      expect(parsedState.workflowId).toBe(workflowId);
      expect(parsedState.currentStepIndex).toBe(1);
      expect(parsedState.collectedData.guest_name).toBe('John Doe');
    });

    it('should replace previous state with same conversation+workflow key', async () => {
      const store = new RedisWorkflowStore(mockRedis);
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      // Save first state
      const state1: WorkflowState = {
        workflowId,
        currentStepIndex: 1,
        collectedData: { guest_name: 'John' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };
      await store.save(conversationId, workflowId, state1);

      // Save second state (overwrites)
      const state2: WorkflowState = {
        workflowId,
        currentStepIndex: 2,
        collectedData: { guest_name: 'John', check_in_date: '2026-04-15' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };
      await store.save(conversationId, workflowId, state2);

      // Load and verify
      const loaded = await store.load(conversationId, workflowId);
      expect(loaded?.currentStepIndex).toBe(2);
      expect(Object.keys(loaded?.collectedData || {}).length).toBe(2);
    });
  });

  describe('AC2: Workflow resumption on new user message', () => {
    it('should resume workflow from last completed step', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      // Simulate: User starts workflow, completes step 1
      const savedState: WorkflowState = {
        workflowId,
        currentStepIndex: 1,
        collectedData: { guest_name: 'John Doe', check_in_date: '2026-04-15' },
        startedAt: Date.now() - 60000, // Started 1 minute ago
        lastUpdateAt: Date.now() - 5000, // Last update 5 seconds ago
      };

      const store = new RedisWorkflowStore(mockRedis);
      await store.save(conversationId, workflowId, savedState);

      // New message arrives: load state and resume
      const resumedState = await loadOrCreateWorkflowState(workflowId, conversationId);

      expect(resumedState.currentStepIndex).toBe(1);
      expect(resumedState.collectedData.guest_name).toBe('John Doe');
      expect(resumedState.collectedData.check_in_date).toBe('2026-04-15');
      expect(resumedState.workflowId).toBe(workflowId);
    });

    it('should preserve all workflow data during resumption', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      const complexState: WorkflowState = {
        workflowId,
        currentStepIndex: 3,
        collectedData: {
          guest_name: 'Alice Smith',
          check_in_date: '2026-04-20',
          check_out_date: '2026-04-25',
          guest_count: '2',
          unit: 'Deluxe Room',
          special_requests: 'Late checkout',
        },
        startedAt: 1000000,
        lastUpdateAt: 2000000,
        executionId: 'exec-123',
      };

      const store = new RedisWorkflowStore(mockRedis);
      await store.save(conversationId, workflowId, complexState);

      const resumed = await store.load(conversationId, workflowId);

      expect(resumed).toBeDefined();
      expect(resumed?.currentStepIndex).toBe(3);
      expect(Object.keys(resumed?.collectedData || {}).length).toBe(6);
      expect(resumed?.collectedData.special_requests).toBe('Late checkout');
      expect(resumed?.executionId).toBe('exec-123');
      expect(resumed?.startedAt).toBe(1000000);
    });

    it('should create fresh state if no persisted state found', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      // No state saved previously
      const state = await loadOrCreateWorkflowState(workflowId, conversationId);

      expect(state.workflowId).toBe(workflowId);
      expect(state.currentStepIndex).toBe(0);
      expect(Object.keys(state.collectedData).length).toBe(0);
      expect(state.startedAt).toBeGreaterThan(0);
    });
  });

  describe('AC3: TTL expiry detection', () => {
    it('should not resume state after TTL expires', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      const state: WorkflowState = {
        workflowId,
        currentStepIndex: 1,
        collectedData: { guest_name: 'John' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const store = new RedisWorkflowStore(mockRedis);

      // Save with very short TTL for testing (1 second)
      const key = `workflow:${conversationId}:${workflowId}`;
      await mockRedis.setex(key, 1, JSON.stringify(state));

      // Verify it exists
      let loaded = await store.load(conversationId, workflowId);
      expect(loaded).toBeDefined();

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // State should not be found (Redis auto-expired)
      loaded = await store.load(conversationId, workflowId);
      expect(loaded).toBeNull();
    });

    it('should handle expired keys gracefully', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      const store = new RedisWorkflowStore(mockRedis);

      // Try to load from non-existent key
      const loaded = await store.load(conversationId, workflowId);

      expect(loaded).toBeNull(); // Should return null, not throw
    });
  });

  describe('Conversation isolation', () => {
    it('should isolate state between different conversations', async () => {
      const workflow1 = 'booking-workflow';
      const conv1 = '+60111111111';
      const conv2 = '+60222222222';

      const store = new RedisWorkflowStore(mockRedis);

      // Save state for conversation 1
      const state1: WorkflowState = {
        workflowId: workflow1,
        currentStepIndex: 1,
        collectedData: { guest_name: 'Alice' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };
      await store.save(conv1, workflow1, state1);

      // Save different state for conversation 2
      const state2: WorkflowState = {
        workflowId: workflow1,
        currentStepIndex: 2,
        collectedData: { guest_name: 'Bob' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };
      await store.save(conv2, workflow1, state2);

      // Load and verify isolation
      const loaded1 = await store.load(conv1, workflow1);
      const loaded2 = await store.load(conv2, workflow1);

      expect(loaded1?.collectedData.guest_name).toBe('Alice');
      expect(loaded1?.currentStepIndex).toBe(1);

      expect(loaded2?.collectedData.guest_name).toBe('Bob');
      expect(loaded2?.currentStepIndex).toBe(2);
    });

    it('should isolate state between different workflows in same conversation', async () => {
      const conversationId = '+60123456789';
      const workflow1 = 'booking-workflow';
      const workflow2 = 'inquiry-workflow';

      const store = new RedisWorkflowStore(mockRedis);

      // Save state for booking workflow
      const bookingState: WorkflowState = {
        workflowId: workflow1,
        currentStepIndex: 1,
        collectedData: { guest_name: 'John' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };
      await store.save(conversationId, workflow1, bookingState);

      // Save state for inquiry workflow
      const inquiryState: WorkflowState = {
        workflowId: workflow2,
        currentStepIndex: 0,
        collectedData: { query: 'Room availability' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };
      await store.save(conversationId, workflow2, inquiryState);

      // Load and verify isolation
      const loadedBooking = await store.load(conversationId, workflow1);
      const loadedInquiry = await store.load(conversationId, workflow2);

      expect(loadedBooking?.workflowId).toBe(workflow1);
      expect(loadedBooking?.collectedData.guest_name).toBe('John');

      expect(loadedInquiry?.workflowId).toBe(workflow2);
      expect(loadedInquiry?.collectedData.query).toBe('Room availability');
    });
  });

  describe('Helper function integration', () => {
    it('loadOrCreateWorkflowState should handle missing conversation ID', async () => {
      const workflowId = 'booking-workflow';

      // Call without conversation ID
      const state = await loadOrCreateWorkflowState(workflowId);

      expect(state.workflowId).toBe(workflowId);
      expect(state.currentStepIndex).toBe(0);
    });

    it('persistWorkflowState should handle missing conversation ID', async () => {
      const state: WorkflowState = {
        workflowId: 'booking-workflow',
        currentStepIndex: 1,
        collectedData: { guest_name: 'John' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      // Should not throw even with undefined conversation ID
      await expect(persistWorkflowState(undefined, state)).resolves.not.toThrow();
    });
  });

  describe('Multi-turn workflow scenario', () => {
    it('should handle complete booking workflow with state resumption', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';
      const store = new RedisWorkflowStore(mockRedis);

      // Turn 1: User starts booking
      let state = createWorkflowState(workflowId);
      expect(state.currentStepIndex).toBe(0);

      // Turn 1: Ask for name
      state.currentStepIndex = 1;
      await persistWorkflowState(conversationId, state);

      // Turn 2: User provides name
      state = await loadOrCreateWorkflowState(workflowId, conversationId);
      expect(state.currentStepIndex).toBe(1);
      state.collectedData.guest_name = 'John Doe';
      state.currentStepIndex = 2;
      await persistWorkflowState(conversationId, state);

      // Turn 3: User provides check-in date
      state = await loadOrCreateWorkflowState(workflowId, conversationId);
      expect(state.collectedData.guest_name).toBe('John Doe');
      state.collectedData.check_in_date = '2026-04-15';
      state.currentStepIndex = 3;
      await persistWorkflowState(conversationId, state);

      // Turn 4: Final confirmation
      state = await loadOrCreateWorkflowState(workflowId, conversationId);
      expect(state.currentStepIndex).toBe(3);
      expect(state.collectedData.guest_name).toBe('John Doe');
      expect(state.collectedData.check_in_date).toBe('2026-04-15');
    });
  });

  describe('State deletion', () => {
    it('should delete state after workflow completion', async () => {
      const conversationId = '+60123456789';
      const workflowId = 'booking-workflow';

      const store = new RedisWorkflowStore(mockRedis);
      const state: WorkflowState = {
        workflowId,
        currentStepIndex: 1,
        collectedData: { guest_name: 'John' },
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      // Save state
      await store.save(conversationId, workflowId, state);
      let loaded = await store.load(conversationId, workflowId);
      expect(loaded).toBeDefined();

      // Delete state
      await store.delete(conversationId, workflowId);
      loaded = await store.load(conversationId, workflowId);
      expect(loaded).toBeNull();
    });
  });
});
