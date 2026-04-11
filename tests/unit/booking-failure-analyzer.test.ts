/**
 * US-466: Booking Failure Analyzer Tests
 *
 * Tests for:
 * - Error categorization (CONFIG, DATA, EXTERNAL, UNKNOWN)
 * - Frequency counting per category
 * - Top 3 recent examples per category
 * - Priority ranking by frequency
 * - Remediation suggestion generation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  categorizeError,
  generateRemediation,
  analyzeFailures,
  extractErrorMessage,
  type FailureExample,
  type CategoryAnalysis,
  type FailureAnalysisReport,
} from '../../src/tools/booking/failure-analyzer.js';

describe('Booking Failure Analyzer', () => {
  describe('categorizeError', () => {
    describe('CONFIG errors', () => {
      it('detects missing workflow step definition', () => {
        const result = categorizeError('Step validate-dates not found in workflows.json');
        expect(result).toBe('CONFIG');
      });

      it('detects invalid workflow step errors', () => {
        const result = categorizeError('Invalid workflow step definition for check-availability');
        expect(result).toBe('CONFIG');
      });

      it('detects missing dependency errors', () => {
        const result = categorizeError('Missing dependency: database connection not initialized');
        expect(result).toBe('CONFIG');
      });

      it('detects schema validation errors', () => {
        const result = categorizeError('Schema validation failed: missing required field check_in_date');
        expect(result).toBe('CONFIG');
      });

      it('detects configuration errors', () => {
        const result = categorizeError('Configuration error: invalid provider settings');
        expect(result).toBe('CONFIG');
      });
    });

    describe('DATA errors', () => {
      it('detects guest record not found', () => {
        const result = categorizeError('Guest record not found for phone +60123456789');
        expect(result).toBe('DATA');
      });

      it('detects unit not found', () => {
        const result = categorizeError('Unit not found for room_id DELUXE_001');
        expect(result).toBe('DATA');
      });

      it('detects booking record missing', () => {
        const result = categorizeError('Booking record missing for booking_id ABC123');
        expect(result).toBe('DATA');
      });

      it('detects data validation errors', () => {
        const result = categorizeError('Data validation error: check_in_date is null');
        expect(result).toBe('DATA');
      });

      it('detects corrupt data', () => {
        const result = categorizeError('Guest record corrupt: invalid phone format in database');
        expect(result).toBe('DATA');
      });

      it('detects null references', () => {
        const result = categorizeError('Null reference: booking object is null');
        expect(result).toBe('DATA');
      });
    });

    describe('EXTERNAL errors', () => {
      it('detects API timeout errors', () => {
        const result = categorizeError('External API timeout after 30s waiting for payment-gateway');
        expect(result).toBe('EXTERNAL');
      });

      it('detects 502 Bad Gateway errors', () => {
        const result = categorizeError('502 Bad Gateway from payment-gateway.external.com');
        expect(result).toBe('EXTERNAL');
      });

      it('detects 503 Service Unavailable errors', () => {
        const result = categorizeError('Service unavailable: database connection pool exhausted');
        expect(result).toBe('EXTERNAL');
      });

      it('detects connection timeout', () => {
        const result = categorizeError('Connection timeout to notification service after 5s');
        expect(result).toBe('EXTERNAL');
      });

      it('detects timed out errors', () => {
        const result = categorizeError('Request timed out after 30 seconds');
        expect(result).toBe('EXTERNAL');
      });

      it('detects ECONNREFUSED errors', () => {
        const result = categorizeError('ECONNREFUSED: connection refused to external service');
        expect(result).toBe('EXTERNAL');
      });
    });

    describe('UNKNOWN errors', () => {
      it('categorizes unknown error patterns', () => {
        const result = categorizeError('Unexpected error occurred during processing');
        expect(result).toBe('UNKNOWN');
      });

      it('handles null/undefined error messages', () => {
        expect(categorizeError(null as any)).toBe('UNKNOWN');
        expect(categorizeError(undefined as any)).toBe('UNKNOWN');
        expect(categorizeError('')).toBe('UNKNOWN');
      });

      it('is case-insensitive', () => {
        const result = categorizeError('TIMEOUT ERROR - EXTERNAL API DID NOT RESPOND');
        expect(result).toBe('EXTERNAL');
      });
    });
  });

  describe('generateRemediation', () => {
    it('generates CONFIG remediation', () => {
      const result = generateRemediation('CONFIG', 'validate-dates');
      expect(result).toContain('workflows.json');
      expect(result).toContain('validate-dates');
    });

    it('generates DATA remediation', () => {
      const result = generateRemediation('DATA', 'check-availability');
      expect(result).toContain('data existence checks');
      expect(result).toContain('check-availability');
    });

    it('generates EXTERNAL remediation', () => {
      const result = generateRemediation('EXTERNAL', 'charge-payment');
      expect(result).toContain('retry logic');
      expect(result).toContain('charge-payment');
    });

    it('generates UNKNOWN remediation', () => {
      const result = generateRemediation('UNKNOWN', 'notify-staff');
      expect(result).toContain('Review error logs');
      expect(result).toContain('notify-staff');
    });
  });

  describe('extractErrorMessage', () => {
    it('extracts from error field', () => {
      const result = extractErrorMessage({ error: 'Guest not found' });
      expect(result).toBe('Guest not found');
    });

    it('extracts from errorMessage field', () => {
      const result = extractErrorMessage({ errorMessage: 'Unit unavailable' });
      expect(result).toBe('Unit unavailable');
    });

    it('extracts from message field', () => {
      const result = extractErrorMessage({ message: 'Timeout error' });
      expect(result).toBe('Timeout error');
    });

    it('extracts from reason field', () => {
      const result = extractErrorMessage({ reason: 'No availability' });
      expect(result).toBe('No availability');
    });

    it('extracts from errorCode field', () => {
      const result = extractErrorMessage({ errorCode: 'PAYMENT_FAILED' });
      expect(result).toBe('PAYMENT_FAILED');
    });

    it('handles null/undefined output', () => {
      expect(extractErrorMessage(null)).toBe('unknown error');
      expect(extractErrorMessage(undefined)).toBe('unknown error');
    });

    it('falls back to JSON stringification', () => {
      const result = extractErrorMessage({ custom_field: 'error value' });
      expect(result).toContain('custom_field');
    });
  });

  describe('analyzeFailures', () => {
    const sampleLogs = [
      // CONFIG failures (2)
      {
        step_name: 'validate-dates',
        output: { errorCode: 'INVALID_WORKFLOW_STEP', message: 'Step validate-dates not found' },
        executed_at: '2026-04-11T12:30:00Z',
      },
      {
        step_name: 'validate-dates',
        output: { message: 'Schema validation failed: missing required field' },
        executed_at: '2026-04-11T14:30:00Z',
      },
      // DATA failures (3)
      {
        step_name: 'check-availability',
        output: { error: 'Unit not found for room_id DELUXE_001' },
        executed_at: '2026-04-11T12:00:00Z',
      },
      {
        step_name: 'verify-guest',
        output: { error: 'Guest record missing for phone +60123456789' },
        executed_at: '2026-04-11T12:15:00Z',
      },
      {
        step_name: 'check-availability',
        output: { error: 'Data validation error: check_in_date is null' },
        executed_at: '2026-04-11T13:00:00Z',
      },
      // EXTERNAL failures (2)
      {
        step_name: 'charge-payment',
        output: { message: 'External API timeout after 30s' },
        executed_at: '2026-04-11T12:45:00Z',
      },
      {
        step_name: 'notify-staff',
        output: { message: '502 Bad Gateway from payment-gateway' },
        executed_at: '2026-04-11T13:45:00Z',
      },
    ];

    it('counts failures by category correctly', () => {
      const report = analyzeFailures(sampleLogs);

      const dataCategory = report.categories.find(c => c.failure_category === 'DATA');
      const configCategory = report.categories.find(c => c.failure_category === 'CONFIG');
      const externalCategory = report.categories.find(c => c.failure_category === 'EXTERNAL');

      expect(dataCategory?.count).toBe(3);
      expect(configCategory?.count).toBe(2);
      expect(externalCategory?.count).toBe(2);
    });

    it('ranks categories by frequency (highest first)', () => {
      const report = analyzeFailures(sampleLogs);

      expect(report.categories[0].priority_rank).toBe(1);
      expect(report.categories[0].failure_category).toBe('DATA');
      expect(report.categories[1].priority_rank).toBe(2);
      expect(report.categories[2].priority_rank).toBe(3);
    });

    it('includes top 3 recent examples per category', () => {
      const report = analyzeFailures(sampleLogs);

      const dataCategory = report.categories.find(c => c.failure_category === 'DATA');
      expect(dataCategory?.examples.length).toBeLessThanOrEqual(3);

      for (const example of dataCategory?.examples || []) {
        expect(example).toHaveProperty('timestamp');
        expect(example).toHaveProperty('errorMessage');
        expect(example).toHaveProperty('remediation');
      }
    });

    it('generates remediation summary with all categories', () => {
      const report = analyzeFailures(sampleLogs);

      expect(report.remediation_summary).toContain('DATA');
      expect(report.remediation_summary).toContain('CONFIG');
      expect(report.remediation_summary).toContain('EXTERNAL');
    });

    it('includes timestamp in report', () => {
      const report = analyzeFailures(sampleLogs);
      expect(report.timestamp).toBeDefined();
      expect(new Date(report.timestamp).getTime()).toBeGreaterThan(0);
    });

    it('counts total failures correctly', () => {
      const report = analyzeFailures(sampleLogs);
      expect(report.total_failures).toBe(sampleLogs.length);
    });

    it('handles empty failure list', () => {
      const report = analyzeFailures([]);
      expect(report.categories.length).toBe(0);
      expect(report.total_failures).toBe(0);
    });

    it('handles mixed valid and invalid error messages', () => {
      const mixedLogs = [
        {
          step_name: 'step1',
          output: { error: 'Unit not found' },
          executed_at: '2026-04-11T12:00:00Z',
        },
        {
          step_name: 'step2',
          output: null,
          executed_at: '2026-04-11T12:01:00Z',
        },
      ];

      const report = analyzeFailures(mixedLogs);
      expect(report.categories.length).toBeGreaterThan(0);
    });

    it('includes step names in remediation summary', () => {
      const report = analyzeFailures(sampleLogs);
      expect(report.remediation_summary).toContain('validate-dates');
      expect(report.remediation_summary).toContain('check-availability');
    });
  });

  describe('Acceptance Criteria Validation', () => {
    it('AC1: Parse logs and categorize by root cause (CONFIG, DATA, EXTERNAL, UNKNOWN)', () => {
      const logs = [
        { step_name: 'a', output: { error: 'Step not found' }, executed_at: '2026-04-11T12:00:00Z' },
        { step_name: 'b', output: { error: 'Guest not found' }, executed_at: '2026-04-11T12:01:00Z' },
        { step_name: 'c', output: { message: 'Timeout' }, executed_at: '2026-04-11T12:02:00Z' },
      ];

      const report = analyzeFailures(logs);
      const categories = report.categories.map(c => c.failure_category);

      expect(categories).toContain('CONFIG');
      expect(categories).toContain('DATA');
      expect(categories).toContain('EXTERNAL');
    });

    it('AC2: Display top 3 recent examples with timestamps and error messages, ranked by frequency', () => {
      const logs = [
        { step_name: 'a', output: { error: 'Guest not found' }, executed_at: '2026-04-11T12:00:00Z' },
        { step_name: 'b', output: { error: 'Unit not found' }, executed_at: '2026-04-11T12:01:00Z' },
        { step_name: 'c', output: { error: 'Data corrupt' }, executed_at: '2026-04-11T12:02:00Z' },
      ];

      const report = analyzeFailures(logs);
      expect(report.categories[0].priority_rank).toBe(1);
      expect(report.categories[0].examples.length).toBeGreaterThan(0);

      const example = report.categories[0].examples[0];
      expect(example.timestamp).toBeDefined();
      expect(example.errorMessage).toBeDefined();
    });

    it('AC3: Generate remediation summary with actionable steps', () => {
      const logs = [
        { step_name: 'check-availability', output: { error: 'Unit not found' }, executed_at: '2026-04-11T12:00:00Z' },
        { step_name: 'validate-dates', output: { message: 'Schema validation failed' }, executed_at: '2026-04-11T12:01:00Z' },
      ];

      const report = analyzeFailures(logs);
      expect(report.remediation_summary).toBeTruthy();
      expect(report.remediation_summary).toContain('DATA failures');
      expect(report.remediation_summary).toContain('CONFIG failures');
    });
  });
});
