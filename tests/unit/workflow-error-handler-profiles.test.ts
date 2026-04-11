/**
 * workflow-error-handler-profiles.test.ts — US-503 Profile Mapping Test
 * Verifies all 6 profiles are correctly mapped to their data directories
 */

import { describe, it, expect } from 'vitest';
import { loadRecoveryMessages, getRecoveryMessage } from '../../src/assistant/pipeline/workflow-error-handler.js';

describe('US-503: Workflow Error Handler Profile Mapping', () => {
  // Test that all profiles can be loaded without errors
  it('should load recovery messages for pelangi profile', () => {
    const messages = loadRecoveryMessages('pelangi');
    expect(messages).toBeDefined();
    expect(messages.payment_failed).toBeDefined();
    expect(messages.payment_failed.en).toBeDefined();
  });

  it('should load recovery messages for southern profile', () => {
    const messages = loadRecoveryMessages('southern');
    expect(messages).toBeDefined();
    expect(messages.payment_failed).toBeDefined();
    expect(messages.payment_failed.en).toBeDefined();
  });

  it('should load recovery messages for makan profile', () => {
    const messages = loadRecoveryMessages('makan');
    expect(messages).toBeDefined();
    expect(messages.payment_failed).toBeDefined();
    expect(messages.payment_failed.en).toBeDefined();
  });

  // Test missing profiles that should now work (US-503)
  it('should load recovery messages for yoongmei profile', () => {
    const messages = loadRecoveryMessages('yoongmei');
    expect(messages).toBeDefined();
    expect(messages.payment_failed).toBeDefined();
  });

  it('should load recovery messages for pms-capsule profile', () => {
    const messages = loadRecoveryMessages('pms-capsule');
    expect(messages).toBeDefined();
    expect(messages.payment_failed).toBeDefined();
  });

  it('should load recovery messages for pms-southern profile', () => {
    const messages = loadRecoveryMessages('pms-southern');
    expect(messages).toBeDefined();
    expect(messages.payment_failed).toBeDefined();
  });

  // Test getRecoveryMessage with all profiles
  it('should get payment_failed message for each profile', () => {
    const profiles = ['pelangi', 'southern', 'makan', 'yoongmei', 'pms-capsule', 'pms-southern'];

    profiles.forEach(profile => {
      const message = getRecoveryMessage('payment_failed', 'en', profile);
      expect(message).toBeDefined();
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toBe('We encountered an issue. Please try again or contact our staff.');
    });
  });

  // Test language fallback for all profiles
  it('should fallback to English when language not available', () => {
    const profiles = ['pelangi', 'southern', 'makan', 'yoongmei', 'pms-capsule', 'pms-southern'];

    profiles.forEach(profile => {
      const message = getRecoveryMessage('payment_failed', 'nonexistent_lang', profile);
      expect(message).toBeDefined();
      // Should fallback to English message
      const enMessage = getRecoveryMessage('payment_failed', 'en', profile);
      expect(message).toBe(enMessage);
    });
  });

  // Test that missing error codes return default message
  it('should return default message for missing error code', () => {
    const profiles = ['pelangi', 'southern', 'makan', 'yoongmei', 'pms-capsule', 'pms-southern'];

    profiles.forEach(profile => {
      const message = getRecoveryMessage('nonexistent_code', 'en', profile);
      expect(message).toBe('We encountered an issue. Please try again or contact our staff.');
    });
  });

  // Test caching - second load should return cached version
  it('should cache recovery messages after first load', () => {
    const messages1 = loadRecoveryMessages('pelangi');
    const messages2 = loadRecoveryMessages('pelangi');
    expect(messages1).toBe(messages2); // Same object reference due to caching
  });

  // Test all 6 profiles are properly supported
  it('should support all 6 business profiles', () => {
    const expectedProfiles = ['pelangi', 'southern', 'makan', 'yoongmei', 'pms-capsule', 'pms-southern'];

    expectedProfiles.forEach(profile => {
      // Should not throw or return empty
      const messages = loadRecoveryMessages(profile);
      expect(Object.keys(messages).length).toBeGreaterThan(0);
    });
  });
});
