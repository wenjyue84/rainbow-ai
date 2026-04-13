/**
 * US-550: Guest Context Quick-Lookup Endpoint
 *
 * GET /admin/guests/:id/summary
 * Returns guest summary with name, unit, arrival/departure dates
 * Performance: <50ms via cached lookup
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadGuestContext } from '../../tools/guest-data-injector.js';
import { ok, badRequest, serverError, notFound } from './http-utils.js';

const router = Router();

/**
 * GET /admin/guests/:id/summary
 *
 * Query params:
 *   - profile: string (optional, default: 'pelangi')
 *
 * Response: {id, name, unit, arrival_date, departure_date, nights}
 *
 * Example:
 *   GET /admin/guests/60123456789/summary?profile=pelangi
 *   -> {
 *        id: "60123456789",
 *        name: "John Doe",
 *        unit: "Capsule-A2",
 *        arrival_date: "2026-04-15",
 *        departure_date: "2026-04-18",
 *        nights: 3
 *      }
 */
router.get('/guests/:id/summary', async (req: Request, res: Response) => {
  try {
    const guestId = decodeURIComponent(req.params.id as string);
    const profile = (req.query.profile as string) || 'pelangi';

    if (!guestId || !guestId.trim()) {
      badRequest(res, 'Guest ID (phone number) required');
      return;
    }

    const startTime = Date.now();
    const context = await loadGuestContext(profile, guestId);
    const duration = Date.now() - startTime;

    console.log(`[GuestsQuickLookup] Retrieved guest summary for ${guestId} in ${duration}ms`);

    ok(res, {
      id: context.id,
      name: context.name,
      unit: context.unit,
      arrival_date: context.arrival_date,
      departure_date: context.departure_date,
      nights: context.nights,
      _lookup_ms: duration, // For performance monitoring
    });
  } catch (err: any) {
    if (err.message && err.message.includes('Guest not found')) {
      notFound(res, `Guest ${req.params.id} not found for profile ${req.query.profile || 'pelangi'}`);
    } else {
      serverError(res, err);
    }
  }
});

export default router;
