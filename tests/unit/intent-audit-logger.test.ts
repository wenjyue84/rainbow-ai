/**
 * US-239: Intent Classification Decision Audit Logger
 *
 * Verifies:
 * - intent_classification_decisions schema has required fields (id, timestamp,
 *   profile_name, message_hash, classified_intent, confidence_score,
 *   top_3_candidates_json, actual_intent)
 * - Audit entries are created when logClassificationDecision is called
 * - Entries can be queried by profile_name and timestamp range
 * - JSON parsing of top_3_candidates_json works correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB ─────────────────────────────────────────────────────────

const insertedValues: any[] = [];

vi.mock('../../src/lib/db.js', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((vals) => {
        if (Array.isArray(vals)) {
          insertedValues.push(...vals);
        } else {
          insertedValues.push(vals);
        }
        return Promise.resolve();
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  },
}));

// ─── Schema field verification ────────────────────────────────────────

describe('US-239: intent_classification_decisions schema', () => {
  it('should have id field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.id).toBeDefined();
  });

  it('should have timestamp field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.timestamp).toBeDefined();
  });

  it('should have profileName field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.profileName).toBeDefined();
  });

  it('should have messageHash field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.messageHash).toBeDefined();
  });

  it('should have classifiedIntent field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.classifiedIntent).toBeDefined();
  });

  it('should have confidenceScore field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.confidenceScore).toBeDefined();
  });

  it('should have top3CandidatesJson field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.top3CandidatesJson).toBeDefined();
  });

  it('should have actualIntent field on intentClassificationDecisions table', async () => {
    const { intentClassificationDecisions } = await import('../../shared/schema-tables.js');
    expect(intentClassificationDecisions.actualIntent).toBeDefined();
  });
});

// ─── Audit logger unit tests ──────────────────────────────────────────

describe('US-239: logClassificationDecision persistence', () => {
  beforeEach(() => {
    insertedValues.length = 0;
    vi.clearAllMocks();
  });

  it('inserts an audit entry with all required fields', async () => {
    const { logClassificationDecision } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    await logClassificationDecision({
      profileName: 'pelangi',
      messageText: 'I want to book a room',
      classifiedIntent: 'booking_inquiry',
      confidenceScore: 0.92,
      candidates: [
        { intent: 'booking_inquiry', score: 0.92 },
        { intent: 'price_inquiry', score: 0.71 },
        { intent: 'greeting', score: 0.15 },
      ],
    });

    expect(insertedValues.length).toBe(1);
    const entry = insertedValues[0];
    expect(entry.profileName).toBe('pelangi');
    expect(entry.classifiedIntent).toBe('booking_inquiry');
    expect(entry.confidenceScore).toBe(0.92);
    expect(entry.messageHash).toBeDefined();
    expect(typeof entry.messageHash).toBe('string');
    expect(entry.messageHash.length).toBe(16); // SHA-256 truncated
  });

  it('builds top-3 candidates from provided candidates', async () => {
    const { logClassificationDecision } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    await logClassificationDecision({
      profileName: 'southern',
      messageText: 'How much for one night?',
      classifiedIntent: 'price_inquiry',
      confidenceScore: 0.88,
      candidates: [
        { intent: 'price_inquiry', score: 0.88 },
        { intent: 'booking_inquiry', score: 0.65 },
        { intent: 'amenity_inquiry', score: 0.42 },
        { intent: 'greeting', score: 0.10 },
      ],
    });

    expect(insertedValues.length).toBe(1);
    const entry = insertedValues[0];
    const candidates = entry.top3CandidatesJson;
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(3);
    // Should be sorted by score descending
    expect(candidates[0].intent).toBe('price_inquiry');
    expect(candidates[0].score).toBe(0.88);
    expect(candidates[1].intent).toBe('booking_inquiry');
    expect(candidates[2].intent).toBe('amenity_inquiry');
  });

  it('includes classified intent in top-3 even when not in candidates list', async () => {
    const { logClassificationDecision } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    await logClassificationDecision({
      profileName: 'pelangi',
      messageText: 'Hello',
      classifiedIntent: 'greeting',
      confidenceScore: 0.95,
      candidates: [
        { intent: 'booking_inquiry', score: 0.20 },
        { intent: 'price_inquiry', score: 0.10 },
      ],
    });

    const entry = insertedValues[0];
    const candidates = entry.top3CandidatesJson;
    expect(candidates.some((c: any) => c.intent === 'greeting')).toBe(true);
    expect(candidates[0].intent).toBe('greeting'); // highest score
    expect(candidates[0].score).toBe(0.95);
  });

  it('works with no candidates provided (only classified intent)', async () => {
    const { logClassificationDecision } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    await logClassificationDecision({
      profileName: 'makan-moments',
      messageText: 'What is the menu?',
      classifiedIntent: 'menu_inquiry',
      confidenceScore: 0.80,
    });

    expect(insertedValues.length).toBe(1);
    const entry = insertedValues[0];
    const candidates = entry.top3CandidatesJson;
    expect(candidates.length).toBe(1);
    expect(candidates[0].intent).toBe('menu_inquiry');
    expect(candidates[0].score).toBe(0.80);
  });

  it('does not throw on DB error (fire-and-forget)', async () => {
    const { db } = await import('../../src/lib/db.js');
    // Make insert throw
    (db.insert as any).mockReturnValueOnce({
      values: vi.fn().mockRejectedValue(new Error('DB connection failed')),
    });

    const { logClassificationDecision } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    // Should not throw
    await expect(
      logClassificationDecision({
        profileName: 'pelangi',
        messageText: 'test',
        classifiedIntent: 'unknown',
        confidenceScore: 0.1,
      })
    ).resolves.not.toThrow();
  });
});

// ─── Hash function tests ──────────────────────────────────────────────

describe('US-239: hashMessage', () => {
  it('produces consistent 16-char hex hash for the same input', async () => {
    const { hashMessage } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    const hash1 = hashMessage('I want to book a room');
    const hash2 = hashMessage('I want to book a room');

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
    expect(/^[0-9a-f]{16}$/.test(hash1)).toBe(true);
  });

  it('produces different hashes for different inputs', async () => {
    const { hashMessage } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    const hash1 = hashMessage('Hello');
    const hash2 = hashMessage('Goodbye');

    expect(hash1).not.toBe(hash2);
  });
});

// ─── Top-3 candidates builder tests ───────────────────────────────────

describe('US-239: buildTop3Candidates', () => {
  it('sorts candidates by score descending', async () => {
    const { buildTop3Candidates } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    const result = buildTop3Candidates('booking_inquiry', 0.90, [
      { intent: 'greeting', score: 0.30 },
      { intent: 'booking_inquiry', score: 0.90 },
      { intent: 'price_inquiry', score: 0.60 },
    ]);

    expect(result[0].score).toBe(0.90);
    expect(result[1].score).toBe(0.60);
    expect(result[2].score).toBe(0.30);
  });

  it('limits to 3 candidates when more are provided', async () => {
    const { buildTop3Candidates } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    const result = buildTop3Candidates('a', 0.90, [
      { intent: 'a', score: 0.90 },
      { intent: 'b', score: 0.80 },
      { intent: 'c', score: 0.70 },
      { intent: 'd', score: 0.60 },
      { intent: 'e', score: 0.50 },
    ]);

    expect(result.length).toBe(3);
  });

  it('returns only the classified intent when no candidates provided', async () => {
    const { buildTop3Candidates } = await import('../../src/assistant/pipeline/intent-audit-logger.js');

    const result = buildTop3Candidates('greeting', 0.95);

    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ intent: 'greeting', score: 0.95 });
  });
});

// ─── Query simulation: profile_name + timestamp range ─────────────────

describe('US-239: audit entries queryable by profile_name and timestamp range', () => {
  type AuditRecord = {
    id: number;
    timestamp: Date;
    profileName: string;
    messageHash: string;
    classifiedIntent: string;
    confidenceScore: number;
    top3CandidatesJson: any;
    actualIntent: string | null;
  };

  function queryByProfileAndTimestamp(
    records: AuditRecord[],
    profileName: string,
    startDate: Date,
    endDate: Date
  ): AuditRecord[] {
    return records.filter(
      (r) =>
        r.profileName === profileName &&
        r.timestamp >= startDate &&
        r.timestamp <= endDate
    );
  }

  function parseCandidates(record: AuditRecord): Array<{ intent: string; score: number }> {
    const data = record.top3CandidatesJson;
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    return data;
  }

  it('filters records by profile_name and timestamp range', () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    const records: AuditRecord[] = [
      {
        id: 1,
        timestamp: now,
        profileName: 'pelangi',
        messageHash: 'abc123',
        classifiedIntent: 'booking_inquiry',
        confidenceScore: 0.90,
        top3CandidatesJson: [{ intent: 'booking_inquiry', score: 0.90 }],
        actualIntent: null,
      },
      {
        id: 2,
        timestamp: twoHoursAgo,
        profileName: 'pelangi',
        messageHash: 'def456',
        classifiedIntent: 'greeting',
        confidenceScore: 0.95,
        top3CandidatesJson: [{ intent: 'greeting', score: 0.95 }],
        actualIntent: null,
      },
      {
        id: 3,
        timestamp: now,
        profileName: 'southern',
        messageHash: 'ghi789',
        classifiedIntent: 'price_inquiry',
        confidenceScore: 0.85,
        top3CandidatesJson: [{ intent: 'price_inquiry', score: 0.85 }],
        actualIntent: null,
      },
    ];

    // Query pelangi within last 90 minutes — should get record 1 only
    const result = queryByProfileAndTimestamp(records, 'pelangi', oneHourAgo, now);
    expect(result.length).toBe(1);
    expect(result[0].classifiedIntent).toBe('booking_inquiry');
  });

  it('parses top_3_candidates_json correctly', () => {
    const record: AuditRecord = {
      id: 1,
      timestamp: new Date(),
      profileName: 'pelangi',
      messageHash: 'abc123',
      classifiedIntent: 'booking_inquiry',
      confidenceScore: 0.90,
      top3CandidatesJson: JSON.stringify([
        { intent: 'booking_inquiry', score: 0.90 },
        { intent: 'price_inquiry', score: 0.71 },
        { intent: 'greeting', score: 0.15 },
      ]),
      actualIntent: null,
    };

    const candidates = parseCandidates(record);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(3);
    expect(candidates[0].intent).toBe('booking_inquiry');
    expect(candidates[0].score).toBe(0.90);
    expect(candidates[1].intent).toBe('price_inquiry');
    expect(candidates[2].intent).toBe('greeting');
  });

  it('handles top_3_candidates_json as already-parsed object (jsonb column)', () => {
    const record: AuditRecord = {
      id: 1,
      timestamp: new Date(),
      profileName: 'southern',
      messageHash: 'xyz789',
      classifiedIntent: 'amenity_inquiry',
      confidenceScore: 0.82,
      top3CandidatesJson: [
        { intent: 'amenity_inquiry', score: 0.82 },
        { intent: 'booking_inquiry', score: 0.55 },
      ],
      actualIntent: null,
    };

    const candidates = parseCandidates(record);
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBe(2);
    expect(candidates[0].intent).toBe('amenity_inquiry');
  });
});
