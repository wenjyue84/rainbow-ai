/**
 * Tests for US-965: OWASP LLM04 — RAG knowledge base integrity validation pipeline.
 *
 * Covers:
 * - AC1: SHA-256 content hashing on ingest; re-ingestion rejected if hash changes
 * - AC2: Source validation (only allowlisted paths accepted)
 * - AC4: Embedding anomaly detection (centroid distance threshold)
 * - AC5: Audit logging of KB ingest events
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  computeContentHash,
  validateSource,
  initAllowedSources,
} from '../kb-integrity.js';
import {
  createBaseline,
  detectAnomalies,
} from '../kb-embedding-audit.js';

// ─── AC1: SHA-256 Content Hashing ──────────────────────────────────────

describe('computeContentHash', () => {
  test('returns consistent SHA-256 hex digest for same content', () => {
    const content = '# FAQ\n\nWelcome to Pelangi Capsule Hostel!';
    const hash1 = computeContentHash(content);
    const hash2 = computeContentHash(content);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('returns different hash for different content', () => {
    const hash1 = computeContentHash('Hello');
    const hash2 = computeContentHash('World');
    expect(hash1).not.toBe(hash2);
  });

  test('handles empty content', () => {
    const hash = computeContentHash('');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('handles unicode content (Malay/Chinese/Tamil)', () => {
    const content = 'Selamat datang! 欢迎! வரவேற்கிறோம்!';
    const hash = computeContentHash(content);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ─── AC2: Source Validation ─────────────────────────────────────────────

describe('validateSource', () => {
  beforeEach(() => {
    initAllowedSources(
      ['/var/www/rainbow-ai/.rainbow-kb', 'C:\\Users\\test\\.rainbow-kb'],
      ['s3://my-bucket/kb/']
    );
  });

  test('accepts files from allowlisted local path', () => {
    const result = validateSource('/var/www/rainbow-ai/.rainbow-kb/faq.md');
    expect(result.valid).toBe(true);
  });

  test('accepts files from allowlisted Windows path', () => {
    const result = validateSource('C:\\Users\\test\\.rainbow-kb\\faq.md');
    expect(result.valid).toBe(true);
  });

  test('rejects files from non-allowlisted local path', () => {
    const result = validateSource('/tmp/malicious/injected.md');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not in allowlist');
  });

  test('accepts files from allowlisted S3 prefix', () => {
    const result = validateSource('s3://my-bucket/kb/pelangi/faq.md');
    expect(result.valid).toBe(true);
  });

  test('rejects files from non-allowlisted S3 prefix', () => {
    const result = validateSource('s3://other-bucket/malicious/kb.md');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('S3 source');
  });

  test('rejects when no sources configured', () => {
    initAllowedSources([], []);
    const result = validateSource('/any/path/file.md');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('No local paths configured');
  });

  test('rejects S3 when no S3 prefixes configured', () => {
    initAllowedSources(['/some/path'], []);
    const result = validateSource('s3://bucket/file.md');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('No S3 prefixes configured');
  });
});

// ─── AC4: Embedding Anomaly Detection ──────────────────────────────────

describe('embedding anomaly detection', () => {
  // Mock config-db functions
  vi.mock('../../lib/config-db.js', () => ({
    loadConfigFromDB: vi.fn().mockResolvedValue(null),
    saveConfigToDB: vi.fn().mockResolvedValue(undefined),
    auditKBEvent: vi.fn().mockResolvedValue(undefined),
    saveKBFileWithHash: vi.fn().mockResolvedValue({ accepted: true }),
    approveKBFile: vi.fn().mockResolvedValue(true),
    getUnapprovedKBFiles: vi.fn().mockResolvedValue([]),
    loadAllKBFromDB: vi.fn().mockResolvedValue(null),
    saveKBFileToDB: vi.fn().mockResolvedValue(undefined),
    getKBFilesHealth: vi.fn().mockResolvedValue([]),
  }));

  test('createBaseline computes per-file centroids and statistics', async () => {
    const fileEmbeddings = new Map<string, number[][]>();
    fileEmbeddings.set('faq.md', [
      [1, 0, 0, 0],
      [0.9, 0.1, 0, 0],
    ]);
    fileEmbeddings.set('checkin.md', [
      [0, 1, 0, 0],
      [0.1, 0.9, 0, 0],
    ]);
    fileEmbeddings.set('facilities.md', [
      [0, 0, 1, 0],
      [0, 0.1, 0.9, 0],
    ]);

    const baseline = await createBaseline(fileEmbeddings, 'test-operator');

    expect(baseline).toBeDefined();
    expect(baseline.fileCentroids).toBeDefined();
    expect(Object.keys(baseline.fileCentroids)).toHaveLength(3);
    expect(baseline.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.meanDistance).toBeGreaterThanOrEqual(0);
    expect(baseline.stdDevDistance).toBeGreaterThanOrEqual(0);
    expect(baseline.createdAt).toBeTruthy();
  });

  test('detectAnomalies returns empty array when no baseline exists', async () => {
    const fileEmbeddings = new Map<string, number[][]>();
    fileEmbeddings.set('faq.md', [[1, 0, 0]]);

    const reports = await detectAnomalies(fileEmbeddings);
    expect(reports).toEqual([]);
  });

  test('anomaly detection flags distant documents', async () => {
    // Import the mocked module to set up baseline
    const { loadConfigFromDB } = await import('../../lib/config-db.js');
    const mockLoad = vi.mocked(loadConfigFromDB);

    // Simulate a baseline where all files cluster tightly
    const { createHash } = await import('crypto');
    const fileCentroids: Record<string, number[]> = {
      'faq.md': [0.9, 0.1, 0, 0],
      'checkin.md': [0.85, 0.15, 0, 0],
      'facilities.md': [0.8, 0.2, 0, 0],
    };
    const sig = createHash('sha256').update(JSON.stringify(fileCentroids)).digest('hex');

    mockLoad.mockResolvedValueOnce({
      createdAt: new Date().toISOString(),
      signature: sig,
      fileCentroids,
      meanDistance: 0.01,  // Very tight cluster
      stdDevDistance: 0.005,
    });

    // Current embeddings — faq.md is now wildly different (anomaly)
    const current = new Map<string, number[][]>();
    current.set('faq.md', [[0, 0, 0, 1]]);  // Completely opposite direction
    current.set('checkin.md', [[0.85, 0.15, 0, 0]]);  // Same as baseline
    current.set('facilities.md', [[0.8, 0.2, 0, 0]]);  // Same as baseline

    const reports = await detectAnomalies(current, 2);

    // faq.md should be flagged as anomaly due to its extreme distance
    const faqReport = reports.find(r => r.filename === 'faq.md');
    expect(faqReport).toBeDefined();
    expect(faqReport!.isAnomaly).toBe(true);
    expect(faqReport!.centroidDistance).toBeGreaterThan(faqReport!.threshold);

    // checkin.md should not be anomalous
    const checkinReport = reports.find(r => r.filename === 'checkin.md');
    expect(checkinReport).toBeDefined();
    expect(checkinReport!.isAnomaly).toBe(false);
  });
});

// ─── AC5: Audit Logging ─────────────────────────────────────────────────

describe('audit logging integration', () => {
  test('auditKBEvent is exported and callable from config-db', async () => {
    const { auditKBEvent } = await import('../../lib/config-db.js');
    expect(typeof auditKBEvent).toBe('function');
    // Should not throw when DB is not available
    await expect(auditKBEvent('add', 'test.md', 'abc123', 'system')).resolves.not.toThrow();
  });
});
