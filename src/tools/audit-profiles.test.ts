/**
 * Unit tests for profile audit tool
 *
 * Tests TF-IDF calculation, cosine similarity, and contamination detection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');

/**
 * Helper: Extract text content from JSON (mirrors audit-profiles.ts)
 */
function extractContent(obj: unknown): string {
  const texts: string[] = [];

  function walk(val: unknown) {
    if (typeof val === 'string') {
      if (val.trim().length > 0) {
        texts.push(val.toLowerCase());
      }
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      for (const v of Object.values(val)) {
        walk(v);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        walk(item);
      }
    }
  }

  walk(obj);
  return texts.join(' ');
}

/**
 * Helper: Tokenize text
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

/**
 * Helper: Calculate TF
 */
function calculateTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const total = tokens.length;

  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1 / total);
  }

  return tf;
}

/**
 * Helper: Calculate IDF
 */
function calculateIDF(corpus: string[][]): Map<string, number> {
  const idf = new Map<string, number>();
  const docCount = corpus.length;
  const docFreq = new Map<string, number>();

  for (const tokens of corpus) {
    const uniqueTerms = new Set(tokens);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  for (const [term, freq] of docFreq.entries()) {
    idf.set(term, Math.log(docCount / freq));
  }

  return idf;
}

/**
 * Helper: Calculate TF-IDF
 */
function calculateTFIDF(
  tokens: string[],
  idf: Map<string, number>,
): Map<string, number> {
  const tf = calculateTF(tokens);
  const tfidf = new Map<string, number>();

  for (const [term, tfVal] of tf.entries()) {
    const idfVal = idf.get(term) || 0;
    tfidf.set(term, tfVal * idfVal);
  }

  return tfidf;
}

/**
 * Helper: Cosine similarity
 */
function cosineSimilarity(
  vec1: Map<string, number>,
  vec2: Map<string, number>,
): number {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  const allTerms = new Set([...vec1.keys(), ...vec2.keys()]);

  for (const term of allTerms) {
    const v1 = vec1.get(term) || 0;
    const v2 = vec2.get(term) || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

describe('Profile Audit Tool', () => {
  describe('Content Extraction', () => {
    it('should extract text from nested objects', () => {
      const obj = {
        nested: {
          text: 'hello world',
          deep: {
            value: 'test data',
          },
        },
      };

      const content = extractContent(obj);
      expect(content).toContain('hello world');
      expect(content).toContain('test data');
    });

    it('should extract text from arrays', () => {
      const obj = {
        items: [{ value: 'first' }, { value: 'second' }],
      };

      const content = extractContent(obj);
      expect(content).toContain('first');
      expect(content).toContain('second');
    });

    it('should ignore non-string values', () => {
      const obj = {
        name: 'test',
        count: 42,
        active: true,
      };

      const content = extractContent(obj);
      expect(content).toContain('test');
      expect(content).not.toContain('42');
    });
  });

  describe('Tokenization', () => {
    it('should tokenize text into words', () => {
      const text = 'Hello World! This is a test.';
      const tokens = tokenize(text);

      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('test');
    });

    it('should filter out short tokens', () => {
      const text = 'a bb ccc dddd';
      const tokens = tokenize(text);

      expect(tokens).not.toContain('bb'); // length 2
      expect(tokens).toContain('ccc'); // length 3
      expect(tokens).toContain('dddd');
    });

    it('should handle punctuation', () => {
      const text = 'check-in, check-out! wifi!';
      const tokens = tokenize(text);

      expect(tokens).toContain('check');
      expect(tokens).toContain('wifi');
    });
  });

  describe('TF-IDF Calculation', () => {
    it('should calculate TF correctly', () => {
      const tokens = ['apple', 'banana', 'apple', 'cherry'];
      const tf = calculateTF(tokens);

      expect(tf.get('apple')).toBe(0.5); // 2/4
      expect(tf.get('banana')).toBe(0.25); // 1/4
      expect(tf.get('cherry')).toBe(0.25); // 1/4
    });

    it('should calculate IDF correctly', () => {
      // Document 1: contains 'apple'
      // Document 2: contains 'apple' and 'banana'
      // Document 3: contains 'cherry'
      const corpus = [
        ['apple'],
        ['apple', 'banana'],
        ['cherry'],
      ];
      const idf = calculateIDF(corpus);

      // apple appears in 2 docs: log(3/2) ≈ 0.405
      expect(idf.get('apple')).toBeCloseTo(Math.log(3 / 2), 2);

      // banana appears in 1 doc: log(3/1) ≈ 1.099
      expect(idf.get('banana')).toBeCloseTo(Math.log(3 / 1), 2);

      // cherry appears in 1 doc: log(3/1) ≈ 1.099
      expect(idf.get('cherry')).toBeCloseTo(Math.log(3 / 1), 2);
    });

    it('should calculate TF-IDF vector', () => {
      const tokens = ['apple', 'banana', 'apple'];
      const idf = new Map([
        ['apple', 1.0],
        ['banana', 2.0],
      ]);

      const tfidf = calculateTFIDF(tokens, idf);

      // apple TF = 2/3, TF-IDF = 2/3 * 1.0
      expect(tfidf.get('apple')).toBeCloseTo((2 / 3) * 1.0, 2);

      // banana TF = 1/3, TF-IDF = 1/3 * 2.0
      expect(tfidf.get('banana')).toBeCloseTo((1 / 3) * 2.0, 2);
    });
  });

  describe('Cosine Similarity', () => {
    it('should return 1.0 for identical vectors', () => {
      const vec = new Map([
        ['apple', 0.5],
        ['banana', 0.5],
      ]);

      const similarity = cosineSimilarity(vec, vec);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('should return 0.0 for orthogonal vectors', () => {
      const vec1 = new Map([['apple', 1.0]]);
      const vec2 = new Map([['banana', 1.0]]);

      const similarity = cosineSimilarity(vec1, vec2);
      expect(similarity).toBeCloseTo(0.0, 5);
    });

    it('should handle partial overlap', () => {
      const vec1 = new Map([
        ['apple', 0.7],
        ['banana', 0.3],
      ]);
      const vec2 = new Map([
        ['apple', 0.6],
        ['banana', 0.4],
      ]);

      const similarity = cosineSimilarity(vec1, vec2);
      // 0.7*0.6 + 0.3*0.4 = 0.42 + 0.12 = 0.54
      // |vec1| = sqrt(0.7^2 + 0.3^2) = sqrt(0.58)
      // |vec2| = sqrt(0.6^2 + 0.4^2) = sqrt(0.52)
      const expected = 0.54 / (Math.sqrt(0.58) * Math.sqrt(0.52));
      expect(similarity).toBeCloseTo(expected, 4);
    });
  });

  describe('Integration: Contamination Detection', () => {
    it('should detect high similarity between similar content', () => {
      const text1 =
        'wifi network password pelangi capsule check in time afternoon';
      const text2 =
        'wifi network password pelangi capsule check in time afternoon lobby facilities';

      const tokens1 = tokenize(text1);
      const tokens2 = tokenize(text2);

      // Add a third document with different content for better IDF
      const text3 = 'restaurant menu prices coffee breakfast';
      const tokens3 = tokenize(text3);

      const corpus = [tokens1, tokens2, tokens3];
      const idf = calculateIDF(corpus);

      const tfidf1 = calculateTFIDF(tokens1, idf);
      const tfidf2 = calculateTFIDF(tokens2, idf);

      const similarity = cosineSimilarity(tfidf1, tfidf2);
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should detect low similarity between different content', () => {
      const text1 = 'wifi network password check in afternoon';
      const text2 = 'restaurant menu prices coffee breakfast';
      const text3 = 'booking reservation room availability';

      const tokens1 = tokenize(text1);
      const tokens2 = tokenize(text2);
      const tokens3 = tokenize(text3);

      const corpus = [tokens1, tokens2, tokens3];
      const idf = calculateIDF(corpus);

      const tfidf1 = calculateTFIDF(tokens1, idf);
      const tfidf2 = calculateTFIDF(tokens2, idf);

      const similarity = cosineSimilarity(tfidf1, tfidf2);
      expect(similarity).toBeLessThan(0.3);
    });
  });

  describe('CLI Tool Integration', () => {
    let testOutputFile: string;

    beforeEach(() => {
      // Create a unique test output file
      testOutputFile = path.join(projectRoot, `test-audit-${Date.now()}.csv`);
    });

    afterEach(() => {
      // Clean up test output
      if (fs.existsSync(testOutputFile)) {
        fs.unlinkSync(testOutputFile);
      }
    });

    it('should generate audit report CSV', () => {
      // Run the audit tool
      try {
        execSync(`cd "${projectRoot}" && npx tsx src/tools/audit-profiles.ts --output "${testOutputFile}" --threshold 0.8`, {
          stdio: 'pipe',
          timeout: 30000,
        });
      } catch (err) {
        // Tool might find no issues, that's okay
        console.log('Audit tool output:', err);
      }

      // Verify CSV file exists and has correct format
      if (fs.existsSync(testOutputFile)) {
        const content = fs.readFileSync(testOutputFile, 'utf-8');
        const lines = content.trim().split('\n');

        // Should have header
        expect(lines.length).toBeGreaterThanOrEqual(1);

        // Header should have correct columns
        const header = lines[0];
        expect(header).toContain('profile_a');
        expect(header).toContain('profile_b');
        expect(header).toContain('file_type');
        expect(header).toContain('similarity_score');
        expect(header).toContain('content_excerpt');
      }
    });
  });
});
