/**
 * US-245: Conversation Turn-by-Turn Confidence Trend API
 *
 * POST /analytics/conversation/:id/confidence-trend
 *   Returns per-turn metrics showing confidence scores and intent names
 *   in chronological order for a specific conversation.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getTurnMetadata } from '../../assistant/turn-confidence-scorer.js';
import { ok, notFound, serverError } from './http-utils.js';

const router = Router();

/**
 * POST /analytics/conversation/:id/confidence-trend
 *
 * Path param :id is the conversation phone key (primary key of rainbow_conversations).
 *
 * Response:
 * {
 *   ok: true,
 *   conversationId: string,
 *   turns: [{ turn_num, intent, confidence, fallback_used, tokens }],
 *   summary: { total_turns, avg_confidence, fallback_count, total_tokens }
 * }
 */
router.post('/analytics/conversation/:id/confidence-trend', async (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id;
    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation ID is required' });
    }

    const turns = await getTurnMetadata(conversationId);

    if (turns.length === 0) {
      return ok(res, {
        conversationId,
        turns: [],
        summary: {
          total_turns: 0,
          avg_confidence: 0,
          fallback_count: 0,
          total_tokens: 0,
        },
      });
    }

    // Compute summary statistics
    const totalTurns = turns.length;
    const avgConfidence = turns.reduce((sum, t) => sum + t.confidence, 0) / totalTurns;
    const fallbackCount = turns.filter(t => t.fallback_used).length;
    const totalTokens = turns.reduce((sum, t) => sum + t.tokens, 0);

    return ok(res, {
      conversationId,
      turns,
      summary: {
        total_turns: totalTurns,
        avg_confidence: Math.round(avgConfidence * 1000) / 1000,
        fallback_count: fallbackCount,
        total_tokens: totalTokens,
      },
    });
  } catch (err: any) {
    return serverError(res, err);
  }
});

export default router;
