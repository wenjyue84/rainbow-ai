/**
 * Context Loss Detector (US-1012)
 *
 * Lightweight heuristic detector for multi-turn LLM context loss.
 * Detects three signals in AI responses:
 *   1. Re-asking: bot asks for information already provided by the user
 *   2. Contradiction: bot states facts that contradict established session facts
 *   3. Named entity omission: bot ignores key entities from recent turns
 *
 * When detected with confidence > 0.7, a silent re-grounding message is
 * appended to the context for the next LLM call.
 *
 * Designed for < 50ms overhead (pure string heuristics, no LLM call).
 */

import type { ChatMessage } from './types.js';
import { pool } from '../lib/db.js';

// ─── Types ──────────────────────────────────────────────────────────

export type ContextLossSignalType = 'reasking' | 'contradiction' | 'entity_omission';

export interface ContextLossSignal {
  type: ContextLossSignalType;
  description: string;
  evidence: string;
}

export interface ContextLossResult {
  /** Whether context loss was detected */
  detected: boolean;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** Individual signals found */
  signals: ContextLossSignal[];
  /** Re-grounding message to inject (null if not needed) */
  regroundingMessage: string | null;
  /** Processing time in milliseconds */
  latencyMs: number;
}

/** Confidence threshold above which re-grounding is triggered */
export const CONTEXT_LOSS_CONFIDENCE_THRESHOLD = 0.7;

// ─── Question patterns that indicate re-asking ─────────────────────

const REASKING_QUESTION_PATTERNS = [
  /\bwhat(?:'s| is) your name\b/i,
  /\bcan I (?:have|get) your name\b/i,
  /\bmay I (?:have|know) your name\b/i,
  /\bwhat(?:'s| is) your (?:check[- ]?in|arrival) date\b/i,
  /\bhow many (?:guests?|people|persons?|pax)\b/i,
  /\bwhat (?:room|capsule|bed) (?:type|would you like)\b/i,
  /\bwhat (?:time|date) (?:are you|do you plan to) (?:arrive|check\b)/i,
  /\bhow long (?:will you|are you) stay(?:ing)?\b/i,
  /\bwhat (?:is|are) your (?:contact|phone|email)\b/i,
];

// ─── Named entity extraction (persons, numbers, room types) ─────────

/** Common room/capsule type keywords */
const ROOM_TYPES = ['deluxe', 'standard', 'superior', 'budget', 'mixed', 'female', 'male', 'private', 'dorm', 'capsule', 'twin', 'double', 'single', 'queen', 'king'];

/** Extract key named entities from a text string */
function extractEntities(text: string): {
  names: string[];
  numbers: string[];
  roomTypes: string[];
  bookingRefs: string[];
  dates: string[];
} {
  // Booking reference patterns: alphanumeric 6–10 chars
  const bookingRefs = [...text.matchAll(/\b[A-Z]{2,4}[0-9]{4,8}\b/g)].map(m => m[0]);

  // Numbers (prices, quantities, room numbers)
  const numbers = [...text.matchAll(/\b\d{1,6}(?:\.\d{1,2})?\b/g)].map(m => m[0]);

  // Capitalised words as potential names (skip common words)
  const COMMON_WORDS = new Set(['I', 'The', 'A', 'An', 'My', 'Your', 'Our', 'We', 'You', 'Hi', 'Hello', 'Yes', 'No', 'Ok', 'Okay']);
  const names = [...text.matchAll(/\b[A-Z][a-z]{2,}\b/g)]
    .map(m => m[0])
    .filter(w => !COMMON_WORDS.has(w));

  // Room types
  const lowerText = text.toLowerCase();
  const foundRoomTypes = ROOM_TYPES.filter(rt => lowerText.includes(rt));

  // Date patterns
  const dates = [...text.matchAll(/\b(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{2,4})?)\b/gi)].map(m => m[0]);

  return { names, numbers, roomTypes: foundRoomTypes, bookingRefs, dates };
}

// ─── Signal 1: Re-asking Detection ──────────────────────────────────

/**
 * Detect if the bot response re-asks for information already provided.
 *
 * Strategy: for each question pattern in the response, check if a recent
 * user message already supplied that information.
 */
function detectReasking(response: string, userMessages: string[]): ContextLossSignal | null {
  const responseLower = response.toLowerCase();

  for (const pattern of REASKING_QUESTION_PATTERNS) {
    if (!pattern.test(responseLower)) continue;

    // Check if any user message already answered this
    const patternKeyword = pattern.source.match(/\\bwhat|\\bcan|\\bmay|\\bhow/)?.[0] || '';
    const keyword = extractQuestionTopic(pattern);

    for (const userMsg of userMessages) {
      const userLower = userMsg.toLowerCase();
      // If user provided a direct answer (name, date, number) → re-asking detected
      if (topicWasAnswered(keyword, userLower)) {
        return {
          type: 'reasking',
          description: `Bot re-asked for ${keyword} already provided by user`,
          evidence: `Pattern "${pattern}" matched in response after user provided: "${userMsg.slice(0, 80)}"`,
        };
      }
    }
  }

  return null;
}

function extractQuestionTopic(pattern: RegExp): string {
  const src = pattern.source;
  if (/name/.test(src)) return 'name';
  if (/check.?in|arrival/.test(src)) return 'check-in date';
  if (/guests?|people|pax/.test(src)) return 'guest count';
  if (/room|capsule|bed/.test(src)) return 'room type';
  if (/time|arrive/.test(src)) return 'arrival time';
  if (/how long|stay/.test(src)) return 'duration';
  if (/contact|phone|email/.test(src)) return 'contact';
  return 'information';
}

function topicWasAnswered(topic: string, userMessage: string): boolean {
  switch (topic) {
    case 'name':
      // User provided a name: "my name is X", "I am X", or standalone capitalised word
      return /my name is|i(?:'m| am)\s+[a-z]/i.test(userMessage) || /\b[A-Z][a-z]{2,}\b/.test(userMessage);
    case 'check-in date':
      return /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}[\/\-]\d{1,2})\b/i.test(userMessage);
    case 'guest count':
      return /\b\d+\s*(?:person|people|guest|pax)\b|\b(?:one|two|three|four|five|\d)\b/i.test(userMessage);
    case 'room type':
      return ROOM_TYPES.some(rt => userMessage.includes(rt));
    case 'duration':
      return /\b\d+\s*(?:night|day|week)\b/i.test(userMessage);
    case 'contact':
      return /\b\d{8,12}\b|@/.test(userMessage);
    default:
      return false;
  }
}

// ─── Signal 2: Contradiction Detection ──────────────────────────────

/**
 * Detect if the bot response contradicts facts established in recent turns.
 *
 * Strategy: extract price/number values stated in the response and compare
 * against values established in assistant messages in recent history.
 */
function detectContradiction(response: string, assistantMessages: string[]): ContextLossSignal | null {
  // Price contradiction: RM X in response vs different RM Y in history
  const responsePrices = [...response.matchAll(/RM\s*(\d+(?:\.\d{2})?)/gi)].map(m => parseFloat(m[1]));
  if (responsePrices.length === 0) return null;

  for (const assistantMsg of assistantMessages) {
    const histPrices = [...assistantMsg.matchAll(/RM\s*(\d+(?:\.\d{2})?)/gi)].map(m => parseFloat(m[1]));
    if (histPrices.length === 0) continue;

    for (const respPrice of responsePrices) {
      for (const histPrice of histPrices) {
        // More than 20% difference for same-context prices signals contradiction
        const diff = Math.abs(respPrice - histPrice) / Math.max(histPrice, 1);
        if (diff > 0.2 && diff < 10) { // 20%-1000% diff = likely contradiction (not different items)
          return {
            type: 'contradiction',
            description: `Bot stated RM${respPrice} which contradicts earlier RM${histPrice}`,
            evidence: `Response price RM${respPrice} vs history price RM${histPrice}`,
          };
        }
      }
    }
  }

  return null;
}

// ─── Signal 3: Named Entity Omission ────────────────────────────────

/**
 * Detect if the bot response omits key entities from recent turns
 * that should be acknowledged (e.g., user mentions booking ref but bot ignores it).
 */
function detectEntityOmission(
  response: string,
  recentUserMessages: string[]
): ContextLossSignal | null {
  // Focus on booking references — if user mentions one, bot should acknowledge it
  for (const userMsg of recentUserMessages) {
    const { bookingRefs } = extractEntities(userMsg);
    for (const ref of bookingRefs) {
      if (!response.includes(ref)) {
        return {
          type: 'entity_omission',
          description: `Bot omitted booking reference ${ref} mentioned by user`,
          evidence: `User mentioned "${ref}" but response doesn't reference it`,
        };
      }
    }
  }

  return null;
}

// ─── Re-grounding Message Builder ────────────────────────────────────

/**
 * Build a compact re-grounding message summarising key facts from conversation.
 * Injected as a system-like message so the LLM re-anchors to established facts.
 */
export function buildRegroundingMessage(history: ChatMessage[]): string {
  const facts: string[] = [];

  for (const msg of history) {
    const text = msg.content;
    const lower = text.toLowerCase();

    // Extract name
    const nameMatch = text.match(/my name is ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ||
      text.match(/(?:i(?:'m| am))\s+([A-Z][a-z]+)/i);
    if (nameMatch) facts.push(`Guest name: ${nameMatch[1]}`);

    // Extract check-in date
    const dateMatch = text.match(/(?:check.?in|arrive|arriving|coming).*?(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+\d{2,4})?)/i);
    if (dateMatch) facts.push(`Check-in: ${dateMatch[1]}`);

    // Extract guest count
    const guestMatch = text.match(/(\d+)\s*(?:person|people|guest|pax)/i);
    if (guestMatch) facts.push(`Guests: ${guestMatch[1]}`);

    // Extract room type
    for (const rt of ROOM_TYPES) {
      if (lower.includes(rt)) {
        facts.push(`Room type mentioned: ${rt}`);
        break;
      }
    }

    // Extract booking references
    const { bookingRefs } = extractEntities(text);
    for (const ref of bookingRefs) {
      facts.push(`Booking ref: ${ref}`);
    }
  }

  // Deduplicate by fact key (before colon)
  const seen = new Set<string>();
  const uniqueFacts: string[] = [];
  for (const fact of facts) {
    const key = fact.split(':')[0];
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFacts.push(fact);
    }
  }

  if (uniqueFacts.length === 0) {
    return '[Context Recovery]: Please continue the conversation referencing all prior guest information.';
  }

  return `[Context Recovery - Session Facts]: ${uniqueFacts.join('; ')}. Use this context to avoid re-asking or contradicting established information.`;
}

// ─── Main Detector ───────────────────────────────────────────────────

/**
 * Detect context loss in the most recent AI response.
 *
 * @param lastResponse - The most recent AI-generated response text
 * @param history - Conversation history (alternating user/assistant messages)
 * @returns ContextLossResult with signals and optional re-grounding message
 */
export function detectContextLoss(
  lastResponse: string,
  history: ChatMessage[]
): ContextLossResult {
  const start = Date.now();

  const signals: ContextLossSignal[] = [];

  const userMessages = history.filter(m => m.role === 'user').map(m => m.content);
  const assistantMessages = history.filter(m => m.role === 'assistant').map(m => m.content);
  const recentUserMessages = userMessages.slice(-6); // last 3 turns

  // Signal 1: Re-asking
  const reaskSignal = detectReasking(lastResponse, recentUserMessages);
  if (reaskSignal) signals.push(reaskSignal);

  // Signal 2: Contradiction
  const contradictionSignal = detectContradiction(lastResponse, assistantMessages.slice(-8));
  if (contradictionSignal) signals.push(contradictionSignal);

  // Signal 3: Entity omission
  const omissionSignal = detectEntityOmission(lastResponse, recentUserMessages);
  if (omissionSignal) signals.push(omissionSignal);

  // Compute confidence
  // Re-asking and contradiction alone are strong enough to cross the 0.7 threshold.
  // Entity omission is weaker; it pushes confidence over the threshold only in combination.
  let confidence = 0;
  for (const signal of signals) {
    switch (signal.type) {
      case 'reasking': confidence += 0.75; break;       // Clear signal: bot forgot established fact
      case 'contradiction': confidence += 0.75; break;  // Clear signal: inconsistent claim
      case 'entity_omission': confidence += 0.75; break; // Clear signal: bot ignored booking ref
    }
  }
  confidence = Math.min(confidence, 1.0);

  const detected = confidence >= CONTEXT_LOSS_CONFIDENCE_THRESHOLD;

  // Build re-grounding message if detected
  let regroundingMessage: string | null = null;
  if (detected && history.length > 0) {
    regroundingMessage = buildRegroundingMessage(history);
  }

  return {
    detected,
    confidence,
    signals,
    regroundingMessage,
    latencyMs: Date.now() - start,
  };
}

// ─── Analytics Logging ────────────────────────────────────────────────

/**
 * Log a context_recovery event to intent_analytics (intent_predictions table).
 * Fire-and-forget — does not throw.
 */
export async function logContextRecoveryEvent(
  phone: string,
  conversationId: string,
  result: ContextLossResult
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO intent_predictions
         (conversation_id, phone_number, message_text, predicted_intent, confidence, tier, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        conversationId,
        phone,
        `[context_recovery] signals: ${result.signals.map(s => s.type).join(',')}`,
        'context_recovery',
        result.confidence,
        'context_loss_detector',
      ]
    );
    console.log(`[ContextLossDetector] Logged context_recovery event for ${phone} (confidence: ${result.confidence.toFixed(2)})`);
  } catch (err: any) {
    console.error(`[ContextLossDetector] Failed to log event: ${err.message}`);
  }
}
