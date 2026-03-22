/**
 * Dead Letter Queue (DLQ) Admin API (US-055)
 *
 * GET  /api/admin/dlq              — paginated list of failed WhatsApp messages
 * POST /api/admin/dlq/:messageId/retry — move message back to main queue
 *
 * US-055
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { deadLetterQueue } from '../../../shared/schema.js';
import { desc, eq } from 'drizzle-orm';

const router = Router();

// US-055: List DLQ messages with pagination
router.get('/dlq', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    // Get total count
    const countResult = await db
      .select({ count: db.$count })
      .from(deadLetterQueue);
    const total = countResult[0]?.count || 0;

    // Get paginated messages sorted by failed_at descending
    const messages = await db
      .select()
      .from(deadLetterQueue)
      .orderBy(desc(deadLetterQueue.failedAt))
      .limit(limit)
      .offset(offset);

    res.json({
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      messages,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// US-055: Retry a message from the DLQ
router.post('/dlq/:messageId/retry', async (req: Request, res: Response) => {
  const messageId = req.params.messageId as string;
  if (!messageId) {
    res.status(400).json({ error: 'messageId is required' });
    return;
  }

  try {
    // Find the message in DLQ
    const [message] = await db
      .select()
      .from(deadLetterQueue)
      .where(eq(deadLetterQueue.id, messageId));

    if (!message) {
      res.status(404).json({ error: `Message ${messageId} not found in DLQ` });
      return;
    }

    // Reset retry_count to 0 and update the message
    await db
      .update(deadLetterQueue)
      .set({ retryCount: 0 })
      .where(eq(deadLetterQueue.id, messageId));

    res.json({
      success: true,
      messageId,
      status: 'Message queued for retry with retry_count reset to 0',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
