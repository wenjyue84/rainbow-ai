/**
 * audit-trail.ts — Conversation Audit Trail Export (US-156)
 *
 * Provides endpoints for exporting conversation audit logs for PDPA compliance
 * and conversation quality debugging.
 *
 * Endpoints:
 *   GET /api/admin/audit-trail/export
 *     Query params:
 *       - startDate: ISO date string (YYYY-MM-DD)
 *       - endDate: ISO date string (YYYY-MM-DD)
 *       - phone?: specific phone number (optional)
 *       - intent?: specific intent to filter (optional)
 *       - limit?: max results (default 10000)
 *     Returns: JSON array of audit trail entries
 */

import { Router, Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { conversationAudit } from '../../../shared/schema-tables.js';
import { and, gte, lt, eq, desc, limit, asc } from 'drizzle-orm';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('AuditTrail');
const router = Router();

// ─── GET /api/admin/audit-trail/export ───────────────────────────

/**
 * Export audit trail entries for a date range.
 * Supports optional phone and intent filters.
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      phone,
      intent,
      limit: limitParam = 10000,
    } = req.query;

    // Validate required parameters
    if (!startDate || !endDate) {
      res.status(400).json({
        error: 'Missing required query parameters: startDate and endDate (ISO format)',
        example: '/api/admin/audit-trail/export?startDate=2026-01-01&endDate=2026-01-31',
      });
      return;
    }

    // Parse dates
    const start = new Date(String(startDate));
    const end = new Date(String(endDate));

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({
        error: 'Invalid date format. Use ISO format: YYYY-MM-DD',
      });
      return;
    }

    // Ensure end date is inclusive (set to end of day)
    end.setUTCHours(23, 59, 59, 999);

    const limitNum = Math.min(parseInt(String(limitParam)) || 10000, 100000);

    // Build filter conditions
    const conditions: any[] = [
      gte(conversationAudit.timestamp, start),
      lt(conversationAudit.timestamp, end),
    ];

    if (phone) {
      conditions.push(eq(conversationAudit.phone, String(phone)));
    }

    if (intent) {
      conditions.push(eq(conversationAudit.intent, String(intent)));
    }

    // Query audit trail
    const results = await db
      .select()
      .from(conversationAudit)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0])
      .orderBy(desc(conversationAudit.timestamp))
      .limit(limitNum);

    logger.info('Audit trail export', {
      startDate: startDate,
      endDate: endDate,
      phone: phone || 'all',
      intent: intent || 'all',
      count: results.length,
    });

    // Return as JSON
    res.setHeader('Content-Type', 'application/json');
    res.json({
      success: true,
      startDate,
      endDate,
      filters: {
        phone: phone || null,
        intent: intent || null,
      },
      count: results.length,
      entries: results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Audit trail export failed', { error: message });
    res.status(500).json({
      error: 'Failed to export audit trail',
      details: message,
    });
  }
});

// ─── GET /api/admin/audit-trail/stats ────────────────────────────

/**
 * Get aggregate statistics for audit trail.
 * Returns intent distribution, confidence metrics, action distribution.
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      res.status(400).json({
        error: 'Missing required query parameters: startDate and endDate',
      });
      return;
    }

    const start = new Date(String(startDate));
    const end = new Date(String(endDate));

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({
        error: 'Invalid date format. Use ISO format: YYYY-MM-DD',
      });
      return;
    }

    end.setUTCHours(23, 59, 59, 999);

    // Get all records for the date range
    const records = await db
      .select()
      .from(conversationAudit)
      .where(
        and(
          gte(conversationAudit.timestamp, start),
          lt(conversationAudit.timestamp, end)
        )
      );

    // Calculate statistics
    const intentCounts: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};
    let totalConfidence = 0;
    let confidenceCount = 0;
    const uniquePhones = new Set<string>();

    for (const record of records) {
      if (record.intent) {
        intentCounts[record.intent] = (intentCounts[record.intent] || 0) + 1;
      }
      if (record.actionTaken) {
        actionCounts[record.actionTaken] =
          (actionCounts[record.actionTaken] || 0) + 1;
      }
      if (record.confidence !== null && record.confidence !== undefined) {
        totalConfidence += record.confidence;
        confidenceCount += 1;
      }
      if (record.phone) {
        uniquePhones.add(record.phone);
      }
    }

    const avgConfidence =
      confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

    logger.info('Audit trail stats', {
      startDate,
      endDate,
      totalRecords: records.length,
      uniquePhones: uniquePhones.size,
      avgConfidence: avgConfidence.toFixed(3),
    });

    res.json({
      success: true,
      startDate,
      endDate,
      summary: {
        totalMessages: records.length,
        uniquePhones: uniquePhones.size,
        avgConfidence: Number(avgConfidence.toFixed(3)),
      },
      intentDistribution: intentCounts,
      actionDistribution: actionCounts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Audit trail stats failed', { error: message });
    res.status(500).json({
      error: 'Failed to compute audit trail stats',
      details: message,
    });
  }
});

export default router;
