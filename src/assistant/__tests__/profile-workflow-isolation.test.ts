/**
 * US-054: Profile Workflow Isolation Test
 *
 * Verifies that workflows execute only within their designated profile,
 * preventing data contamination where Pelangi workflows mistakenly run for
 * Makan or Southern guests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWorkflowState, executeWorkflowStep, type WorkflowContext } from '../workflow-executor.js';
import { configStore } from '../config-store.js';

// Mock the configStore
vi.mock('../config-store.js', () => ({
  configStore: {
    getWorkflows: vi.fn(),
  }
}));

describe('US-054: Profile Workflow Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Profile mismatch prevention', () => {
    it('should prevent Makan workflow from executing for Pelangi conversation', async () => {
      // Mock workflows with profileId field
      const mockWorkflows = {
        workflows: [
          {
            id: 'makan_booking',
            name: 'Makan Booking',
            profileId: 'makan', // Makan profile
            steps: [
              {
                id: 'step1',
                message: { en: 'Welcome', ms: 'Selamat datang', zh: '欢迎' },
                waitForReply: false,
              }
            ],
            format: 'steps' as const,
          },
          {
            id: 'pelangi_booking',
            name: 'Pelangi Booking',
            profileId: 'pelangi', // Pelangi profile
            steps: [
              {
                id: 'step1',
                message: { en: 'Book a capsule', ms: 'Tempah kapsula', zh: '预订舱室' },
                waitForReply: false,
              }
            ],
            format: 'steps' as const,
          },
        ]
      };

      vi.mocked(configStore.getWorkflows).mockReturnValue(mockWorkflows as any);

      const workflowState = {
        workflowId: 'makan_booking',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '60123456789',
        pushName: 'Guest',
        instanceId: 'msg123',
        profileId: 'pelangi', // Conversation is for Pelangi profile
      };

      const result = await executeWorkflowStep(workflowState, null, context);

      // Verify workflow was rejected due to profile mismatch
      expect(result.response).toContain('configuration error');
      expect(result.newState).toBeNull();
    });

    it('should allow workflow execution when profiles match (Makan)', async () => {
      const mockWorkflows = {
        workflows: [
          {
            id: 'makan_booking',
            name: 'Makan Booking',
            profileId: 'makan',
            steps: [
              {
                id: 'step1',
                message: { en: 'Order now', ms: 'Pesan sekarang', zh: '立即订购' },
                waitForReply: true,
              }
            ],
            format: 'steps' as const,
          },
        ]
      };

      vi.mocked(configStore.getWorkflows).mockReturnValue(mockWorkflows as any);

      const workflowState = {
        workflowId: 'makan_booking',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '60123456789',
        pushName: 'Customer',
        instanceId: 'msg123',
        profileId: 'makan', // Matching profile
      };

      const result = await executeWorkflowStep(workflowState, null, context);

      // Verify workflow execution proceeded (didn't fail on profile check)
      expect(result.newState).toBeDefined();
      expect(result.newState?.workflowId).toBe('makan_booking');
    });

    it('should allow workflow execution when profiles match (Southern)', async () => {
      const mockWorkflows = {
        workflows: [
          {
            id: 'southern_checkin',
            name: 'Southern Check-in',
            profileId: 'southern',
            steps: [
              {
                id: 'checkin_step',
                message: { en: 'Welcome to Southern', ms: 'Selamat datang ke Southern', zh: '欢迎来到Southern' },
                waitForReply: false,
              }
            ],
            format: 'steps' as const,
          },
        ]
      };

      vi.mocked(configStore.getWorkflows).mockReturnValue(mockWorkflows as any);

      const workflowState = {
        workflowId: 'southern_checkin',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '60187654321',
        pushName: 'Guest',
        instanceId: 'msg456',
        profileId: 'southern', // Matching profile
      };

      const result = await executeWorkflowStep(workflowState, null, context);

      expect(result.newState).toBeDefined();
      expect(result.newState?.workflowId).toBe('southern_checkin');
    });

    it('should prevent Southern workflow from executing for Makan conversation', async () => {
      const mockWorkflows = {
        workflows: [
          {
            id: 'southern_checkout',
            name: 'Southern Checkout',
            profileId: 'southern',
            steps: [
              {
                id: 'checkout_step',
                message: { en: 'Checkout', ms: 'Daftar keluar', zh: '退房' },
                waitForReply: false,
              }
            ],
            format: 'steps' as const,
          },
        ]
      };

      vi.mocked(configStore.getWorkflows).mockReturnValue(mockWorkflows as any);

      const workflowState = {
        workflowId: 'southern_checkout',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '60111222333',
        pushName: 'Customer',
        instanceId: 'msg789',
        profileId: 'makan', // Conversation is for Makan
      };

      const result = await executeWorkflowStep(workflowState, null, context);

      // Should be rejected
      expect(result.response).toContain('configuration error');
      expect(result.newState).toBeNull();
    });

    it('should include both profile IDs in error message for debugging', async () => {
      const mockWorkflows = {
        workflows: [
          {
            id: 'pelangi_booking',
            name: 'Pelangi Booking',
            profileId: 'pelangi',
            steps: [
              {
                id: 'booking_step',
                message: { en: 'Book', ms: 'Tempah', zh: '预订' },
                waitForReply: false,
              }
            ],
            format: 'steps' as const,
          },
        ]
      };

      vi.mocked(configStore.getWorkflows).mockReturnValue(mockWorkflows as any);

      const workflowState = {
        workflowId: 'pelangi_booking',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '60155666777',
        pushName: 'User',
        instanceId: 'msg999',
        profileId: 'makan', // Different profile
      };

      // Spy on console.error to capture the error message
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await executeWorkflowStep(workflowState, null, context);

      // Check that error was logged with both profile IDs
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorMessage = consoleErrorSpy.mock.calls[0][0] as string;
      expect(errorMessage).toContain('pelangi'); // Workflow profile
      expect(errorMessage).toContain('makan'); // Conversation profile
      expect(errorMessage).toContain('ProfileMismatchError');

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Backward compatibility (profileId not enforced if missing)', () => {
    it('should allow execution if workflow lacks profileId field (legacy workflows)', async () => {
      const mockWorkflows = {
        workflows: [
          {
            id: 'legacy_workflow',
            name: 'Legacy Workflow',
            // No profileId field (pre-US-054 workflow)
            steps: [
              {
                id: 'step1',
                message: { en: 'Legacy step', ms: 'Langkah warisan', zh: '遗留步骤' },
                waitForReply: false,
              }
            ],
            format: 'steps' as const,
          },
        ]
      };

      vi.mocked(configStore.getWorkflows).mockReturnValue(mockWorkflows as any);

      const workflowState = {
        workflowId: 'legacy_workflow',
        currentStepIndex: 0,
        collectedData: {},
        startedAt: Date.now(),
        lastUpdateAt: Date.now(),
      };

      const context: WorkflowContext = {
        language: 'en',
        phone: '60199888777',
        pushName: 'Guest',
        instanceId: 'msg1234',
        profileId: 'pelangi',
      };

      const result = await executeWorkflowStep(workflowState, null, context);

      // Should execute (validation only triggers if both profileId and currentProfile are set)
      expect(result.newState).toBeDefined();
      expect(result.newState?.workflowId).toBe('legacy_workflow');
    });
  });
});
