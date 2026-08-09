/**
 * US-393: Multi-Turn Conversation Context Debugger
 *
 * Core module for replaying conversations and generating debug traces.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TurnSnapshot {
  turn: number;
  messageId: number;
  timestamp: string;
  phone: string;
  role: 'user' | 'assistant';
  content: string;

  // Context info
  contextSize: number;
  contextIndices: number[];
  contextMessages: Array<{ id: number; role: string; content: string }>;

  // Classification info
  classifiedIntent: string;
  confidence: number;
  confidencePercentile?: number;
  source: string;

  // Top-3 candidates (if available)
  intentCandidates?: Array<{
    intent: string;
    confidence: number;
    source: string;
  }>;

  // Routing info
  routedAction?: string;
  workflowId?: string;
  stepId?: string;
}

export interface ConversationTrace {
  conversationId: string;
  profile: string;
  phone: string;
  totalTurns: number;
  startedAt: string;
  finishedAt: string;
  turns: TurnSnapshot[];
  summary: {
    highConfidenceCount: number;  // >= 0.8
    mediumConfidenceCount: number; // 0.5-0.8
    lowConfidenceCount: number;    // < 0.5
    routingErrors?: number;
  };
}

export interface Message {
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
}

// ---------------------------------------------------------------------------
// Database queries
// ---------------------------------------------------------------------------

export async function loadConversationMessages(
  phone?: string,
  messageId?: number,
  limit: number = 50,
  profile: string = 'pelangi'
): Promise<Message[]> {
  try {
    const { default: pg } = await import('pg');
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.error('Error: DATABASE_URL not set');
      process.exit(1);
    }

    const client = new pg.Client({ connectionString });
    await client.connect();

    let query = '';
    let params: any[] = [];

    if (phone) {
      // Load all messages for a phone
      query = `
        SELECT
          id,
          phone,
          role,
          content,
          timestamp,
          intent,
          confidence,
          routed_action AS "routedAction",
          workflow_id AS "workflowId",
          step_id AS "stepId",
          profile_id AS "profileId"
        FROM rainbow_messages
        WHERE phone = $1 AND profile_id = $2
        ORDER BY timestamp ASC
        LIMIT $3
      `;
      params = [phone, profile, limit];
    } else if (messageId) {
      // Load from message ID onwards
      query = `
        SELECT
          id,
          phone,
          role,
          content,
          timestamp,
          intent,
          confidence,
          routed_action AS "routedAction",
          workflow_id AS "workflowId",
          step_id AS "stepId",
          profile_id AS "profileId"
        FROM rainbow_messages
        WHERE id >= $1 AND profile_id = $2
        ORDER BY timestamp ASC
        LIMIT $3
      `;
      params = [messageId, profile, limit];
    }

    const result = await client.query(query, params);
    await client.end();

    return result.rows as Message[];
  } catch (err) {
    console.error('Error loading messages from database:', (err as Error).message);
    console.error('Continuing with empty dataset...');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Intent classification replay
// ---------------------------------------------------------------------------

export async function replayConversationTurns(
  messages: Message[],
  profile: string
): Promise<TurnSnapshot[]> {
  // Import the classifier
  const { classifyMessageWithContext } = await import('../assistant/intents.js');

  const turns: TurnSnapshot[] = [];
  const contextWindow: Message[] = [];
  const confidenceScores: number[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Include only user messages in context (max 20)
    if (msg.role === 'user' && contextWindow.length < 20) {
      contextWindow.push(msg);
    }

    // For user messages, classify intent
    if (msg.role === 'user') {
      try {
        // Build context from previous messages (exclude current)
        const contextMessages = contextWindow.slice(0, -1).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp.getTime(),
        }));

        // Classify with context
        const result = await classifyMessageWithContext(
          msg.content,
          contextMessages,
          null, // lastIntent
          undefined, // preferredLanguage
          `${msg.phone}-${msg.id}`
        );

        confidenceScores.push(result.confidence);

        // Calculate percentile
        const sortedScores = [...confidenceScores].sort((a, b) => a - b);
        const percentile = sortedScores.length > 1
          ? sortedScores.indexOf(result.confidence) / (sortedScores.length - 1)
          : 1.0;

        turns.push({
          turn: turns.filter(t => t.role === 'user').length + 1,
          messageId: msg.id,
          timestamp: msg.timestamp.toISOString(),
          phone: msg.phone,
          role: msg.role,
          content: msg.content.substring(0, 200), // Truncate for readability

          contextSize: contextWindow.length,
          contextIndices: contextWindow.map(m => m.id),
          contextMessages: contextWindow.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content.substring(0, 100),
          })),

          classifiedIntent: result.category,
          confidence: result.confidence,
          confidencePercentile: percentile,
          source: result.source,

          intentCandidates: [
            {
              intent: result.category,
              confidence: result.confidence,
              source: result.source,
            },
          ],

          routedAction: msg.routedAction || undefined,
          workflowId: msg.workflowId || undefined,
          stepId: msg.stepId || undefined,
        });
      } catch (err) {
        console.error(`Error classifying message ${msg.id}:`, (err as Error).message);
        turns.push({
          turn: turns.filter(t => t.role === 'user').length + 1,
          messageId: msg.id,
          timestamp: msg.timestamp.toISOString(),
          phone: msg.phone,
          role: msg.role,
          content: msg.content.substring(0, 200),

          contextSize: contextWindow.length,
          contextIndices: contextWindow.map(m => m.id),
          contextMessages: contextWindow.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content.substring(0, 100),
          })),

          classifiedIntent: 'unknown',
          confidence: 0,
          source: 'error',

          routedAction: msg.routedAction || undefined,
          workflowId: msg.workflowId || undefined,
          stepId: msg.stepId || undefined,
        });
      }
    } else {
      // Assistant messages are logged but not classified
      turns.push({
        turn: turns.length + 1,
        messageId: msg.id,
        timestamp: msg.timestamp.toISOString(),
        phone: msg.phone,
        role: msg.role,
        content: msg.content.substring(0, 200),

        contextSize: contextWindow.length,
        contextIndices: contextWindow.map(m => m.id),
        contextMessages: contextWindow.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content.substring(0, 100),
        })),

        classifiedIntent: msg.intent || 'n/a',
        confidence: msg.confidence || 0,
        source: 'stored',

        routedAction: msg.routedAction || undefined,
        workflowId: msg.workflowId || undefined,
        stepId: msg.stepId || undefined,
      });
    }
  }

  return turns;
}

// ---------------------------------------------------------------------------
// Trace generation
// ---------------------------------------------------------------------------

export function buildConversationTrace(
  messages: Message[],
  turns: TurnSnapshot[],
  profile: string,
  startTime: number,
  finishTime: number
): ConversationTrace {
  const summary = {
    highConfidenceCount: turns.filter(t => t.confidence >= 0.8).length,
    mediumConfidenceCount: turns.filter(t => t.confidence >= 0.5 && t.confidence < 0.8).length,
    lowConfidenceCount: turns.filter(t => t.confidence < 0.5).length,
  };

  return {
    conversationId: messages[0].phone,
    profile,
    phone: messages[0].phone,
    totalTurns: turns.length,
    startedAt: new Date(startTime).toISOString(),
    finishedAt: new Date(finishTime).toISOString(),
    turns,
    summary,
  };
}
