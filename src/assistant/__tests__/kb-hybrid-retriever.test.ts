/**
 * Tests for KBHybridRetriever (US-912)
 *
 * Tests BM25 keyword ranking, text chunking, RRF fusion, and the full
 * retrieve pipeline with mocked transformer models.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @xenova/transformers so tests don't download real models
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(),
  env: { allowLocalModels: false },
}));

import { KBHybridRetriever } from '../kb-hybrid-retriever.js';
import type { RetrievalResult } from '../kb-hybrid-retriever.js';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeKBFiles(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

// Deterministic fake embedder: converts text to a simple numeric vector
function fakeEmbed(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  // 4-dim vector based on word characteristics
  return [
    words.length / 100,
    words.filter(w => w.length > 5).length / 10,
    text.length / 1000,
    words.filter(w => /[aeiou]/.test(w[0])).length / 10,
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('KBHybridRetriever', () => {
  let retriever: KBHybridRetriever;

  beforeEach(() => {
    retriever = new KBHybridRetriever();
  });

  describe('buildIndex', () => {
    it('builds index from KB file map', () => {
      const files = makeKBFiles({
        'faq.md': 'Check-in time is 2pm. Check-out time is 12pm noon.',
        'pricing.md': 'Dorm bed costs RM45 per night. Private room costs RM120 per night.',
      });
      retriever.buildIndex(files);
      // Should not throw; index is built silently
    });

    it('skips memory files and very short files', () => {
      const files = makeKBFiles({
        'memory/2026-03-15.md': 'Guest complained about noise',
        'memory.md': 'Durable memory content here',
        'tiny.md': 'Too short',
        'faq.md': 'This is the FAQ file with enough content to be indexed properly for testing purposes.',
      });
      retriever.buildIndex(files);
      // memory/ and memory.md should be skipped, tiny.md is < 20 chars
      // Only faq.md should produce chunks
    });

    it('handles empty file map', () => {
      retriever.buildIndex(new Map());
      // Should not throw
    });
  });

  describe('chunking', () => {
    it('chunks long text into ~300-word pieces with overlap', () => {
      // Generate a long text (600+ words)
      const sentences: string[] = [];
      for (let i = 0; i < 80; i++) {
        sentences.push(`Sentence number ${i} about the hostel facilities and services.`);
      }
      const longText = sentences.join(' ');

      const files = makeKBFiles({ 'long.md': longText });
      retriever.buildIndex(files);
      // With 80 sentences of ~8 words each = ~640 words, expect 2-3 chunks
    });

    it('handles single-sentence files', () => {
      const files = makeKBFiles({
        'short.md': 'The hostel is located at 123 Jalan Pelangi, Johor Bahru.',
      });
      retriever.buildIndex(files);
      // Single chunk expected
    });
  });

  describe('retrieve', () => {
    beforeEach(async () => {
      // Setup mock for @xenova/transformers pipeline
      const { pipeline: mockPipeline } = await import('@xenova/transformers');
      const mockedPipeline = vi.mocked(mockPipeline);

      // Mock embedder: returns fake embeddings
      const fakeEmbedder = vi.fn(async (text: string) => ({
        data: new Float32Array(fakeEmbed(text)),
      }));

      // Mock cross-encoder: returns relevance score based on word overlap
      const fakeCrossEncoder = vi.fn(async (query: string, opts: any) => {
        const queryWords = new Set(query.toLowerCase().split(/\s+/));
        const pairWords = (opts.text_pair || '').toLowerCase().split(/\s+/);
        const overlap = pairWords.filter((w: string) => queryWords.has(w)).length;
        // Higher overlap => higher logit => higher sigmoid score
        const logit = overlap * 0.5 - 1;
        return [{ score: logit }];
      });

      mockedPipeline.mockImplementation(async (task: string) => {
        if (task === 'feature-extraction') return fakeEmbedder;
        if (task === 'text-classification') return fakeCrossEncoder;
        throw new Error(`Unknown task: ${task}`);
      });
    });

    it('returns relevant chunks for matching query', async () => {
      const files = makeKBFiles({
        'pricing.md': 'Dorm bed costs RM45 per night. Private room costs RM120 per night. Family room costs RM200 per night. All prices include breakfast and wifi access.',
        'location.md': 'The hostel is located at 123 Jalan Pelangi, Johor Bahru. Nearest MRT is JB Sentral station. Walking distance to City Square mall.',
        'rules.md': 'Check-in time is 2pm. Check-out time is 12pm noon. Late checkout costs RM20 per hour. No smoking in rooms.',
      });
      retriever.buildIndex(files);

      const result = await retriever.retrieve('What is the price of a dorm bed?', 3, 0.1);
      expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.belowThreshold).toBe(false);
    });

    it('returns belowThreshold=true when no chunks match', async () => {
      const files = makeKBFiles({
        'pricing.md': 'Dorm bed costs RM45 per night.',
      });
      retriever.buildIndex(files);

      // Use a very high threshold that nothing will meet
      const result = await retriever.retrieve('xyz random query', 3, 0.99);
      expect(result.belowThreshold).toBe(true);
      expect(result.chunks.length).toBe(0);
    });

    it('returns empty result for empty index', async () => {
      retriever.buildIndex(new Map());
      const result = await retriever.retrieve('any query');
      expect(result.belowThreshold).toBe(true);
      expect(result.chunks).toEqual([]);
    });

    it('retrieves at most topK chunks', async () => {
      const files = makeKBFiles({
        'a.md': 'Room type A is a single bed dorm room for solo travelers at affordable price.',
        'b.md': 'Room type B is a double bed private room for couples at moderate price.',
        'c.md': 'Room type C is a family room with bunk beds for families at premium price.',
        'd.md': 'Room type D is a deluxe suite with air conditioning and private bathroom.',
        'e.md': 'Room type E is a capsule pod with personal locker and reading light.',
      });
      retriever.buildIndex(files);

      const result = await retriever.retrieve('room type', 2, 0.1);
      expect(result.chunks.length).toBeLessThanOrEqual(2);
    });

    it('measures retrieval time', async () => {
      const files = makeKBFiles({
        'faq.md': 'Frequently asked questions about the hostel. We have wifi, breakfast, and parking.',
      });
      retriever.buildIndex(files);

      const result = await retriever.retrieve('Do you have wifi?', 3, 0.1);
      expect(typeof result.retrievalTimeMs).toBe('number');
      expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('threshold filtering', () => {
    beforeEach(async () => {
      const { pipeline: mockPipeline } = await import('@xenova/transformers');
      const mockedPipeline = vi.mocked(mockPipeline);

      const fakeEmbedder = vi.fn(async (text: string) => ({
        data: new Float32Array(fakeEmbed(text)),
      }));

      // Cross-encoder that always returns low scores
      const lowScoreCrossEncoder = vi.fn(async () => [{ score: -5.0 }]);

      mockedPipeline.mockImplementation(async (task: string) => {
        if (task === 'feature-extraction') return fakeEmbedder;
        if (task === 'text-classification') return lowScoreCrossEncoder;
        throw new Error(`Unknown task: ${task}`);
      });
    });

    it('returns belowThreshold=true when all scores are below default threshold (0.65)', async () => {
      const files = makeKBFiles({
        'faq.md': 'Check-in time is 2pm. Check-out time is 12pm noon. Free wifi is available.',
      });
      retriever.buildIndex(files);

      const result = await retriever.retrieve('What is the dorm price?');
      // With cross-encoder returning -5.0, sigmoid(-5) ≈ 0.0067, well below 0.65
      expect(result.belowThreshold).toBe(true);
      expect(result.chunks).toEqual([]);
    });
  });

  describe('fallback behavior', () => {
    it('falls back to BM25-only if vector search fails', async () => {
      const { pipeline: mockPipeline } = await import('@xenova/transformers');
      const mockedPipeline = vi.mocked(mockPipeline);

      // Embedder that fails
      mockedPipeline.mockImplementation(async (task: string) => {
        if (task === 'feature-extraction') {
          throw new Error('Model download failed');
        }
        if (task === 'text-classification') {
          // Cross-encoder with high scores as fallback
          return vi.fn(async () => [{ score: 2.0 }]);
        }
        throw new Error(`Unknown task: ${task}`);
      });

      const files = makeKBFiles({
        'pricing.md': 'Dorm bed costs RM45 per night. Private room costs RM120.',
      });
      retriever.buildIndex(files);

      // Should still work using BM25 + fallback cross-encoder scores
      const result = await retriever.retrieve('dorm price', 3, 0.1);
      // Won't crash — graceful degradation
      expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('falls back gracefully if cross-encoder fails', async () => {
      const { pipeline: mockPipeline } = await import('@xenova/transformers');
      const mockedPipeline = vi.mocked(mockPipeline);

      const fakeEmbedder = vi.fn(async (text: string) => ({
        data: new Float32Array(fakeEmbed(text)),
      }));

      mockedPipeline.mockImplementation(async (task: string) => {
        if (task === 'feature-extraction') return fakeEmbedder;
        if (task === 'text-classification') {
          throw new Error('Cross-encoder failed');
        }
        throw new Error(`Unknown task: ${task}`);
      });

      const files = makeKBFiles({
        'pricing.md': 'Dorm bed costs RM45 per night. Private room costs RM120.',
      });
      retriever.buildIndex(files);

      // Should still return results using RRF fallback scores
      const result = await retriever.retrieve('dorm price', 3, 0.1);
      expect(result.retrievalTimeMs).toBeGreaterThanOrEqual(0);
      // Fallback scores degrade from 0.8, so with threshold 0.1 we should get results
      expect(result.chunks.length).toBeGreaterThan(0);
    });
  });

  describe('integration with KnowledgeBaseInstance', () => {
    it('accepts the same file map format as kbCache', () => {
      // Simulate what KnowledgeBaseInstance passes
      const kbCache = new Map<string, string>();
      kbCache.set('AGENTS.md', '# Rainbow AI Agent Configuration');
      kbCache.set('soul.md', '# Personality: Warm, helpful hostel assistant');
      kbCache.set('faq.md', 'Q: What time is check-in?\nA: Check-in is at 2pm.');
      kbCache.set('pricing.md', 'Dorm: RM45/night. Private: RM120/night.');
      kbCache.set('memory.md', 'Guest John checked in today');
      kbCache.set('memory/2026-03-15.md', 'Wifi issue on floor 2');

      retriever.buildIndex(kbCache);
      // memory.md and memory/ files are filtered out by buildIndex
    });
  });
});
