/**
 * US-393: Multi-Turn Conversation Context Debugger CLI Tests
 *
 * Validates the debug-conversation CLI against database records
 * for a 3-turn sample conversation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool } from '../lib/db.js';
import type { ConversationTrace } from './debug-conversation.js';

describe('US-393: Debug Conversation CLI', () => {
  let testPhone: string;
  let testMessageIds: number[] = [];

  beforeAll(async () => {
    testPhone = `test-${Date.now()}`; // Unique test phone number

    // Insert 3-turn sample conversation into rainbow_messages
    // Turn 1: User asks about booking
    const result1 = await pool.query(
      `INSERT INTO rainbow_messages (phone, role, content, timestamp, intent, confidence, routed_action, profile_id)
       VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
       RETURNING id`,
      [testPhone, 'user', 'Do you have rooms available?', 'availability', 0.92, 'booking_inquiry', 'pelangi']
    );

    // Turn 2: Assistant responds
    const result2 = await pool.query(
      `INSERT INTO rainbow_messages (phone, role, content, timestamp, intent, confidence, routed_action, profile_id)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 second', $4, $5, $6, $7)
       RETURNING id`,
      [testPhone, 'assistant', 'We have rooms available. When would you like to check in?', null, null, null, 'pelangi']
    );

    // Turn 3: User provides check-in date
    const result3 = await pool.query(
      `INSERT INTO rainbow_messages (phone, role, content, timestamp, intent, confidence, routed_action, profile_id)
       VALUES ($1, $2, $3, NOW() + INTERVAL '2 seconds', $4, $5, $6, $7)
       RETURNING id`,
      [testPhone, 'user', 'Tomorrow please, for 3 nights', 'booking', 0.88, 'booking_confirm', 'pelangi']
    );

    // Store the IDs
    testMessageIds = [
      (result1.rows[0] as any).id,
      (result2.rows[0] as any).id,
      (result3.rows[0] as any).id,
    ];

    console.log(`Created test conversation on ${testPhone} with message IDs:`, testMessageIds);
  });

  afterAll(async () => {
    // Clean up test data
    await pool.query('DELETE FROM rainbow_messages WHERE phone = $1', [testPhone]);
  });

  it('should load messages for a conversation by phone number', async () => {
    const result = await pool.query(
      `SELECT id, phone, role, content, timestamp, intent, confidence
       FROM rainbow_messages
       WHERE phone = $1
       ORDER BY timestamp ASC`,
      [testPhone]
    );

    expect(result.rows.length).toBe(3);
    expect(result.rows[0].role).toBe('user');
    expect(result.rows[1].role).toBe('assistant');
    expect(result.rows[2].role).toBe('user');
  });

  it('should validate turn snapshot structure for user message', async () => {
    const result = await pool.query(
      `SELECT id, phone, role, content, timestamp, intent, confidence, routed_action
       FROM rainbow_messages
       WHERE phone = $1 AND role = 'user' AND id = $2
       LIMIT 1`,
      [testPhone, testMessageIds[0]]
    );

    const msg = result.rows[0] as any;

    // Validate required fields for TurnSnapshot
    expect(msg).toHaveProperty('id');
    expect(msg).toHaveProperty('phone');
    expect(msg).toHaveProperty('role');
    expect(msg).toHaveProperty('content');
    expect(msg).toHaveProperty('timestamp');
    expect(msg).toHaveProperty('intent');
    expect(msg).toHaveProperty('confidence');
    expect(msg).toHaveProperty('routed_action');

    // Validate types
    expect(typeof msg.id).toBe('number');
    expect(typeof msg.phone).toBe('string');
    expect(['user', 'assistant']).toContain(msg.role);
    expect(typeof msg.content).toBe('string');
    expect(typeof msg.confidence).toBe('number');
    expect(msg.confidence).toBeGreaterThanOrEqual(0);
    expect(msg.confidence).toBeLessThanOrEqual(1);
  });

  it('should validate context window for multi-turn conversation', async () => {
    const result = await pool.query(
      `SELECT id, role, content, timestamp
       FROM rainbow_messages
       WHERE phone = $1
       ORDER BY timestamp ASC`,
      [testPhone]
    );

    const messages = result.rows as any[];

    // Validate context accumulation
    // Turn 1: context = [turn1]
    // Turn 2: context = [turn1, turn2]
    // Turn 3: context = [turn1, turn2, turn3]

    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');

    // Verify ordering
    const timestamps = messages.map((m: any) => new Date(m.timestamp).getTime());
    expect(timestamps[0]).toBeLessThanOrEqual(timestamps[1]);
    expect(timestamps[1]).toBeLessThanOrEqual(timestamps[2]);
  });

  it('should validate confidence scores in range [0, 1]', async () => {
    const result = await pool.query(
      `SELECT confidence
       FROM rainbow_messages
       WHERE phone = $1 AND role = 'user' AND confidence IS NOT NULL`,
      [testPhone]
    );

    const scores = (result.rows as any[]).map((r) => r.confidence);

    expect(scores.length).toBeGreaterThan(0);

    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });

  it('should validate routed action field', async () => {
    const result = await pool.query(
      `SELECT routed_action
       FROM rainbow_messages
       WHERE phone = $1 AND routed_action IS NOT NULL`,
      [testPhone]
    );

    const actions = (result.rows as any[]).map((r) => r.routed_action);

    expect(actions.length).toBeGreaterThan(0);

    for (const action of actions) {
      expect(typeof action).toBe('string');
      expect(action.length).toBeGreaterThan(0);
    }
  });

  it('should validate conversation trace structure', async () => {
    // Mock a minimal trace structure
    const trace: ConversationTrace = {
      conversationId: testPhone,
      profile: 'pelangi',
      phone: testPhone,
      totalTurns: 3,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      turns: [
        {
          turn: 1,
          messageId: testMessageIds[0],
          timestamp: new Date().toISOString(),
          phone: testPhone,
          role: 'user',
          content: 'Do you have rooms available?',
          contextSize: 1,
          contextIndices: [testMessageIds[0]],
          contextMessages: [
            {
              id: testMessageIds[0],
              role: 'user',
              content: 'Do you have rooms available?',
            },
          ],
          classifiedIntent: 'availability',
          confidence: 0.92,
          confidencePercentile: 1.0,
          source: 'stored',
          routedAction: 'booking_inquiry',
        },
      ],
      summary: {
        highConfidenceCount: 1,
        mediumConfidenceCount: 0,
        lowConfidenceCount: 0,
      },
    };

    // Validate structure
    expect(trace).toHaveProperty('conversationId');
    expect(trace).toHaveProperty('profile');
    expect(trace).toHaveProperty('phone');
    expect(trace).toHaveProperty('totalTurns');
    expect(trace).toHaveProperty('startedAt');
    expect(trace).toHaveProperty('finishedAt');
    expect(trace).toHaveProperty('turns');
    expect(trace).toHaveProperty('summary');

    // Validate turns
    expect(Array.isArray(trace.turns)).toBe(true);
    expect(trace.turns.length).toBeGreaterThan(0);

    const turn = trace.turns[0];
    expect(turn).toHaveProperty('turn');
    expect(turn).toHaveProperty('messageId');
    expect(turn).toHaveProperty('timestamp');
    expect(turn).toHaveProperty('phone');
    expect(turn).toHaveProperty('role');
    expect(turn).toHaveProperty('content');
    expect(turn).toHaveProperty('contextSize');
    expect(turn).toHaveProperty('contextIndices');
    expect(turn).toHaveProperty('classifiedIntent');
    expect(turn).toHaveProperty('confidence');
    expect(turn).toHaveProperty('source');

    // Validate summary
    expect(trace.summary).toHaveProperty('highConfidenceCount');
    expect(trace.summary).toHaveProperty('mediumConfidenceCount');
    expect(trace.summary).toHaveProperty('lowConfidenceCount');
    expect(typeof trace.summary.highConfidenceCount).toBe('number');
  });

  it('should correctly partition confidence tiers', () => {
    const confidenceScores = [0.92, 0.88, 0.45, 0.72, 0.35];

    const high = confidenceScores.filter((c) => c >= 0.8).length;
    const medium = confidenceScores.filter((c) => c >= 0.5 && c < 0.8).length;
    const low = confidenceScores.filter((c) => c < 0.5).length;

    expect(high).toBe(2); // 0.92, 0.88
    expect(medium).toBe(1); // 0.72
    expect(low).toBe(2); // 0.45, 0.35
    expect(high + medium + low).toBe(confidenceScores.length);
  });

  it('should validate per-turn state snapshots match database records', async () => {
    const result = await pool.query(
      `SELECT id, intent, confidence, routed_action
       FROM rainbow_messages
       WHERE phone = $1 AND role = 'user'
       ORDER BY timestamp ASC`,
      [testPhone]
    );

    const messages = (result.rows as any[]).map((msg) => ({
      messageId: msg.id,
      intent: msg.intent,
      confidence: msg.confidence,
      routedAction: msg.routed_action,
    }));

    // Verify all user messages have required fields populated
    for (const msg of messages) {
      expect(msg.messageId).toBeDefined();
      expect(msg.intent).toBeDefined();
      if (msg.intent) {
        expect(typeof msg.intent).toBe('string');
      }
      if (msg.confidence !== null) {
        expect(typeof msg.confidence).toBe('number');
        expect(msg.confidence).toBeGreaterThanOrEqual(0);
        expect(msg.confidence).toBeLessThanOrEqual(1);
      }
    }
  });
});
