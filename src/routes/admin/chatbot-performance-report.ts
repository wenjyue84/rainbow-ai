/**
 * Admin API: Chatbot Performance Report (US-825)
 *
 * GET  /settings/chatbot-report        — get current settings
 * PATCH /settings/chatbot-report       — update settings (enabled, recipient_phone, send_time, profile_id)
 * POST /chatbot-report/send-now        — manually trigger report (for testing)
 * GET  /chatbot-report/log             — view delivery log
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, serverError, getStore } from './http-utils.js';
import {
  buildAndSendChatbotReport,
  getReportLog,
  startChatbotReportScheduler,
  type ChatbotReportSettings,
} from '../../lib/chatbot-performance-report.js';

const router = Router();

// ─── GET /settings/chatbot-report ────────────────────────────────────
router.get('/settings/chatbot-report', (req: Request, res: Response) => {
  const settings = getStore(res).getSettings() as any;
  const chatbotReport: ChatbotReportSettings = settings?.chatbot_report ?? {
    enabled: false,
    recipient_phone: '',
    send_time: '08:00',
    profile_id: '',
  };
  ok(res, { chatbot_report: chatbotReport });
});

// ─── PATCH /settings/chatbot-report ──────────────────────────────────
router.patch('/settings/chatbot-report', (req: Request, res: Response) => {
  const { enabled, recipient_phone, send_time, profile_id } = req.body;

  // Validate send_time if provided
  if (send_time !== undefined) {
    const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.test(send_time);
    if (!match) {
      badRequest(res, 'send_time must be in HH:MM format (e.g. "08:00")');
      return;
    }
  }

  const store = getStore(res);
  const current = store.getSettings() as any;
  const existing: ChatbotReportSettings = current?.chatbot_report ?? {
    enabled: false,
    recipient_phone: '',
    send_time: '08:00',
    profile_id: '',
  };

  const updated: ChatbotReportSettings = {
    ...existing,
    ...(enabled !== undefined ? { enabled: Boolean(enabled) } : {}),
    ...(recipient_phone !== undefined ? { recipient_phone: String(recipient_phone) } : {}),
    ...(send_time !== undefined ? { send_time: String(send_time) } : {}),
    ...(profile_id !== undefined ? { profile_id: String(profile_id) } : {}),
  };

  store.setSettings({ ...current, chatbot_report: updated });

  // Restart scheduler with updated settings
  try {
    startChatbotReportScheduler();
  } catch (err: any) {
    console.warn('[ChatbotReport] Failed to restart scheduler after settings update:', err.message);
  }

  ok(res, { chatbot_report: updated });
});

// ─── POST /chatbot-report/send-now ───────────────────────────────────
router.post('/chatbot-report/send-now', async (req: Request, res: Response) => {
  try {
    const settings = getStore(res).getSettings() as any;
    const chatbotReport: ChatbotReportSettings = settings?.chatbot_report;

    if (!chatbotReport) {
      badRequest(res, 'chatbot_report settings not configured');
      return;
    }

    // Allow override of recipient for one-off manual sends
    const recipient = req.body.recipient_phone || chatbotReport.recipient_phone;
    if (!recipient) {
      badRequest(res, 'recipient_phone not configured. Set it in settings or pass in request body.');
      return;
    }

    const result = await buildAndSendChatbotReport({
      ...chatbotReport,
      recipient_phone: recipient,
    });

    ok(res, result);
  } catch (err: any) {
    serverError(res, err);
  }
});

// ─── GET /chatbot-report/log ─────────────────────────────────────────
router.get('/chatbot-report/log', (_req: Request, res: Response) => {
  const log = getReportLog();
  ok(res, { log, total: log.length });
});

export default router;
