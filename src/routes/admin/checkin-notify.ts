/**
 * Check-in Notification Route
 *
 * Called by the web server (port 5000) after a guest completes self-check-in.
 * Sends a WhatsApp message to admin with guest details.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadAdminNotificationSettings } from '../../lib/admin-notification-settings.js';
import { sendToOperatorWithEscalation } from '../../lib/operator-escalation.js';
import { ok, badRequest, serverError } from './http-utils.js';

const router = Router();

router.post('/notify-checkin', async (req: Request, res: Response) => {
  try {
    const {
      guestName,
      phoneNumber,
      unitNumber,
      checkInDate,
      checkOutDate,
      idNumber,
      email,
      nationality,
      gender,
      age,
    } = req.body;

    if (!guestName || !unitNumber) {
      badRequest(res, 'guestName and unitNumber are required');
      return;
    }

    const config = await loadAdminNotificationSettings();
    if (!config.enabled || config.operators.length === 0) {
      ok(res, { sent: false, reason: 'disabled or no operators' });
      return;
    }

    // Build operator notification message
    const lines = [
      '🏨 *New Self-Check-in Completed!*',
      '',
      `👤 *Name:* ${guestName}`,
      `📱 *Phone:* ${phoneNumber || 'Not provided'}`,
      `🛏️ *Unit:* ${unitNumber}`,
    ];

    if (checkInDate) lines.push(`📅 *Check-in:* ${checkInDate}`);
    if (checkOutDate) lines.push(`📅 *Check-out:* ${checkOutDate}`);
    if (idNumber) lines.push(`🪪 *ID:* ${idNumber}`);
    if (email) lines.push(`📧 *Email:* ${email}`);
    if (nationality) lines.push(`🌍 *Nationality:* ${nationality}`);
    if (gender) lines.push(`👤 *Gender:* ${gender}`);
    if (age) lines.push(`🎂 *Age:* ${age}`);

    lines.push('');
    lines.push('✅ Guest has completed the self-check-in form.');
    lines.push('🤖 _Notification by Rainbow AI_');

    const message = lines.join('\n');
    const messageId = `checkin-${Date.now()}`;

    await sendToOperatorWithEscalation(messageId, message, '[check-in]');

    console.log(`[CheckinNotify] Sent operator notification for ${guestName} → ${unitNumber}`);

    ok(res, { sent: true });
  } catch (error: any) {
    console.error('[CheckinNotify] Failed to send notification:', error.message);
    serverError(res, error);
  }
});

export default router;
