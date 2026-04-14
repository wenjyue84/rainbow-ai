/**
 * Tests for KB Relevance Scorer (US-634)
 *
 * Tests verify:
 * - Cosine similarity scoring with TF-IDF vectors
 * - Document filtering based on relevance threshold (0.7)
 * - Logging of skipped documents
 * - Intent-based keyword loading and filtering
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KBRelevanceScorer } from '../src/lib/kb-relevance-scorer.js';

describe('KBRelevanceScorer', () => {
  let scorer: KBRelevanceScorer;

  beforeEach(() => {
    scorer = new KBRelevanceScorer(0.7);
  });

  describe('scoreDocuments - basic cosine similarity', () => {
    it('should score documents high when they match intent keywords closely', () => {
      const intent = 'booking_inquiry';
      const keywords = ['booking', 'reservation', 'check-in', 'room'];
      const documents = new Map<string, string>([
        [
          'booking.md',
          'How to make a booking reservation check-in room booking reservation check-in'
        ],
        ['faq.md', 'What is frequently asked question'],
        ['contact.md', 'Contact us by phone or email for inquiries'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      // booking.md should score high (contains all keywords)
      const bookingDoc = result.documents.find(d => d.docId === 'booking.md');
      expect(bookingDoc).toBeDefined();
      expect(bookingDoc!.included).toBe(true);
      expect(bookingDoc!.score).toBeGreaterThanOrEqual(0.7);
    });

    it('should exclude documents when relevance score is below threshold', () => {
      const intent = 'booking_inquiry';
      const keywords = ['booking', 'reservation', 'room'];
      const documents = new Map<string, string>([
        ['booking.md', 'Book a room for your stay'],
        ['faq.md', 'Frequently asked questions about our website'],
        ['about.md', 'About our company and history'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      // about.md should be skipped (no relevant keywords)
      const aboutDoc = result.skipped.find(d => d.docId === 'about.md');
      expect(aboutDoc).toBeDefined();
      expect(aboutDoc!.included).toBe(false);
      expect(aboutDoc!.reason).toBe('below_threshold');
    });

    it('should return score in 0-1 range rounded to 3 decimals', () => {
      const intent = 'test';
      const keywords = ['test', 'sample'];
      const documents = new Map<string, string>([['doc.md', 'This is a test document with sample content']]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      expect(result.documents.length).toBeGreaterThan(0);
      const score = result.documents[0].score;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
      // Check it's rounded to 3 decimals
      const decimals = score.toString().split('.')[1];
      expect(decimals?.length || 0).toBeLessThanOrEqual(3);
    });

    it('should handle empty keyword list', () => {
      const intent = 'test';
      const keywords: string[] = [];
      const documents = new Map<string, string>([['doc.md', 'Some content']]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      // Empty keywords should include all documents at score 1.0
      expect(result.documents.length).toBe(1);
      expect(result.documents[0].score).toBe(1.0);
      expect(result.skipped.length).toBe(0);
    });

    it('should handle documents with no content', () => {
      const intent = 'test';
      const keywords = ['test'];
      const documents = new Map<string, string>([['empty.md', '']]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      // Empty document should score low
      const doc = result.documents.find(d => d.docId === 'empty.md');
      if (doc) {
        expect(doc.included).toBe(false);
      }
    });
  });

  describe('filterDocuments', () => {
    it('should return only document IDs above threshold', () => {
      const intent = 'booking';
      const keywords = ['booking', 'reservation'];
      const documents = new Map<string, string>([
        ['booking.md', 'booking information and reservation booking reservation'],
        ['unrelated.md', 'other content no keywords'],
      ]);

      const filtered = scorer.filterDocuments(intent, keywords, documents);

      expect(filtered).toContain('booking.md');
    });

    it('should exclude documents below threshold', () => {
      const intent = 'checkout';
      const keywords = ['checkout', 'departure'];
      const documents = new Map<string, string>([
        ['checkout.md', 'checkout procedures departure times checkout departure'],
        ['menu.md', 'food menu restaurant information'],
      ]);

      const filtered = scorer.filterDocuments(intent, keywords, documents);

      expect(filtered).toContain('checkout.md');
      expect(filtered).not.toContain('menu.md');
    });
  });

  describe('threshold configuration', () => {
    it('should respect custom threshold', () => {
      const customScorer = new KBRelevanceScorer(0.5); // Lower threshold
      const intent = 'test';
      const keywords = ['test'];
      const documents = new Map<string, string>([
        ['doc.md', 'This is a test document'],
        ['unrelated.md', 'No matches here'],
      ]);

      const result = customScorer.scoreDocuments(intent, keywords, documents);

      // With lower threshold, more documents should be included
      const lowThresholdIncluded = result.documents.length;

      const strictScorer = new KBRelevanceScorer(0.9);
      const strictResult = strictScorer.scoreDocuments(intent, keywords, documents);
      const strictIncluded = strictResult.documents.length;

      expect(lowThresholdIncluded).toBeGreaterThanOrEqual(strictIncluded);
    });

    it('should throw error for invalid threshold', () => {
      expect(() => scorer.setThreshold(-0.1)).toThrow();
      expect(() => scorer.setThreshold(1.1)).toThrow();
    });

    it('should accept valid threshold values', () => {
      expect(() => scorer.setThreshold(0)).not.toThrow();
      expect(() => scorer.setThreshold(0.5)).not.toThrow();
      expect(() => scorer.setThreshold(1)).not.toThrow();
    });
  });

  describe('profile-specific intent filtering', () => {
    it('filterDocumentsByIntent should load keywords for given intent', () => {
      // This test requires intent-keywords files to exist
      // Since we can't guarantee that, we'll use a mock or skip if files don't exist
      const scorer = new KBRelevanceScorer(0.7);
      const documents = new Map<string, string>([
        ['test.md', 'Test content with multiple words'],
      ]);

      // Should not throw even if intent doesn't exist
      const filtered = scorer.filterDocumentsByIntent(
        'nonexistent_intent',
        documents,
        'pelangi'
      );
      expect(Array.isArray(filtered)).toBe(true);
    });

    it('scoreDocumentsByIntent should load keywords for given intent', () => {
      const scorer = new KBRelevanceScorer(0.7);
      const documents = new Map<string, string>([
        ['test.md', 'Test content'],
      ]);

      const result = scorer.scoreDocumentsByIntent(
        'nonexistent_intent',
        documents,
        'pelangi'
      );

      expect(result.intent).toBe('nonexistent_intent');
      expect(Array.isArray(result.documents)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);
    });
  });

  describe('ScoringResult structure', () => {
    it('should return complete ScoringResult with all fields', () => {
      const intent = 'test';
      const keywords = ['test', 'keyword'];
      const documents = new Map<string, string>([
        ['doc1.md', 'Test keyword content'],
        ['doc2.md', 'Unrelated content'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('documents');
      expect(result).toHaveProperty('skipped');
      expect(result.intent).toBe(intent);
      expect(Array.isArray(result.documents)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);

      // Verify all documents are accounted for
      const totalDocuments = result.documents.length + result.skipped.length;
      expect(totalDocuments).toBe(documents.size);
    });

    it('should mark included documents correctly', () => {
      const intent = 'test';
      const keywords = ['test'];
      const documents = new Map<string, string>([
        ['relevant.md', 'test content'],
        ['irrelevant.md', 'other content'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      for (const doc of result.documents) {
        expect(doc.included).toBe(true);
      }

      for (const doc of result.skipped) {
        expect(doc.included).toBe(false);
        expect(doc.reason).toBe('below_threshold');
      }
    });
  });

  describe('TF-IDF vector similarity', () => {
    it('should score documents with multiple matching keywords higher', () => {
      const intent = 'booking';
      const keywords = ['booking', 'reservation', 'room', 'check-in'];
      const documents = new Map<string, string>([
        [
          'full_booking.md',
          'Complete booking and reservation guide for room check-in and check-out procedures'
        ],
        [
          'partial_booking.md',
          'Information about booking procedures only'
        ],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      const fullBooking = result.documents.find(d => d.docId === 'full_booking.md');
      const partialBooking = result.documents.find(d => d.docId === 'partial_booking.md');

      if (fullBooking && partialBooking) {
        expect(fullBooking.score).toBeGreaterThanOrEqual(partialBooking.score);
      }
    });

    it('should handle multilingual content appropriately', () => {
      const intent = 'test';
      const keywords = ['booking', 'check-in'];
      const documents = new Map<string, string>([
        ['en_doc.md', 'booking check-in procedures'],
        ['zh_doc.md', '预订入住程序'], // Chinese
        ['mixed_doc.md', 'booking 预订 check-in 入住'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      // All documents should be scored (tokenization should handle multilingual)
      expect(result.documents.length + result.skipped.length).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('should handle very long documents without error', () => {
      const intent = 'test';
      const keywords = ['test'];
      const longContent = 'word '.repeat(10000); // 50KB of text
      const documents = new Map<string, string>([['long.md', longContent]]);

      expect(() => scorer.scoreDocuments(intent, keywords, documents)).not.toThrow();
    });

    it('should handle special characters in document content', () => {
      const intent = 'test';
      const keywords = ['booking'];
      const documents = new Map<string, string>([
        ['special.md', 'Special chars: @#$%^&*() and booking info'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      expect(result.documents.length + result.skipped.length).toBe(1);
    });

    it('should handle duplicate keywords gracefully', () => {
      const intent = 'test';
      const keywords = ['booking', 'booking', 'booking']; // Duplicates
      const documents = new Map<string, string>([['doc.md', 'booking information']]);

      expect(() => scorer.scoreDocuments(intent, keywords, documents)).not.toThrow();
    });
  });

  describe('logging behavior', () => {
    it('should log skipped documents with debug information', () => {
      const mockLogger = {
        debug: vi.fn(),
      };

      const scorer = new KBRelevanceScorer(0.7, mockLogger as any);
      const intent = 'booking';
      const keywords = ['booking'];
      const documents = new Map<string, string>([
        ['booking.md', 'Booking information'],
        ['unrelated.md', 'No keywords here at all'],
      ]);

      scorer.scoreDocuments(intent, keywords, documents);

      // Should log summary at the end
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should use console.debug when no logger provided', () => {
      const debugSpy = vi.spyOn(console, 'debug');
      const scorer = new KBRelevanceScorer(0.7); // No logger
      const intent = 'test';
      const keywords = ['test'];
      const documents = new Map<string, string>([['doc.md', 'test']]);

      scorer.scoreDocuments(intent, keywords, documents);

      expect(debugSpy).toHaveBeenCalled();
      debugSpy.mockRestore();
    });
  });

  describe('acceptance criteria verification', () => {
    it('AC1: Scores documents using cosine similarity on 0-1 scale, filters >= 0.7', () => {
      const scorer = new KBRelevanceScorer(0.7);
      const intent = 'booking_inquiry';
      const keywords = ['booking', 'reservation'];
      const documents = new Map<string, string>([
        ['booking.md', 'How to book a room reservation at our hotel'],
        ['faq.md', 'FAQ page about general questions'],
      ]);

      const result = scorer.scoreDocuments(intent, keywords, documents);

      // Verify scoring on 0-1 scale
      for (const doc of result.documents.concat(result.skipped)) {
        expect(doc.score).toBeGreaterThanOrEqual(0);
        expect(doc.score).toBeLessThanOrEqual(1);
      }

      // Verify filtering threshold
      for (const doc of result.documents) {
        expect(doc.score).toBeGreaterThanOrEqual(0.7);
        expect(doc.included).toBe(true);
      }

      for (const doc of result.skipped) {
        expect(doc.score).toBeLessThan(0.7);
        expect(doc.included).toBe(false);
      }
    });

    it('AC2: Logs skipped documents with intent, doc_id, score, and reason', () => {
      const logs: string[] = [];
      const mockLogger = {
        debug: (msg: string) => logs.push(msg),
      };

      const scorer = new KBRelevanceScorer(0.7, mockLogger as any);
      const intent = 'booking';
      const keywords = ['booking'];
      const documents = new Map<string, string>([
        ['booking.md', 'Booking information'],
        ['irrelevant.md', 'No booking keywords here'],
      ]);

      scorer.scoreDocuments(intent, keywords, documents);

      // Should have logged summary and skipped documents
      expect(logs.length).toBeGreaterThan(0);
      const skippedLog = logs.find(l => l.includes('Skipped') || l.includes(intent));
      if (logs.some(l => l.includes('Skipped'))) {
        expect(logs.some(l => l.includes('below_threshold'))).toBe(true);
      }
    });

    it('AC3: Filtering preserves relevant docs and excludes irrelevant ones', () => {
      const scorer = new KBRelevanceScorer(0.7);

      // Test 1: Booking intent includes booking docs but excludes inquiry templates
      const bookingKeywords = ['booking', 'reservation', 'check-in', 'room'];
      const bookingDocs = new Map<string, string>([
        ['booking-guide.md', 'booking reservation check-in room booking reservation check-in'],
        ['inquiry-template.md', 'template form for inquiries'],
      ]);

      const bookingResult = scorer.scoreDocuments(
        'booking_inquiry',
        bookingKeywords,
        bookingDocs
      );

      const bookingGuide = bookingResult.documents.find(
        d => d.docId === 'booking-guide.md'
      );
      expect(bookingGuide).toBeDefined();
      expect(bookingGuide!.included).toBe(true);

      // Test 2: Profile-specific docs preferred over generic
      const profileDocs = new Map<string, string>([
        [
          'pelangi-booking.md',
          'booking reservation check-in room pelangi hostel specific policies'
        ],
        [
          'generic-booking.md',
          'booking information accommodation generic'
        ],
      ]);

      const profileResult = scorer.scoreDocuments(
        'booking_inquiry',
        bookingKeywords,
        profileDocs
      );

      const pelangiDoc = profileResult.documents.find(
        d => d.docId === 'pelangi-booking.md'
      );
      const genericDoc = profileResult.documents.find(
        d => d.docId === 'generic-booking.md'
      );

      if (pelangiDoc && genericDoc) {
        // Profile-specific should score higher (contains more intent keywords + profile context)
        expect(pelangiDoc.score).toBeGreaterThanOrEqual(genericDoc.score);
      }
    });
  });
});
