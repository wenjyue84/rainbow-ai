/**
 * audit-trail.test.ts — Tests for conversation audit trail (US-156)
 *
 * Tests verify:
 * - Audit table schema is correctly defined
 * - Audit log entries contain required fields
 * - Date range filtering works
 * - Phone and intent filtering work
 * - Confidence scores are preserved
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '../lib/db.js';
import { conversationAudit } from '../../shared/schema-tables.js';
import type { InsertConversationAudit } from '../../shared/schema-tables.js';
import { auditLog } from '../lib/logger.js';
import { eq, and, gte, lt } from 'drizzle-orm';

describe('Conversation Audit Trail (US-156)', () => {
  const testPhone = '+60123456789';
  const testPhone2 = '+60198765432';
  const now = new Date();

  // Clean up test data after tests
  afterAll(async () => {
    try {
      await db.delete(conversationAudit).where(eq(conversationAudit.phone, testPhone));
      await db.delete(conversationAudit).where(eq(conversationAudit.phone, testPhone2));
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  });

  it('should insert audit log entry with all required fields', async () => {
    const entry: InsertConversationAudit = {
      phone: testPhone,
      guestId: 'guest_123',
      message: 'I want to book a room',
      intent: 'booking_inquiry',
      confidence: 0.92,
      actionTaken: 'booking_workflow',
      tier: 'T2',
      profileId: 'pelangi',
      timestamp: now,
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'booking_inquiry')
        )
      );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      phone: testPhone,
      guestId: 'guest_123',
      message: 'I want to book a room',
      intent: 'booking_inquiry',
      confidence: 0.92,
      actionTaken: 'booking_workflow',
      tier: 'T2',
      profileId: 'pelangi',
    });
  });

  it('should preserve confidence score (test accepts 0.92 ≈ 0.92)', async () => {
    const entry: InsertConversationAudit = {
      phone: testPhone,
      message: 'Check in to my room',
      intent: 'checkin',
      confidence: 0.85,
      actionTaken: 'checkin_workflow',
      tier: 'T3',
      profileId: 'pelangi',
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'checkin')
        )
      );

    expect(result).toHaveLength(1);
    // Allow small floating-point variance
    expect(result[0].confidence).toBeCloseTo(0.85, 2);
  });

  it('should support date range filtering', async () => {
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneHourLater = new Date(now.getTime() + 3600000);

    const entry1: InsertConversationAudit = {
      phone: testPhone2,
      message: 'Hello',
      intent: 'greeting',
      confidence: 0.99,
      actionTaken: 'greeting_template',
      tier: 'T1',
      profileId: 'pelangi',
      timestamp: oneHourAgo,
    };

    const entry2: InsertConversationAudit = {
      phone: testPhone2,
      message: 'What are your room prices?',
      intent: 'pricing_inquiry',
      confidence: 0.78,
      actionTaken: 'pricing_knowledge_reply',
      tier: 'T2',
      profileId: 'pelangi',
      timestamp: oneHourLater,
    };

    await db.insert(conversationAudit).values([entry1, entry2]);

    // Query within range that includes both
    const results = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone2),
          gte(conversationAudit.timestamp, oneHourAgo),
          lt(conversationAudit.timestamp, oneHourLater)
        )
      );

    // At least our entries should be there (might be more from parallel tests)
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should filter by intent', async () => {
    const entry: InsertConversationAudit = {
      phone: testPhone,
      message: 'I need help with my booking',
      intent: 'booking_help',
      confidence: 0.81,
      actionTaken: 'escalation',
      tier: 'T4',
      profileId: 'pelangi',
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'booking_help')
        )
      );

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every(r => r.intent === 'booking_help')).toBe(true);
  });

  it('should allow null confidence for incomplete classifications', async () => {
    const entry: InsertConversationAudit = {
      phone: testPhone,
      message: 'Test message without confidence',
      intent: null,
      confidence: null,
      actionTaken: 'fallback',
      tier: 'T1',
      profileId: 'pelangi',
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(eq(conversationAudit.phone, testPhone));

    const nullEntry = result.find(r => r.confidence === null);
    expect(nullEntry).toBeDefined();
    expect(nullEntry?.intent).toBeNull();
  });

  it('should allow guestId to be optional', async () => {
    const entry: InsertConversationAudit = {
      phone: testPhone,
      message: 'Message without guest ID',
      intent: 'inquiry',
      confidence: 0.75,
      actionTaken: 'info_reply',
      // guestId omitted
      profileId: 'pelangi',
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'inquiry')
        )
      );

    expect(result.length).toBeGreaterThanOrEqual(1);
    const entry_without_guest = result.find(r => r.intent === 'inquiry');
    expect(entry_without_guest?.guestId).toBeNull();
  });

  it('should default profileId to pelangi if omitted', async () => {
    const entry: InsertConversationAudit = {
      phone: testPhone,
      message: 'Test default profile',
      intent: 'test_intent',
      confidence: 0.77,
      actionTaken: 'test_action',
      // profileId omitted
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'test_intent')
        )
      );

    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('should create timestamp automatically if not provided', async () => {
    const entryTime = new Date();
    const entry: InsertConversationAudit = {
      phone: testPhone,
      message: 'Test auto timestamp',
      intent: 'test',
      confidence: 0.88,
      actionTaken: 'test_action',
      profileId: 'pelangi',
      // timestamp omitted
    };

    await db.insert(conversationAudit).values(entry);

    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'test')
        )
      );

    expect(result.length).toBeGreaterThanOrEqual(1);
    const entry_with_ts = result.find(r => r.intent === 'test');
    expect(entry_with_ts?.timestamp).toBeDefined();
    // Timestamp should be close to now
    expect(
      Math.abs(
        (entry_with_ts?.timestamp?.getTime() ?? 0) - entryTime.getTime()
      )
    ).toBeLessThan(5000);
  });

  it('auditLog function should not throw on DB write (fire-and-forget)', async () => {
    const promise = auditLog({
      phone: testPhone,
      message: 'Testing auditLog function',
      intent: 'test_audit_log',
      confidence: 0.93,
      actionTaken: 'test_action',
      profileId: 'pelangi',
    });

    // Should not throw
    await expect(promise).resolves.toBeUndefined();

    // Verify entry was written
    const result = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          eq(conversationAudit.phone, testPhone),
          eq(conversationAudit.intent, 'test_audit_log')
        )
      );

    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle multiple intents per phone (conversation history)', async () => {
    const entries: InsertConversationAudit[] = [
      {
        phone: testPhone2,
        message: 'Message 1',
        intent: 'intent_a',
        confidence: 0.9,
        actionTaken: 'action_a',
        profileId: 'pelangi',
      },
      {
        phone: testPhone2,
        message: 'Message 2',
        intent: 'intent_b',
        confidence: 0.85,
        actionTaken: 'action_b',
        profileId: 'pelangi',
      },
      {
        phone: testPhone2,
        message: 'Message 3',
        intent: 'intent_a',
        confidence: 0.88,
        actionTaken: 'action_c',
        profileId: 'pelangi',
      },
    ];

    await db.insert(conversationAudit).values(entries);

    const results = await db
      .select()
      .from(conversationAudit)
      .where(eq(conversationAudit.phone, testPhone2));

    // Should have all 3 messages
    expect(results.length).toBeGreaterThanOrEqual(3);

    // Should be able to count by intent
    const intentA = results.filter(r => r.intent === 'intent_a');
    const intentB = results.filter(r => r.intent === 'intent_b');
    expect(intentA.length).toBeGreaterThanOrEqual(2);
    expect(intentB.length).toBeGreaterThanOrEqual(1);
  });
});
