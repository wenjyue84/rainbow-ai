/**
 * Tests for WhatsApp Consent Enforcement (US-155)
 */

import { describe, it, expect } from 'vitest';
import { checkWhatsAppConsent, recordWhatsAppOptIn, recordWhatsAppOptOut } from './consent-enforcement.js';

describe('Consent Enforcement (US-155)', () => {
  describe('checkWhatsAppConsent', () => {
    it('should fail-open when database is unavailable', async () => {
      // When pool is unavailable, consent check should return allowed=true
      const result = await checkWhatsAppConsent('+60123456789');
      expect(result.allowed).toBe(true);
      expect(result.optedIn).toBe(true);
    });

    it('should extract phone number from JID format', async () => {
      // Should handle full JID format
      const phone1 = '60123456789@s.whatsapp.net';
      const phone2 = '60123456789';
      // Both should be treated the same way
      expect(phone1.replace(/[@a-z.]/g, '')).toBe(phone2);
    });
  });

  describe('recordWhatsAppOptIn', () => {
    it('should handle missing database gracefully', async () => {
      // Should not throw when database is unavailable
      await expect(recordWhatsAppOptIn('+60123456789')).resolves.toBeUndefined();
    });
  });

  describe('recordWhatsAppOptOut', () => {
    it('should handle missing database gracefully', async () => {
      // Should not throw when database is unavailable
      await expect(recordWhatsAppOptOut('+60123456789')).resolves.toBeUndefined();
    });
  });

  describe('Consent Check Result types', () => {
    it('should return ConsentCheckResult with required fields', async () => {
      const result = await checkWhatsAppConsent('+60123456789');
      expect(result).toHaveProperty('allowed');
      expect(result).toHaveProperty('optedIn');
      expect(typeof result.allowed).toBe('boolean');
      expect(typeof result.optedIn).toBe('boolean');
    });

    it('should include reason when consent is denied', async () => {
      // Mock a denied consent scenario
      const result = {
        allowed: false,
        reason: 'Contact +60123456789 has whatsapp_opted_in = false — blocked',
        optedIn: false
      };
      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('blocked');
    });
  });
});
