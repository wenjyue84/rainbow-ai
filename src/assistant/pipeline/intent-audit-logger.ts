/**
 * US-239: Intent Classification Decision Audit Logger
 *
 * Logs every intent classification decision with confidence score,
 * top-3 candidate intents, and message hash for debugging accuracy
 * regressions and identifying weak categories.
 *
 * Fire-and-forget — never blocks the classification pipeline.
 */

import { createHash } from 'crypto';
import { db } from '../../lib/db.js';
import { intentClassificationDecisions } from '../../../shared/schema-tables.js';

export interface AuditCandidate {
  intent: string;
  score: number;
}

export interface AuditDecisionInput {
  profileName: string;
  messageText: string;
  classifiedIntent: string;
  confidenceScore: number;
  candidates?: AuditCandidate[];
}

/**
 * Compute a SHA-256 hash of the message text, truncated to 16 hex characters.
 */
export function hashMessage(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Build the top-3 candidates array from raw candidates.
 * Sorts by score descending and takes the top 3.
 * Always includes the classified intent if not already in the list.
 */
export function buildTop3Candidates(
  classifiedIntent: string,
  confidenceScore: number,
  candidates: AuditCandidate[] = []
): AuditCandidate[] {
  // Start with any provided candidates
  const all = [...candidates];

  // Ensure the classified intent is represented
  const hasClassified = all.some(c => c.intent === classifiedIntent);
  if (!hasClassified) {
    all.push({ intent: classifiedIntent, score: confidenceScore });
  }

  // Sort descending by score and take top 3
  all.sort((a, b) => b.score - a.score);
  return all.slice(0, 3).map(c => ({ intent: c.intent, score: c.score }));
}

/**
 * Log an intent classification decision to the audit table.
 * Fire-and-forget: errors are caught and logged but never thrown.
 */
export async function logClassificationDecision(input: AuditDecisionInput): Promise<void> {
  try {
    const messageHash = hashMessage(input.messageText);
    const top3 = buildTop3Candidates(
      input.classifiedIntent,
      input.confidenceScore,
      input.candidates
    );

    await db.insert(intentClassificationDecisions).values({
      profileName: input.profileName,
      messageHash,
      classifiedIntent: input.classifiedIntent,
      confidenceScore: input.confidenceScore,
      top3CandidatesJson: top3,
    });
  } catch (err) {
    // Fire-and-forget — never let audit logging break the pipeline
    console.error('[IntentAudit] Failed to log classification decision:', (err as Error).message);
  }
}
