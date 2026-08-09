#!/usr/bin/env tsx
/**
 * US-437: Conversation Replay Debugger CLI for Intent Classification Analysis
 *
 * Replays a conversation from the database, re-running intent classification at each
 * message step to produce detailed debug reports: confidence scores, extracted entities,
 * decision paths, and a summary highlighting confidence drops and intent changes.
 *
 * Usage:
 *   npx tsx src/tools/conversation-replay.ts --phone 60123456789 --profile pelangi
 *   npx tsx src/tools/conversation-replay.ts --phone 60123456789 --profile pelangi --confidence-threshold 0.6 --json
 */

import pg from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoredMessageInfo {
  id: number;
  phone: string;
  role: string;
  content: string;
  timestamp: Date;
  intent: string | null;
  confidence: number | null;
  routedAction: string | null;
  workflowId: string | null;
  stepId: string | null;
  profileId: string;
  model: string | null;
  responseTime: number | null;
  source: string | null;
}

export interface ClassificationStep {
  messageIndex: number;
  messageId: number;
  timestamp: string;
  phone: string;
  content: string;
  // Stored values (from DB)
  storedIntent: string | null;
  storedConfidence: number | null;
  // Re-classified values
  replayedIntent: string;
  replayedConfidence: number;
  replayedEntities: Record<string, string>;
  // Analysis
  confidenceDropped: boolean;
  intentChanged: boolean;
  decisionPath: string[];
  contextSize: number;
}

export interface ConversationReplayReport {
  conversationId: string;
  profile: string;
  totalMessages: number;
  userMessages: number;
  replayedAt: string;
  confidenceThreshold: number;
  steps: ClassificationStep[];
  summary: {
    lowConfidenceIndices: number[];
    intentChangedIndices: number[];
    avgConfidence: number;
    minConfidence: number;
    maxConfidence: number;
  };
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/**
 * Load all messages for a conversation (identified by phone) from rainbow_messages,
 * ordered chronologically.
 */
export async function loadMessagesForConversation(
  conversationId: string,
  profile: string,
  limit = 200
): Promise<StoredMessageInfo[]> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query(
      `SELECT
         id,
         phone,
         role,
         content,
         timestamp,
         intent,
         confidence,
         routed_action   AS "routedAction",
         workflow_id     AS "workflowId",
         step_id         AS "stepId",
         profile_id      AS "profileId",
         model,
         response_time_ms AS "responseTime",
         source
       FROM rainbow_messages
       WHERE phone = $1 AND profile_id = $2
       ORDER BY timestamp ASC
       LIMIT $3`,
      [conversationId, profile, limit]
    );
    return result.rows as StoredMessageInfo[];
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------
// Debug info extraction
// ---------------------------------------------------------------------------

/**
 * Extracts stored debug info from a message row.
 * Returns metadata about what was stored at classification time.
 */
export function parseStoredDebugInfo(msg: StoredMessageInfo): {
  intent: string | null;
  confidence: number | null;
  decisionPath: string[];
} {
  const decisionPath: string[] = [];

  if (msg.routedAction) decisionPath.push(`routed_action=${msg.routedAction}`);
  if (msg.workflowId) decisionPath.push(`workflow=${msg.workflowId}`);
  if (msg.stepId) decisionPath.push(`step=${msg.stepId}`);
  if (msg.source) decisionPath.push(`source=${msg.source}`);
  if (msg.model) decisionPath.push(`model=${msg.model}`);

  return {
    intent: msg.intent,
    confidence: msg.confidence,
    decisionPath,
  };
}

// ---------------------------------------------------------------------------
// Core replay logic
// ---------------------------------------------------------------------------

/**
 * Replay all messages for a conversation, re-running intent classification
 * at each user message step with accumulated context.
 */
export async function replayConversation(
  conversationId: string,
  profile: string,
  confidenceThreshold = 0.6
): Promise<ConversationReplayReport> {
  const messages = await loadMessagesForConversation(conversationId, profile);

  if (messages.length === 0) {
    return {
      conversationId,
      profile,
      totalMessages: 0,
      userMessages: 0,
      replayedAt: new Date().toISOString(),
      confidenceThreshold,
      steps: [],
      summary: {
        lowConfidenceIndices: [],
        intentChangedIndices: [],
        avgConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
      },
    };
  }

  // Lazy-load the classifier (avoids DB/env issues at import time)
  const { classifyIntent } = await import('../assistant/ai-classification.js');

  const steps: ClassificationStep[] = [];
  const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  let userMsgIndex = 0;

  for (const msg of messages) {
    if (msg.role !== 'user') {
      // Accumulate assistant turns for context
      contextMessages.push({ role: 'assistant', content: msg.content });
      continue;
    }

    userMsgIndex++;
    const stored = parseStoredDebugInfo(msg);
    const decisionPath: string[] = [...stored.decisionPath];

    let replayedIntent = 'unknown';
    let replayedConfidence = 0;
    let replayedEntities: Record<string, string> = {};

    try {
      const result = await classifyIntent(msg.content, contextMessages);
      replayedIntent = result.category;
      replayedConfidence = result.confidence;
      replayedEntities = result.entities ?? {};
      decisionPath.push(`replayed_intent=${result.category}`);
      if (result.fallback_used) decisionPath.push('fallback_used=true');
    } catch (err) {
      decisionPath.push(`classify_error=${(err as Error).message}`);
    }

    const confidenceDropped = replayedConfidence < confidenceThreshold;
    const intentChanged =
      stored.intent !== null && stored.intent !== replayedIntent;

    steps.push({
      messageIndex: userMsgIndex,
      messageId: msg.id,
      timestamp: msg.timestamp.toISOString(),
      phone: msg.phone,
      content: msg.content,
      storedIntent: stored.intent,
      storedConfidence: stored.confidence,
      replayedIntent,
      replayedConfidence,
      replayedEntities,
      confidenceDropped,
      intentChanged,
      decisionPath,
      contextSize: contextMessages.length,
    });

    // Accumulate this user message for subsequent turns
    contextMessages.push({ role: 'user', content: msg.content });
  }

  return generateDebugReport(conversationId, profile, messages.length, steps, confidenceThreshold);
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

/**
 * Structures the per-message analysis into a full ConversationReplayReport.
 */
export function generateDebugReport(
  conversationId: string,
  profile: string,
  totalMessages: number,
  steps: ClassificationStep[],
  confidenceThreshold: number
): ConversationReplayReport {
  const lowConfidenceIndices = steps
    .filter(s => s.confidenceDropped)
    .map(s => s.messageIndex);

  const intentChangedIndices = steps
    .filter(s => s.intentChanged)
    .map(s => s.messageIndex);

  const confidences = steps.map(s => s.replayedConfidence);
  const avgConfidence =
    confidences.length > 0
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;
  const minConfidence = confidences.length > 0 ? Math.min(...confidences) : 0;
  const maxConfidence = confidences.length > 0 ? Math.max(...confidences) : 0;

  return {
    conversationId,
    profile,
    totalMessages,
    userMessages: steps.length,
    replayedAt: new Date().toISOString(),
    confidenceThreshold,
    steps,
    summary: {
      lowConfidenceIndices,
      intentChangedIndices,
      avgConfidence,
      minConfidence,
      maxConfidence,
    },
  };
}

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

/**
 * Formats a single classification step for console output.
 */
export function formatClassificationLog(step: ClassificationStep): string {
  const flags: string[] = [];
  if (step.confidenceDropped) flags.push('LOW_CONF');
  if (step.intentChanged) flags.push('INTENT_CHANGED');
  const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

  const entities = Object.keys(step.replayedEntities).length > 0
    ? JSON.stringify(step.replayedEntities)
    : '{}';

  const storedStr = step.storedIntent
    ? `${step.storedIntent}@${(step.storedConfidence ?? 0).toFixed(2)}`
    : 'none';

  return [
    `--- Message #${step.messageIndex} (id=${step.messageId})${flagStr} ---`,
    `  Time     : ${step.timestamp}`,
    `  Content  : ${step.content.substring(0, 120)}`,
    `  Stored   : ${storedStr}`,
    `  Replayed : ${step.replayedIntent} @ ${step.replayedConfidence.toFixed(2)}`,
    `  Entities : ${entities}`,
    `  Path     : ${step.decisionPath.join(' → ')}`,
    `  Context  : ${step.contextSize} prior messages`,
  ].join('\n');
}

/**
 * Formats the full replay report for console output with summary statistics.
 */
export function formatHumanReport(report: ConversationReplayReport): string {
  const lines: string[] = [];

  lines.push('═'.repeat(70));
  lines.push(`CONVERSATION REPLAY REPORT`);
  lines.push(`Conversation : ${report.conversationId}`);
  lines.push(`Profile      : ${report.profile}`);
  lines.push(`Total msgs   : ${report.totalMessages} (${report.userMessages} user)`);
  lines.push(`Replayed at  : ${report.replayedAt}`);
  lines.push(`Threshold    : ${report.confidenceThreshold}`);
  lines.push('═'.repeat(70));
  lines.push('');

  for (const step of report.steps) {
    lines.push(formatClassificationLog(step));
    lines.push('');
  }

  lines.push('═'.repeat(70));
  lines.push('SUMMARY');
  lines.push(`  Avg confidence  : ${report.summary.avgConfidence.toFixed(3)}`);
  lines.push(`  Min confidence  : ${report.summary.minConfidence.toFixed(3)}`);
  lines.push(`  Max confidence  : ${report.summary.maxConfidence.toFixed(3)}`);
  lines.push(
    `  Low confidence  : ${report.summary.lowConfidenceIndices.length} message(s) at index [${report.summary.lowConfidenceIndices.join(', ')}]`
  );
  lines.push(
    `  Intent changed  : ${report.summary.intentChangedIndices.length} message(s) at index [${report.summary.intentChangedIndices.join(', ')}]`
  );
  lines.push('═'.repeat(70));

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  phone: string;
  profile: string;
  confidenceThreshold: number;
  json: boolean;
} {
  let phone = '';
  let profile = '';
  let confidenceThreshold = 0.6;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--phone=')) {
      phone = arg.slice('--phone='.length);
    } else if (arg === '--phone' && argv[i + 1]) {
      phone = argv[++i];
    } else if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length);
    } else if (arg === '--profile' && argv[i + 1]) {
      profile = argv[++i];
    } else if (arg.startsWith('--confidence-threshold=')) {
      confidenceThreshold = parseFloat(arg.slice('--confidence-threshold='.length));
    } else if (arg === '--confidence-threshold' && argv[i + 1]) {
      confidenceThreshold = parseFloat(argv[++i]);
    } else if (arg === '--json') {
      json = true;
    }
  }

  return { phone, profile, confidenceThreshold, json };
}

async function main() {
  const { phone, profile, confidenceThreshold, json } = parseArgs(process.argv.slice(2));

  if (!phone || !profile) {
    console.error('Usage: conversation-replay.ts --phone <number> --profile <profile> [--confidence-threshold <val>] [--json]');
    process.exit(1);
  }

  console.log(`[replay] Loading conversation for phone=${phone} profile=${profile} threshold=${confidenceThreshold}`);

  const report = await replayConversation(phone, profile, confidenceThreshold);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHumanReport(report));
  }
}

// Run CLI if invoked directly
const isMain = process.argv[1]?.endsWith('conversation-replay.ts') ||
               process.argv[1]?.endsWith('conversation-replay.js');
if (isMain) {
  main().catch(err => {
    console.error('Fatal error:', (err as Error).message);
    process.exit(1);
  });
}
