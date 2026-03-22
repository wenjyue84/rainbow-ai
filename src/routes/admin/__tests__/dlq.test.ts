/**
 * Dead Letter Queue (DLQ) Admin API Tests (US-055)
 *
 * Tests:
 * - GET /admin/dlq returns paginated list sorted by failed_at descending
 * - POST /admin/dlq/:messageId/retry moves message back to queue with retry_count reset
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { db } from '../../../lib/db.js';
import { deadLetterQueue } from '../../../../shared/schema.js';
import { eq } from 'drizzle-orm';

// Mock Express app for testing
let app: Express;

// Sample test data
const testMessages = [
  {
    id: 'msg-001',
    messageId: 'wa-msg-001',
    guestId: '+6012345678',
    body: 'First test message',
    failureReason: 'Network timeout',
    failedAt: new Date('2026-03-20T10:00:00Z'),
    retryCount: 0,
    profile: 'pelangi',
    expiresAt: new Date('2026-03-27T10:00:00Z'),
  },
  {
    id: 'msg-002',
    messageId: 'wa-msg-002',
    guestId: '+6087654321',
    body: 'Second test message',
    failureReason: 'Message too large',
    failedAt: new Date('2026-03-21T14:30:00Z'),
    retryCount: 1,
    profile: 'southern',
    expiresAt: new Date('2026-03-28T14:30:00Z'),
  },
  {
    id: 'msg-003',
    messageId: 'wa-msg-003',
    guestId: '+6019876543',
    body: 'Third test message',
    failureReason: 'Invalid recipient',
    failedAt: new Date('2026-03-22T09:15:00Z'),
    retryCount: 2,
    profile: 'pelangi',
    expiresAt: new Date('2026-03-29T09:15:00Z'),
  },
];

beforeEach(async () => {
  // Clean up existing test data
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, 'msg-001'));
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, 'msg-002'));
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, 'msg-003'));

  // Insert test data
  for (const msg of testMessages) {
    await db.insert(deadLetterQueue).values(msg);
  }

  // Import and create app
  const { createApp } = await import('../../../index.js');
  app = await createApp();
});

afterEach(async () => {
  // Clean up
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, 'msg-001'));
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, 'msg-002'));
  await db.delete(deadLetterQueue).where(eq(deadLetterQueue.id, 'msg-003'));
});

describe('DLQ Admin API (US-055)', () => {
  describe('GET /admin/dlq', () => {
    it('should return paginated list of DLQ messages', async () => {
      const response = await request(app)
        .get('/admin/dlq')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body).toHaveProperty('messages');
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(20);
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(3);
    });

    it('should return messages sorted by failed_at descending', async () => {
      const response = await request(app)
        .get('/admin/dlq')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      const messages = response.body.messages;

      // Verify messages are sorted descending by failedAt
      if (messages.length > 1) {
        for (let i = 0; i < messages.length - 1; i++) {
          const currentTime = new Date(messages[i].failedAt).getTime();
          const nextTime = new Date(messages[i + 1].failedAt).getTime();
          expect(currentTime).toBeGreaterThanOrEqual(nextTime);
        }
      }
    });

    it('should include required message fields', async () => {
      const response = await request(app)
        .get('/admin/dlq')
        .query({ page: 1, limit: 20 });

      expect(response.status).toBe(200);
      const messages = response.body.messages;

      if (messages.length > 0) {
        const message = messages[0];
        expect(message).toHaveProperty('id');
        expect(message).toHaveProperty('messageId');
        expect(message).toHaveProperty('guestId');
        expect(message).toHaveProperty('body');
        expect(message).toHaveProperty('failureReason');
        expect(message).toHaveProperty('failedAt');
        expect(message).toHaveProperty('retryCount');
        expect(message).toHaveProperty('profile');
        expect(message).toHaveProperty('expiresAt');
      }
    });

    it('should support pagination', async () => {
      const response1 = await request(app)
        .get('/admin/dlq')
        .query({ page: 1, limit: 1 });

      expect(response1.status).toBe(200);
      expect(response1.body.messages.length).toBeLessThanOrEqual(1);
      expect(response1.body.pagination.total).toBeGreaterThanOrEqual(3);
    });
  });

  describe('POST /admin/dlq/:messageId/retry', () => {
    it('should reset retry_count to 0 and return success', async () => {
      const response = await request(app)
        .post('/admin/dlq/msg-001/retry');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('messageId', 'msg-001');

      // Verify the message was updated
      const [updated] = await db
        .select()
        .from(deadLetterQueue)
        .where(eq(deadLetterQueue.id, 'msg-001'));

      expect(updated.retryCount).toBe(0);
    });

    it('should return 404 for non-existent message', async () => {
      const response = await request(app)
        .post('/admin/dlq/non-existent-id/retry');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should reject request without messageId', async () => {
      const response = await request(app)
        .post('/admin/dlq//retry');

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should handle concurrent retries safely', async () => {
      const promises = [
        request(app).post('/admin/dlq/msg-002/retry'),
        request(app).post('/admin/dlq/msg-003/retry'),
      ];

      const responses = await Promise.all(promises);

      expect(responses[0].status).toBe(200);
      expect(responses[1].status).toBe(200);

      // Verify both messages were updated
      const [msg2] = await db
        .select()
        .from(deadLetterQueue)
        .where(eq(deadLetterQueue.id, 'msg-002'));

      const [msg3] = await db
        .select()
        .from(deadLetterQueue)
        .where(eq(deadLetterQueue.id, 'msg-003'));

      expect(msg2.retryCount).toBe(0);
      expect(msg3.retryCount).toBe(0);
    });
  });
});
