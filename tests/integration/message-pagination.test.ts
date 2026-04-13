/**
 * Integration tests for cursor-based message pagination (US-548)
 *
 * Tests:
 * 1. First page returns messages and next_cursor when more exist
 * 2. Subsequent pages use cursor to fetch older messages
 * 3. Last page returns next_cursor = null
 * 4. Query execution is fast (<100ms per call, mocked)
 * 5. Migration SQL file exists with correct index definition
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Cursor-Based Message Pagination (US-548)', () => {
  let pool: any;
  let paginateConversationMessages: any;
  let originalPoolQuery: any;

  beforeEach(async () => {
    const dbModule = await import('../../src/lib/db.js');
    pool = dbModule.pool;
    paginateConversationMessages = dbModule.paginateConversationMessages;
    originalPoolQuery = pool.query?.bind(pool);
  });

  afterEach(() => {
    if (pool && originalPoolQuery) {
      pool.query = originalPoolQuery;
    }
    vi.restoreAllMocks();
  });

  // Build a fake message row
  function makeMsg(id: number, phone = '60123456789') {
    return {
      id,
      phone,
      role: id % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${id}`,
      timestamp: new Date(Date.now() - id * 1000),
      intent: null,
      confidence: null,
      action: null,
      manual: false,
      staff_name: null,
      model: null,
      message_type: null,
      profile_id: 'pelangi',
    };
  }

  it('first page with no cursor returns messages and next_cursor', async () => {
    // limit=3, but we have 4 rows (signals "has more")
    const fakeRows = [makeMsg(100), makeMsg(99), makeMsg(98), makeMsg(97)];
    pool.query = vi.fn().mockResolvedValue({ rows: fakeRows });

    const result = await paginateConversationMessages('60123456789', null, 3);

    expect(result.messages).toHaveLength(3);
    expect(result.next_cursor).toBe('98'); // last message id in the page
    expect(pool.query).toHaveBeenCalledOnce();
  });

  it('page with cursor fetches older messages using keyset', async () => {
    const fakeRows = [makeMsg(50), makeMsg(49)];
    pool.query = vi.fn().mockResolvedValue({ rows: fakeRows });

    const result = await paginateConversationMessages('60123456789', '51', 3);

    expect(result.messages).toHaveLength(2);
    expect(result.next_cursor).toBeNull(); // only 2 rows returned, no more
    const call = (pool.query as any).mock.calls[0];
    expect(call[1]).toContain(51); // cursor id passed to query
  });

  it('last page returns next_cursor = null', async () => {
    const fakeRows = [makeMsg(5), makeMsg(3), makeMsg(1)];
    pool.query = vi.fn().mockResolvedValue({ rows: fakeRows });

    const result = await paginateConversationMessages('60123456789', null, 5);

    expect(result.next_cursor).toBeNull();
    expect(result.messages).toHaveLength(3);
  });

  it('caps limit at 200 to prevent oversized queries', async () => {
    pool.query = vi.fn().mockResolvedValue({ rows: [] });

    await paginateConversationMessages('60123456789', null, 9999);

    const call = (pool.query as any).mock.calls[0];
    // The query should use 201 (200 + 1 sentinel) not 10000
    expect(call[1]).toContain(201);
  });

  it('throws on invalid (non-numeric) cursor', async () => {
    pool.query = vi.fn().mockResolvedValue({ rows: [] });

    await expect(
      paginateConversationMessages('60123456789', 'not-a-number', 10)
    ).rejects.toThrow('Invalid cursor');
  });

  it('query execution time is under 100ms (mocked)', async () => {
    pool.query = vi.fn().mockResolvedValue({ rows: Array.from({ length: 50 }, (_, i) => makeMsg(50 - i)) });

    const start = Date.now();
    await paginateConversationMessages('60123456789', null, 50);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it('response shape matches {messages: [], next_cursor: string | null}', async () => {
    pool.query = vi.fn().mockResolvedValue({ rows: [makeMsg(10)] });

    const result = await paginateConversationMessages('60123456789', null, 50);

    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('next_cursor');
    expect(Array.isArray(result.messages)).toBe(true);
    expect(typeof result.next_cursor === 'string' || result.next_cursor === null).toBe(true);
  });
});

describe('Message Pagination Index Migration (US-548)', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'db/migrations/0003-add-message-pagination-index.sql'
  );

  it('migration SQL file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('migration SQL contains CREATE INDEX for rainbow_messages', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toMatch(/CREATE INDEX/i);
    expect(sql).toMatch(/rainbow_messages/i);
    expect(sql).toMatch(/idx_rainbow_messages_pagination/i);
  });

  it('migration uses IF NOT EXISTS for idempotency', () => {
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    expect(sql).toMatch(/IF NOT EXISTS/i);
  });
});
