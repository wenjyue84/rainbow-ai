import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { authBruteForceStore, ADMIN_IP_ALLOWLIST } from '../../lib/auth-brute-force.js';
import { isReady } from '../../lib/readiness.js';

import knowledgeBaseRoutes from './knowledge-base.js';
import memoryRoutes from './memory.js';
import configRoutes from './config.js';
import testingRoutes from './testing.js';
import conversationsRoutes from './conversations.js';
import whatsappRoutes from './whatsapp.js';
import metricsRoutes from './metrics.js';
import intentManagerRoutes from './intent-manager.js';
import feedbackRoutes from './feedback.js';
import feedbackSettingsRoutes from './feedback-settings.js';
import intentAnalyticsRoutes from './intent-analytics.js';
import templatesRoutes from './templates.js';
import activityRoutes from './activity.js';
import adminNotificationsRoutes from './admin-notifications.js';
import checkinNotifyRoutes from './checkin-notify.js';
import checkoutNotifyRoutes from './checkout-notify.js';
import bookingNotifyRoutes from './booking-notify.js';
import dailyReportNotifyRoutes from './daily-report-notify.js';
import prismaBotRoutes from './prisma-bot.js';
import tagsRoutes from './tags.js';
import unitsRoutes from './units.js';
import customMessagesRoutes from './custom-messages.js';
import scheduledMessagesRoutes from './scheduled-messages.js';
import paymentRemindersRoutes from './payment-reminders.js';
import latencyRoutes from '../test/latency.js';
import fleetRoutes from './fleet.js';
import profilesRoutes from './profiles.js';
import mcpServersRoutes from './mcp-servers.js';
import webchatRoutes from './webchat.js';
import integrationHealthRoutes from './integration-health.js';
import diagnosticsRoutes from './diagnostics.js';
import optOutsRoutes from './opt-outs.js';
import kbHealthRoutes from './kb-health.js';
import dataRetentionRoutes from './data-retention.js';
import gdprErasureRoutes from './gdpr-erasure.js';
import consentRoutes from './consent.js';
import llmCostRoutes from './llm-cost.js';
import frequencyCapRoutes from './frequency-cap.js';
import dlqRoutes from './dlq.js';
import deliveryStatusRoutes from './delivery-status.js';
import tracesRoutes from './traces.js';
import escalationsRoutes from './escalations.js';
import qualityMetricsRoutes from './quality-metrics.js';
import intentGapsRoutes from './intent-gaps.js';
import messagingLimitsRoutes from './messaging-limits.js';
import phoneQualityRoutes from './phone-quality.js';
import whatsappCostRoutes from './whatsapp-cost.js';
import analyticsLatencyRoutes from './analytics-latency.js';
import authRoutes from './auth.js';

const router = Router();

// ─── Auth Middleware ─────────────────────────────────────────────────
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

  // Local connections and allowlisted IPs bypass lockout and key check
  if (isLocal || ADMIN_IP_ALLOWLIST.has(ip)) {
    next();
    return;
  }

  // Reject locked-out IPs before any key check
  if (authBruteForceStore.isLockedOut(ip)) {
    res.status(429).json({ error: 'Too Many Requests: IP temporarily locked after repeated failed auth attempts' });
    return;
  }

  const adminKey = process.env.RAINBOW_ADMIN_KEY;
  if (!adminKey) {
    res.status(401).json({ error: 'Unauthorized: RAINBOW_ADMIN_KEY not configured for remote access' });
    return;
  }

  const provided = req.headers['x-admin-key'];
  if (typeof provided === 'string' && provided.length > 0) {
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(adminKey);
    if (providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      // Successful auth: clear any previous failure record for this IP
      authBruteForceStore.clearRecord(ip);
      next();
      return;
    }
  }

  // Auth failed: record attempt and log
  authBruteForceStore.recordFailure(ip);
  console.warn(`[auth] Failed attempt from IP ${ip} at ${new Date().toISOString()}`);
  res.status(401).json({ error: 'Unauthorized' });
}

router.use(adminAuth);

// ─── Readiness Gate (US-450) ────────────────────────────────────────
// Block all admin API requests until critical subsystems have initialised.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (!isReady()) {
    res.status(503).json({ status: 'starting' });
    return;
  }
  next();
});

// ─── Profile Resolution Middleware ──────────────────────────────────
// Reads x-profile-id header and attaches the profile's ConfigStore to res.locals
router.use((req: Request, res: Response, next: NextFunction) => {
  const profileId = req.headers['x-profile-id'] as string | undefined;
  if (profileId && profileRegistry.isInitialized()) {
    const profile = profileRegistry.getProfile(profileId);
    if (profile) {
      res.locals.profileConfigStore = profile.configStore;
      res.locals.profileId = profileId;
    }
  }
  next();
});

// ─── Rate Limiting (mutation endpoints) ─────────────────────────────
const adminMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 60 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin API requests. Please try again later.' },
  skip: (req: Request) => req.method === 'GET', // Only limit mutations
});
router.use(adminMutationLimiter);

// ─── Selective Cache Headers ─────────────────────────────────────────
// Stable endpoints (config/definitions that rarely change) — 60s cache
const STABLE_PATHS = [
  '/settings', '/templates', '/intents', '/routing',
  '/knowledge-base', '/knowledge', '/workflows', '/workflow',
  '/intent-manager/keywords', '/intent-manager/examples',
  '/intent-manager/tiers', '/intent-manager/llm-settings',
  '/mcp-servers',
];
// Semi-stable endpoints (aggregated stats, refresh every 30s)
const SEMI_STABLE_PATHS = [
  '/feedback/stats', '/intent/accuracy',
  '/conversations/stats', '/intent-manager/stats', '/analytics/llm-cost', '/analytics/messaging-limits',
  '/analytics/phone-quality', '/analytics/latency',
];

router.use((req: Request, res: Response, next: NextFunction) => {
  const path = req.path;
  // Only cache GET requests; all mutations remain uncacheable
  if (req.method === 'GET' && STABLE_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
    res.setHeader('Cache-Control', 'public, max-age=60');
  } else if (req.method === 'GET' && SEMI_STABLE_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
    res.setHeader('Cache-Control', 'public, max-age=30');
  } else {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
  next();
});

// ─── Mount Sub-Routers ──────────────────────────────────────────────
router.use(knowledgeBaseRoutes);
router.use(memoryRoutes);
router.use(configRoutes);
router.use(testingRoutes);
router.use(conversationsRoutes);
router.use(whatsappRoutes);
router.use(metricsRoutes);
router.use(intentManagerRoutes);
router.use(feedbackRoutes);
router.use(feedbackSettingsRoutes);
router.use(intentAnalyticsRoutes);
router.use('/templates', templatesRoutes);
router.use(activityRoutes);
router.use('/admin-notifications', adminNotificationsRoutes);
router.use(checkinNotifyRoutes);
router.use(checkoutNotifyRoutes);
router.use(bookingNotifyRoutes);
router.use(dailyReportNotifyRoutes);
router.use(prismaBotRoutes);
router.use(tagsRoutes);
router.use(unitsRoutes);
router.use(customMessagesRoutes);
router.use(scheduledMessagesRoutes);
router.use(paymentRemindersRoutes);
router.use('/test', latencyRoutes);
router.use(fleetRoutes);
router.use(profilesRoutes);
router.use(mcpServersRoutes);
router.use(webchatRoutes);
router.use(integrationHealthRoutes);
router.use(diagnosticsRoutes);
router.use(optOutsRoutes);
router.use(kbHealthRoutes);
router.use(dataRetentionRoutes);
router.use(gdprErasureRoutes);
router.use(consentRoutes);
router.use(llmCostRoutes);
router.use(frequencyCapRoutes);
router.use(dlqRoutes);
router.use(deliveryStatusRoutes);
router.use(tracesRoutes);
router.use(escalationsRoutes);
router.use(qualityMetricsRoutes);
router.use(intentGapsRoutes);
router.use(messagingLimitsRoutes);
router.use(phoneQualityRoutes);
router.use(whatsappCostRoutes);
router.use(analyticsLatencyRoutes);
router.use(authRoutes);

// Ensure unmatched /api/rainbow/* returns JSON 404 (never HTML)
// US-504: Do not echo the requested path back to the client
router.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// API error handler: always respond with JSON (never HTML)
// US-504: Never leak err.message, stack traces, or file paths to client
router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  console.error('[AdminErrorHandler]', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default router;
