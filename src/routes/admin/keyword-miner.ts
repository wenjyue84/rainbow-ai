/**
 * US-323: Intent Keyword Auto-Miner API
 *
 * Provides:
 *   POST /admin/keywords/approve-suggestions — Update intent-keywords.json with approved suggestions
 *   GET /admin/keywords/suggestions/{profile} — Get mining suggestions from DB
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { createModuleLogger } from '../../lib/logger.js';
import { logConfigChange } from '../../lib/config-audit.js';
import { mineKeywordSuggestions } from '../../tools/keyword-miner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..', '..');

const logger = createModuleLogger('KeywordMiner');
const router = Router();

// ─── Request/Response Schemas ──────────────────────────────────────────

const ApproveSuggestionsSchema = z.object({
  profile: z.enum(['pelangi', 'makan', 'southern']),
  suggestions: z.array(
    z.object({
      keyword: z.string().min(1),
      intent: z.string().min(1),
      language: z.string().default('en').optional(),
    })
  ).min(1),
});

type ApproveSuggestionsRequest = z.infer<typeof ApproveSuggestionsSchema>;

// ─── Profile configuration ────────────────────────────────────────────

const PROFILE_KEYWORD_DIRS: Record<string, string> = {
  pelangi: 'src/assistant/data',
  makan: 'src/assistant/data-makan',
  southern: 'src/assistant/data-southern',
};

// ─── Helper: Load intent-keywords.json ─────────────────────────────────

interface IntentKeywordsFile {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

function loadIntentKeywords(profileDir: string): IntentKeywordsFile {
  const filePath = path.join(profileDir, 'intent-keywords.json');
  if (!fs.existsSync(filePath)) {
    return { intents: [] };
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

function saveIntentKeywords(profileDir: string, data: IntentKeywordsFile): void {
  const filePath = path.join(profileDir, 'intent-keywords.json');
  // Write to temp file first, then rename (atomic write)
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, filePath);
}

// ─── POST /admin/keywords/approve-suggestions ──────────────────────────

/**
 * Accept approved keyword suggestions and update intent-keywords.json.
 *
 * Request body:
 * {
 *   "profile": "makan",
 *   "suggestions": [
 *     { "keyword": "table reservation", "intent": "booking", "language": "en" },
 *     { "keyword": "book a table", "intent": "booking", "language": "en" }
 *   ]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "profile": "makan",
 *   "keywords_added": 2,
 *   "intents_updated": 1
 * }
 */
router.post('/keywords/approve-suggestions', async (req: Request, res: Response) => {
  try {
    // Validate request
    const validated = ApproveSuggestionsSchema.parse(req.body);
    const { profile, suggestions } = validated;

    // Resolve profile directory
    const profileDir = path.join(rootDir, PROFILE_KEYWORD_DIRS[profile]);
    if (!fs.existsSync(profileDir)) {
      return res.status(400).json({
        error: `Profile directory not found: ${profileDir}`,
      });
    }

    // Load existing keywords
    const before = loadIntentKeywords(profileDir);

    // Apply suggestions
    let keywordsAdded = 0;
    const intentsUpdated = new Set<string>();

    for (const suggestion of suggestions) {
      const language = suggestion.language || 'en';

      // Find or create intent entry
      let intentEntry = before.intents.find(i => i.intent === suggestion.intent);
      if (!intentEntry) {
        intentEntry = {
          intent: suggestion.intent,
          keywords: { en: [], ms: [], zh: [], ta: [] },
        };
        before.intents.push(intentEntry);
      }

      // Initialize language if not present
      if (!intentEntry.keywords[language]) {
        intentEntry.keywords[language] = [];
      }

      // Add keyword if not already present
      const normalized = suggestion.keyword.toLowerCase().trim();
      if (!intentEntry.keywords[language].includes(normalized)) {
        intentEntry.keywords[language].push(normalized);
        keywordsAdded++;
        intentsUpdated.add(suggestion.intent);

        logger.info('Keyword added', {
          profile,
          intent: suggestion.intent,
          keyword: normalized,
          language,
        });
      }
    }

    // Sort keywords alphabetically for consistency
    for (const intentEntry of before.intents) {
      for (const lang of Object.keys(intentEntry.keywords)) {
        intentEntry.keywords[lang].sort();
      }
    }

    // Save to file
    const after = before;
    saveIntentKeywords(profileDir, after);

    // Log audit trail
    await logConfigChange(
      `intent-keywords.json (${profile})`,
      req.ip || 'unknown',
      null, // Don't include full before/after in audit log
      {
        profile,
        keywords_added: keywordsAdded,
        intents_updated: Array.from(intentsUpdated),
        suggestions_count: suggestions.length,
      }
    );

    logger.info('Keywords approved and saved', {
      profile,
      keywordsAdded,
      intentsUpdated: intentsUpdated.size,
    });

    res.json({
      success: true,
      profile,
      keywords_added: keywordsAdded,
      intents_updated: intentsUpdated.size,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Validation failed',
        details: err.errors,
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to approve suggestions', { error: message });
    res.status(500).json({
      error: 'Failed to approve suggestions',
      details: message,
    });
  }
});

// ─── GET /admin/keywords/suggestions/{profile} ──────────────────────────

/**
 * Mine and return keyword suggestions for a profile.
 *
 * Query params:
 *   - window: time window (e.g., "7d", "24h") — default "7d"
 *   - limit: max suggestions — default 100
 *
 * Response:
 * {
 *   "timestamp": "2026-03-24T12:00:00Z",
 *   "profile": "makan",
 *   "suggestions": [
 *     { "keyword": "table reservation", "intent": "booking", "frequency": 8, "suggestedProfile": "makan" },
 *     ...
 *   ],
 *   "total_predictions": 150,
 *   "low_confidence_count": 45
 * }
 */
router.get('/keywords/suggestions/:profile', async (req: Request, res: Response) => {
  try {
    const profile = req.params.profile as string;
    const windowStr = (req.query.window as string) || '7d';
    const limitStr = (req.query.limit as string) || '100';

    // Validate profile
    if (!(['pelangi', 'makan', 'southern'] as const).includes(profile as any)) {
      return res.status(400).json({
        error: `Invalid profile: ${profile}`,
      });
    }

    // Parse window
    const windowMatch = windowStr.match(/^(\d+)(d|h)$/);
    if (!windowMatch) {
      return res.status(400).json({
        error: `Invalid window format. Use "7d" or "24h"`,
      });
    }

    const value = parseInt(windowMatch[1], 10);
    const unit = windowMatch[2];
    const windowDays = unit === 'd' ? value : value / 24;

    const limit = Math.min(parseInt(limitStr, 10) || 100, 500);

    // Mine suggestions from DB
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      return res.status(500).json({
        error: 'DATABASE_URL not configured',
      });
    }

    const output = await mineKeywordSuggestions(profile, windowDays, dbUrl, rootDir);

    // Limit suggestions
    output.suggestions = output.suggestions.slice(0, limit);

    logger.info('Suggestions mined', {
      profile,
      window_days: windowDays,
      suggestion_count: output.suggestions.length,
    });

    res.json({
      timestamp: output.timestamp,
      profile: output.profile,
      window_days: output.window_days,
      total_predictions: output.total_predictions,
      low_confidence_count: output.low_confidence_count,
      failed_count: output.failed_count,
      suggestions: output.suggestions,
      duplicates_filtered: output.duplicates_filtered,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Failed to mine suggestions', { error: message });
    res.status(500).json({
      error: 'Failed to mine suggestions',
      details: message,
    });
  }
});

export default router;
