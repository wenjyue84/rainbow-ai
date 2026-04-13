/**
 * analyze-message-ordering.ts — CLI tool for message timestamp ordering analysis (US-593)
 *
 * Processes conversation logs from the database and reports:
 * - Percentage of conversations with ordering anomalies
 * - Affected message sequences with details
 *
 * Usage:
 *   npm run analyze:message-ordering
 *   npm run analyze:message-ordering -- --limit 100
 *   npm run analyze:message-ordering -- --conversation-id <phone>
 */

import { validateMessageOrdering } from '../src/lib/message-ordering-validator.js';
import type { ChatMessage } from '../src/assistant/types.js';

// ─── CLI argument parsing ─────────────────────────────────────────────────────

const args = process.argv.slice(2);
let limitArg = 200;
let conversationIdFilter: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit' && args[i + 1]) {
    limitArg = parseInt(args[i + 1], 10) || 200;
    i++;
  }
  if (args[i] === '--conversation-id' && args[i + 1]) {
    conversationIdFilter = args[i + 1];
    i++;
  }
}

// ─── Main analysis ────────────────────────────────────────────────────────────

interface ConversationRecord {
  conversationId: string;
  messages: ChatMessage[];
}

/**
 * Load conversations from the database.
 * Falls back to an empty array if DB is unavailable (e.g., in CI).
 */
async function loadConversations(limit: number, idFilter: string | null): Promise<ConversationRecord[]> {
  let db: any;
  let tables: any;

  try {
    const dbMod = await import('../src/lib/db.js');
    const tableMod = await import('../shared/schema-tables.js');
    db = dbMod.db;
    tables = tableMod;
  } catch {
    console.warn('[analyze:message-ordering] DB unavailable — running in demo mode');
    return generateDemoConversations();
  }

  try {
    const { eq, desc } = await import('drizzle-orm');

    // Fetch recent conversations
    let convQuery = db
      .select({ phone: tables.rainbowConversations.phone })
      .from(tables.rainbowConversations)
      .orderBy(desc(tables.rainbowConversations.lastActiveAt))
      .limit(limit);

    if (idFilter) {
      convQuery = db
        .select({ phone: tables.rainbowConversations.phone })
        .from(tables.rainbowConversations)
        .where(eq(tables.rainbowConversations.phone, idFilter))
        .limit(1);
    }

    const conversations: Array<{ phone: string }> = await convQuery;
    const records: ConversationRecord[] = [];

    for (const conv of conversations) {
      const msgs: Array<{ role: string; content: string; timestamp: number }> = await db
        .select({
          role: tables.rainbowMessages.role,
          content: tables.rainbowMessages.content,
          timestamp: tables.rainbowMessages.timestamp,
        })
        .from(tables.rainbowMessages)
        .where(eq(tables.rainbowMessages.phone, conv.phone))
        .orderBy(tables.rainbowMessages.timestamp);

      if (msgs.length >= 2) {
        records.push({
          conversationId: conv.phone,
          messages: msgs.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
          })),
        });
      }
    }

    return records;
  } catch (err: any) {
    console.warn(`[analyze:message-ordering] DB query failed: ${err.message} — running in demo mode`);
    return generateDemoConversations();
  }
}

/**
 * Generate synthetic demo conversations for testing without a live DB.
 */
function generateDemoConversations(): ConversationRecord[] {
  const now = Math.floor(Date.now() / 1000);
  return [
    {
      conversationId: 'demo_ordered',
      messages: [
        { role: 'user', content: 'Hello', timestamp: now - 300 },
        { role: 'assistant', content: 'Hi! How can I help?', timestamp: now - 290 },
        { role: 'user', content: 'Book a room', timestamp: now - 280 },
        { role: 'assistant', content: 'Sure, what dates?', timestamp: now - 270 },
      ],
    },
    {
      conversationId: 'demo_out_of_order',
      messages: [
        { role: 'user', content: 'Hello', timestamp: now - 300 },
        { role: 'user', content: 'Book a room', timestamp: now - 280 },        // out of order
        { role: 'assistant', content: 'Hi! How can I help?', timestamp: now - 290 }, // timestamp is BEFORE previous
        { role: 'assistant', content: 'Sure, what dates?', timestamp: now - 270 },
      ],
    },
    {
      conversationId: 'demo_simultaneous',
      messages: [
        { role: 'user', content: 'Hi', timestamp: now - 200 },
        { role: 'assistant', content: 'Hello!', timestamp: now - 200 }, // same timestamp
        { role: 'user', content: 'Room?', timestamp: now - 100 },
      ],
    },
    {
      conversationId: 'demo_multi_issue',
      messages: [
        { role: 'user', content: 'Check in tomorrow?', timestamp: now - 500 },
        { role: 'user', content: 'Early check in?', timestamp: now - 400 },
        { role: 'assistant', content: 'Yes.', timestamp: now - 450 }, // between user msgs, timestamp < previous
        { role: 'user', content: 'WiFi password?', timestamp: now - 300 },
        { role: 'assistant', content: 'abc123', timestamp: now - 100 },
      ],
    },
  ];
}

async function main(): Promise<void> {
  console.log('\n=== Message Timestamp Ordering Analyzer (US-593) ===\n');
  console.log(`Loading up to ${limitArg} conversations${conversationIdFilter ? ` (filtered: ${conversationIdFilter})` : ''}...`);

  const conversations = await loadConversations(limitArg, conversationIdFilter);

  if (conversations.length === 0) {
    console.log('No conversations found.');
    process.exit(0);
  }

  console.log(`Analyzed ${conversations.length} conversation(s)\n`);

  let anomalyCount = 0;
  const affectedConversations: Array<{
    conversationId: string;
    issueCount: number;
    simultaneousGroupCount: number;
    sampleIssues: typeof conversations[0]['messages'];
  }> = [];

  for (const conv of conversations) {
    const result = validateMessageOrdering(conv.messages, conv.conversationId);

    if (result.hasOrderingIssues || result.simultaneousGroups.length > 0) {
      anomalyCount++;
      affectedConversations.push({
        conversationId: conv.conversationId,
        issueCount: result.issues.length,
        simultaneousGroupCount: result.simultaneousGroups.length,
        sampleIssues: conv.messages,
      });
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const pct = ((anomalyCount / conversations.length) * 100).toFixed(1);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`SUMMARY`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total conversations analyzed : ${conversations.length}`);
  console.log(`  Conversations with anomalies : ${anomalyCount} (${pct}%)`);
  console.log(`  Conversations without issues : ${conversations.length - anomalyCount}`);

  if (affectedConversations.length > 0) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`AFFECTED CONVERSATIONS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    for (const item of affectedConversations) {
      console.log(`\n  [${item.conversationId}]`);
      if (item.issueCount > 0) {
        console.log(`    Out-of-order messages: ${item.issueCount}`);
      }
      if (item.simultaneousGroupCount > 0) {
        console.log(`    Simultaneous timestamp groups: ${item.simultaneousGroupCount}`);
      }

      // Show affected message sequence (compact)
      const result = validateMessageOrdering(item.sampleIssues, item.conversationId);
      for (const issue of result.issues) {
        const msg = item.sampleIssues[issue.actualIndex];
        const preview = msg.content.slice(0, 40) + (msg.content.length > 40 ? '…' : '');
        console.log(
          `    • ${issue.messageId}: expected pos ${issue.expectedIndex}, actual pos ${issue.actualIndex}` +
          ` | ts=${issue.timestamp} | "${preview}"`
        );
      }
      for (const group of result.simultaneousGroups) {
        console.log(`    ~ simultaneous ts=${group.timestamp}: indices [${group.indices.join(', ')}]`);
      }
    }
  }

  console.log('\n');
  process.exit(0);
}

main().catch(err => {
  console.error('[analyze:message-ordering] Fatal error:', err);
  process.exit(1);
});
