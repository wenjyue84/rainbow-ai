/**
 * Check-out Notification Route
 *
 * Called by the web server (port 5000) after a guest checks out.
 * Sends a WhatsApp message to configured operators with escalation fallback.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadAdminNotificationSettings } from '../../lib/admin-notification-settings.js';
import { sendToOperatorWithEscalation } from '../../lib/operator-escalation.js';
import { ok, badRequest, serverError } from './http-utils.js';

const router = Router();

router.post('/notify-checkout', async (req: Request, res: Response) => {
  try {
    const { guestName, unitNumber, checkoutTime } = req.body;

    if (!guestName || !unitNumber) {
      badRequest(res, 'guestName and unitNumber are required');
      return;
    }

    const config = await loadAdminNotificationSettings();
    if (!config.enabled || config.operators.length === 0) {
      ok(res, { sent: false, reason: 'disabled or no operators' });
      return;
    }

    const lines = [
      '🚪 *Guest Check-out*',
      '',
      `👤 *Name:* ${guestName}`,
      `🛏️ *Unit:* ${unitNumber}`,
    ];

    if (checkoutTime) lines.push(`⏰ *Checked out at:* ${checkoutTime}`);

    lines.push('');
    lines.push('🤖 _Notification by Rainbow AI_');

    const message = lines.join('\n');
    const messageId = `checkout-${Date.now()}`;

    await sendToOperatorWithEscalation(messageId, message, '[check-out]');

    console.log(`[CheckoutNotify] Sent operator notification for ${guestName} → ${unitNumber}`);

    ok(res, { sent: true });
  } catch (error: any) {
    console.error('[CheckoutNotify] Failed to send notification:', error.message);
    serverError(res, error);
  }
});

export default router;
