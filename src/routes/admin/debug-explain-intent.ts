/**
 * Admin API: Intent Classification Explanation Debugger (US-378)
 *
 * POST /admin/debug/explain-intent  — Generate explanation for intent classification
 *   Input: { message: string, intent: string }
 *   Output: { top_keywords: string[], classifier_scores: Record<string, number>, matched_patterns: string[] }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { generateIntentExplanation } from '../../lib/intent-explanation.js';

const router = Router();

/**
 * POST /admin/debug/explain-intent
 *
 * Generate explanation for how an intent was classified for a given message.
 * Returns top-3 keywords that matched, their scores, and patterns that fired.
 *
 * @param {string} message - User message to explain
 * @param {string} intent - Classified intent
 * @returns {object} Explanation with top_keywords, classifier_scores, matched_patterns
 *
 * Example request:
 * ```
 * POST /admin/debug/explain-intent
 * { "message": "I want to book a room for 3 nights starting tomorrow", "intent": "booking_request" }
 * ```
 *
 * Example response:
 * ```
 * {
 *   "top_keywords": ["book", "room", "night"],
 *   "classifier_scores": { "book": 0.95, "room": 0.85, "night": 0.75 },
 *   "matched_patterns": ["booking_pattern", "number_pattern", "date_pattern"]
 * }
 * ```
 */
router.post('/explain-intent', (req: Request, res: Response) => {
  try {
    const { message, intent } = req.body;

    // Validate required fields
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid "message" field (must be a non-empty string)'
      });
    }

    if (!intent || typeof intent !== 'string') {
      return res.status(400).json({
        error: 'Missing or invalid "intent" field (must be a non-empty string)'
      });
    }

    // Generate explanation
    const explanation = generateIntentExplanation(message, intent);

    // Return with top-3 contributing features summary
    return res.status(200).json({
      ...explanation,
      summary: {
        intent,
        messageLength: message.length,
        keywordMatches: explanation.top_keywords.length,
        patternsDetected: explanation.matched_patterns.length,
        topContributor: explanation.top_keywords[0] || null,
        topContributorScore: explanation.top_keywords[0]
          ? explanation.classifier_scores[explanation.top_keywords[0]]
          : null
      }
    });
  } catch (error: any) {
    console.error('[DebugExplainIntent] Error:', error.message);
    return res.status(500).json({
      error: 'Failed to generate explanation',
      details: error.message
    });
  }
});

export default router;
