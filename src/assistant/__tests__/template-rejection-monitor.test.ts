/**
 * Template Rejection Monitor Tests (US-900)
 *
 * Tests syncTemplateStatuses() transition detection logic.
 * Mocks the Meta template list endpoint and asserts notification fires on REJECTED status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  syncTemplateStatuses,
  fetchMetaTemplates,
  type TemplateTransition,
} from '../../lib/template-rejection-monitor.js';

// ─── Mock DB layer ───────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockSet = vi.fn();
const mockValues = vi.fn();

vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockLimit,
        }),
      }),
    }),
    insert: () => ({
      values: mockValues,
    }),
    update: () => ({
      set: () => ({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
  dbReady: Promise.resolve(true),
}));

vi.mock('../../lib/admin-notifier.js', () => ({
  notifyAdminTemplatePaused: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── Tests ───────────────────────────────────────────────────────────

describe('syncTemplateStatuses — transition detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects APPROVED -> REJECTED transition', async () => {
    // Existing template in DB is APPROVED
    mockLimit.mockResolvedValueOnce([{
      id: 1,
      templateName: 'booking_confirm',
      status: 'APPROVED',
      previousStatus: null,
      rejectedReason: null,
      profileId: 'pelangi',
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    const templates = [{
      name: 'booking_confirm',
      status: 'REJECTED',
      rejected_reason: 'PROMOTIONAL_CONTENT',
    }];

    const transitions = await syncTemplateStatuses(templates, 'pelangi');

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual(expect.objectContaining({
      templateName: 'booking_confirm',
      oldStatus: 'APPROVED',
      newStatus: 'REJECTED',
      rejectedReason: 'PROMOTIONAL_CONTENT',
      profileId: 'pelangi',
    }));
  });

  it('detects APPROVED -> PAUSED transition', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 2,
      templateName: 'welcome_msg',
      status: 'APPROVED',
      previousStatus: null,
      rejectedReason: null,
      profileId: 'pelangi',
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    const transitions = await syncTemplateStatuses(
      [{ name: 'welcome_msg', status: 'PAUSED' }],
      'pelangi',
    );

    expect(transitions).toHaveLength(1);
    expect(transitions[0].newStatus).toBe('PAUSED');
  });

  it('does NOT flag non-rejection transitions (PENDING -> APPROVED)', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 3,
      templateName: 'info_msg',
      status: 'PENDING',
      previousStatus: null,
      rejectedReason: null,
      profileId: 'pelangi',
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    const transitions = await syncTemplateStatuses(
      [{ name: 'info_msg', status: 'APPROVED' }],
      'pelangi',
    );

    expect(transitions).toHaveLength(0);
  });

  it('does NOT flag same-status (no change)', async () => {
    mockLimit.mockResolvedValueOnce([{
      id: 4,
      templateName: 'stable_msg',
      status: 'APPROVED',
      previousStatus: null,
      rejectedReason: null,
      profileId: 'pelangi',
      lastCheckedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    const transitions = await syncTemplateStatuses(
      [{ name: 'stable_msg', status: 'APPROVED' }],
      'pelangi',
    );

    expect(transitions).toHaveLength(0);
  });

  it('inserts new templates without flagging transition', async () => {
    // No existing record
    mockLimit.mockResolvedValueOnce([]);
    mockValues.mockResolvedValueOnce(undefined);

    const transitions = await syncTemplateStatuses(
      [{ name: 'new_template', status: 'APPROVED' }],
      'pelangi',
    );

    expect(transitions).toHaveLength(0);
    expect(mockValues).toHaveBeenCalled();
  });
});

describe('fetchMetaTemplates — API mock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses Meta template list response', async () => {
    const mockResponse = {
      data: [
        { name: 'booking_confirm', status: 'APPROVED' },
        { name: 'welcome_msg', status: 'REJECTED', rejected_reason: 'DUPLICATE_MESSAGE' },
      ],
      paging: {},
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    }));

    const templates = await fetchMetaTemplates('123456', 'test-token');

    expect(templates).toHaveLength(2);
    expect(templates[0].name).toBe('booking_confirm');
    expect(templates[1].status).toBe('REJECTED');
    expect(templates[1].rejected_reason).toBe('DUPLICATE_MESSAGE');

    vi.unstubAllGlobals();
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    }));

    await expect(fetchMetaTemplates('123456', 'bad-token'))
      .rejects.toThrow('Meta API error: 401');

    vi.unstubAllGlobals();
  });
});
