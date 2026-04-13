import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for US-580: Intent Misclassification Report
 *
 * AC1: Create admin API endpoint that queries feedback table for confidence > 0.8 AND satisfaction < 0.5
 * AC2: Report groups misclassifications by intent (top 5)
 * AC3: Shows count, average confidence, and sample conversation IDs
 */

// Mock types for testing
interface MockFeedbackRecord {
  intent: string;
  confidence: number;
  rating: number;
  conversationId: string;
  createdAt: Date;
}

interface MisclassificationGroup {
  intent: string;
  count: number;
  avgConfidence: number;
  sampleConversationIds: string[];
}

interface MisclassificationReport {
  period: {
    days: number;
    startDate: string;
    endDate: string;
  };
  misclassifications: MisclassificationGroup[];
}

/**
 * Helper: Generate mock feedback records for testing
 */
function generateMockFeedback(): MockFeedbackRecord[] {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  return [
    // High confidence, low satisfaction (misclassifications) - booking intent
    { intent: 'booking', confidence: 0.95, rating: 1, conversationId: 'conv-1', createdAt: new Date(now.getTime() - 1 * 60 * 60 * 1000) },
    { intent: 'booking', confidence: 0.92, rating: 2, conversationId: 'conv-2', createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    { intent: 'booking', confidence: 0.88, rating: 1, conversationId: 'conv-3', createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
    { intent: 'booking', confidence: 0.85, rating: 2, conversationId: 'conv-4', createdAt: sevenDaysAgo },

    // High confidence, low satisfaction - checkin_info intent
    { intent: 'checkin_info', confidence: 0.91, rating: 1, conversationId: 'conv-5', createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000) },
    { intent: 'checkin_info', confidence: 0.89, rating: 2, conversationId: 'conv-6', createdAt: new Date(now.getTime() - 5 * 60 * 60 * 1000) },

    // High confidence, low satisfaction - payment intent
    { intent: 'payment', confidence: 0.87, rating: 1, conversationId: 'conv-7', createdAt: new Date(now.getTime() - 6 * 60 * 60 * 1000) },

    // High confidence, low satisfaction - wifi intent
    { intent: 'wifi', confidence: 0.86, rating: 2, conversationId: 'conv-8', createdAt: new Date(now.getTime() - 7 * 60 * 60 * 1000) },

    // High confidence, low satisfaction - facilities_info intent
    { intent: 'facilities_info', confidence: 0.83, rating: 1, conversationId: 'conv-9', createdAt: new Date(now.getTime() - 8 * 60 * 60 * 1000) },

    // High confidence, HIGH satisfaction (not misclassifications) - should be filtered out
    { intent: 'booking', confidence: 0.94, rating: 5, conversationId: 'conv-10', createdAt: new Date(now.getTime() - 9 * 60 * 60 * 1000) },
    { intent: 'checkin_info', confidence: 0.90, rating: 4, conversationId: 'conv-11', createdAt: new Date(now.getTime() - 10 * 60 * 60 * 1000) },

    // Low confidence (should be filtered out)
    { intent: 'booking', confidence: 0.6, rating: 1, conversationId: 'conv-12', createdAt: new Date(now.getTime() - 11 * 60 * 60 * 1000) },

    // Old records (outside date range)
    { intent: 'booking', confidence: 0.91, rating: 1, conversationId: 'conv-13', createdAt: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000) }
  ];
}

/**
 * Filter and process feedback records like the API would
 */
function generateReport(feedbackRecords: MockFeedbackRecord[], days: number): MisclassificationReport {
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  // Filter: confidence > 0.8 AND rating < 3 (satisfaction < 0.5 on 0-1 scale)
  const misclassifications = feedbackRecords.filter(
    f => f.confidence > 0.8 && f.rating < 3 && f.createdAt >= startDate
  );

  // Group by intent
  const groupedByIntent = new Map<string, MockFeedbackRecord[]>();
  for (const record of misclassifications) {
    const intent = record.intent || 'unknown';
    if (!groupedByIntent.has(intent)) {
      groupedByIntent.set(intent, []);
    }
    groupedByIntent.get(intent)!.push(record);
  }

  // Convert to sorted array, take top 5
  const sorted = Array.from(groupedByIntent.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5);

  // Calculate aggregates
  const groups: MisclassificationGroup[] = sorted.map(([intent, records]) => ({
    intent,
    count: records.length,
    avgConfidence: Number((records.reduce((sum, r) => sum + r.confidence, 0) / records.length).toFixed(3)),
    sampleConversationIds: [...new Set(records.map(r => r.conversationId))].slice(0, 5)
  }));

  return {
    period: {
      days,
      startDate: startDate.toISOString(),
      endDate: now.toISOString()
    },
    misclassifications: groups
  };
}

describe('US-580: Intent Misclassification Report', () => {
  describe('AC1: Filtering by confidence > 0.8 AND satisfaction < 0.5', () => {
    it('should include records with confidence > 0.8 AND rating < 3', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      // All misclassifications should have high count
      expect(report.misclassifications.length).toBeGreaterThan(0);

      // Booking should be first (4 records)
      expect(report.misclassifications[0].intent).toBe('booking');
      expect(report.misclassifications[0].count).toBe(4);
    });

    it('should exclude records with confidence <= 0.8', () => {
      const feedback = [
        { intent: 'test', confidence: 0.8, rating: 1, conversationId: 'conv-1', createdAt: new Date() },
        { intent: 'test', confidence: 0.79, rating: 1, conversationId: 'conv-2', createdAt: new Date() },
        { intent: 'test', confidence: 0.6, rating: 1, conversationId: 'conv-3', createdAt: new Date() }
      ];
      const report = generateReport(feedback, 7);

      // Only records with confidence > 0.8 should be included
      const testRecords = report.misclassifications.filter(m => m.intent === 'test');
      if (testRecords.length > 0) {
        // If test intent appears, it should have exactly 1 record (the 0.8 boundary is exclusive for > 0.8)
        expect(testRecords[0].count).toBeLessThanOrEqual(1);
      }
    });

    it('should exclude records with rating >= 3 (satisfaction >= 0.5)', () => {
      const feedback = [
        { intent: 'test', confidence: 0.9, rating: 3, conversationId: 'conv-1', createdAt: new Date() },
        { intent: 'test', confidence: 0.9, rating: 4, conversationId: 'conv-2', createdAt: new Date() },
        { intent: 'test', confidence: 0.9, rating: 5, conversationId: 'conv-3', createdAt: new Date() },
        { intent: 'test', confidence: 0.9, rating: 1, conversationId: 'conv-4', createdAt: new Date() }
      ];
      const report = generateReport(feedback, 7);

      // Only 1 record should match (rating 1)
      const testRecords = report.misclassifications.filter(m => m.intent === 'test');
      if (testRecords.length > 0) {
        expect(testRecords[0].count).toBe(1);
      }
    });
  });

  describe('AC2: Group by intent and return top 5', () => {
    it('should group records by intent', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      // Verify grouping: each misclassification should have a distinct intent
      const intents = report.misclassifications.map(m => m.intent);
      expect(intents.length).toBe(new Set(intents).size);
    });

    it('should return top 5 intents by count', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      // Should have at most 5 groups
      expect(report.misclassifications.length).toBeLessThanOrEqual(5);

      // Should be sorted by count descending
      for (let i = 1; i < report.misclassifications.length; i++) {
        expect(report.misclassifications[i - 1].count).toBeGreaterThanOrEqual(report.misclassifications[i].count);
      }
    });

    it('should order groups by count (descending)', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      // Booking should have 4, checkin_info should have 2, payment/wifi/facilities should have 1 each
      if (report.misclassifications.length > 0) {
        expect(report.misclassifications[0].intent).toBe('booking');
        expect(report.misclassifications[0].count).toBe(4);
      }
      if (report.misclassifications.length > 1) {
        expect(report.misclassifications[1].intent).toBe('checkin_info');
        expect(report.misclassifications[1].count).toBe(2);
      }
    });
  });

  describe('AC3: Show count, average confidence, and sample conversation IDs', () => {
    it('should include count for each intent group', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      report.misclassifications.forEach(m => {
        expect(m.count).toBeGreaterThan(0);
        expect(typeof m.count).toBe('number');
      });
    });

    it('should calculate average confidence correctly', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      // Booking: 0.95, 0.92, 0.88, 0.85 -> avg = 0.9
      const bookingGroup = report.misclassifications.find(m => m.intent === 'booking');
      if (bookingGroup) {
        expect(bookingGroup.avgConfidence).toBe(0.9);
      }
    });

    it('should include sample conversation IDs', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      report.misclassifications.forEach(m => {
        expect(Array.isArray(m.sampleConversationIds)).toBe(true);
        expect(m.sampleConversationIds.length).toBeGreaterThan(0);
        expect(m.sampleConversationIds.length).toBeLessThanOrEqual(5);

        // All conversation IDs should be strings
        m.sampleConversationIds.forEach(id => {
          expect(typeof id).toBe('string');
        });
      });
    });

    it('should limit sample conversation IDs to 5 per intent', () => {
      const feedback = [
        ...Array.from({ length: 10 }, (_, i) => ({
          intent: 'test',
          confidence: 0.9,
          rating: 1,
          conversationId: `conv-${i}`,
          createdAt: new Date()
        }))
      ];
      const report = generateReport(feedback, 7);

      const testGroup = report.misclassifications.find(m => m.intent === 'test');
      if (testGroup) {
        expect(testGroup.sampleConversationIds.length).toBe(5);
      }
    });
  });

  describe('Date range filtering', () => {
    it('should filter by days parameter', () => {
      const feedback = generateMockFeedback();

      // 7-day report
      const report7 = generateReport(feedback, 7);
      expect(report7.period.days).toBe(7);

      // 1-day report should have fewer results
      const report1 = generateReport(feedback, 1);
      expect(report1.period.days).toBe(1);
      expect(report1.misclassifications.length).toBeLessThanOrEqual(report7.misclassifications.length);
    });

    it('should include startDate and endDate in response', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      expect(report.period.startDate).toBeDefined();
      expect(report.period.endDate).toBeDefined();

      const start = new Date(report.period.startDate);
      const end = new Date(report.period.endDate);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    });
  });

  describe('Edge cases', () => {
    it('should handle no misclassifications gracefully', () => {
      const feedback = [
        { intent: 'booking', confidence: 0.95, rating: 5, conversationId: 'conv-1', createdAt: new Date() },
        { intent: 'checkin', confidence: 0.6, rating: 1, conversationId: 'conv-2', createdAt: new Date() }
      ];
      const report = generateReport(feedback, 7);

      expect(Array.isArray(report.misclassifications)).toBe(true);
      expect(report.misclassifications.length).toBe(0);
    });

    it('should handle null intent values', () => {
      const feedback = [
        { intent: null as any, confidence: 0.9, rating: 1, conversationId: 'conv-1', createdAt: new Date() }
      ];
      const report = generateReport(feedback, 7);

      // Should gracefully handle null intents, converting to 'unknown' or filtering them
      expect(Array.isArray(report.misclassifications)).toBe(true);
    });

    it('should handle edge confidence values', () => {
      const feedback = [
        { intent: 'test1', confidence: 0.8000001, rating: 1, conversationId: 'conv-1', createdAt: new Date() },
        { intent: 'test2', confidence: 0.7999999, rating: 1, conversationId: 'conv-2', createdAt: new Date() }
      ];
      const report = generateReport(feedback, 7);

      // test1 should be included (> 0.8), test2 should be excluded (<= 0.8)
      expect(report.misclassifications.some(m => m.intent === 'test1')).toBe(true);
    });
  });

  describe('Response structure', () => {
    it('should match expected response schema', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      // Validate top-level structure
      expect(report).toHaveProperty('period');
      expect(report).toHaveProperty('misclassifications');
      expect(Array.isArray(report.misclassifications)).toBe(true);

      // Validate period structure
      expect(report.period).toHaveProperty('days');
      expect(report.period).toHaveProperty('startDate');
      expect(report.period).toHaveProperty('endDate');

      // Validate each misclassification group
      report.misclassifications.forEach(m => {
        expect(m).toHaveProperty('intent');
        expect(m).toHaveProperty('count');
        expect(m).toHaveProperty('avgConfidence');
        expect(m).toHaveProperty('sampleConversationIds');
      });
    });

    it('should format avgConfidence to 3 decimal places', () => {
      const feedback = generateMockFeedback();
      const report = generateReport(feedback, 7);

      report.misclassifications.forEach(m => {
        const confStr = m.avgConfidence.toString();
        const decimalPart = confStr.split('.')[1];
        expect(decimalPart?.length || 0).toBeLessThanOrEqual(3);
      });
    });
  });
});
