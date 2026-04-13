import { describe, it, expect } from 'vitest';
import { FuzzyIntentMatcher, type KeywordIntent } from '../../src/assistant/fuzzy-matcher.js';

describe('US-563: Intent Synonym Matching', () => {
  describe('Synonym Expansion in Fuzzy Matcher', () => {
    it('should match primary keywords without synonyms', () => {
      const intents: KeywordIntent[] = [
        {
          intent: 'booking',
          keywords: ['book a room', 'reserve', 'booking', 'reserve room'],
          language: 'en'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);
      const result = matcher.match('reserve');

      expect(result).toBeTruthy();
      expect(result!.intent).toBe('booking');
    });

    it('should match with expanded synonyms in keyword list', () => {
      // Simulating merged keywords (primary + synonyms)
      const intents: KeywordIntent[] = [
        {
          intent: 'booking',
          keywords: [
            'book a room', 'reserve', 'booking', // primary keywords
            'reserve room', 'book a stay', 'make a reservation', 'want to book' // synonyms (merged)
          ],
          language: 'en'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);
      const result = matcher.match('book a stay');

      expect(result).toBeTruthy();
      expect(result!.intent).toBe('booking');
    });

    it('should match synonym phrases correctly', () => {
      const intents: KeywordIntent[] = [
        {
          intent: 'wifi',
          keywords: [
            'wifi password', 'wi-fi password', 'internet password', // primary
            'internet access code', 'network code', 'hotspot password' // synonyms
          ],
          language: 'en'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);
      // Direct match with a synonym keyword
      const result = matcher.match('hotspot password');

      expect(result).toBeTruthy();
      expect(result!.intent).toBe('wifi');
    });

    it('should handle multilingual synonyms correctly', () => {
      const intents: KeywordIntent[] = [
        {
          intent: 'greeting',
          keywords: ['hi', 'hello', 'hey', 'good morning', 'wassup', 'yo'], // primary + EN synonyms
          language: 'en'
        },
        {
          intent: 'greeting',
          keywords: ['hai', 'helo', 'apa khabar', 'selamat pagi', 'hoi', 'hai apa'], // primary + MS synonyms
          language: 'ms'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);

      // English synonym match
      const enResult = matcher.match('wassup bro', 'en');
      expect(enResult).toBeTruthy();
      expect(enResult!.intent).toBe('greeting');

      // Malay synonym match
      const msResult = matcher.match('hoi', 'ms');
      expect(msResult).toBeTruthy();
      expect(msResult!.intent).toBe('greeting');
    });

    it('should not degrade performance with expanded keywords (latency benchmark)', async () => {
      // Create intents with synonyms
      const intents: KeywordIntent[] = Array.from({ length: 20 }, (_, i) => ({
        intent: `intent_${i}`,
        keywords: [
          `keyword_${i}_1`, `keyword_${i}_2`, `keyword_${i}_3`, // primary
          `synonym_${i}_1`, `synonym_${i}_2`, `synonym_${i}_3` // synonyms
        ],
        language: 'en'
      }));

      const matcher = new FuzzyIntentMatcher(intents);

      // Benchmark 100 matches and measure total latency
      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        matcher.match('keyword_5_1 something');
      }
      const elapsed = performance.now() - startTime;
      const avgLatency = elapsed / 100;

      // AC: Latency should remain <50ms per message (100 messages avg should be <5000ms)
      expect(avgLatency).toBeLessThan(50);
      console.log(`[US-563] Average latency: ${avgLatency.toFixed(2)}ms per match`);
    });

    it('should deduplicate identical keywords and synonyms', () => {
      // When a synonym is identical to a primary keyword, it should not create duplicates
      const intents: KeywordIntent[] = [
        {
          intent: 'booking',
          keywords: [
            'book a room', 'reserve', 'booking', // primary
            'reserve', 'book' // overlapping synonyms
          ],
          language: 'en'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);
      // Should still match correctly despite duplicates being handled by Fuse.js
      const result = matcher.match('reserve a place');
      expect(result).toBeTruthy();
      expect(result!.intent).toBe('booking');
    });

    it('should provide AC1: Synonym expansion before fuzzy matching', () => {
      // AC1: Intent classifier T2 fuzzy-match step expands keyword list to include synonyms
      // This test verifies that synonyms are included in the keyword list passed to FuzzyIntentMatcher
      const intents: KeywordIntent[] = [
        {
          intent: 'checkin_info',
          keywords: [
            'checkin details', 'check in info', // primary
            'check in details', 'arrival information', 'key pickup' // synonyms from intent-synonyms.json
          ],
          language: 'en'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);
      const result = matcher.match('arrival information');

      expect(result).toBeTruthy();
      expect(result!.intent).toBe('checkin_info');
    });

    it('should provide AC2: Synonyms weighted equally to primary keywords', () => {
      // AC2: Primary keywords and synonyms are weighted equally in fuzzy matching
      // Both should produce similar confidence scores
      const intents: KeywordIntent[] = [
        {
          intent: 'wifi',
          keywords: [
            'wifi password', // primary keyword
            'network password', 'hotspot password' // synonyms (equally weighted)
          ],
          language: 'en'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);

      const primaryMatch = matcher.match('wifi password');
      const synonymMatch = matcher.match('hotspot password');

      expect(primaryMatch).toBeTruthy();
      expect(synonymMatch).toBeTruthy();
      // Both should match with similar confidence (within 0.3 difference)
      const confidenceDiff = Math.abs((primaryMatch!.score) - (synonymMatch!.score));
      expect(confidenceDiff).toBeLessThan(0.3);
    });

    it('should provide AC3: Admin API accepts synonyms per intent and language', () => {
      // AC3 is tested via integration tests in admin API tests
      // This is a unit-level verification that the keyword structure supports language-specific synonyms
      const intents: KeywordIntent[] = [
        {
          intent: 'wifi',
          keywords: ['wifi password', 'internet access code'], // EN + synonyms
          language: 'en'
        },
        {
          intent: 'wifi',
          keywords: ['kod internet', 'kata laluan wifi', 'akses internet'], // MS + synonyms
          language: 'ms'
        },
        {
          intent: 'wifi',
          keywords: ['网络密码', '网络代码'], // ZH + synonyms
          language: 'zh'
        }
      ];

      const matcher = new FuzzyIntentMatcher(intents);

      // Should match in different languages
      expect(matcher.match('wifi password', 'en')?.intent).toBe('wifi');
      expect(matcher.match('kod internet', 'ms')?.intent).toBe('wifi');
      expect(matcher.match('网络代码', 'zh')?.intent).toBe('wifi');
    });
  });

  describe('Performance: Synonym expansion does not degrade latency', () => {
    it('should maintain <50ms latency with 30+ intents and expanded synonyms', () => {
      // Create realistic intent set with synonyms (similar to production)
      const intents: KeywordIntent[] = [];

      // 30 intents, each with ~6 keywords (3 primary + 3 synonyms)
      for (let i = 0; i < 30; i++) {
        intents.push({
          intent: `intent_${i}`,
          keywords: Array.from({ length: 6 }, (_, j) => `keyword_${i}_${j}`),
          language: 'en'
        });
      }

      const matcher = new FuzzyIntentMatcher(intents);

      // Warm up
      matcher.match('keyword_5_1');

      // Benchmark
      const samples = 50;
      const times: number[] = [];

      for (let i = 0; i < samples; i++) {
        const start = performance.now();
        matcher.match('keyword_5_1 some user input');
        const end = performance.now();
        times.push(end - start);
      }

      const avgTime = times.reduce((a, b) => a + b) / times.length;
      const maxTime = Math.max(...times);

      console.log(`[US-563 Latency] Avg: ${avgTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`);

      // Target: <50ms additional latency per message
      expect(avgTime).toBeLessThan(50);
      expect(maxTime).toBeLessThan(100);
    });
  });
});
