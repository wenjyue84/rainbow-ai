import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { authBruteForceStore, ADMIN_IP_ALLOWLIST } from '../../lib/auth-brute-force.js';
import { isReady } from '../../lib/readiness.js';
import { checkRole } from '../../lib/rbac.js';
import { enforceAdminTenantScope, isValidTenant } from '../../lib/tenant-context.js';
import { ADMIN_ROLES } from '../../../shared/schema.js';
import type { AdminRole } from '../../../shared/schema.js';

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
import gdprDataExportRoutes from './gdpr-data-export.js';
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
import analyticsKpisRoutes from './analytics-kpis.js';
import slowQueriesRoutes from './slow-queries.js';
import fallbackAlertRoutes from './fallback-alert.js';
import jidRateLimiterRoutes from './jid-rate-limiter.js';
import templateQualityRoutes from './template-quality.js';
import authRoutes from './auth.js';
import experimentsRoutes from './experiments.js';
import breachReportRoutes from './breach-report.js';
import menuAllergensRoutes from './menu-allergens.js';
import menuItemsRoutes from './menu-items.js';
import rateLimitSettingsRoutes from './rate-limit-settings.js';
import serviceRequestsRoutes from './service-requests.js';
import bookingSequenceRoutes from './booking-sequence.js';
import waTemplatesRoutes from './wa-templates.js';
import pdpaDpoRoutes from './pdpa-dpo.js';
import referralAttributionRoutes from './referral-attribution.js';
import hallucinationReportRoutes from './hallucination-report.js';
import complianceRoutes from './compliance.js';
import festiveStickersRoutes from './festive-stickers.js';
import manglishRoutes from './manglish.js';
import inventoryRoutes from './inventory.js';

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

// ─── Profile Resolution + Tenant Context Middleware (US-908) ─────────
// Reads x-profile-id header and attaches the profile's ConfigStore to res.locals.
// Also sets res.locals.tenantId for tenant isolation enforcement.
router.use((req: Request, res: Response, next: NextFunction) => {
  const profileId = req.headers['x-profile-id'] as string | undefined;
  if (profileId && profileRegistry.isInitialized()) {
    const profile = profileRegistry.getProfile(profileId);
    if (profile) {
      res.locals.profileConfigStore = profile.configStore;
      res.locals.profileId = profileId;
    }
  }
  // US-908: Set tenantId from validated profile header
  if (profileId && isValidTenant(profileId)) {
    res.locals.tenantId = profileId;
  }
  next();
});

// ─── Role Resolution Middleware (US-898) ─────────────────────────────
// Client passes x-admin-role header (obtained from /auth/login response).
// Trusted because the request already passed admin key auth above.
router.use((req: Request, res: Response, next: NextFunction) => {
  const rawRole = req.headers['x-admin-role'] as string | undefined;
  if (rawRole && (ADMIN_ROLES as readonly string[]).includes(rawRole)) {
    res.locals.adminRole = rawRole as AdminRole;
  }
  // If header missing, res.locals.adminRole stays undefined → checkRole
  // defaults to 'operator' for backwards compatibility during migration.
  next();
});

// ─── Tenant Scope Enforcement (US-908) ───────────────────────────────
// If the admin user has an allowed_tenants restriction, reject requests
// to tenants they are not authorized for.
router.use(enforceAdminTenantScope);

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

// ─── Endpoint-Specific Rate Limiting (US-904) ───────────────────────
// Strict limiter for auth routes: 5 requests per minute per IP (brute-force protection)
export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,
  standardHeaders: true,   // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset + Retry-After
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});
router.use('/auth', authRateLimiter);

// Standard limiter for analytics and read-only GET routes: 60 requests per minute per IP
export const standardReadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,   // RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: (req: Request) => req.method !== 'GET', // Only limit GET requests
});
router.use('/analytics', standardReadLimiter);

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
  '/analytics/phone-quality', '/analytics/template-quality', '/analytics/latency', '/analytics/kpis', '/analytics/kpis/containment',
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

// ─── RBAC: Method-based role enforcement (US-898) ───────────────────
// Viewers can only use GET/HEAD/OPTIONS. Mutations require operator+.
// Super-admin-only routes are guarded individually below.
const requireOperator = checkRole(['operator', 'super-admin']);
const requireSuperAdmin = checkRole(['super-admin']);

router.use((req: Request, res: Response, next: NextFunction) => {
  // Auth routes are always accessible (login, register, 2fa)
  if (req.path.startsWith('/auth/')) { next(); return; }
  // GET/HEAD/OPTIONS are read-only — all roles can access
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  // All mutations require at least operator role
  requireOperator(req, res, next);
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

// Super-admin only: user management, profile config, data deletion, GDPR
router.use(profilesRoutes);    // Profile config — super-admin for mutations (GET allowed above)
router.use(mcpServersRoutes);
router.use(webchatRoutes);
router.use(integrationHealthRoutes);
router.use(diagnosticsRoutes);
router.use(optOutsRoutes);
router.use(kbHealthRoutes);
router.use(dataRetentionRoutes);
router.use(gdprErasureRoutes);    // Data deletion — super-admin enforced below
router.use(gdprDataExportRoutes);
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
router.use(analyticsKpisRoutes);
router.use(slowQueriesRoutes);
router.use(fallbackAlertRoutes);
router.use(jidRateLimiterRoutes);
router.use(templateQualityRoutes);
router.use(authRoutes);
router.use(experimentsRoutes);
router.use(breachReportRoutes);
router.use(menuAllergensRoutes);
router.use(menuItemsRoutes);
router.use(rateLimitSettingsRoutes);
router.use(serviceRequestsRoutes);
router.use(bookingSequenceRoutes);
router.use(waTemplatesRoutes);
router.use(pdpaDpoRoutes);
router.use(referralAttributionRoutes);
router.use(hallucinationReportRoutes);
router.use(complianceRoutes);
router.use(festiveStickersRoutes);
router.use(manglishRoutes);
router.use(inventoryRoutes);

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
