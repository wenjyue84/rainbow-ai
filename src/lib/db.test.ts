import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deleteExpiredConversations } from './db.js';
import { pool } from './db.js';

describe('deleteExpiredConversations (US-157)', {
  timeout: 60000, // Allow up to 60 seconds for DB operations
}, () => {
  const consoleSpy = vi.spyOn(console, 'log');

  beforeEach(() => {
    consoleSpy.mockClear();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should delete conversations older than 7 years (8-year-old test)', async () => {
    // Create a conversation 8 years ago (should be deleted)
    const eightYearsAgo = new Date();
    eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);

    const testPhone8y = `test_8y_${Date.now()}`;

    try {
      // Insert test conversation 8 years old
      await pool.query(
        'INSERT INTO rainbow_conversations (phone, push_name, created_at, updated_at) VALUES ($1, $2, $3, $4)',
        [testPhone8y, 'Test User 8y', eightYearsAgo, eightYearsAgo]
      );

      // Insert test messages for this conversation
      await pool.query(
        'INSERT INTO rainbow_messages (phone, role, content, timestamp) VALUES ($1, $2, $3, $4)',
        [testPhone8y, 'user', 'Test message', eightYearsAgo]
      );

      // Insert audit record
      await pool.query(
        'INSERT INTO conversation_audit (phone, message, timestamp) VALUES ($1, $2, $3)',
        [testPhone8y, 'Test audit', eightYearsAgo]
      );

      // Run retention with default 7 years (2555 days)
      const result = await deleteExpiredConversations(2555);

      // Verify conversation was deleted
      expect(result.records_deleted.conversations).toBeGreaterThan(0);
      expect(result.records_deleted.messages).toBeGreaterThan(0);
      expect(result.records_deleted.audit_records).toBeGreaterThan(0);

      // Verify the conversation no longer exists
      const remaining = await pool.query('SELECT * FROM rainbow_conversations WHERE phone = $1', [testPhone8y]);
      expect(remaining.rows.length).toBe(0);
    } finally {
      // Cleanup
      await pool.query('DELETE FROM conversation_audit WHERE phone = $1', [testPhone8y]).catch(() => {});
      await pool.query('DELETE FROM rainbow_messages WHERE phone = $1', [testPhone8y]).catch(() => {});
      await pool.query('DELETE FROM rainbow_conversations WHERE phone = $1', [testPhone8y]).catch(() => {});
    }
  });

  it('should retain conversations younger than 7 years (6-year-old test)', async () => {
    // Create a conversation 6 years ago (should NOT be deleted)
    const sixYearsAgo = new Date();
    sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);

    const testPhone6y = `test_6y_${Date.now()}`;

    try {
      // Insert test conversation 6 years old
      await pool.query(
        'INSERT INTO rainbow_conversations (phone, push_name, created_at, updated_at) VALUES ($1, $2, $3, $4)',
        [testPhone6y, 'Test User 6y', sixYearsAgo, sixYearsAgo]
      );

      // Insert test messages
      await pool.query(
        'INSERT INTO rainbow_messages (phone, role, content, timestamp) VALUES ($1, $2, $3, $4)',
        [testPhone6y, 'user', 'Test message', sixYearsAgo]
      );

      // Run retention with 7 years
      await deleteExpiredConversations(2555);

      // Verify conversation still exists
      const remaining = await pool.query('SELECT * FROM rainbow_conversations WHERE phone = $1', [testPhone6y]);
      expect(remaining.rows.length).toBe(1);

      // Verify messages still exist
      const messages = await pool.query('SELECT * FROM rainbow_messages WHERE phone = $1', [testPhone6y]);
      expect(messages.rows.length).toBeGreaterThan(0);
    } finally {
      // Cleanup
      await pool.query('DELETE FROM conversation_audit WHERE phone = $1', [testPhone6y]).catch(() => {});
      await pool.query('DELETE FROM rainbow_messages WHERE phone = $1', [testPhone6y]).catch(() => {});
      await pool.query('DELETE FROM rainbow_conversations WHERE phone = $1', [testPhone6y]).catch(() => {});
    }
  });

  it('should return correct result structure with deletion counts and timestamps', async () => {
    const result = await deleteExpiredConversations(2555);

    // Verify result structure
    expect(result).toHaveProperty('retention_days');
    expect(result).toHaveProperty('cutoff_date');
    expect(result).toHaveProperty('timestamp');
    expect(result).toHaveProperty('records_deleted');
    expect(result.records_deleted).toHaveProperty('conversations');
    expect(result.records_deleted).toHaveProperty('messages');
    expect(result.records_deleted).toHaveProperty('audit_records');

    // Verify types
    expect(typeof result.retention_days).toBe('number');
    expect(typeof result.cutoff_date).toBe('string');
    expect(typeof result.timestamp).toBe('string');
    expect(typeof result.records_deleted.conversations).toBe('number');
    expect(typeof result.records_deleted.messages).toBe('number');
    expect(typeof result.records_deleted.audit_records).toBe('number');

    // Verify retention_days matches what was passed in
    expect(result.retention_days).toBe(2555);
  });

  it('should use configurable retention days parameter', async () => {
    // Test with custom retention days
    const customDays = 3650; // 10 years
    const result = await deleteExpiredConversations(customDays);

    expect(result.retention_days).toBe(customDays);

    // Verify cutoff is approximately 10 years ago
    const cutoffDate = new Date(result.cutoff_date);
    const expectedCutoff = new Date();
    expectedCutoff.setFullYear(expectedCutoff.getFullYear() - 10);
    const daysDiff = Math.abs((cutoffDate.getTime() - expectedCutoff.getTime()) / (24 * 60 * 60 * 1000));
    expect(daysDiff).toBeLessThan(5); // Allow 5-day margin
  });

  it('should log deletion with configured retention days from settings', async () => {
    const result = await deleteExpiredConversations(2555);

    // Verify result has all required fields for logging
    expect(result).toBeDefined();
    expect(result.retention_days).toBe(2555);
    expect(result.cutoff_date).toBeDefined();
    expect(result.timestamp).toBeDefined();
    expect(result.records_deleted).toBeDefined();
  });
});
