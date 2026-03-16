/**
 * Tests for US-1010: Malaysia PDPA 2025 — Right to refuse automated AI decisions
 * and request human review.
 *
 * Acceptance criteria:
 * AC1: When AI makes a material action, disclosure message is sent to the user
 * AC2: Users can type 'human' (or variants) to request human review
 * AC3: Audit log records decision type, confidence score, human review requested, outcome
 * AC4: Disclosure message is templated and editable per profile
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

// vi.mock is hoisted — use vi.hoisted() to declare mockQuery before hoisting
const { mockQuery } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  return { mockQuery };
});

vi.mock('../../lib/db.js', () => ({
  pool: {
    query: mockQuery,
  },
  db: {},
}));

// ─── Import under test ───────────────────────────────────────────────────────

import {
  isHumanReviewRequest,
  getDisclosureTemplate,
  saveDisclosureTemplate,
  logAiDecision,
  updateAiDecisionOutcome,
  getAiDecisionAuditLog,
  getAiDecisionStats,
  MATERIAL_DECISION_TYPES,
  DEFAULT_DISCLOSURE_TEMPLATE,
} from '../../lib/ai-decision-disclosure.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-1010: AI Decision Disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: table ensure queries succeed
    mockQuery.mockResolvedValue({ rows: [] });
  });

  // ── AC1: Material decision types ─────────────────────────────────────────

  describe('MATERIAL_DECISION_TYPES', () => {
    it('includes booking as a material decision', () => {
      expect(MATERIAL_DECISION_TYPES.has('booking')).toBe(true);
    });

    it('includes escalation as a material decision', () => {
      expect(MATERIAL_DECISION_TYPES.has('escalation')).toBe(true);
    });

    it('includes order_confirmation as a material decision', () => {
      expect(MATERIAL_DECISION_TYPES.has('order_confirmation')).toBe(true);
    });

    it('includes menu_recommendation as a material decision', () => {
      expect(MATERIAL_DECISION_TYPES.has('menu_recommendation')).toBe(true);
    });

    it('does not mark non-material decisions (e.g. general_query) as material', () => {
      expect(MATERIAL_DECISION_TYPES.has('general_query')).toBe(false);
    });
  });

  // ── AC2: Human review request detection ─────────────────────────────────

  describe('isHumanReviewRequest()', () => {
    it('detects exact "human" keyword', () => {
      expect(isHumanReviewRequest('human')).toBe(true);
    });

    it('detects "human " with trailing content', () => {
      expect(isHumanReviewRequest('human please')).toBe(true);
    });

    it('detects "staff" keyword', () => {
      expect(isHumanReviewRequest('staff')).toBe(true);
    });

    it('detects "agent" keyword', () => {
      expect(isHumanReviewRequest('agent')).toBe(true);
    });

    it('detects "person" keyword', () => {
      expect(isHumanReviewRequest('person')).toBe(true);
    });

    it('detects Malay "manusia" keyword', () => {
      expect(isHumanReviewRequest('manusia')).toBe(true);
    });

    it('detects Malay "orang" keyword', () => {
      expect(isHumanReviewRequest('orang')).toBe(true);
    });

    it('detects quick-reply payload REQUEST_HUMAN_REVIEW', () => {
      expect(isHumanReviewRequest('', 'REQUEST_HUMAN_REVIEW')).toBe(true);
    });

    it('does not match unrelated messages', () => {
      expect(isHumanReviewRequest('I want to book a room')).toBe(false);
    });

    it('does not match partial keyword embedded in word', () => {
      // "humanity" should NOT trigger — starts with "human" but there's no space after
      expect(isHumanReviewRequest('humanity')).toBe(false);
    });

    it('is case-insensitive', () => {
      expect(isHumanReviewRequest('HUMAN')).toBe(true);
      expect(isHumanReviewRequest('Staff')).toBe(true);
    });
  });

  // ── AC3: Audit log ────────────────────────────────────────────────────────

  describe('logAiDecision()', () => {
    it('inserts an audit record and returns ID', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 42 }] });

      const id = await logAiDecision({
        profileId: 'pelangi',
        phone: '+60123456789',
        decisionType: 'booking',
        intent: 'booking_inquiry',
        confidenceScore: 0.92,
        aiProvider: 'nvidia-kimi',
        disclosureSent: true,
        metadata: { roomType: 'mixed' },
      });

      expect(id).toBe(42);
      // Ensure an INSERT was called
      const insertCall = mockQuery.mock.calls.find(([q]) =>
        typeof q === 'string' && q.includes('INSERT INTO ai_decision_audit')
      );
      expect(insertCall).toBeDefined();
    });

    it('records confidence score in the audit record', async () => {
      mockQuery.mockResolvedValue({ rows: [{ id: 7 }] });

      await logAiDecision({
        profileId: 'pelangi',
        phone: '+60123456789',
        decisionType: 'escalation',
        confidenceScore: 0.75,
        disclosureSent: false,
      });

      const insertCall = mockQuery.mock.calls.find(([q]) =>
        typeof q === 'string' && q.includes('INSERT INTO ai_decision_audit')
      );
      expect(insertCall).toBeDefined();
      // Check confidence score is in params (index 4 = confidence_score)
      const params = insertCall![1] as unknown[];
      expect(params[4]).toBe(0.75);
    });

    it('returns 0 on DB error (non-fatal)', async () => {
      // First call (ensureTable) succeeds, second (INSERT) fails
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX 1
        .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX 2
        .mockResolvedValueOnce({ rows: [] }) // CREATE INDEX 3
        .mockRejectedValueOnce(new Error('DB error'));

      const id = await logAiDecision({
        profileId: 'pelangi',
        phone: '+60123456789',
        decisionType: 'booking',
      });
      expect(id).toBe(0);
    });
  });

  describe('updateAiDecisionOutcome()', () => {
    it('updates outcome to human_review with human_review_requested = true', async () => {
      await updateAiDecisionOutcome(42, 'human_review', true);

      const updateCall = mockQuery.mock.calls.find(([q]) =>
        typeof q === 'string' && q.includes('UPDATE ai_decision_audit')
      );
      expect(updateCall).toBeDefined();
      const params = updateCall![1] as unknown[];
      expect(params[0]).toBe('human_review');
      expect(params[1]).toBe(true);
      expect(params[2]).toBe(42);
    });

    it('updates outcome to accepted without changing human_review_requested', async () => {
      await updateAiDecisionOutcome(10, 'accepted');

      const updateCall = mockQuery.mock.calls.find(([q]) =>
        typeof q === 'string' && q.includes('UPDATE ai_decision_audit')
      );
      expect(updateCall).toBeDefined();
      const params = updateCall![1] as unknown[];
      expect(params[0]).toBe('accepted');
      expect(params[1]).toBeUndefined(); // humanReviewRequested not passed
    });

    it('is a no-op when id is 0', async () => {
      await updateAiDecisionOutcome(0, 'accepted');
      // No DB calls should have been made
      const updateCall = mockQuery.mock.calls.find(([q]) =>
        typeof q === 'string' && q.includes('UPDATE ai_decision_audit')
      );
      expect(updateCall).toBeUndefined();
    });
  });

  // ── AC4: Disclosure template management ─────────────────────────────────

  describe('getDisclosureTemplate()', () => {
    it('returns profile-specific template when configured', async () => {
      const customTemplate = 'Custom disclosure for Pelangi Capsule';
      // Table ensure + profile-specific SELECT returns a result
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE (skipped — already ensured)
        .mockResolvedValueOnce({ rows: [{ value: customTemplate }] }); // SELECT profile template

      const template = await getDisclosureTemplate('pelangi');
      expect(template).toBe(customTemplate);
    });

    it('falls back to generic template when profile-specific not found', async () => {
      const genericTemplate = 'Generic AI disclosure message';
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // SELECT profile template — no result
        .mockResolvedValueOnce({ rows: [{ value: genericTemplate }] }); // SELECT generic

      const template = await getDisclosureTemplate('pelangi');
      expect(template).toBe(genericTemplate);
    });

    it('falls back to DEFAULT_DISCLOSURE_TEMPLATE when no DB records', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // SELECT profile template — no result
        .mockResolvedValueOnce({ rows: [] }); // SELECT generic — no result

      const template = await getDisclosureTemplate('unknown_profile');
      expect(template).toBe(DEFAULT_DISCLOSURE_TEMPLATE);
    });
  });

  describe('saveDisclosureTemplate()', () => {
    it('upserts template into app_settings', async () => {
      await saveDisclosureTemplate('pelangi', 'My custom template');

      const upsertCall = mockQuery.mock.calls.find(([q]) =>
        typeof q === 'string' && q.includes('INSERT INTO app_settings')
      );
      expect(upsertCall).toBeDefined();
      const params = upsertCall![1] as string[];
      expect(params[0]).toBe('ai_disclosure_template_pelangi');
      expect(params[1]).toBe('My custom template');
    });
  });

  describe('DEFAULT_DISCLOSURE_TEMPLATE', () => {
    it('contains "AI" to identify automated decision', () => {
      expect(DEFAULT_DISCLOSURE_TEMPLATE.toLowerCase()).toContain('ai');
    });

    it('instructs user to reply "human" for review', () => {
      expect(DEFAULT_DISCLOSURE_TEMPLATE.toLowerCase()).toContain('human');
    });
  });

  // ── Audit query ───────────────────────────────────────────────────────────

  describe('getAiDecisionAuditLog()', () => {
    it('returns mapped records from DB', async () => {
      const mockRow = {
        id: 1, profile_id: 'pelangi', phone: '+60123456789',
        decision_type: 'booking', intent: 'booking_inquiry',
        confidence_score: 0.9, ai_provider: 'nvidia-kimi',
        human_review_requested: false, outcome: 'accepted',
        disclosure_sent_at: new Date(), review_requested_at: null,
        resolved_at: new Date(), metadata: null, created_at: new Date(),
      };
      mockQuery.mockResolvedValue({ rows: [mockRow] });

      const records = await getAiDecisionAuditLog({ profileId: 'pelangi' });
      expect(records).toHaveLength(1);
      expect(records[0].decisionType).toBe('booking');
      expect(records[0].confidenceScore).toBe(0.9);
      expect(records[0].humanReviewRequested).toBe(false);
    });

    it('returns empty array on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));
      const records = await getAiDecisionAuditLog({ profileId: 'pelangi' });
      expect(records).toEqual([]);
    });
  });

  describe('getAiDecisionStats()', () => {
    it('calculates human review rate correctly', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ total: '10', human_review: '3' }] })
        .mockResolvedValueOnce({ rows: [
          { decision_type: 'booking', count: '6' },
          { decision_type: 'escalation', count: '4' },
        ] });

      const stats = await getAiDecisionStats('pelangi');
      expect(stats.total).toBe(10);
      expect(stats.humanReviewRequested).toBe(3);
      expect(stats.humanReviewRate).toBe(0.3);
      expect(stats.byDecisionType.booking).toBe(6);
      expect(stats.byDecisionType.escalation).toBe(4);
    });

    it('returns zero stats on DB error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));
      const stats = await getAiDecisionStats('pelangi');
      expect(stats.total).toBe(0);
      expect(stats.humanReviewRate).toBe(0);
    });
  });
});
