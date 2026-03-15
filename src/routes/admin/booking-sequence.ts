/**
 * Booking Sequence Admin Routes (US-884)
 *
 * POST /api/bookings          — Create a booking and schedule pre-arrival messages
 * GET  /api/bookings          — List bookings with scheduled message status
 * DELETE /api/bookings/:id    — Cancel a booking's pending messages
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { scheduleBookingSequence, cancelBookingSequence, listBookings } from '../../lib/booking-sequence.js';
import { ok, badRequest, notFound, serverError, validateRequired } from './http-utils.js';

const router = Router();

// POST /bookings — Create booking + schedule pre-arrival sequence
router.post('/bookings', async (req: Request, res: Response) => {
  try {
    const err = validateRequired(req.body, ['jid', 'guestName', 'arrivalDate']);
    if (err) { badRequest(res, err); return; }

    const { jid, guestName, arrivalDate, checkInTime, roomType, confirmationNumber } = req.body;

    // Validate arrivalDate is a valid date
    const parsedDate = new Date(arrivalDate);
    if (isNaN(parsedDate.getTime())) {
      badRequest(res, 'arrivalDate must be a valid ISO date (YYYY-MM-DD)');
      return;
    }

    const profileId = (res.locals.profileId as string) || 'pelangi';

    const result = await scheduleBookingSequence({
      jid,
      guestName,
      arrivalDate,
      checkInTime,
      roomType,
      confirmationNumber,
      profileId,
    });

    ok(res, result);
  } catch (error: any) {
    console.error('[BookingSequence] POST /bookings failed:', error.message);
    serverError(res, error);
  }
});

// GET /bookings — List bookings with message status
router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const profileId = (res.locals.profileId as string) || undefined;
    const bookings = await listBookings(profileId);
    ok(res, { bookings });
  } catch (error: any) {
    serverError(res, error);
  }
});

// DELETE /bookings/:id — Cancel booking's pending messages
router.delete('/bookings/:id', async (req: Request, res: Response) => {
  try {
    const bookingId = req.params.id;
    const cancelled = await cancelBookingSequence(bookingId);
    if (cancelled === 0) {
      notFound(res, 'Booking or pending messages');
      return;
    }
    ok(res, { cancelled });
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
