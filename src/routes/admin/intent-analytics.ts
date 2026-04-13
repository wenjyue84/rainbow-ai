import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { intentPredictions, regressionAlerts, intentHardCases } from '../../../shared/schema.js';
import { desc, eq, sql, isNull, isNotNull, inArray, and } from 'drizzle-orm';
import { serverError, badRequest, notFound } from './http-utils.js';
import { safeReadJSON, atomicWriteJSON } from './file-utils.js';
import { checkRegressions } from '../../lib/monitoring/regression-detector.js';
import { join } from 'path';

const EXAMPLES_PATH = join(process.cwd(), 'src', 'assistant', 'data', 'intent-examples.json');

// ─── Training Data Helper ──────────────────────────────────────────
// When staff approves a prediction, add the message text to intent-examples.json
// so it improves future intent classification (T3 semantic matching).

interface IntentExamplesFile {
  intents: Array<{
    intent: string;
    examples: Record<string, string[]>;
  }>;
}

async function addToTrainingData(messageText: string, intent: string): Promise<boolean> {
  try {
    const data = await safeReadJSON<IntentExamplesFile>(EXAMPLES_PATH, { intents: [] });
    const entry = data.intents.find(i => i.intent === intent);
    if (!entry) {
      // Intent doesn't exist in examples — skip (don't create new intents automatically)
      console.log(`[Staff Review] Intent "${intent}" not in intent-examples.json, skipping training add`);
      return false;
    }

    // Add to 'en' examples by default (the text is as-received from the guest)
    if (!entry.examples.en) entry.examples.en = [];

    // Skip if already present (case-insensitive dedup)
    const lower = messageText.toLowerCase().trim();
    const alreadyExists = entry.examples.en.some(ex => ex.toLowerCase().trim() === lower);
    if (alreadyExists) return false;

    entry.examples.en.push(messageText.trim());
    await atomicWriteJSON(EXAMPLES_PATH, data);
    console.log(`[Staff Review] Added training example for "${intent}": "${messageText.substring(0, 60)}..."`);
    return true;
  } catch (err: any) {
    console.error('[Staff Review] Failed to add training data:', err.message);
    return false;
  }
}

const router = Router();

// ─── GET /api/rainbow/intent/accuracy ───────────────────────────────
// Get intent classification accuracy metrics
router.get('/intent/accuracy', async (req: Request, res: Response) => {
  try {
    // Test database connection first
    try {
      await db.execute(sql`SELECT 1`);
    } catch (connError) {
      console.error('[Intent Analytics] ⚠️ Database not available, returning empty data');
      return res.json({
        success: true,
        accuracy: {
          overall: {
            total: 0,
            correct: 0,
            incorrect: 0,
            unvalidated: 0,
            avgConfidence: null,
            accuracyRate: null,
          },
          byIntent: [],
          byTier: [],
          byModel: [],
        },
        warning: 'Database connection unavailable. Install data when database is connected.',
      });
    }

    // Overall accuracy (only counting predictions that have been validated)
    const overallStats = await db
      .select({
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where was_correct = true)::int`,
        incorrect: sql<number>`count(*) filter (where was_correct = false)::int`,
        unvalidated: sql<number>`count(*) filter (where was_correct is null)::int`,
        avgConfidence: sql<number>`avg(confidence)`,
      })
      .from(intentPredictions);

    const overall = overallStats[0];
    const validatedTotal = overall.correct + overall.incorrect;
    const accuracyRate = validatedTotal > 0
      ? (overall.correct / validatedTotal) * 100
      : null;

    // Accuracy by intent
    const byIntent = await db
      .select({
        intent: intentPredictions.predictedIntent,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where was_correct = true)::int`,
        incorrect: sql<number>`count(*) filter (where was_correct = false)::int`,
        accuracyRate: sql<number>`
          case
            when count(*) filter (where was_correct is not null) > 0
            then (count(*) filter (where was_correct = true)::float /
                  count(*) filter (where was_correct is not null)::float) * 100
            else null
          end
        `,
        avgConfidence: sql<number>`avg(confidence)`,
      })
      .from(intentPredictions)
      .groupBy(intentPredictions.predictedIntent)
      .orderBy(desc(sql`count(*)`));

    // Accuracy by tier
    const byTier = await db
      .select({
        tier: intentPredictions.tier,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where was_correct = true)::int`,
        incorrect: sql<number>`count(*) filter (where was_correct = false)::int`,
        accuracyRate: sql<number>`
          case
            when count(*) filter (where was_correct is not null) > 0
            then (count(*) filter (where was_correct = true)::float /
                  count(*) filter (where was_correct is not null)::float) * 100
            else null
          end
        `,
        avgConfidence: sql<number>`avg(confidence)`,
      })
      .from(intentPredictions)
      .groupBy(intentPredictions.tier)
      .orderBy(desc(sql`count(*)`));

    // Accuracy by model (for T4 LLM tier)
    const byModel = await db
      .select({
        model: intentPredictions.model,
        total: sql<number>`count(*)::int`,
        correct: sql<number>`count(*) filter (where was_correct = true)::int`,
        incorrect: sql<number>`count(*) filter (where was_correct = false)::int`,
        accuracyRate: sql<number>`
          case
            when count(*) filter (where was_correct is not null) > 0
            then (count(*) filter (where was_correct = true)::float /
                  count(*) filter (where was_correct is not null)::float) * 100
            else null
          end
        `,
      })
      .from(intentPredictions)
      .where(isNotNull(intentPredictions.model))
      .groupBy(intentPredictions.model)
      .orderBy(desc(sql`count(*)`));

    res.json({
      success: true,
      accuracy: {
        overall: {
          ...overall,
          accuracyRate: accuracyRate !== null ? parseFloat(accuracyRate.toFixed(2)) : null,
        },
        byIntent,
        byTier,
        byModel,
      },
    });
  } catch (error) {
    console.error('[Intent Analytics] ❌ Error fetching accuracy:', error);
    serverError(res, 'Failed to fetch intent accuracy');
  }
});

// ─── GET /api/rainbow/intent/misclassified ──────────────────────────
// Get list of misclassified intents for review
router.get('/intent/misclassified', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const intent = req.query.intent as string | undefined;

    const misclassified = await db
      .select()
      .from(intentPredictions)
      .where(
        intent
          ? sql`was_correct = false AND predicted_intent = ${intent}`
          : eq(intentPredictions.wasCorrect, false)
      )
      .orderBy(desc(intentPredictions.createdAt))
      .limit(limit);

    res.json({
      success: true,
      misclassified,
    });
  } catch (error) {
    console.error('[Intent Analytics] ❌ Error fetching misclassified:', error);
    serverError(res, 'Failed to fetch misclassified intents');
  }
});

// ─── GET /api/rainbow/intent/low-confidence ─────────────────────────
// Get predictions with low confidence (potential issues)
router.get('/intent/low-confidence', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const threshold = parseFloat(req.query.threshold as string) || 0.6;

    const lowConfidence = await db
      .select()
      .from(intentPredictions)
      .where(sql`confidence < ${threshold}`)
      .orderBy(intentPredictions.confidence)
      .limit(limit);

    res.json({
      success: true,
      lowConfidence,
      threshold,
    });
  } catch (error) {
    console.error('[Intent Analytics] ❌ Error fetching low confidence:', error);
    serverError(res, 'Failed to fetch low confidence predictions');
  }
});

// ─── GET /api/rainbow/intent/predictions/pending ────────────────────
// List unvalidated predictions for staff review
router.get('/intent/predictions/pending', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    const pending = await db
      .select({
        id: intentPredictions.id,
        messageText: intentPredictions.messageText,
        predictedIntent: intentPredictions.predictedIntent,
        confidence: intentPredictions.confidence,
        tier: intentPredictions.tier,
        model: intentPredictions.model,
        phoneNumber: intentPredictions.phoneNumber,
        createdAt: intentPredictions.createdAt,
      })
      .from(intentPredictions)
      .where(isNull(intentPredictions.wasCorrect))
      .orderBy(desc(intentPredictions.createdAt))
      .limit(limit);

    // Count total unvalidated
    const totalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(intentPredictions)
      .where(isNull(intentPredictions.wasCorrect));

    res.json({
      success: true,
      predictions: pending,
      total: totalResult[0].count,
    });
  } catch (error) {
    console.error('[Intent Analytics] Error fetching pending predictions:', error);
    serverError(res, 'Failed to fetch pending predictions');
  }
});

// ─── GET /api/rainbow/intent/predictions/validated ──────────────────
// List validated predictions (history)
router.get('/intent/predictions/validated', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;

    const validated = await db
      .select({
        id: intentPredictions.id,
        messageText: intentPredictions.messageText,
        predictedIntent: intentPredictions.predictedIntent,
        actualIntent: intentPredictions.actualIntent,
        wasCorrect: intentPredictions.wasCorrect,
        confidence: intentPredictions.confidence,
        tier: intentPredictions.tier,
        model: intentPredictions.model,
        phoneNumber: intentPredictions.phoneNumber,
        createdAt: intentPredictions.createdAt,
        correctedAt: intentPredictions.correctedAt,
      })
      .from(intentPredictions)
      .where(isNotNull(intentPredictions.wasCorrect))
      .orderBy(desc(intentPredictions.correctedAt))
      .limit(limit);

    res.json({
      success: true,
      predictions: validated,
    });
  } catch (error) {
    console.error('[Intent Analytics] Error fetching validated predictions:', error);
    serverError(res, 'Failed to fetch validated predictions');
  }
});

// ─── PATCH /api/rainbow/intent/predictions/:id ──────────────────────
// Validate a single prediction (staff marks correct or provides actual intent)
// When approved as correct, also adds the message to intent-examples.json for training.
router.patch('/intent/predictions/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { actualIntent } = req.body;

    if (!actualIntent) {
      return badRequest(res, 'actualIntent is required');
    }

    // Fetch the prediction to compare
    const existing = await db
      .select({
        predictedIntent: intentPredictions.predictedIntent,
        messageText: intentPredictions.messageText,
      })
      .from(intentPredictions)
      .where(eq(intentPredictions.id, id))
      .limit(1);

    if (existing.length === 0) {
      return notFound(res, 'Prediction');
    }

    const wasCorrect = existing[0].predictedIntent === actualIntent;

    await db
      .update(intentPredictions)
      .set({
        actualIntent,
        wasCorrect,
        correctionSource: 'manual',
        correctedAt: new Date(),
      })
      .where(eq(intentPredictions.id, id));

    // Add approved message to training data (intent-examples.json)
    let addedToTraining = false;
    if (existing[0].messageText) {
      addedToTraining = await addToTrainingData(existing[0].messageText, actualIntent);
    }

    res.json({
      success: true,
      updated: { id, wasCorrect, actualIntent, addedToTraining },
    });
  } catch (error) {
    console.error('[Intent Analytics] Error validating prediction:', error);
    serverError(res, 'Failed to validate prediction');
  }
});

// ─── POST /api/rainbow/intent/predictions/bulk-validate ─────────────
// Bulk validate multiple predictions at once (approve all, reject all, etc.)
// When approved as correct, also adds messages to intent-examples.json for training.
router.post('/intent/predictions/bulk-validate', async (req: Request, res: Response) => {
  try {
    const { ids, wasCorrect, actualIntent } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return badRequest(res, 'ids array is required');
    }

    if (typeof wasCorrect !== 'boolean') {
      return badRequest(res, 'wasCorrect (boolean) is required');
    }

    // If wasCorrect is false and no actualIntent provided, we can't update
    // (staff needs to specify what the correct intent was)
    if (!wasCorrect && !actualIntent) {
      return badRequest(res, 'actualIntent is required when wasCorrect is false');
    }

    // Fetch all predictions (include messageText for training data)
    const predictions = await db
      .select({
        id: intentPredictions.id,
        predictedIntent: intentPredictions.predictedIntent,
        messageText: intentPredictions.messageText,
      })
      .from(intentPredictions)
      .where(
        ids.length === 1
          ? eq(intentPredictions.id, ids[0])
          : sql`${intentPredictions.id} IN (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `
          )})`
      );

    if (predictions.length === 0) {
      return notFound(res, 'Predictions');
    }

    // Build update values for each prediction
    const updates = predictions.map((p) => ({
      id: p.id,
      actualIntent: wasCorrect ? p.predictedIntent : actualIntent,
      messageText: p.messageText,
      wasCorrect,
      correctionSource: 'manual' as const,
      correctedAt: new Date(),
    }));

    // Bulk update all predictions in DB (US-166: batch update with inArray)
    const allIds = updates.map(u => u.id);
    const now = new Date();

    if (wasCorrect) {
      // All correct: single batch — SET actualIntent = predictedIntent (column reference)
      await db
        .update(intentPredictions)
        .set({
          actualIntent: sql`${intentPredictions.predictedIntent}`,
          wasCorrect: true,
          correctionSource: 'manual',
          correctedAt: now,
        })
        .where(inArray(intentPredictions.id, allIds));
    } else {
      // All incorrect with same actualIntent: single batch update
      await db
        .update(intentPredictions)
        .set({
          actualIntent,
          wasCorrect: false,
          correctionSource: 'manual',
          correctedAt: now,
        })
        .where(inArray(intentPredictions.id, allIds));
    }

    // Add approved messages to training data (intent-examples.json)
    let trainingAdded = 0;
    for (const update of updates) {
      if (update.messageText) {
        const added = await addToTrainingData(update.messageText, update.actualIntent);
        if (added) trainingAdded++;
      }
    }

    res.json({
      success: true,
      updated: updates.length,
      trainingAdded,
      ids: predictions.map((p) => p.id),
    });
  } catch (error) {
    console.error('[Intent Analytics] Error bulk validating predictions:', error);
    serverError(res, 'Failed to bulk validate predictions');
  }
});

// ─── GET /api/rainbow/metrics/intent-classification ──────────────────
// Returns intent classification success rate, avg confidence, and p95 latency
// Grouped by intent_type and profile (US-043)
router.get('/metrics/intent-classification', async (req: Request, res: Response) => {
  try {
    // Test database connection first
    try {
      await db.execute(sql`SELECT 1`);
    } catch (connError) {
      console.error('[Intent Classification Metrics] Database unavailable');
      return res.json({
        success: true,
        metrics: {
          overall: {
            success_rate: null,
            avg_confidence: null,
            p95_latency: null,
            total_count: 0,
          },
          byIntent: [],
          byProfile: [],
          byIntentAndProfile: [],
        },
        warning: 'Database connection unavailable',
      });
    }

    // Import intentAnalytics here to avoid circular dependencies
    const { intentAnalytics: iaTable } = await import('../../../shared/schema-tables.js');

    // Overall metrics (all classifications)
    const overallMetrics = await db
      .select({
        total_count: sql<number>`count(*)::int`,
        avg_confidence: sql<number>`avg(confidence)`,
        success_count: sql<number>`count(*) filter (where was_correct = true)::int`,
      })
      .from(iaTable);

    const overall = overallMetrics[0] || { total_count: 0, avg_confidence: null, success_count: 0 };
    const success_rate = overall.total_count > 0
      ? (overall.success_count / overall.total_count)
      : null;

    // Metrics by intent type
    const byIntentMetrics = await db
      .select({
        intent_type: iaTable.intentType,
        success_rate: sql<number>`count(*) filter (where was_correct = true)::float / nullif(count(*), 0)`,
        avg_confidence: sql<number>`avg(confidence)`,
        p95_latency: sql<number>`percentile_cont(0.95) within group (order by latency_ms)`,
        total_count: sql<number>`count(*)::int`,
      })
      .from(iaTable)
      .groupBy(iaTable.intentType)
      .orderBy(desc(sql`count(*)`));

    // Metrics by profile
    const byProfileMetrics = await db
      .select({
        profile_id: iaTable.profileId,
        success_rate: sql<number>`count(*) filter (where was_correct = true)::float / nullif(count(*), 0)`,
        avg_confidence: sql<number>`avg(confidence)`,
        p95_latency: sql<number>`percentile_cont(0.95) within group (order by latency_ms)`,
        total_count: sql<number>`count(*)::int`,
      })
      .from(iaTable)
      .groupBy(iaTable.profileId)
      .orderBy(desc(sql`count(*)`));

    // Metrics by intent and profile (detailed breakdown)
    const byIntentAndProfileMetrics = await db
      .select({
        profile_id: iaTable.profileId,
        intent_type: iaTable.intentType,
        success_rate: sql<number>`count(*) filter (where was_correct = true)::float / nullif(count(*), 0)`,
        avg_confidence: sql<number>`avg(confidence)`,
        p95_latency: sql<number>`percentile_cont(0.95) within group (order by latency_ms)`,
        total_count: sql<number>`count(*)::int`,
      })
      .from(iaTable)
      .groupBy(iaTable.profileId, iaTable.intentType)
      .orderBy(desc(sql`count(*)`));

    // Calculate overall p95_latency
    const p95Result = await db
      .select({
        p95_latency: sql<number>`percentile_cont(0.95) within group (order by latency_ms)`,
      })
      .from(iaTable);

    const overall_p95 = p95Result[0]?.p95_latency || null;

    res.json({
      success: true,
      metrics: {
        overall: {
          success_rate,
          avg_confidence: overall.avg_confidence || null,
          p95_latency: overall_p95,
          total_count: overall.total_count,
        },
        byIntent: byIntentMetrics,
        byProfile: byProfileMetrics,
        byIntentAndProfile: byIntentAndProfileMetrics,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Intent Classification Metrics] Error:', error);
    serverError(res, 'Failed to fetch intent classification metrics');
  }
});

// ─── GET /api/rainbow/intent/regression-check ──────────────────────────────
// Check for accuracy regressions across intents
// Query params:
//   days: number (default 7) - rolling window days
//   threshold: number (default 0.05) - regression threshold (0.05 = 5% drop)
//   profile: string (optional) - filter by profile
router.get('/intent/regression-check', async (req: Request, res: Response) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days as string) || 7));
    const threshold = Math.max(0, Math.min(1, parseFloat(req.query.threshold as string) || 0.05));
    const profile = req.query.profile as string | undefined;

    const result = await checkRegressions(days, threshold, profile);

    res.json({
      success: true,
      overallStatus: result.overallStatus,
      intents: result.intents,
      timestamp: result.timestamp,
      window: {
        days,
        threshold: `${Math.round(threshold * 100)}%`,
        profile: profile || 'all',
      },
    });
  } catch (error) {
    console.error('[Intent Regression Check] Error:', error);
    serverError(res, 'Failed to check intent regressions');
  }
});

// ─── GET /api/rainbow/analytics/regression-alerts ──────────────────────────
// Returns active and/or resolved regression alerts stored in regression_alerts table
// Query params:
//   status: 'active' | 'resolved' | 'all' (default 'all')
//   profile: string (optional) - filter by profile
//   limit: number (default 50, max 200)
router.get('/analytics/regression-alerts', async (req: Request, res: Response) => {
  try {
    const statusFilter = (req.query.status as string) || 'all';
    const profile = req.query.profile as string | undefined;
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string) || 50));

    const conditions: any[] = [];
    if (statusFilter !== 'all') {
      if (statusFilter !== 'active' && statusFilter !== 'resolved') {
        return badRequest(res, 'status must be "active", "resolved", or "all"');
      }
      conditions.push(eq(regressionAlerts.status, statusFilter));
    }
    if (profile) {
      conditions.push(eq(regressionAlerts.profileId, profile));
    }

    const alerts = await db
      .select()
      .from(regressionAlerts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(regressionAlerts.detectedAt))
      .limit(limit);

    const active = alerts.filter(a => a.status === 'active');
    const resolved = alerts.filter(a => a.status === 'resolved');

    res.json({
      success: true,
      summary: {
        total: alerts.length,
        active: active.length,
        resolved: resolved.length,
      },
      alerts: alerts.map(a => ({
        id: a.id,
        profileId: a.profileId,
        intentType: a.intentType,
        baselineAccuracy: a.baselineAccuracy,
        currentAccuracy: a.currentAccuracy,
        accuracyDrop: a.accuracyDrop,
        status: a.status,
        detectedAt: a.detectedAt,
        resolvedAt: a.resolvedAt,
      })),
      filter: {
        status: statusFilter,
        profile: profile || 'all',
        limit,
      },
    });
  } catch (error) {
    console.error('[Regression Alerts] Error:', error);
    serverError(res, 'Failed to fetch regression alerts');
  }
});

// ─── POST /api/rainbow/intent-hard-cases ────────────────────────────────────
// Flag a conversation with ambiguous intent classification for manual review
// AC1: Accepts {conversationId, intentId, confidence, reason} and stores to intent_hard_cases
router.post('/intent-hard-cases', async (req: Request, res: Response) => {
  try {
    const { conversationId, intentId, confidence, reason, candidateIntents } = req.body;
    const profile = (req.query.profile as string) || 'pelangi';

    // Validate required fields
    if (!conversationId || !intentId || typeof confidence !== 'number') {
      return badRequest(res, 'conversationId, intentId, and confidence are required');
    }

    // Insert the hard case
    const result = await db
      .insert(intentHardCases)
      .values({
        conversationId,
        intentId,
        confidence,
        reason: reason || null,
        candidateIntents: candidateIntents ? JSON.stringify(candidateIntents) : null,
        profile,
      })
      .returning({ id: intentHardCases.id });

    if (!result[0]) {
      return serverError(res, 'Failed to create hard case');
    }

    res.json({
      success: true,
      hardCaseId: result[0].id,
      conversationId,
      intentId,
      confidence,
    });
  } catch (error) {
    console.error('[Intent Hard Cases] Error creating hard case:', error);
    serverError(res, 'Failed to create intent hard case');
  }
});

// ─── GET /api/rainbow/intent-hard-cases ─────────────────────────────────────
// Get hard cases grouped by predicted intent with confidence breakdown
// AC2: Returns cases grouped by predicted intent with top-3 candidate intents and confidence breakdown
router.get('/intent-hard-cases', async (req: Request, res: Response) => {
  try {
    const profile = (req.query.profile as string) || 'pelangi';
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit as string) || 50));

    // Fetch hard cases for the profile
    const hardCases = await db
      .select()
      .from(intentHardCases)
      .where(eq(intentHardCases.profile, profile))
      .orderBy(desc(intentHardCases.createdAt))
      .limit(limit);

    // Group by intentId and calculate confidence statistics
    const groupedByIntent: Record<
      string,
      {
        intent: string;
        count: number;
        avgConfidence: number;
        minConfidence: number;
        maxConfidence: number;
        cases: Array<{
          conversationId: string;
          confidence: number;
          reason?: string;
          candidateIntents?: unknown;
          createdAt: Date;
        }>;
      }
    > = {};

    for (const hardCase of hardCases) {
      const intent = hardCase.intentId;
      if (!groupedByIntent[intent]) {
        groupedByIntent[intent] = {
          intent,
          count: 0,
          avgConfidence: 0,
          minConfidence: 1,
          maxConfidence: 0,
          cases: [],
        };
      }

      const group = groupedByIntent[intent];
      group.count += 1;
      group.avgConfidence =
        (group.avgConfidence * (group.count - 1) + hardCase.confidence) / group.count;
      group.minConfidence = Math.min(group.minConfidence, hardCase.confidence);
      group.maxConfidence = Math.max(group.maxConfidence, hardCase.confidence);
      group.cases.push({
        conversationId: hardCase.conversationId,
        confidence: hardCase.confidence,
        reason: hardCase.reason || undefined,
        candidateIntents: hardCase.candidateIntents,
        createdAt: hardCase.createdAt,
      });
    }

    // Convert to array and sort by count (most cases first)
    const grouped = Object.values(groupedByIntent).sort((a, b) => b.count - a.count);

    // Round confidence values to 2 decimals
    for (const group of grouped) {
      group.avgConfidence = parseFloat(group.avgConfidence.toFixed(2));
      group.minConfidence = parseFloat(group.minConfidence.toFixed(2));
      group.maxConfidence = parseFloat(group.maxConfidence.toFixed(2));
    }

    res.json({
      success: true,
      profile,
      totalCases: hardCases.length,
      groupedByIntent: grouped,
      filter: {
        profile,
        limit,
      },
    });
  } catch (error) {
    console.error('[Intent Hard Cases] Error fetching hard cases:', error);
    serverError(res, 'Failed to fetch intent hard cases');
  }
});

// ─── GET /api/admin/analytics/intent-accuracy ────────────────────────
// Returns intent classification accuracy metrics per profile, intent, and language
// Supports optional filters: profile, intent, language
// US-589: Intent Classification Accuracy Reporting Dashboard Endpoint
router.get('/analytics/intent-accuracy', async (req: Request, res: Response) => {
  try {
    const { intentClassificationDecisions: icdTable } = await import('../../../shared/schema-tables.js');

    const profile = (req.query.profile as string) || 'pelangi';
    const intent = req.query.intent as string | undefined;
    const language = req.query.language as string | undefined;

    // Build query conditions
    const conditions = [];
    conditions.push(eq(icdTable.profileName, profile));

    if (intent) {
      conditions.push(eq(icdTable.classifiedIntent, intent));
    }

    // Language filter: check if language field exists in message context
    // For now, we'll filter on timestamp/language preference if needed
    // This is a simplification—full implementation might join with conversation state

    // Query all classification decisions for the profile
    const decisions = await db
      .select({
        classifiedIntent: icdTable.classifiedIntent,
        actualIntent: icdTable.actualIntent,
        confidenceScore: icdTable.confidenceScore,
        timestamp: icdTable.timestamp,
      })
      .from(icdTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(icdTable.timestamp))
      .limit(10000); // Limit to prevent memory overload

    if (decisions.length === 0) {
      return res.json({
        success: true,
        metrics: {
          profile,
          intent: intent || 'all',
          language: language || 'all',
          accuracy: null,
          precision: null,
          recall: null,
          f1: null,
          sampleSize: 0,
          lastUpdated: null,
        },
        message: 'No classification data available for the specified filters',
      });
    }

    // Calculate metrics
    let correct = 0;
    let total = decisions.length;

    // For precision/recall, we need to consider:
    // - TP (True Positive): classified correctly
    // - FP (False Positive): classified as intent X but was actually Y
    // - FN (False Negative): classified as something else but should be X

    for (const decision of decisions) {
      if (decision.actualIntent && decision.classifiedIntent === decision.actualIntent) {
        correct++;
      }
    }

    const accuracy = total > 0 ? correct / total : 0;

    // For a single intent, calculate precision and recall
    let precision = accuracy;
    let recall = accuracy;

    if (intent) {
      // Precision: of items we classified as 'intent', how many were correct?
      let tp = 0;
      let fp = 0;

      for (const decision of decisions) {
        if (decision.classifiedIntent === intent) {
          if (decision.actualIntent === intent) {
            tp++;
          } else {
            fp++;
          }
        }
      }

      precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;

      // Recall: of items that should be 'intent', how many did we classify as such?
      let fn = 0;
      for (const decision of decisions) {
        if (decision.actualIntent === intent && decision.classifiedIntent !== intent) {
          fn++;
        }
      }

      recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
    }

    // Calculate F1 score
    const f1 = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;

    const lastUpdated = decisions[0]?.timestamp || new Date();

    res.json({
      success: true,
      metrics: {
        profile,
        intent: intent || 'all',
        language: language || 'all',
        accuracy: parseFloat(accuracy.toFixed(4)),
        precision: parseFloat(precision.toFixed(4)),
        recall: parseFloat(recall.toFixed(4)),
        f1: parseFloat(f1.toFixed(4)),
        sampleSize: total,
        lastUpdated: lastUpdated.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Intent Accuracy Analytics] Error fetching accuracy metrics:', error);
    serverError(res, 'Failed to fetch intent accuracy metrics');
  }
});

export default router;
