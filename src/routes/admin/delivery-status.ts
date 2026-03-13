/**
 * Delivery Status Admin API (US-426)
 *
 * GET /messages/:id/status  — get delivery status for a specific Baileys message ID
 * GET /delivery-status/:phone — get all delivery statuses for a phone number
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDeliveryStatus, getDeliveryStatusByPhone } from '../../lib/delivery-status.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware

// GET /messages/:id/status — delivery status for a specific message
router.get('/messages/:id/status', async (req: Request, res: Response) => {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Message ID is required' });
    return;
  }

  const status = await getDeliveryStatus(id);
  if (!status) {
    res.status(404).json({ error: 'No delivery status found for this message' });
    return;
  }
  res.json(status);
});

// GET /delivery-status/:phone — all delivery statuses for a phone number
router.get('/delivery-status/:phone', async (req: Request, res: Response) => {
  const { phone } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const statuses = await getDeliveryStatusByPhone(phone, limit);
  res.json({ count: statuses.length, statuses });
});

export default router;
