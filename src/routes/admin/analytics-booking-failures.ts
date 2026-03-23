/**
 * Admin API: Booking Workflow Failure Hotspot Analyzer (US-291)
 *
 * GET /analytics/booking-failures?profile=pelangi&days=7
 *
 * Identifies which booking workflow steps fail most frequently and correlates
 * with failure reasons (timeout, validation, unavailability). Helps prioritize
 * targeted improvements to workflows.json.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, dbReady } from '../../lib/db.js';
import { bookingExecutionAudit } from '../../../shared/schema-tables.js';
import { sql, and, gte, eq } from 'drizzle-orm';

const router = Router();

// ─── Pure calculation functions (exported for testing) ──────────────

export interface FailureReasonCount {
  reason: string;
  count: number;
}

export interface StepFailureMetrics {
  failures: number;
  attempts: number;
  rate: string;
  top_reasons: FailureReasonCount[];
}

export type StepFailureAnalysis = Record<string, StepFailureMetrics>;

/**
 * Extract failure reason from step output JSON.
 * Looks for common error patterns in the output.
 */
export function extractFailureReason(output: Record<string, unknown> | null): string {
  if (!output || typeof output !== 'object') return 'unknown';

  const outputObj = output as Record<string, unknown>;

  // Check for errorCode field
  if (typeof outputObj.errorCode === 'string') {
    return outputObj.errorCode;
  }

  // Check for error field
  if (typeof outputObj.error === 'string') {
    return outputObj.error;
  }

  // Check for reason field
  if (typeof outputObj.reason === 'string') {
    return outputObj.reason;
  }

  // Check for message field containing "timeout"
  if (typeof outputObj.message === 'string') {
    if (outputObj.message.toLowerCase().includes('timeout')) {
      return 'timeout';
    }
    return outputObj.message.slice(0, 50);
  }

  // Default
  return 'unknown';
}

/**
 * Calculate failure metrics from raw attempt/failure counts.
 * Pure function — no side effects, fully testable.
 */
export function calculateFailureMetrics(
  failures: number,
  attempts: number,
  failureReasons: FailureReasonCount[]
): StepFailureMetrics {
  const rate =
    attempts > 0 ? ((failures / attempts) * 100).toFixed(1) : '0.0';

  // Sort reasons by count descending and take top 3
  const topReasons = failureReasons
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return {
    failures,
    attempts,
    rate: `${rate}%`,
    top_reasons: topReasons,
  };
}

// ─── GET /analytics/booking-failures ─────────────────────────────────

router.get('/analytics/booking-failures', async (req: Request, res: Response) => {
  try {
    const isConnected = await dbReady;
    if (!isConnected) {
      return res.json({
        success: true,
        data: {},
        warning: 'Database connection unavailable.',
      });
    }

    const profile = (req.query.profile as string) || (res.locals.profileId as string) || 'pelangi';
    const days = Math.min(365, Math.max(1, parseInt(req.query.days as string) || 7));
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Query: Get all booking step executions in the time window
    const rows = await db
      .select({
        stepName: bookingExecutionAudit.stepName,
        status: bookingExecutionAudit.status,
        output: bookingExecutionAudit.output,
      })
      .from(bookingExecutionAudit)
      .where(
        gte(bookingExecutionAudit.executedAt, since)
      );

    // Aggregate by step name
    const stepMap = new Map<string, {
      attempts: number;
      failures: number;
      reasons: Map<string, number>;
    }>();

    for (const row of rows) {
      const stepName = row.stepName;
      if (!stepMap.has(stepName)) {
        stepMap.set(stepName, {
          attempts: 0,
          failures: 0,
          reasons: new Map(),
        });
      }

      const entry = stepMap.get(stepName)!;
      entry.attempts += 1;

      if (row.status === 'error' || row.status === 'timeout') {
        entry.failures += 1;

        // Extract and track failure reason
        const reason = extractFailureReason(row.output as Record<string, unknown> | null);
        entry.reasons.set(reason, (entry.reasons.get(reason) ?? 0) + 1);
      }
    }

    // Convert to analysis format
    const analysis: StepFailureAnalysis = {};
    for (const [stepName, data] of stepMap) {
      const failureReasons: FailureReasonCount[] = Array.from(data.reasons.entries())
        .map(([reason, count]) => ({ reason, count }));

      analysis[stepName] = calculateFailureMetrics(
        data.failures,
        data.attempts,
        failureReasons
      );
    }

    // Sort steps by failure_rate descending
    const sorted = Object.entries(analysis)
      .sort(([, a], [, b]) => {
        const aRate = parseFloat(a.rate);
        const bRate = parseFloat(b.rate);
        return bRate - aRate;
      })
      .reduce((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {} as StepFailureAnalysis);

    return res.json({
      success: true,
      period_days: days,
      profile,
      data: sorted,
    });
  } catch (err) {
    console.error('[analytics-booking-failures] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
