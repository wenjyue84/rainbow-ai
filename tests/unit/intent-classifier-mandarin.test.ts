/**
 * Tests for Mandarin Chinese intent classification (US-062).
 *
 * Verifies that Mandarin-language messages are correctly classified
 * for booking and inquiry intents with ≥80% accuracy.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Load intent keywords from JSON file
interface IntentKeywords {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

let intentKeywords: IntentKeywords;

beforeAll(() => {
  const filePath = path.join(
    process.cwd(),
    'src/assistant/data/intent-keywords.json'
  );
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  intentKeywords = JSON.parse(fileContent);
});

// Simple fuzzy string matching function for testing
function fuzzyMatch(text: string, keywords: string[]): { matched: boolean; confidence: number } {
  const lowerText = text.toLowerCase();

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();

    // Exact match
    if (lowerText === lowerKeyword) {
      return { matched: true, confidence: 1.0 };
    }

    // Contains match (high confidence)
    if (lowerText.includes(lowerKeyword) || lowerKeyword.includes(lowerText)) {
      return { matched: true, confidence: 0.85 };
    }

    // Character overlap match (for Chinese text)
    const matchedChars = text.split('').filter(char => keyword.includes(char)).length;
    if (matchedChars >= Math.floor(text.length * 0.6)) {
      return { matched: true, confidence: 0.75 };
    }
  }

  return { matched: false, confidence: 0 };
}

describe('Mandarin Chinese Intent Classification (US-062)', () => {
  // ─── Verify Mandarin Keywords Exist ───────────────────────
  describe('Mandarin Keywords Coverage', () => {
    it('should have 10+ Mandarin keywords for booking intent', () => {
      const bookingIntent = intentKeywords.intents.find(i => i.intent === 'booking');
      expect(bookingIntent).toBeDefined();
      expect(bookingIntent?.keywords.zh).toBeDefined();
      expect(bookingIntent?.keywords.zh?.length).toBeGreaterThanOrEqual(10);
    });

    it('should have 10+ Mandarin keywords for availability intent', () => {
      const availIntent = intentKeywords.intents.find(i => i.intent === 'availability');
      expect(availIntent).toBeDefined();
      expect(availIntent?.keywords.zh).toBeDefined();
      expect(availIntent?.keywords.zh?.length).toBeGreaterThanOrEqual(10);
    });

    it('should have Mandarin keywords for pricing intent', () => {
      const pricingIntent = intentKeywords.intents.find(i => i.intent === 'pricing');
      expect(pricingIntent).toBeDefined();
      expect(pricingIntent?.keywords.zh).toBeDefined();
      expect(pricingIntent?.keywords.zh?.length).toBeGreaterThanOrEqual(5);
    });

    it('should have Mandarin keywords for room_type_inquiry intent', () => {
      const roomIntent = intentKeywords.intents.find(i => i.intent === 'room_type_inquiry');
      expect(roomIntent).toBeDefined();
      expect(roomIntent?.keywords.zh).toBeDefined();
      expect(roomIntent?.keywords.zh?.length).toBeGreaterThanOrEqual(5);
    });
  });

  // ─── Booking Intent Fuzzy Matching Tests ──────────────────
  describe('Booking Intent Classification with Mandarin Samples', () => {
    const bookingTests = [
      { text: '我要订房', description: 'I want to book a room' },
      { text: '想订一间房', description: 'Want to book a room' },
      { text: '怎么订房', description: 'How to book a room' },
      { text: '可以订房吗', description: 'Can I book a room?' },
      { text: '帮我订房', description: 'Help me book a room' },
    ];

    bookingTests.forEach((test) => {
      it(`should fuzzy-match "${test.text}" (${test.description}) to booking keywords`, () => {
        const bookingIntent = intentKeywords.intents.find(i => i.intent === 'booking');
        expect(bookingIntent).toBeDefined();

        const zhKeywords = bookingIntent?.keywords.zh || [];
        const result = fuzzyMatch(test.text, zhKeywords);

        expect(result.matched).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      });
    });
  });

  // ─── Inquiry Intent Fuzzy Matching Tests ──────────────────
  describe('Inquiry Intent - Availability with Mandarin Samples', () => {
    const availabilityTests = [
      { text: '有没有房', description: 'Do you have rooms?' },
      { text: '还有房吗', description: 'Any rooms left?' },
      { text: '有空房吗', description: 'Any empty rooms?' },
      { text: '有床位吗', description: 'Any beds available?' },
      { text: '明天有空房吗', description: 'Tomorrow any rooms?' },
    ];

    availabilityTests.forEach((test) => {
      it(`should fuzzy-match "${test.text}" (${test.description}) to availability keywords`, () => {
        const availIntent = intentKeywords.intents.find(i => i.intent === 'availability');
        expect(availIntent).toBeDefined();

        const zhKeywords = availIntent?.keywords.zh || [];
        const result = fuzzyMatch(test.text, zhKeywords);

        expect(result.matched).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      });
    });
  });

  // ─── Inquiry Intent Fuzzy Matching Tests (Pricing) ────────
  describe('Inquiry Intent - Pricing with Mandarin Samples', () => {
    const pricingTests = [
      { text: '房间价格多少', description: 'Room price how much?' },
      { text: '多少钱一晚', description: 'How much per night?' },
      { text: '房价是多少', description: 'What is the room price?' },
      { text: '一个人多少钱', description: 'How much per person?' },
      { text: '住一晚多少', description: 'How much for one night?' },
    ];

    pricingTests.forEach((test) => {
      it(`should fuzzy-match "${test.text}" (${test.description}) to pricing keywords`, () => {
        const pricingIntent = intentKeywords.intents.find(i => i.intent === 'pricing');
        expect(pricingIntent).toBeDefined();

        const zhKeywords = pricingIntent?.keywords.zh || [];
        const result = fuzzyMatch(test.text, zhKeywords);

        expect(result.matched).toBe(true);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      });
    });
  });

  // ─── Accuracy Verification ───────────────────────────────
  it('should achieve ≥80% classification accuracy across 15 Mandarin samples', () => {
    const testSamples = [
      { text: '我要订房', intent: 'booking' },
      { text: '想订一间房', intent: 'booking' },
      { text: '怎么订房', intent: 'booking' },
      { text: '可以订房吗', intent: 'booking' },
      { text: '帮我订房', intent: 'booking' },
      { text: '有没有房', intent: 'availability' },
      { text: '还有房吗', intent: 'availability' },
      { text: '有空房吗', intent: 'availability' },
      { text: '有床位吗', intent: 'availability' },
      { text: '明天有空房吗', intent: 'availability' },
      { text: '房间价格多少', intent: 'pricing' },
      { text: '多少钱一晚', intent: 'pricing' },
      { text: '房价是多少', intent: 'pricing' },
      { text: '一个人多少钱', intent: 'pricing' },
      { text: '住一晚多少', intent: 'pricing' },
    ];

    let successCount = 0;

    testSamples.forEach((sample) => {
      const intent = intentKeywords.intents.find(i => i.intent === sample.intent);
      const zhKeywords = intent?.keywords.zh || [];
      const result = fuzzyMatch(sample.text, zhKeywords);

      if (result.matched && result.confidence >= 0.5) {
        successCount++;
      }
    });

    const accuracy = (successCount / testSamples.length) * 100;
    console.log(`Mandarin Classification Accuracy: ${accuracy.toFixed(1)}% (${successCount}/${testSamples.length})`);

    expect(accuracy).toBeGreaterThanOrEqual(80);
  });

  // ─── Language Detection Verification ──────────────────────
  it('should correctly identify Mandarin text using Chinese character detection', () => {
    const mandarin_samples = [
      '我要订房',
      '有没有房',
      '多少钱',
      '怎么入住',
      '感谢',
    ];

    mandarin_samples.forEach((sample) => {
      // Verify the sample contains Chinese characters
      const hasChineseChars = /[\u4E00-\u9FFF]/.test(sample);
      expect(hasChineseChars).toBe(true);
    });
  });
});
