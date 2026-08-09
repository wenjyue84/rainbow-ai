#!/usr/bin/env tsx
/**
 * US-393: Multi-Turn Conversation Context Debugger CLI
 *
 * Interactive CLI to replay conversations turn-by-turn, visualizing context window state,
 * classifier decisions, and routing path at each step to diagnose multi-turn dialogue failures.
 *
 * Usage:
 *   npx tsx src/tools/debug-conversation-cli.ts --message-id <id> --profile data-pelangi
 *   npx tsx src/tools/debug-conversation-cli.ts --phone 60123456789 --profile pelangi [--output trace.json]
 *   npm run debug:conversation -- --phone 60123456789 --profile pelangi
 *
 * Flags:
 *   --message-id <id>    Rainbow message ID (serial integer) to start conversation from
 *   --phone <number>     Phone number to load conversation (alternative to message-id)
 *   --profile <name>     Profile to use for classification (required, e.g., pelangi, makan)
 *   --output <file>      Output JSON file path (default: stdout)
 *   --limit <n>          Max messages to include (default: 50)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadConversationMessages,
  replayConversationTurns,
  buildConversationTrace,
  type ConversationTrace,
} from './debug-conversation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  messageId?: number;
  phone?: string;
  profile: string;
  output?: string;
  limit: number;
} {
  let messageId: number | undefined;
  let phone: string | undefined;
  let profile = '';
  let output: string | undefined;
  let limit = 50;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--message-id' && argv[i + 1]) {
      messageId = parseInt(argv[++i], 10);
    } else if (argv[i] === '--phone' && argv[i + 1]) {
      phone = argv[++i];
    } else if (argv[i] === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (argv[i] === '--output' && argv[i + 1]) {
      output = argv[++i];
    } else if (argv[i] === '--limit' && argv[i + 1]) {
      limit = parseInt(argv[++i], 10);
    }
  }

  if (!profile) {
    console.error('Error: --profile is required');
    console.error('Usage: npx tsx src/tools/debug-conversation-cli.ts --phone 60123456789 --profile pelangi [--output trace.json]');
    process.exit(1);
  }

  if (!messageId && !phone) {
    console.error('Error: either --message-id or --phone is required');
    process.exit(1);
  }

  return { messageId, phone, profile, output, limit };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.error(`Loading conversation...`);
  console.error(`  Profile: ${args.profile}`);
  if (args.phone) console.error(`  Phone: ${args.phone}`);
  if (args.messageId) console.error(`  Message ID: ${args.messageId}`);
  console.error(`  Limit: ${args.limit} messages`);
  console.error('');

  // Load messages
  const messages = await loadConversationMessages(
    args.phone,
    args.messageId,
    args.limit,
    args.profile
  );

  if (messages.length === 0) {
    console.error('No messages found.');
    process.exit(1);
  }

  console.error(`Loaded ${messages.length} messages. Replaying conversation...`);
  const startTime = Date.now();

  // Replay turns
  const turns = await replayConversationTurns(messages, args.profile);

  const finishTime = Date.now();
  console.error(`Replay complete in ${finishTime - startTime}ms.\n`);

  // Build trace
  const trace = buildConversationTrace(messages, turns, args.profile, startTime, finishTime);

  // Output
  const json = JSON.stringify(trace, null, 2);

  if (args.output) {
    const outPath = path.resolve(args.output);
    fs.writeFileSync(outPath, json, 'utf-8');
    console.error(`Trace exported to ${outPath}`);
  } else {
    console.log(json);
  }

  // Print summary
  console.error('\nConversation Summary:');
  console.error(`  Total turns: ${turns.length}`);
  console.error(`  High confidence (≥0.8): ${trace.summary.highConfidenceCount}`);
  console.error(`  Medium confidence (0.5-0.8): ${trace.summary.mediumConfidenceCount}`);
  console.error(`  Low confidence (<0.5): ${trace.summary.lowConfidenceCount}`);
  console.error('');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
