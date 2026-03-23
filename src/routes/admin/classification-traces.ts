/**
 * US-122: Classification Traces API
 *
 * Endpoint to retrieve intent classification decision traces (top-3 candidates with confidence breakdown)
 * for a given conversation.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getClassificationTraces, getTracedConversationIds } from '../../assistant/classification-tracer.js';

const router = Router();

/**
 * GET /admin/conversations/:conversationId/classification-trace
 *
 * Retrieve classification decision history for a conversation.
 *
 * Query params:
 * - limit: max number of traces to return (default: 20, max: 100)
 *
 * Response:
 * {
 *   conversation_id: string
 *   trace_count: number
 *   traces: ClassificationTrace[]
 * }
 */
router.get('/conversations/:conversationId/classification-trace', (req: Request, res: Response) => {
  const { conversationId } = req.params;
  const limit = Math.min(parseInt(String(req.query.limit) || '20', 10), 100);

  try {
    const traces = getClassificationTraces(conversationId);
    const recentTraces = traces.slice(-limit);

    res.json({
      conversation_id: conversationId,
      trace_count: traces.length,
      traces: recentTraces.map(t => ({
        timestamp: t.timestamp,
        input_text: t.input_text,
        detected_language: t.detected_language,
        candidates: t.candidates,
        chosen_intent: t.chosen_intent,
        chosen_confidence: t.chosen_confidence,
        chosen_source: t.chosen_source,
        tie_break_reason: t.tie_break_reason,
      })),
    });
  } catch (error: any) {
    console.error('[ClassificationTraces] Error retrieving traces:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /admin/classification-traces/conversations
 *
 * List all conversation IDs that have classification traces recorded.
 *
 * Response:
 * {
 *   count: number
 *   conversation_ids: string[]
 * }
 */
router.get('/classification-traces/conversations', (_req: Request, res: Response) => {
  try {
    const conversationIds = getTracedConversationIds();
    res.json({
      count: conversationIds.length,
      conversation_ids: conversationIds,
    });
  } catch (error: any) {
    console.error('[ClassificationTraces] Error listing conversations:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
