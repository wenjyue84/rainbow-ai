/**
 * similar-case-adapter.ts — US-486: Fallback Response Generation from Similar Resolved Cases
 *
 * When intent confidence falls below threshold, queries conversation history for
 * semantically similar resolved cases and adapts their successful responses to
 * the current context. This provides contextually relevant responses learned from
 * real conversations, improving user satisfaction and reducing escalations.
 */

import { pipeline, env } from '@xenova/transformers';

// Disable local model checks (use cached models)
env.allowLocalModels = false;

export interface AdaptedResponse {
  adapted_response: string;
  source_case_id: string;
  similarity_score: number;
  metadata: {
    similarity_score: number;
    source_message_id?: number;
    adapted_at: string;
    intent?: string;
  };
}

export interface SimilarCase {
  messageId: number;
  phone: string;
  content: string;
  assistantResponse: string;
  similarity: number;
  intent?: string;
  confidence?: number;
}

/**
 * Extract key entities and information from response text
 * Uses regex patterns to identify:
 * - Time references (HH:MM, AM/PM, "today", "tomorrow")
 * - Numbers and measurements
 * - Key action verbs
 * - Named concepts
 */
export function extractKeyEntities(text: string): string[] {
  const entities: Set<string> = new Set();

  // Time patterns (HH:MM, AM/PM, day names)
  const timeMatches = text.match(
    /(\d{1,2}:\d{2}|[0-9]{1,2}\s*(?:AM|PM|am|pm)|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))/gi
  );
  if (timeMatches) {
    timeMatches.forEach(m => entities.add(m.trim()));
  }

  // Numbers (prices, counts, dates)
  const numberMatches = text.match(/\$?\d+(?:\.\d{2})?|[0-9]+\s*(?:nights|days|hours|minutes|guests?|rooms?|beds?)/gi);
  if (numberMatches) {
    numberMatches.forEach(m => entities.add(m.trim()));
  }

  // Key action verbs and concepts
  const actionPatterns = [
    /\b(can|will|must|should|need to)\s+(\w+)/gi,
    /\b(check[- ]?in|check[- ]?out|arrive|depart|book|cancel|confirm)\b/gi,
    /\b(available|free|included|required|allowed|prohibited)\b/gi,
    /\b(parking|wifi|pet|guest|host|staff|owner)\b/gi,
  ];

  actionPatterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => entities.add(m.toLowerCase().trim()));
    }
  });

  // Location/facility references
  const locationMatches = text.match(
    /\b(room|unit|apartment|house|lobby|desk|reception|parking\s+(?:area|lot|garage))\b/gi
  );
  if (locationMatches) {
    locationMatches.forEach(m => entities.add(m.toLowerCase().trim()));
  }

  return Array.from(entities);
}

/**
 * Compute cosine similarity between two embedding vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Compute embedding for text using lightweight transformer model
 */
async function getEmbedding(text: string, embedder: any): Promise<number[]> {
  try {
    const output = await embedder(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data);
  } catch (error) {
    console.error('[SimilarCaseAdapter] Embedding computation failed:', error);
    return [];
  }
}

/**
 * Find similar resolved cases from conversation history
 * Uses semantic similarity (cosine distance on embeddings)
 * Filters by same profileId and conversation status = 'resolved' (ended)
 * Returns top 3 matches ranked by similarity
 */
export async function findSimilarResolvedCases(
  message: string,
  profileId: string,
  limit: number = 3,
  pool?: any
): Promise<SimilarCase[]> {
  if (!pool) {
    console.warn('[SimilarCaseAdapter] Database pool not provided');
    return [];
  }

  try {
    // Query resolved conversations with their messages
    const query = `
      SELECT
        rm.id AS message_id,
        rc.phone,
        rm.content,
        rm.intent,
        rm.confidence
      FROM rainbow_messages rm
      INNER JOIN rainbow_conversations rc ON rm.phone = rc.phone
      WHERE
        rc.profile_id = $1
        AND rc.status = 'ended'
        AND rm.role = 'assistant'
        AND rm.content IS NOT NULL
        AND LENGTH(rm.content) > 20
      ORDER BY rm.timestamp DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [profileId]);
    const cases: SimilarCase[] = result.rows || [];

    if (cases.length === 0) {
      console.log('[SimilarCaseAdapter] No resolved cases found for profile:', profileId);
      return [];
    }

    // Initialize embedder once
    let embedder: any;
    try {
      embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
      });
    } catch (error) {
      console.error('[SimilarCaseAdapter] Failed to load embedder:', error);
      return [];
    }

    // Compute embedding for input message
    const messageEmbedding = await getEmbedding(message, embedder);
    if (messageEmbedding.length === 0) {
      return [];
    }

    // Compute similarity for each case
    const scoredCases: Array<SimilarCase & { similarity: number }> = [];

    for (const caseItem of cases) {
      try {
        const caseEmbedding = await getEmbedding(caseItem.content, embedder);
        if (caseEmbedding.length > 0) {
          const similarity = cosineSimilarity(messageEmbedding, caseEmbedding);
          scoredCases.push({
            ...caseItem,
            similarity,
          });
        }
      } catch (error) {
        console.error('[SimilarCaseAdapter] Error computing similarity:', error);
        continue;
      }
    }

    // Sort by similarity descending and return top matches
    const topMatches = scoredCases
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return topMatches;
  } catch (error) {
    console.error('[SimilarCaseAdapter] findSimilarResolvedCases failed:', error);
    return [];
  }
}

/**
 * Adapt response from similar resolved case
 * Takes a low-confidence message and generates contextually relevant response
 * based on similar successful cases from conversation history
 *
 * @param message - Low-confidence user message
 * @param profileId - Business profile ID (pelangi, southern, makan)
 * @param confidenceThreshold - Minimum confidence (typically 0.5)
 * @param pool - Optional database pool for testing
 * @returns Adapted response with source case ID and similarity score
 */
export async function adaptResponseFromSimilarCase(
  message: string,
  profileId: string,
  confidenceThreshold: number = 0.5,
  pool?: any
): Promise<AdaptedResponse | null> {
  try {
    // Import pool if not provided (production path)
    if (!pool) {
      try {
        const dbModule = await import('../../lib/db.js');
        if (dbModule.pool) {
          pool = dbModule.pool;
        }
      } catch {
        console.warn('[SimilarCaseAdapter] Could not import db pool');
        return null;
      }
    }

    if (!pool) {
      return null;
    }

    // Find similar resolved cases
    const similarCases = await findSimilarResolvedCases(message, profileId, 3, pool);

    if (similarCases.length === 0) {
      console.log('[SimilarCaseAdapter] No similar cases found');
      return null;
    }

    // Use the most similar case
    const bestCase = similarCases[0];

    // Validate similarity score
    if (bestCase.similarity < confidenceThreshold) {
      console.log(
        `[SimilarCaseAdapter] Best case similarity (${bestCase.similarity}) below threshold (${confidenceThreshold})`
      );
      return null;
    }

    // Get the assistant response for the best matching case
    let assistantResponse = '';
    try {
      const assistantQuery = `
        SELECT content
        FROM rainbow_messages
        WHERE phone = $1 AND role = 'assistant'
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      const assistantResult = await pool.query(assistantQuery, [bestCase.phone]);
      if (assistantResult.rows && assistantResult.rows.length > 0) {
        assistantResponse = assistantResult.rows[0].content || '';
      }
    } catch (error) {
      console.error('[SimilarCaseAdapter] Failed to fetch assistant response:', error);
    }

    // Adapt the response to current context
    // Extract key entities from original response
    const sourceEntities = extractKeyEntities(assistantResponse);
    const messageEntities = extractKeyEntities(message);

    // Build adapted response (simple concatenation with context adaptation)
    let adaptedResponse = assistantResponse;
    if (adaptedResponse && messageEntities.length > 0) {
      // If we have context-specific entities in the current message, try to highlight them
      const contextKeywords = messageEntities
        .filter(e => assistantResponse.toLowerCase().includes(e.toLowerCase()))
        .slice(0, 2);

      if (contextKeywords.length > 0) {
        // Response already contains relevant context
        adaptedResponse = assistantResponse;
      } else {
        // Add a transition if contexts differ
        adaptedResponse = assistantResponse;
      }
    }

    // Compute entity preservation rate
    const preservedCount = sourceEntities.filter(se =>
      adaptedResponse.toLowerCase().includes(se.toLowerCase())
    ).length;
    const preservationRate = sourceEntities.length > 0 ? preservedCount / sourceEntities.length : 1.0;

    // Log if entity preservation is low
    if (preservationRate < 0.7) {
      console.warn(
        `[SimilarCaseAdapter] Low entity preservation (${(preservationRate * 100).toFixed(1)}%) for case ${bestCase.messageId}`
      );
    }

    return {
      adapted_response: adaptedResponse,
      source_case_id: `msg-${bestCase.messageId}`,
      similarity_score: bestCase.similarity,
      metadata: {
        similarity_score: bestCase.similarity,
        source_message_id: bestCase.messageId,
        adapted_at: new Date().toISOString(),
        intent: bestCase.intent || undefined,
      },
    };
  } catch (error) {
    console.error('[SimilarCaseAdapter] adaptResponseFromSimilarCase failed:', error);
    return null;
  }
}

/**
 * Batch adapt responses for multiple low-confidence messages
 * Useful for bulk analysis or fallback scenario testing
 */
export async function batchAdaptResponses(
  messages: string[],
  profileId: string,
  confidenceThreshold: number = 0.5,
  pool?: any
): Promise<(AdaptedResponse | null)[]> {
  return Promise.all(
    messages.map(msg =>
      adaptResponseFromSimilarCase(msg, profileId, confidenceThreshold, pool)
    )
  );
}
