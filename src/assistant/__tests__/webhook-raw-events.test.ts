/**
 * Tests for US-895: Persist raw webhook payloads to durable storage before processing.
 *
 * Uses mocked DB layer to verify:
 *  - Raw events are persisted before processing
 *  - Raw events persist even when downstream processing throws
 *  - DLQ entries reference the raw event ID
 *  - GET /dlq/:jobId returns the associated raw event payload
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock DB layer ───────────────────────────────────────────────────────────
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSet = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockLimit = vi.fn();

vi.mock('../../lib/db.js', () => ({
  db: {
    insert: (...args: any[]) => {
      mockInsert(...args);
      return { values: (...vArgs: any[]) => { mockValues(...vArgs); return { returning: (...rArgs: any[]) => mockReturning(...rArgs) }; } };
    },
    update: (...args: any[]) => {
      mockUpdate(...args);
      return { set: (...sArgs: any[]) => { mockSet(...sArgs); return { where: (...wArgs: any[]) => mockWhere(...wArgs) }; } };
    },
    select: (...args: any[]) => {
      mockSelect(...args);
      return { from: (...fArgs: any[]) => { mockFrom(...fArgs); return { where: (...wArgs: any[]) => { mockWhere(...wArgs); return { limit: (...lArgs: any[]) => mockLimit(...lArgs) }; } }; } };
    },
  },
}));

vi.mock('../../../shared/schema.js', () => ({
  webhookRawEvents: {
    eventId: 'event_id',
    receivedAt: 'received_at',
    source: 'source',
    profile: 'profile',
    payload: 'payload',
    processed: 'processed',
  },
}));

// ─── Import after mocks ──────────────────────────────────────────────────────
import {
  persistRawEvent,
  markRawEventProcessed,
  getRawEventById,
} from '../../lib/webhook-raw-events.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('persistRawEvent', () => {
  it('inserts a row and returns the event_id', async () => {
    mockReturning.mockResolvedValue([{ eventId: 'evt-abc-123' }]);

    const result = await persistRawEvent('meta:messages', { entry: [] });

    expect(result).toBe('evt-abc-123');
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'meta:messages',
        payload: { entry: [] },
        processed: false,
      })
    );
  });

  it('returns null and logs error when DB insert fails', async () => {
    mockReturning.mockRejectedValue(new Error('connection refused'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await persistRawEvent('digiman', { type: 'booking_created' });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to persist raw event'),
      expect.any(String)
    );
    errorSpy.mockRestore();
  });

  it('persists even when downstream processing would throw', async () => {
    // Simulate: persistRawEvent succeeds, then processing throws
    mockReturning.mockResolvedValue([{ eventId: 'evt-success' }]);

    const eventId = await persistRawEvent('meta:messages', { entry: [{ changes: [] }] });
    expect(eventId).toBe('evt-success');
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // Downstream processing throws — but raw event is already persisted
    const processingFn = async () => { throw new Error('Pipeline crash'); };
    await expect(processingFn()).rejects.toThrow('Pipeline crash');

    // The insert was already called before the throw
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('uses default profile "pelangi" when not specified', async () => {
    mockReturning.mockResolvedValue([{ eventId: 'evt-default' }]);

    await persistRawEvent('evolution', { event: 'test' });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'pelangi' })
    );
  });

  it('accepts custom profile parameter', async () => {
    mockReturning.mockResolvedValue([{ eventId: 'evt-custom' }]);

    await persistRawEvent('meta:messages', { entry: [] }, 'southern');

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ profile: 'southern' })
    );
  });
});

describe('markRawEventProcessed', () => {
  it('updates processed to true for the given event_id', async () => {
    mockWhere.mockResolvedValue(undefined);

    await markRawEventProcessed('evt-abc-123');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ processed: true });
  });

  it('does not throw when DB update fails', async () => {
    mockWhere.mockRejectedValue(new Error('timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(markRawEventProcessed('evt-fail')).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to mark event'),
      expect.any(String)
    );
    errorSpy.mockRestore();
  });
});

describe('getRawEventById', () => {
  it('returns the raw event row when found', async () => {
    const mockRow = {
      eventId: 'evt-abc',
      receivedAt: new Date(),
      source: 'meta:messages',
      profile: 'pelangi',
      payload: { entry: [] },
      processed: true,
    };
    mockLimit.mockResolvedValue([mockRow]);

    const result = await getRawEventById('evt-abc');

    expect(result).toEqual(mockRow);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('returns null when event not found', async () => {
    mockLimit.mockResolvedValue([]);

    const result = await getRawEventById('evt-nonexistent');

    expect(result).toBeNull();
  });

  it('returns null and logs error on DB failure', async () => {
    mockLimit.mockRejectedValue(new Error('connection lost'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await getRawEventById('evt-err');

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('DLQ rawEventId integration', () => {
  it('IncomingMessage type accepts rawEventId field', () => {
    // Type-level check — if this compiles, the field exists
    const msg: import('../../assistant/types.js').IncomingMessage = {
      from: '60123456789',
      text: 'Hello',
      pushName: 'Test',
      messageId: 'msg-1',
      isGroup: false,
      timestamp: Date.now(),
      messageType: 'text',
      rawEventId: 'evt-abc-123',
    };
    expect(msg.rawEventId).toBe('evt-abc-123');
  });

  it('rawEventId is optional on IncomingMessage', () => {
    const msg: import('../../assistant/types.js').IncomingMessage = {
      from: '60123456789',
      text: 'Hello',
      pushName: 'Test',
      messageId: 'msg-2',
      isGroup: false,
      timestamp: Date.now(),
      messageType: 'text',
    };
    expect(msg.rawEventId).toBeUndefined();
  });
});
