import { describe, it, expect } from 'vitest';
import {
  validateTemplate,
  formatValidationResult,
  normalizeProfileName,
} from '../email-template-validator.js';

describe('Email Template Validator', () => {
  describe('normalizeProfileName', () => {
    it('normalizes underscore to hyphen', () => {
      expect(normalizeProfileName('pelangi_capsule')).toBe('pelangi-capsule');
      expect(normalizeProfileName('makan_moments')).toBe('makan-moments');
    });

    it('converts to lowercase', () => {
      expect(normalizeProfileName('PELANGI-CAPSULE')).toBe('pelangi-capsule');
      expect(normalizeProfileName('Makan-Moments')).toBe('makan-moments');
    });

    it('handles already normalized names', () => {
      expect(normalizeProfileName('pelangi-capsule')).toBe('pelangi-capsule');
    });
  });

  describe('validateTemplate - valid templates', () => {
    it('accepts template with {{PROFILE_NAME}} variables', () => {
      const content = `
        <h1>Welcome to {{PROFILE_NAME}}</h1>
        <p>Amenities at {{PROFILE_NAME}}:</p>
        <ul>
          <li>{{PROFILE_AMENITIES}}</li>
        </ul>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.summary).toContain('✓ Template is valid');
    });

    it('accepts template with no profile-specific content', () => {
      const content = `
        <h1>Booking Confirmation</h1>
        <p>Dear Guest,</p>
        <p>Your booking has been confirmed.</p>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe('validateTemplate - invalid templates', () => {
    it('detects hardcoded business name for Pelangi', () => {
      const content = `
        <h1>Welcome to Pelangi Capsule Hostel</h1>
        <p>Your booking at Pelangi Capsule Hostel has been confirmed!</p>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(
        result.violations.some((v) =>
          v.detectedKeyword.includes('Pelangi Capsule Hostel'),
        ),
      ).toBe(true);
    });

    it('detects hardcoded amenities for Pelangi', () => {
      const content = `
        <h2>Amenities</h2>
        <ul>
          <li>Capsule pod with AC</li>
          <li>Shared bathroom</li>
        </ul>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(
        result.violations.some((v) => v.detectedKeyword === 'capsule pod'),
      ).toBe(true);
    });

    it('detects hardcoded business name for Makan', () => {
      const content = `
        <h1>Welcome to Makan Moments Cafe</h1>
        <p>Thank you for choosing Makan Moments!</p>
      `;

      const result = validateTemplate(
        content,
        'makan-moments',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(
        result.violations.some((v) =>
          v.detectedKeyword.includes('Makan Moments'),
        ),
      ).toBe(true);
    });

    it('reports correct line numbers for violations', () => {
      const content = `
Line 1: Some intro text
Line 2: Welcome to Pelangi Capsule Hostel
Line 3: Check your email
Line 4: This is the capsule pod setup
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);

      // Find violations and check they have line numbers > 1
      const lineNumbers = result.violations.map((v) => v.lineNumber);
      expect(lineNumbers.some((n) => n > 1)).toBe(true);
    });

    it('detects multiple violations in single template', () => {
      const content = `
        <h1>Welcome to Pelangi Capsule Hostel</h1>
        <p>Our capsule facility is located in Taman Pelangi</p>
        <p>Check-in at our hostel location</p>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    });

    it('is case-insensitive when detecting keywords', () => {
      const content = `
        <h1>PELANGI CAPSULE HOSTEL</h1>
        <p>Welcome to pelangi capsule hostel</p>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });
  });

  describe('validateTemplate - profile normalization', () => {
    it('normalizes profile names internally', () => {
      const content = `<h1>Welcome to {{PROFILE_NAME}}</h1>`;

      const result1 = validateTemplate(content, 'pelangi_capsule');
      const result2 = validateTemplate(content, 'pelangi-capsule');

      expect(result1.profile).toBe('pelangi-capsule');
      expect(result2.profile).toBe('pelangi-capsule');
      expect(result1.isValid).toBe(true);
      expect(result2.isValid).toBe(true);
    });
  });

  describe('validateTemplate - error handling', () => {
    it('rejects unknown profiles', () => {
      const content = `<h1>Welcome</h1>`;
      const result = validateTemplate(content, 'unknown-profile');

      expect(result.isValid).toBe(false);
      expect(result.violations).toHaveLength(0);
      expect(result.summary).toContain('not recognized');
    });
  });

  describe('formatValidationResult', () => {
    it('formats valid result', () => {
      const content = `<h1>Welcome to {{PROFILE_NAME}}</h1>`;
      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );
      const formatted = formatValidationResult(result);

      expect(formatted).toContain('✓ VALID');
      expect(formatted).toContain('pelangi-capsule');
    });

    it('formats invalid result with violations', () => {
      const content = `
        <h1>Welcome to Pelangi Capsule Hostel</h1>
        <p>Capsule pod amenities included</p>
      `;
      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );
      const formatted = formatValidationResult(result);

      expect(formatted).toContain('✗ INVALID');
      expect(formatted).toContain('Line');
      expect(formatted).toContain('Hardcoded');
      expect(formatted).toContain('{{PROFILE_NAME}}');
    });
  });

  describe('Integration - real-world scenarios', () => {
    it('validates booking confirmation template with mixed content', () => {
      const content = `
        <!DOCTYPE html>
        <html>
        <head><title>Booking Confirmation</title></head>
        <body>
          <h1>Welcome to {{PROFILE_NAME}}</h1>
          <p>Dear Guest,</p>
          <p>Your booking has been confirmed.</p>
          <h2>Check-in Instructions</h2>
          <p>Please arrive on your check-in date between 2:00 PM and 10:00 PM.</p>
          <h2>Amenities at {{PROFILE_NAME}}</h2>
          <ul><li>{{PROFILE_AMENITIES}}</li></ul>
        </body>
        </html>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(true);
    });

    it('catches cross-profile contamination', () => {
      const content = `
        <h1>Welcome to Pelangi Capsule Hostel</h1>
        <p>Your {{PROFILE_NAME}} booking is confirmed.</p>
      `;

      const result = validateTemplate(
        content,
        'pelangi-capsule',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(
        result.violations.some((v) =>
          v.detectedKeyword.includes('Pelangi'),
        ),
      ).toBe(true);
    });

    it('validates Southern Homestay profile', () => {
      const content = `
        <h1>Welcome to {{PROFILE_NAME}}</h1>
        <p>Your booking is confirmed at {{PROFILE_NAME}}.</p>
      `;

      const result = validateTemplate(
        content,
        'southern-homestay',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(true);
    });

    it('detects hardcoded Southern Homestay content', () => {
      const content = `
        <h1>Welcome to Southern Homestay</h1>
        <p>Enjoy your stay at our homestay.</p>
      `;

      const result = validateTemplate(
        content,
        'southern-homestay',
        'booking-confirmation.html',
      );

      expect(result.isValid).toBe(false);
      expect(
        result.violations.some((v) =>
          v.detectedKeyword.includes('Southern Homestay'),
        ),
      ).toBe(true);
    });
  });
});
