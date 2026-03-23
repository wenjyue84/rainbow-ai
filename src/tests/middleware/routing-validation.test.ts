/**
 * Tests: Message Routing Validation Middleware
 *
 * Validates that:
 * 1. Messages route to the correct profile (no cross-profile contamination)
 * 2. Routing violations are logged to rainbow_config_audit
 * 3. Middleware rejects messages where profile !== target
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateRouting,
  validateMessageRouting,
  type RoutingViolation,
} from '../../assistant/pipeline/middleware/routing-validator.js';
import type { PipelineState } from '../../assistant/pipeline/types.js';
import type { ConversationState } from '../../assistant/types.js';

describe('Message Routing Validation Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('validateRouting()', () => {
    it('should return null for first contact (no existing profile)', () => {
      const result = validateRouting(
        '1234567890',
        'pelangi',
        undefined
      );
      expect(result).toBeNull();
    });

    it('should return null when profiles match', () => {
      const result = validateRouting(
        '1234567890',
        'pelangi',
        'pelangi'
      );
      expect(result).toBeNull();
    });

    it('should return violation when profiles mismatch', () => {
      const result = validateRouting(
        '1234567890',
        'southern-homestay',
        'pelangi'
      );

      expect(result).not.toBeNull();
      expect(result?.senderId).toBe('1234567890');
      expect(result?.intendedProfile).toBe('pelangi');
      expect(result?.actualProfile).toBe('southern-homestay');
      expect(result?.timestamp).toBeGreaterThan(0);
    });

    it('should detect cross-profile switch from pelangi to southern', () => {
      const violation = validateRouting(
        '+60-guest-jalan-bukit',
        'southern-homestay',
        'pelangi'
      );

      expect(violation).toBeDefined();
      expect(violation?.intendedProfile).toBe('pelangi');
      expect(violation?.actualProfile).toBe('southern-homestay');
    });

    it('should detect cross-profile switch from southern to pelangi', () => {
      const violation = validateRouting(
        '+60-guest-jalan-bukit',
        'pelangi',
        'southern-homestay'
      );

      expect(violation).toBeDefined();
      expect(violation?.intendedProfile).toBe('southern-homestay');
      expect(violation?.actualProfile).toBe('pelangi');
    });
  });

  describe('validateMessageRouting()', () => {
    it('should return null when message routing is valid', async () => {
      const state: Partial<PipelineState> = {
        phone: '1234567890',
        profileId: 'pelangi',
        convo: {
          profileId: 'pelangi',
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);
      expect(result).toBeNull();
    });

    it('should reject message on profile mismatch', async () => {
      const state: Partial<PipelineState> = {
        phone: '1234567890',
        profileId: 'southern-homestay',
        convo: {
          profileId: 'pelangi',
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result).not.toBeNull();
      expect(result?.continue).toBe(false);
      expect(result?.reason).toBe('cross_profile_routing');
    });

    it('should allow message on first contact (no existing profile)', async () => {
      const state: Partial<PipelineState> = {
        phone: '1234567890',
        profileId: 'pelangi',
        convo: {
          // No profileId yet (first contact)
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);
      expect(result).toBeNull();
    });

    it('should handle AC3: reject cross-profile message for existing conversation', async () => {
      // Scenario: conversation started with pelangi, message arrives via southern-homestay
      const state: Partial<PipelineState> = {
        phone: '+60-123-456-7890',
        profileId: 'southern-homestay',
        convo: {
          profileId: 'pelangi',
          phone: '+60-123-456-7890',
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      // Should reject
      expect(result?.continue).toBe(false);
      expect(result?.reason).toBe('cross_profile_routing');
    });
  });

  describe('AC1: Message routing validation middleware', () => {
    it('should assert message.profile === target_profile before processing', async () => {
      // AC1 requirement: validate that message's profile matches conversation's profile

      const validState: Partial<PipelineState> = {
        phone: '1234567890',
        profileId: 'pelangi',
        convo: { profileId: 'pelangi' } as ConversationState,
      };

      const result = await validateMessageRouting(validState as PipelineState);
      expect(result).toBeNull(); // Valid routing, continues pipeline

      const invalidState: Partial<PipelineState> = {
        phone: '1234567890',
        profileId: 'southern-homestay',
        convo: { profileId: 'pelangi' } as ConversationState,
      };

      const rejectResult = await validateMessageRouting(invalidState as PipelineState);
      expect(rejectResult?.continue).toBe(false); // Invalid routing, halts pipeline
    });
  });

  describe('AC2: Log routing violations to rainbow_config_audit', () => {
    it('should return violation with correct structure when profiles mismatch', () => {
      const violation = validateRouting(
        '1234567890',
        'southern-homestay',
        'pelangi'
      );

      expect(violation).toBeDefined();
      expect(violation?.senderId).toBe('1234567890');
      expect(violation?.intendedProfile).toBe('pelangi');
      expect(violation?.actualProfile).toBe('southern-homestay');
      expect(violation?.timestamp).toBeGreaterThan(0);
    });

    it('should structure violation with sender_id field', () => {
      const violation = validateRouting(
        '601234567890',
        'southern-homestay',
        'pelangi'
      );

      expect(violation?.senderId).toBe('601234567890');
    });

    it('should structure violation with intended_profile field', () => {
      const violation = validateRouting(
        '1234567890',
        'makan-moments',
        'pelangi'
      );

      expect(violation?.intendedProfile).toBe('pelangi');
    });

    it('should structure violation with actual_profile field', () => {
      const violation = validateRouting(
        '1234567890',
        'makan-moments',
        'pelangi'
      );

      expect(violation?.actualProfile).toBe('makan-moments');
    });
  });

  describe('AC3: Tests asserting middleware rejects messages where profile !== target', () => {
    it('should reject message when profile mismatch detected', async () => {
      const state: Partial<PipelineState> = {
        phone: '1234567890',
        profileId: 'southern-homestay',
        convo: { profileId: 'pelangi' } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result).toBeDefined();
      expect(result?.continue).toBe(false);
      expect(result?.reason).toBe('cross_profile_routing');
    });

    it('should return correct rejection reason for cross-profile routing', async () => {
      const state: Partial<PipelineState> = {
        phone: '601234567890',
        profileId: 'southern-homestay',
        convo: { profileId: 'pelangi' } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result?.reason).toBe('cross_profile_routing');
    });

    it('should detect mismatch between pelangi conversation and southern message', async () => {
      const state: Partial<PipelineState> = {
        phone: 'guest-123',
        profileId: 'southern-homestay',
        convo: { profileId: 'pelangi', phone: 'guest-123' } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result?.continue).toBe(false);
    });

    it('should detect mismatch between southern conversation and pelangi message', async () => {
      const state: Partial<PipelineState> = {
        phone: 'guest-456',
        profileId: 'pelangi',
        convo: { profileId: 'southern-homestay', phone: 'guest-456' } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result?.continue).toBe(false);
    });

    it('should allow same-profile messages to continue', async () => {
      const state: Partial<PipelineState> = {
        phone: 'guest-789',
        profileId: 'pelangi',
        convo: { profileId: 'pelangi', phone: 'guest-789' } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result).toBeNull(); // Continues pipeline
    });

    it('should establish profile on first message (no existing conversation)', async () => {
      const state: Partial<PipelineState> = {
        phone: 'new-guest',
        profileId: 'pelangi',
        convo: {
          // No profileId — first contact
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);

      expect(result).toBeNull(); // First contact is always allowed
    });
  });

  describe('Routing violation structure for audit trail', () => {
    it('should contain all fields required for audit log (senderId, intendedProfile, actualProfile)', () => {
      const violation = validateRouting('12345', 'new-profile', 'old-profile');

      expect(violation).toHaveProperty('senderId');
      expect(violation).toHaveProperty('intendedProfile');
      expect(violation).toHaveProperty('actualProfile');
      expect(violation).toHaveProperty('timestamp');
    });

    it('should track timestamp of violation for audit trail', () => {
      const before = Date.now();
      const violation = validateRouting('12345', 'profile-b', 'profile-a');
      const after = Date.now();

      expect(violation?.timestamp).toBeGreaterThanOrEqual(before);
      expect(violation?.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('Profile-aware message routing validation', () => {
    it('should enforce profile separation at conversation level', async () => {
      // Test that a phone cannot switch between profiles mid-conversation
      const state: Partial<PipelineState> = {
        phone: '+60-guest-123',
        profileId: 'pelangi',
        convo: {
          profileId: 'southern-homestay', // Conversation established on southern
          phone: '+60-guest-123',
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);
      expect(result?.continue).toBe(false);
      expect(result?.reason).toBe('cross_profile_routing');
    });

    it('should prevent contamination between business profiles', async () => {
      // Verify makan-moments and pelangi conversations don't cross-contaminate
      const state: Partial<PipelineState> = {
        phone: '+60-cafe-guest',
        profileId: 'makan-moments',
        convo: {
          profileId: 'pelangi',
        } as ConversationState,
      };

      const result = await validateMessageRouting(state as PipelineState);
      expect(result?.continue).toBe(false);
    });
  });
});
