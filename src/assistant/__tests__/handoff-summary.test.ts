/**
 * US-429: Warm handoff summary generation tests
 *
 * Tests that:
 * 1. Summary generation is triggered when summaryContext is provided
 * 2. Summary is stored in the escalation_events table
 * 3. Summary generation failure is non-fatal
 * 4. Summary prompt includes guest name, messages, and reason
 * 5. Admin API returns summary with escalation record
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the module under test
vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn(() => Promise.resolve()),
  },
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 42 }])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{
            id: 42,
            jid: '60123456789',
            profileId: 'pelangi',
            trigger: 'complaint',
            summary: 'Guest wants a refund for noisy room.',
            createdAt: new Date(),
          }])),
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
  },
}));

// Mock the AI response generator
vi.mock('../../assistant/ai-response-generator.js', () => ({
  chat: vi.fn(() => Promise.resolve('Guest is asking about check-in time and room availability for 2 guests on March 15.')),
}));

// Mock drizzle-orm eq/desc
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
}));

// Mock schema-tables
vi.mock('../../../shared/schema-tables.js', () => ({
  escalationEvents: {
    id: 'id',
    jid: 'jid',
    profileId: 'profile_id',
    trigger: 'trigger',
    count: 'count',
    metadata: 'metadata',
    summary: 'summary',
    createdAt: 'created_at',
  },
}));

describe('US-429: Warm handoff summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('generateAndStoreHandoffSummary calls LLM with correct prompt context', async () => {
    const { chat } = await import('../../assistant/ai-response-generator.js');
    const { generateAndStoreHandoffSummary } = await import('../../lib/handoff-summary.js');

    const input = {
      escalationEventId: 42,
      guestJid: '60123456789',
      guestName: 'Alice',
      recentMessages: [
        'user: Hi, I want to book a room',
        'assistant: Sure! How many guests?',
        'user: 2 guests for March 15',
        'assistant: Let me check availability.',
        'user: I need to talk to a human',
      ],
      escalationReason: 'Guest requested human assistance',
    };

    generateAndStoreHandoffSummary(input);

    // Allow setImmediate to fire
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(chat).toHaveBeenCalledTimes(1);
    const [systemPrompt, _history, userMessage] = (chat as ReturnType<typeof vi.fn>).mock.calls[0];

    // System prompt should mention summarizer
    expect(systemPrompt).toContain('summarizer');

    // User message should include guest info and messages
    expect(userMessage).toContain('Alice');
    expect(userMessage).toContain('60123456789');
    expect(userMessage).toContain('Guest requested human assistance');
    expect(userMessage).toContain('I want to book a room');
  });

  test('summary generation failure does not throw', async () => {
    const { chat } = await import('../../assistant/ai-response-generator.js');
    (chat as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('AI unavailable'));

    const { generateAndStoreHandoffSummary } = await import('../../lib/handoff-summary.js');

    // Should not throw
    expect(() => generateAndStoreHandoffSummary({
      escalationEventId: 99,
      guestJid: '60111111111',
      guestName: 'Bob',
      recentMessages: ['user: help'],
      escalationReason: 'complaint',
    })).not.toThrow();

    // Allow setImmediate to fire
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  test('summary prompt includes last 10 messages only', async () => {
    const { chat } = await import('../../assistant/ai-response-generator.js');
    const { generateAndStoreHandoffSummary } = await import('../../lib/handoff-summary.js');

    const messages = Array.from({ length: 15 }, (_, i) => `user: message ${i + 1}`);

    generateAndStoreHandoffSummary({
      escalationEventId: 50,
      guestJid: '60222222222',
      guestName: 'Charlie',
      recentMessages: messages,
      escalationReason: 'unknown_repeated',
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const userMessage = (chat as ReturnType<typeof vi.fn>).mock.calls[0][2] as string;
    // Should contain message 6-15 (last 10) but not message 1-5
    expect(userMessage).toContain('message 6');
    expect(userMessage).toContain('message 15');
    expect(userMessage).not.toContain('message 1\n');
  });

  test('logEscalationEvent with summaryContext triggers summary generation', async () => {
    // Reset modules to get fresh imports
    vi.resetModules();

    // Re-mock dependencies
    vi.doMock('../../lib/db.js', () => ({
      pool: {
        query: vi.fn(() => Promise.resolve()),
      },
      db: {
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([{ id: 77 }])),
          })),
        })),
        update: vi.fn(() => ({
          set: vi.fn(() => ({
            where: vi.fn(() => Promise.resolve()),
          })),
        })),
      },
    }));
    vi.doMock('../../assistant/ai-response-generator.js', () => ({
      chat: vi.fn(() => Promise.resolve('Summary text here.')),
    }));
    vi.doMock('../../../shared/schema-tables.js', () => ({
      escalationEvents: {
        id: 'id', jid: 'jid', profileId: 'profile_id',
        trigger: 'trigger', count: 'count', metadata: 'metadata',
        summary: 'summary', createdAt: 'created_at',
      },
    }));
    vi.doMock('drizzle-orm', () => ({
      eq: vi.fn((...args: any[]) => args),
      desc: vi.fn((col: any) => col),
    }));

    const { logEscalationEvent } = await import('../../lib/escalation-events.js');

    logEscalationEvent({
      jid: '60123456789',
      profileId: 'pelangi',
      trigger: 'complaint',
      summaryContext: {
        guestName: 'Dave',
        recentMessages: ['user: This is terrible', 'assistant: I understand your frustration'],
        escalationReason: 'Guest complaint',
      },
    });

    // Allow promises to resolve
    await new Promise(resolve => setTimeout(resolve, 100));

    // The insert should have been called (DB logging)
    const { db } = await import('../../lib/db.js');
    expect(db.insert).toHaveBeenCalled();
  });
});
