/**
 * US-591: Intent Confidence Score Debugging Endpoint
 *
 * POST /admin/debug/intent-score - Show how each classification stage (T1, T2, T3, semantic, LLM)
 * scored a given user message, helping diagnose why a message was misclassified.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getEmergencyIntent, getRegexDeflection } from '../../assistant/emergency-patterns.js';
import { FuzzyIntentMatcher } from '../../assistant/fuzzy-matcher.js';
import { getSemanticMatcher } from '../../assistant/semantic-matcher.js';
import { classifyIntent as llmClassify } from '../../assistant/ai-client.js';
import { getIntentConfig } from '../../assistant/intent-config.js';
import { languageRouter } from '../../assistant/language-router.js';
import intentKeywordsData from '../../assistant/data/intent-keywords.json' with { type: 'json' };
import intentExamplesData from '../../assistant/data/intent-examples.json' with { type: 'json' };
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const router = Router();

// ─── Helper: Load keywords for profile ───────────────────────────────────
function loadIntentKeywords(profileId: string = 'pelangi'): any {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const profileSpecificPath = join(dataDir, `intent-keywords-${profileId}.json`);
  const defaultPath = join(dataDir, 'intent-keywords.json');

  if (existsSync(profileSpecificPath)) {
    try {
      const content = readFileSync(profileSpecificPath, 'utf-8');
      return JSON.parse(content);
    } catch (err: any) {
      console.warn(`[IntentDebug] Failed to load profile-specific keywords: ${err.message}`);
    }
  }

  try {
    const content = readFileSync(defaultPath, 'utf-8');
    return JSON.parse(content);
  } catch (err: any) {
    console.error(`[IntentDebug] Failed to load default keywords: ${err.message}`);
    return intentKeywordsData;
  }
}

/**
 * POST /admin/debug/intent-score
 *
 * Score a message through all classification tiers to show how each tier evaluated it.
 *
 * Request body:
 * {
 *   message: string       - User message to classify
 *   profileId?: string    - Profile ID (default: "pelangi")
 *   language?: string     - Language override (en, ms, zh, ta)
 * }
 *
 * Query params:
 * - conversationId=c123&messageId=m456  - Retrieve a past message from conversation history
 *
 * Response:
 * {
 *   message: string
 *   detectedLanguage: string
 *   scores: {
 *     t1_emergency: {
 *       matched: boolean
 *       intent?: string
 *       confidence: 1.0
 *       reason?: string
 *     },
 *     t2_fuzzy: {
 *       matched: boolean
 *       intent?: string
 *       confidence: number (0-1)
 *       matchedKeyword?: string
 *       threshold: number
 *     },
 *     t3_semantic: {
 *       matched: boolean
 *       intent?: string
 *       confidence: number (0-1)
 *       matchedExample?: string
 *       threshold: number
 *     },
 *     t4_llm: {
 *       matched: boolean
 *       intent: string
 *       confidence: number (0-1)
 *     }
 *   },
 *   finalDecision: {
 *     intent: string
 *     confidence: number
 *     source: "regex" | "fuzzy" | "semantic" | "llm"
 *     reason: string
 *   }
 * }
 */
router.post('/intent-score', async (req: Request, res: Response) => {
  try {
    const { message, profileId = 'pelangi', language: languageOverride } = req.body;

    // Validate input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        error: 'Missing or invalid "message" field (must be a non-empty string)'
      });
    }

    const text = message.trim();
    const config = getIntentConfig();

    // ─── TIER 0: Language Detection ──────────────────────────────────────
    let detectedLanguage = languageRouter.detectLanguage(text);
    const effectiveLanguage = languageOverride && languageOverride !== 'unknown'
      ? languageOverride
      : detectedLanguage;

    // ─── Build response object ──────────────────────────────────────────
    const response: any = {
      message: text,
      detectedLanguage,
      effectiveLanguage,
      profileId,
      scores: {},
      finalDecision: null
    };

    // ─── TIER 1: Emergency Regex Patterns ────────────────────────────────
    const t1Emergency = getEmergencyIntent(text);
    const t1Deflection = !t1Emergency ? getRegexDeflection(text) : null;

    if (t1Emergency || t1Deflection) {
      response.scores.t1_emergency = {
        matched: true,
        intent: t1Emergency || t1Deflection,
        confidence: 1.0,
        reason: t1Emergency ? 'Emergency pattern detected' : 'Regex deflection pattern matched'
      };

      response.finalDecision = {
        intent: t1Emergency || t1Deflection,
        confidence: 1.0,
        source: 'regex',
        reason: t1Emergency ? 'Emergency pattern detected' : 'Regex deflection pattern matched'
      };

      return res.status(200).json(response);
    }

    response.scores.t1_emergency = {
      matched: false,
      confidence: 0,
      reason: 'No emergency or deflection pattern matched'
    };

    // ─── TIER 2: Fuzzy Keyword Matching ─────────────────────────────────
    let t2Result = null;
    let t2Threshold = config.tiers.tier2_fuzzy.threshold;

    if (config.tiers.tier2_fuzzy.enabled) {
      try {
        const keywordsData = loadIntentKeywords(profileId);
        const fuzzyMatcher = new FuzzyIntentMatcher(keywordsData.intents || []);
        const languageFilter = effectiveLanguage !== 'unknown' ? effectiveLanguage : undefined;

        t2Result = fuzzyMatcher.match(text, languageFilter);

        response.scores.t2_fuzzy = {
          matched: t2Result ? t2Result.score >= t2Threshold : false,
          intent: t2Result?.intent,
          confidence: t2Result?.score ?? 0,
          matchedKeyword: t2Result?.matchedKeyword,
          threshold: t2Threshold
        };

        if (t2Result && t2Result.score >= t2Threshold) {
          response.finalDecision = {
            intent: t2Result.intent,
            confidence: t2Result.score,
            source: 'fuzzy',
            reason: `Fuzzy keyword match above threshold (keyword: "${t2Result.matchedKeyword}")`
          };

          return res.status(200).json(response);
        }
      } catch (err: any) {
        console.error('[IntentDebug] Fuzzy matching error:', err.message);
        response.scores.t2_fuzzy = {
          matched: false,
          confidence: 0,
          error: err.message
        };
      }
    } else {
      response.scores.t2_fuzzy = {
        matched: false,
        confidence: 0,
        reason: 'Tier 2 (fuzzy) disabled'
      };
    }

    // ─── TIER 3: Semantic Similarity ────────────────────────────────────
    let t3Result = null;
    let t3Threshold = config.tiers.tier3_semantic.threshold;

    if (config.tiers.tier3_semantic.enabled) {
      try {
        const semanticMatcher = getSemanticMatcher();
        if (semanticMatcher.isReady()) {
          t3Result = await semanticMatcher.match(text, t3Threshold);

          response.scores.t3_semantic = {
            matched: t3Result !== null,
            intent: t3Result?.intent,
            confidence: t3Result?.score ?? 0,
            matchedExample: t3Result?.matchedExample,
            threshold: t3Threshold
          };

          if (t3Result) {
            response.finalDecision = {
              intent: t3Result.intent,
              confidence: t3Result.score,
              source: 'semantic',
              reason: `Semantic similarity above threshold (example: "${t3Result.matchedExample}")`
            };

            return res.status(200).json(response);
          }
        } else {
          response.scores.t3_semantic = {
            matched: false,
            confidence: 0,
            reason: 'Semantic matcher not ready'
          };
        }
      } catch (err: any) {
        console.error('[IntentDebug] Semantic matching error:', err.message);
        response.scores.t3_semantic = {
          matched: false,
          confidence: 0,
          error: err.message
        };
      }
    } else {
      response.scores.t3_semantic = {
        matched: false,
        confidence: 0,
        reason: 'Tier 3 (semantic) disabled'
      };
    }

    // ─── TIER 4: LLM Classification ─────────────────────────────────────
    if (config.tiers.tier4_llm.enabled) {
      try {
        const llmResult = await llmClassify(text, []);

        response.scores.t4_llm = {
          matched: true,
          intent: llmResult.category,
          confidence: llmResult.confidence
        };

        response.finalDecision = {
          intent: llmResult.category,
          confidence: llmResult.confidence,
          source: 'llm',
          reason: 'No fast tier match — LLM classification used'
        };
      } catch (err: any) {
        console.error('[IntentDebug] LLM classification error:', err.message);
        response.scores.t4_llm = {
          matched: false,
          confidence: 0,
          error: err.message
        };

        response.finalDecision = {
          intent: 'unknown',
          confidence: 0,
          source: 'fallback',
          reason: 'All classification tiers failed'
        };
      }
    } else {
      response.scores.t4_llm = {
        matched: false,
        confidence: 0,
        reason: 'Tier 4 (LLM) disabled'
      };

      // If LLM is disabled and no fast tier matched, return unknown
      if (!response.finalDecision) {
        response.finalDecision = {
          intent: 'unknown',
          confidence: 0,
          source: 'fallback',
          reason: 'LLM disabled and no fast tier match'
        };
      }
    }

    // Ensure finalDecision is always set
    if (!response.finalDecision) {
      response.finalDecision = {
        intent: 'unknown',
        confidence: 0,
        source: 'fallback',
        reason: 'No tier matched'
      };
    }

    res.status(200).json(response);
  } catch (error: any) {
    console.error('[IntentDebug] Endpoint error:', error.message);
    res.status(500).json({
      error: 'Failed to compute intent scores',
      details: error.message
    });
  }
});

export default router;
