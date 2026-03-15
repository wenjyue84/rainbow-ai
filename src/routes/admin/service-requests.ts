/**
 * Admin API: Service Requests (US-875)
 *
 * GET  /service-requests          — List service requests (pending by default)
 * PATCH /service-requests/:id/resolve — Mark request as fulfilled, send completion message to guest
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { db } from '../../lib/db.js';
import { serviceRequests } from '../../../shared/schema-tables.js';
import { eq } from 'drizzle-orm';
import { resolveServiceRequest, listServiceRequests } from '../../lib/service-requests.js';

const router = Router();

// GET /service-requests — list service requests
router.get('/service-requests', async (req: Request, res: Response) => {
  const profile = typeof req.query.profile === 'string' ? req.query.profile : undefined;
  const status = req.query.status === 'resolved' ? 'resolved' as const :
                 req.query.status === 'all' ? undefined : 'pending' as const;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

  const rows = await listServiceRequests({ profile, status, limit });
  res.json({ serviceRequests: rows, total: rows.length });
});

// GET /service-requests/:id — get single request
router.get('/service-requests/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const rows = await db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).limit(1);
  if (rows.length === 0) {
    res.status(404).json({ error: 'Service request not found' });
    return;
  }
  res.json({ serviceRequest: rows[0] });
});

// PATCH /service-requests/:id/resolve — mark as fulfilled
router.patch('/service-requests/:id/resolve', async (req: Request, res: Response) => {
  const { id } = req.params;

  const resolved = await resolveServiceRequest(id);
  if (!resolved) {
    res.status(404).json({ error: 'Service request not found' });
    return;
  }

  console.log(`[ServiceRequests] Resolved request id=${id} type=${resolved.requestType} jid=${resolved.jid}`);

  // Attempt to send completion message to guest (best-effort)
  let guestNotified = false;
  try {
    const { sendWhatsAppMessage } = await import('../../lib/baileys-client.js');
    const completionMessages: Record<string, string> = {
      extra_towel: '✅ Your extra towels have been delivered! Enjoy your stay.',
      extra_pillow: '✅ Your extra pillow has been delivered! Sleep well.',
      room_cleaning: '✅ Your room has been cleaned and tidied up. Enjoy the freshness!',
      maintenance_issue: '✅ The maintenance issue in your room has been resolved. Please let us know if you need anything else.',
      wifi_password: '✅ Hope you are connected! Let us know if you need anything else.',
      amenity: '✅ Your request has been fulfilled. Enjoy your stay!',
    };

    const msg = completionMessages[resolved.requestType]
      ?? `✅ Your service request (${resolved.requestType}) has been fulfilled. Thank you for your patience!`;

    await sendWhatsAppMessage(resolved.jid, msg);
    guestNotified = true;
    console.log(`[ServiceRequests] Completion message sent to ${resolved.jid}`);
  } catch (err: any) {
    console.warn(`[ServiceRequests] Could not send completion message to guest:`, err.message);
  }

  res.json({ success: true, id, requestType: resolved.requestType, guestNotified });
});

export default router;
