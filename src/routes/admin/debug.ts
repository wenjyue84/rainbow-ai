/**
 * Admin Debug Router — Intent Classification Explainability (US-628)
 *
 * POST /admin/debug/intent-explain
 *   Body:   { message: string, profile?: string }
 *   Returns: { intent, confidence, matchedKeywords, classificationMethod, processingTime }
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { explainIntentClassification } from '../../assistant/intent-classifier.js';

const router = Router();

/**
 * POST /admin/debug/intent-explain
 *
 * Classify a message and return full explainability metadata so developers can
 * understand why the classifier chose a particular intent.
 *
 * @example
 * POST /api/rainbow/admin/debug/intent-explain
 * { "message": "I want to check in tomorrow", "profile": "pelangi" }
 *
 * Response:
 * {
 *   "intent": "check_in_arrival",
 *   "confidence": 0.85,
 *   "matchedKeywords": [{ "keyword": "check in", "score": 0.85 }],
 *   "classificationMethod": "keyword_match",
 *   "processingTime": 3
 * }
 */
router.post('/intent-explain', (req: Request, res: Response) => {
  const { message, profile } = req.body ?? {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({
      error: 'Missing or invalid "message" field (must be a non-empty string)'
    });
  }

  const profileId = typeof profile === 'string' && profile.trim() ? profile.trim() : 'pelangi';

  try {
    const result = explainIntentClassification(message, profileId);
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('[DebugIntentExplain] Error:', err?.message);
    return res.status(500).json({ error: 'Classification failed', details: err?.message });
  }
});

export default router;
