/**
 * Daily Report Notification Route
 *
 * Called by PMS2 (port 5000) to deliver a formatted daily summary
 * via WhatsApp to all configured operators.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { loadAdminNotificationSettings } from '../../lib/admin-notification-settings.js';
import { sendToOperatorWithEscalation } from '../../lib/operator-escalation.js';
import { ok, badRequest, serverError } from './http-utils.js';
import { db } from '../../lib/db.js';
import { templateQualityEvents } from '../../../shared/schema.js';
import { desc, sql } from 'drizzle-orm';

const router = Router();

router.post('/notify-daily-report', async (req: Request, res: Response) => {
  try {
    const {
      occupancy,
      totalUnits,
      checkIns,
      checkOuts,
      overdueGuests,
      revenueToday,
      outstandingBalance,
      reportDate,
    } = req.body;

    if (occupancy === undefined || totalUnits === undefined) {
      badRequest(res, 'occupancy and totalUnits are required');
      return;
    }

    const config = await loadAdminNotificationSettings();
    if (!config.enabled || config.operators.length === 0) {
      ok(res, { sent: false, reason: 'disabled or no operators' });
      return;
    }

    const occupied = Number(occupancy) || 0;
    const total = Number(totalUnits) || 0;
    const rate = total > 0 ? Math.round((occupied / total) * 100) : 0;

    // Visual occupancy bar (10 segments)
    const filledSegments = Math.round(rate / 10);
    const bar = '█'.repeat(filledSegments) + '░'.repeat(10 - filledSegments);

    const date = reportDate || new Date().toISOString().slice(0, 10);
    const revenue = Number(revenueToday) || 0;
    const outstanding = Number(outstandingBalance) || 0;
    const ins = Number(checkIns) || 0;
    const outs = Number(checkOuts) || 0;
    const overdue = Number(overdueGuests) || 0;

    // Fetch template quality summary for last 24h (US-831)
    let templateQualitySection: string[] = [];
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const events24h = await db
        .select()
        .from(templateQualityEvents)
        .where(sql`${templateQualityEvents.createdAt} >= ${oneDayAgo}`)
        .orderBy(desc(templateQualityEvents.createdAt));

      if (events24h.length > 0) {
        const paused = events24h.filter(e => e.newStatus === 'PAUSED').length;
        const disabled = events24h.filter(e => e.newStatus === 'DISABLED').length;
        templateQualitySection = [
          '',
          `📋 *Template Quality*`,
          `Events (24h): ${events24h.length}`,
          ...(paused > 0 ? [`⚠️ Paused: ${paused}`] : []),
          ...(disabled > 0 ? [`🚨 Disabled: ${disabled}`] : []),
          ...(paused === 0 && disabled === 0 ? [`✅ All templates healthy`] : []),
        ];
      }
    } catch {
      // Non-critical — skip template quality if DB query fails
    }

    const lines = [
      `📊 *Daily Report — ${date}*`,
      '',
      `🏨 *Occupancy*`,
      `${bar} ${rate}%`,
      `${occupied}/${total} units occupied`,
      '',
      `📋 *Activity*`,
      `📥 Check-ins: ${ins}`,
      `📤 Checkouts: ${outs}`,
      `⚠️ Overdue: ${overdue}`,
      '',
      `💰 *Financials*`,
      `Collected today: RM ${revenue.toFixed(2)}`,
      `Outstanding: RM ${outstanding.toFixed(2)}`,
      ...templateQualitySection,
      '',
      '🤖 _Notification by Rainbow AI_',
    ];

    const message = lines.join('\n');
    const messageId = `daily-report-${Date.now()}`;

    await sendToOperatorWithEscalation(messageId, message, '[daily-report]');

    console.log(`[DailyReportNotify] Sent daily report for ${date}`);

    ok(res, { sent: true });
  } catch (error: any) {
    console.error('[DailyReportNotify] Failed to send notification:', error.message);
    serverError(res, error);
  }
});

export default router;
