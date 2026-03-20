/**
 * Knowledge Base (KB) Content Validation Tests (US-032)
 *
 * Validates that KB files contain required business-specific content
 * and accurately reflect each business identity. Tests KB markdown
 * files for completeness, accuracy, and business alignment.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Resolve project root
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function readKBFile(profile: string, filename: string): string {
  const filePath = join(ROOT, `.rainbow-kb-${profile}`, filename);
  if (!existsSync(filePath)) {
    throw new Error(`KB file not found: ${filePath}`);
  }
  return readFileSync(filePath, 'utf-8');
}

// ─── Makan Moments Cafe: Content Validation ──────────────────────────────────

describe('Makan Moments Cafe KB files — business accuracy', () => {
  describe('soul.md', () => {
    const content = readKBFile('makan', 'soul.md');

    it('should identify as Makan Moments Cafe, not a hostel', () => {
      expect(content).toContain('Makan Moments Cafe');
      expect(content).not.toContain('hostel');
      expect(content).not.toContain('capsule');
    });

    it('should describe personality as food-focused', () => {
      expect(content).toContain('Food First');
      expect(content).toContain('Proactive Seller');
      expect(content.toLowerCase()).toContain('food-enthusiastic');
    });

    it('should mention Thai-Malaysian fusion cuisine', () => {
      expect(content.toLowerCase()).toContain('thai-malaysian');
    });

    it('should not contain hostel-specific services', () => {
      expect(content.toLowerCase()).not.toContain('room');
      expect(content.toLowerCase()).not.toContain('check-in');
    });
  });

  describe('cafe-facts.md', () => {
    const content = readKBFile('makan', 'cafe-facts.md');

    it('should contain Makan Moments name and address', () => {
      expect(content).toContain('Makan Moments Cafe');
      expect(content).toContain('Jalan Impian Emas');
      expect(content).toContain('Taman Impian Emas');
    });

    it('should have Makan-specific operating hours', () => {
      expect(content).toContain('11:00 AM');
      expect(content).toContain('11:00 PM');
    });

    it('should mention Thai Basil Chicken Rice', () => {
      expect(content).toContain('Thai Basil Chicken Rice');
    });

    it('should mention Makan WiFi password ilovemakan', () => {
      expect(content).toContain('ilovemakan');
    });

    it('should not contain hostel references', () => {
      expect(content).not.toContain('capsule');
      expect(content).not.toContain('dorm');
      expect(content.toLowerCase()).not.toContain('check-in');
    });
  });

  describe('faq.md', () => {
    const content = readKBFile('makan', 'faq.md');

    it('should address cafe-specific questions', () => {
      expect(content.toLowerCase()).toContain('halal');
      expect(content.toLowerCase()).toContain('best sellers');
      expect(content.toLowerCase()).toContain('takeaway');
    });

    it('should not contain hostel policies', () => {
      expect(content.toLowerCase()).not.toContain('check-out');
      expect(content.toLowerCase()).not.toContain('room');
      expect(content.toLowerCase()).not.toContain('deposit');
    });

    it('should mention pre-order capability', () => {
      expect(content.toLowerCase()).toContain('pre-order');
    });
  });

  describe('ordering.md', () => {
    const content = readKBFile('makan', 'ordering.md');

    it('should describe pre-order process for cafe', () => {
      expect(content).toContain('Pre-Order Flow');
      expect(content.toLowerCase()).toContain('tray');
      expect(content.toLowerCase()).toContain('kitchen');
    });

    it('should mention Touch n Go for deposits', () => {
      expect(content.toLowerCase()).toContain('touch');
    });

    it('should have cafe-specific order statuses', () => {
      expect(content).toContain('Pending Approval');
      expect(content).toContain('Preparing');
    });
  });

  describe('AGENTS.md', () => {
    const content = readKBFile('makan', 'AGENTS.md');

    it('should identify as Makan Moments, not hostel', () => {
      expect(content).toContain('Makan Moments Cafe');
      expect(content).not.toContain('Pelangi');
    });

    it('should emphasize food and cafe context', () => {
      expect(content.toLowerCase()).toContain('food');
      expect(content.toLowerCase()).toContain('cafe');
    });
  });
});

// ─── Southern Homestay: Content Validation ──────────────────────────────────

describe('Southern Homestay KB files — business accuracy', () => {
  describe('soul.md', () => {
    const content = readKBFile('southern', 'soul.md');

    it('should identify as Southern Homestay, not Pelangi', () => {
      expect(content).toContain('Southern Homestay');
      expect(content).not.toContain('Pelangi');
      expect(content).not.toContain('capsule');
    });

    it('should describe personality as hospitality-focused', () => {
      expect(content).toContain('Hospitality First');
      expect(content.toLowerCase()).toContain('warm');
      expect(content.toLowerCase()).toContain('friendly');
    });

    it('should not contain cafe references', () => {
      expect(content.toLowerCase()).not.toContain('food');
      expect(content.toLowerCase()).not.toContain('menu');
    });
  });

  describe('company-profile.md', () => {
    const content = readKBFile('southern', 'company-profile.md');

    it('should identify Southern as separate from Pelangi', () => {
      expect(content).toContain('Southern Homestay');
      expect(content.toLowerCase()).toContain('johor');
    });

    it('should list KSL, Sky88, and Pinnacle as properties', () => {
      expect(content).toContain('KSL D\'Esplanade');
      expect(content).toContain('Setia Sky88');
      expect(content).toContain('Pinnacle Towers');
    });

    it('should mention owner Jay', () => {
      expect(content).toContain('Jay');
      expect(content).toContain('Wenjyue');
    });

    it('should mention CIMB account (not Maya)', () => {
      expect(content).toContain('CIMB');
      expect(content).not.toContain('Maya');
    });

    it('should not contain Pelangi-only services', () => {
      // Pelangi is listed but should be clear it's a separate service
      expect(content).not.toContain('ilovestaycapsule');
    });
  });

  describe('check-in-guide.md', () => {
    const content = readKBFile('southern', 'check-in-guide.md');

    it('should have Southern-specific check-in procedures', () => {
      expect(content).toContain('KSL D\'Esplanade');
      expect(content).toContain('Setia Sky88');
    });

    it('should mention Apam Balik stall for Sky88', () => {
      expect(content).toContain('Apam Balik');
    });

    it('should describe block names (ALTUS, SORA, NUBE)', () => {
      expect(content).toContain('ALTUS');
      expect(content).toContain('SORA');
      expect(content).toContain('NUBE');
    });

    it('should not mention Pelangi facilities', () => {
      expect(content).not.toContain('ilovestaycapsule');
      expect(content).not.toContain('Pelangi');
    });
  });

  describe('pricing-and-payment.md', () => {
    const content = readKBFile('southern', 'pricing-and-payment.md');

    it('should have Southern rates (not Pelangi)', () => {
      expect(content).toContain('RM180');
      expect(content).toContain('RM165');
    });

    it('should mention CIMB account', () => {
      expect(content).toContain('CIMB');
      expect(content).toContain('8009679425');
    });

    it('should not reference Pelangi payment details', () => {
      expect(content).not.toContain('Maya');
      expect(content).not.toContain('Maybank');
      expect(content).not.toContain('ilovestaycapsule');
    });

    it('should describe Southern check-in times', () => {
      expect(content).toContain('4:00 PM');
      expect(content).toContain('12:00 PM');
    });
  });

  describe('faq.md', () => {
    const content = readKBFile('southern', 'faq.md');

    it('should address homestay-specific questions', () => {
      expect(content.toLowerCase()).toContain('booking');
      expect(content.toLowerCase()).toContain('check-in');
      expect(content.toLowerCase()).toContain('check-out');
    });

    it('should mention Jay as operator', () => {
      expect(content).toContain('Jay');
    });

    it('should not contain cafe references', () => {
      expect(content.toLowerCase()).not.toContain('menu');
      expect(content.toLowerCase()).not.toContain('food');
      expect(content.toLowerCase()).not.toContain('order');
    });

    it('should not mention Pelangi credentials', () => {
      expect(content).not.toContain('ilovestaycapsule');
      expect(content).not.toContain('1270#');
    });
  });

  describe('AGENTS.md', () => {
    const content = readKBFile('southern', 'AGENTS.md');

    it('should identify as Southern Homestay, NOT Pelangi', () => {
      expect(content).toContain('Southern Homestay');
      expect(content).toContain('NOT Pelangi');
    });

    it('should emphasize guest/booking context', () => {
      expect(content.toLowerCase()).toContain('booking');
      expect(content.toLowerCase()).toContain('guest');
    });
  });
});

// ─── Cross-Profile Validation ───────────────────────────────────────────────

describe('Cross-profile business separation', () => {
  it('Makan KB should not reference Southern properties', () => {
    const content = readKBFile('makan', 'soul.md');
    expect(content.toLowerCase()).not.toContain('southern homestay');
    expect(content.toLowerCase()).not.toContain('ksl');
    expect(content.toLowerCase()).not.toContain('sky88');
  });

  it('Southern KB should not reference Makan details', () => {
    const content = readKBFile('southern', 'soul.md');
    expect(content.toLowerCase()).not.toContain('makan moments');
    expect(content.toLowerCase()).not.toContain('thai');
    expect(content.toLowerCase()).not.toContain('skudai');
  });

  it('Both profiles should have distinct operating contexts', () => {
    const makanSoul = readKBFile('makan', 'soul.md');
    const southernSoul = readKBFile('southern', 'soul.md');

    // Makan focuses on food/selling
    expect(makanSoul.toLowerCase()).toContain('food');
    expect(makanSoul.toLowerCase()).toContain('seller');

    // Southern focuses on hospitality/hosting
    expect(southernSoul.toLowerCase()).toContain('hospitality');
  });
});
