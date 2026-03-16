/**
 * E-Invoice Admin API (US-1039)
 *
 * GET  /einvoice/dashboard — monthly success rate, failure reasons, pending count
 * GET  /einvoice/queue     — list queue entries with pagination and filtering
 * POST /einvoice/retry/:id — manually retry a failed/expired invoice
 * POST /einvoice/queue     — manually queue an e-invoice submission
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and, gte, lte, sql, desc, count } from 'drizzle-orm';
import { db } from '../../lib/db.js';
import { einvoiceQueue } from '../../../shared/schema.js';
import { queueEinvoice } from '../../lib/einvoice-queue.js';

const router = Router();

// GET /einvoice/dashboard — monthly submission stats
router.get('/einvoice/dashboard', async (req: Request, res: Response) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  // Aggregate counts by status for the current month
  const statusCounts = await db
    .select({
      status: einvoiceQueue.status,
      count: count(),
    })
    .from(einvoiceQueue)
    .where(
      and(
        gte(einvoiceQueue.createdAt, monthStart),
        lte(einvoiceQueue.createdAt, monthEnd),
      )
    )
    .groupBy(einvoiceQueue.status);

  const stats: Record<string, number> = {};
  let total = 0;
  for (const row of statusCounts) {
    stats[row.status] = Number(row.count);
    total += Number(row.count);
  }

  const delivered = stats['delivered'] || 0;
  const validated = stats['validated'] || 0;
  const successCount = delivered + validated;
  const successRate = total > 0 ? ((successCount / total) * 100).toFixed(1) : '0.0';

  // Top failure reasons this month
  const failures = await db
    .select({
      lastError: einvoiceQueue.lastError,
      count: count(),
    })
    .from(einvoiceQueue)
    .where(
      and(
        gte(einvoiceQueue.createdAt, monthStart),
        lte(einvoiceQueue.createdAt, monthEnd),
        eq(einvoiceQueue.status, 'expired'),
      )
    )
    .groupBy(einvoiceQueue.lastError)
    .orderBy(desc(count()))
    .limit(10);

  // Currently pending/in-flight count
  const pendingResult = await db
    .select({ count: count() })
    .from(einvoiceQueue)
    .where(
      sql`${einvoiceQueue.status} IN ('pending', 'submitted')`
    );

  res.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    total,
    delivered,
    validated,
    pending: stats['pending'] || 0,
    submitted: stats['submitted'] || 0,
    failed: stats['failed'] || 0,
    expired: stats['expired'] || 0,
    successRate: `${successRate}%`,
    currentPending: Number(pendingResult[0]?.count || 0),
    topFailureReasons: failures.map(f => ({
      reason: f.lastError || 'Unknown',
      count: Number(f.count),
    })),
  });
});

// GET /einvoice/queue — list queue entries with pagination
router.get('/einvoice/queue', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const statusFilter = req.query.status as string | undefined;

  let query = db.select().from(einvoiceQueue).orderBy(desc(einvoiceQueue.createdAt)).limit(limit).offset(offset);

  if (statusFilter) {
    query = db.select().from(einvoiceQueue)
      .where(eq(einvoiceQueue.status, statusFilter))
      .orderBy(desc(einvoiceQueue.createdAt))
      .limit(limit)
      .offset(offset);
  }

  const entries = await query;
  res.json({ count: entries.length, offset, entries });
});

// POST /einvoice/retry/:id — manually retry a failed/expired invoice
router.post('/einvoice/retry/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [entry] = await db.select().from(einvoiceQueue).where(eq(einvoiceQueue.id, id)).limit(1);
  if (!entry) {
    res.status(404).json({ error: 'Invoice queue entry not found' });
    return;
  }

  if (entry.status === 'delivered') {
    res.status(400).json({ error: 'Invoice already delivered' });
    return;
  }

  // Reset for retry
  await db.update(einvoiceQueue)
    .set({
      status: 'pending',
      nextRetryAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(einvoiceQueue.id, id));

  res.json({ message: 'Invoice queued for retry', id });
});

// POST /einvoice/queue — manually queue an e-invoice
router.post('/einvoice/queue', async (req: Request, res: Response) => {
  const { transactionType, transactionId, customerPhone, customerName, customerIdNumber, lineItems, totalAmount, sstAmount, profileId } = req.body;

  if (!transactionType || !transactionId || !lineItems || totalAmount == null) {
    res.status(400).json({ error: 'Missing required fields: transactionType, transactionId, lineItems, totalAmount' });
    return;
  }

  const id = await queueEinvoice({
    transactionType,
    transactionId,
    profileId,
    customerPhone,
    customerName,
    customerIdNumber,
    lineItems,
    totalAmount,
    sstAmount,
  });

  res.status(201).json({ message: 'Invoice queued for submission', id });
});

export default router;
