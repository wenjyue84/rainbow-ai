/**
 * Booking Notification Route
 *
 * Called by PMS2 public-booking.ts after a guest makes a public booking.
 * Sends a WhatsApp message to configured operators with booking details.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadAdminNotificationSettings } from '../../lib/admin-notification-settings.js';
import { sendToOperatorWithEscalation } from '../../lib/operator-escalation.js';
import { ok, badRequest, serverError } from './http-utils.js';

const router = Router();

router.post('/notify-booking', async (req: Request, res: Response) => {
  try {
    const {
      guestName,
      phoneNumber,
      confirmationNumber,
      checkInDate,
      checkOutDate,
      numberOfGuests,
      totalAmount,
      checkInLink,
    } = req.body;

    if (!guestName || !checkInDate) {
      badRequest(res, 'guestName and checkInDate are required');
      return;
    }

    const config = await loadAdminNotificationSettings();
    if (!config.enabled || config.operators.length === 0) {
      ok(res, { sent: false, reason: 'disabled or no operators' });
      return;
    }

    // Build operator notification message
    const lines = [
      '📋 *New Booking Received!*',
      '',
      `👤 *Name:* ${guestName}`,
      `📱 *Phone:* ${phoneNumber || 'Not provided'}`,
    ];

    if (confirmationNumber) lines.push(`🔖 *Confirmation:* ${confirmationNumber}`);
    lines.push(`📅 *Check-in:* ${checkInDate}`);
    if (checkOutDate) lines.push(`📅 *Check-out:* ${checkOutDate}`);
    if (numberOfGuests) lines.push(`👥 *Guests:* ${numberOfGuests}`);
    if (totalAmount) lines.push(`💰 *Total:* RM${totalAmount}`);
    if (checkInLink) lines.push(`🔗 *Check-in link:* ${checkInLink}`);

    lines.push('');
    lines.push('🤖 _Notification by Rainbow AI_');

    const message = lines.join('\n');
    const messageId = `booking-${Date.now()}`;

    await sendToOperatorWithEscalation(messageId, message, '[booking]');

    console.log(`[BookingNotify] Sent operator notification for ${guestName} → ${confirmationNumber || 'no confirmation#'}`);

    ok(res, { sent: true });
  } catch (error: any) {
    console.error('[BookingNotify] Failed to send notification:', error.message);
    serverError(res, error);
  }
});

export default router;
