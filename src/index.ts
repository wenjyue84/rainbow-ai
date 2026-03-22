// Catch silent crashes from Baileys / unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason);
});

import express from 'express';
import { randomBytes } from 'crypto';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { createServer as createHttpServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createMCPHandler } from './server.js';
import { apiClient, getApiBaseUrl } from './lib/http-client.js';
import { getWhatsAppStatus, whatsappManager } from './lib/baileys-client.js';
import { startBaileysWithSupervision } from './lib/baileys-supervisor.js';
import { pool, getPoolMetrics, initDb } from './lib/db.js';
import { initSecrets, checkSecretsHealth } from './lib/secrets.js';
import { validateEnvironment } from './lib/env-validator.js';
import adminRoutes from './routes/admin/index.js';
import webchatApiRoutes from './routes/public/webchat-api.js';
import fnbChatRoutes from './routes/public/fnb-chat.js';
import gdprPortabilityRoutes from './routes/public/gdpr-portability.js';
import webhookRoutes from './routes/webhooks/index.js';
import whatsappFlowsRoutes from './routes/public/whatsapp-flows.js';
import whatsappFlowsCheckinRoutes from './routes/public/whatsapp-flows-checkin.js';
import whatsappFlowsMenuRoutes from './routes/public/whatsapp-flows-menu.js';
import paymentWebviewRoutes from './routes/public/payment-webview.js';
import pushApiRoutes from './routes/public/push-api.js';
import { captureRawBody } from './lib/webhook-signature.js';
import { safeRedirect } from './lib/safe-redirect.js';
import { buildConnectSrc, buildImgSrc } from './lib/csp-directives.js';
import { initFeedbackSettings } from './lib/init-feedback-settings.js';
import { initAdminNotificationSettings } from './lib/admin-notification-settings.js';
import { configStore } from './assistant/config-store.js';
import { profileRegistry } from './assistant/profile-registry.js';
import { initKnowledgeBase, initKBFromDB, checkKBStaleness } from './assistant/knowledge-base.js';
import { initUnitCache } from './lib/unit-cache.js';
import { initScheduler } from './lib/message-scheduler.js';
import { ensureConfigTables } from './lib/config-db.js';
import { reloadLLMSettingsFromDB } from './assistant/llm-settings-loader.js';
import { loadIntentTiersFromDB } from './assistant/intent-config.js';
import { initPricingFromDB } from './assistant/pricing.js';
import { initAllergenStore } from './lib/allergen-store.js';
import { loadMenuItemsFromDB, ensureStockEventsTable } from './lib/menu-items-store.js';
import { loadOptOutCache } from './assistant/opt-out.js';
import { startQualityMetricsJob } from './lib/quality-metrics.js';
import { loadQualityStateFromDb } from './lib/phone-quality.js';
import { checkMetaCACert } from './lib/meta-ca-check.js';
import { loadTodayCosts, startBudgetAlertInterval } from './assistant/llm-cost-budget.js';
import { loadTodayWhatsappCosts, startWhatsappCostDailyJob } from './lib/whatsapp-cost.js';
import { isReady, markReady, markListening } from './lib/readiness.js';
import {
  ensurePgStatStatements,
  startSlowQueryMonitor,
  setSlowQueryAlertHandler,
} from './lib/slow-query-monitor.js';
import { notifyAdminSlowQuery } from './lib/admin-notifier.js';
import { startFallbackAlertScheduler } from './lib/fallback-alert.js';
import { computeAvailability } from './assistant/business-hours.js';
import type { BusinessHoursConfig } from './assistant/business-hours.js';
import { startHandoffSlaCron } from './lib/handoff-sla.js';
import { checkBreachDeadlines } from './routes/admin/breach-report.js';
import { migrateObsoleteTiers, checkMessagingVolumeLimits } from './routes/admin/messaging-limits.js';
import { loadPacingStateFromDb, startPacingMonitor } from './lib/pacing-monitor.js';
import { startWebhookHealthCheck, getWebhookHealthState } from './lib/waba-webhook-health.js';
import { MEDIA_BASE_DIR } from './lib/media-downloader.js';
import { startBookingSequenceProcessor } from './lib/booking-sequence.js';
import { startEinvoiceQueueProcessor } from './lib/einvoice-queue.js';
import { startBreachDetectionScheduler } from './lib/breach-detection.js';
import { startConsentExpiryScheduler } from './lib/marketing-optin.js';
import { startRetentionScheduler } from './lib/data-retention.js';
import { runCanaryProbesOnStartup, startCanaryScheduler } from './assistant/canary-probe.js';
import { initializeQueue } from './assistant/intent-tracker.js';
import { validateAllProfiles, formatReport } from './lib/profile-validator.js';
import { validateProfileIntents } from './lib/config.js';
import { validateAllProfiles as validateIntentWhitelists, getViolationsSummary } from './assistant/validators/profile-intent-whitelist.js';

const __filename_main = fileURLToPath(import.meta.url);
const __dirname_main = dirname(__filename_main);

// Env loading: dotenv-cli pre-loads .env.southern.local for the Southern instance.
// For Pelangi (npm run dev / start-rainbow.bat), we load .env.pelangi.local explicitly.
// cwd dotenv() picks up any remaining vars from repo root .env without overriding.
if (!process.env.BUSINESS_NAME) {
  dotenv.config({ path: join(__dirname_main, '..', '.env.pelangi.local') });
}
dotenv.config();

// US-499: Fetch secrets from AWS Secrets Manager (when enabled).
// Must run BEFORE any module reads DATABASE_URL or API keys.
try {
  await initSecrets();
} catch (err: any) {
  console.error('[Startup] FATAL: Secrets Manager initialization failed:', err.message);
  if (process.env.USE_SECRETS_MANAGER === 'true') {
    // Fail loudly when SM is required but unreachable
    console.error('[Startup] Set USE_SECRETS_MANAGER=false to fall back to .env file values');
    process.exit(1);
  }
}

// US-033: Validate required environment variables before initializing DB/server.
// Exits with code 1 and human-readable errors if DATABASE_URL, MCP_SERVER_PORT, or NODE_ENV are missing/invalid.
try {
  validateEnvironment();
} catch (err: any) {
  console.error(err.message);
  process.exit(1);
}

// US-044: Profile data schema validation.
// Checks that each profile's data files contain only profile-appropriate content.
// Blocks startup when STRICT_PROFILE_VALIDATION=true; otherwise logs a warning.
{
  const profileReport = validateAllProfiles(join(__dirname_main, '..'));
  if (!profileReport.isClean) {
    console.warn('[Startup] WARNING: Profile data contamination detected:\n' + formatReport(profileReport));
    if (process.env.STRICT_PROFILE_VALIDATION === 'true') {
      console.error('[Startup] FATAL: Aborting startup due to profile data contamination (STRICT_PROFILE_VALIDATION=true)');
      process.exit(1);
    }
  }
}

// US-067: Profile intent whitelist validation.
// Ensures each profile only contains intents from its curated whitelist.
// Prevents cross-contamination (e.g., cafe intents in hostel profile).
{
  try {
    const whitelistViolations = validateIntentWhitelists();
    let hasViolations = false;
    for (const [, violations] of whitelistViolations) {
      if (violations.length > 0) {
        hasViolations = true;
        break;
      }
    }

    if (hasViolations) {
      const summary = getViolationsSummary(whitelistViolations);
      console.warn('[Startup] WARNING: Intent whitelist violations detected:\n' + summary);
      if (process.env.STRICT_PROFILE_VALIDATION === 'true') {
        console.error('[Startup] FATAL: Aborting startup due to intent whitelist violations (STRICT_PROFILE_VALIDATION=true)');
        process.exit(1);
      }
    } else {
      console.log('[Startup] Intent whitelist validation passed');
    }
  } catch (err: any) {
    console.warn('[Startup] Intent whitelist validation skipped:', err.message);
  }
}

// US-499: Initialize DB pool now that secrets/env are loaded.
// In non-SM mode, initDb() was already called at db.ts import time (backward compat).
// This is idempotent — safe to call again.
initDb();

// Startup env validation — warn about missing keys that will cause silent failures
{
  const warnings: string[] = [];
  if (!process.env.GROQ_API_KEY && !process.env.OPENROUTER_API_KEY) {
    warnings.push('  No AI provider API key set (GROQ_API_KEY or OPENROUTER_API_KEY) — AI replies will be unavailable');
  }
  if (warnings.length > 0) {
    console.warn('[Startup] Environment warnings:');
    warnings.forEach(w => console.warn(w));
  }
}

// Meta CA certificate check (US-478) — warn if cert is missing before 2026-04-01 deadline
checkMetaCACert();

// Ensure DB config tables exist (no-op when DATABASE_URL not set)
try {
  await ensureConfigTables();
} catch (err: any) {
  console.warn('[Startup] Config tables setup failed (will use JSON files):', err.message);
}

// US-458: Load phone quality state from DB
try {
  await loadQualityStateFromDb();
} catch (err: any) {
  console.warn('[Startup] Phone quality state load failed (will default to UNKNOWN):', err.message);
}

// Initialize ProfileRegistry (multi-profile support)
// This initializes per-profile ConfigStores and KBs for all enabled profiles.
try {
  await profileRegistry.init();
  console.log('[Startup] ProfileRegistry initialized');
} catch (err: any) {
  console.warn('[Startup] ProfileRegistry init failed, falling back to single-profile mode:', err.message);
}

// Initialize default profile's Knowledge Base (backward compat for code using global imports)
try {
  initKnowledgeBase();
  await initKBFromDB();
  console.log('[Startup] Default KnowledgeBase initialized');
  // US-409: Check KB file staleness on startup (fire-and-forget)
  checkKBStaleness().catch(() => {});
} catch (err: any) {
  console.error('[Startup] Failed to initialize KnowledgeBase:', err.message);
}

// Initialize Unit Cache — fetches from dashboard API in background
initUnitCache();

// US-877: Initialize allergen store from file
initAllergenStore();

// US-879: Load menu items from DB into in-memory store
loadMenuItemsFromDB().catch(err => {
  console.warn('[Startup] Menu items load failed (store will be empty):', err?.message);
});

// US-949: Ensure stock events table exists for inventory sync logging
ensureStockEventsTable().catch(err => {
  console.warn('[Startup] Stock events table creation failed:', err?.message);
});

// CRITICAL: Initialize configStore BEFORE mounting admin routes
// This is the global singleton for the default profile (backward compat).
// Per-profile ConfigStores are already initialized by ProfileRegistry above.
try {
  await configStore.init();
  console.log('[Startup] Default ConfigStore initialized successfully');

  // US-057: Validate that default profile intents match expected profile type
  // Prevents cross-contamination where cafe profiles accidentally load hostel intents
  try {
    validateProfileIntents(configStore.profileId, configStore.getIntents());
    console.log(`[Startup] Profile intent validation passed for ${configStore.profileId}`);
  } catch (validationErr: any) {
    console.error(validationErr.message);
    process.exit(1);
  }
} catch (err: any) {
  console.error('[Startup] Failed to initialize ConfigStore:', err.message);
  console.error('[Startup] Admin API may not function correctly until config files are fixed');
}

// Load standalone configs from DB (fire-and-forget, file fallbacks already loaded)
try {
  await Promise.all([
    reloadLLMSettingsFromDB(),
    loadIntentTiersFromDB(),
    initPricingFromDB(),
    loadOptOutCache(),
  ]);
  console.log('[Startup] Standalone configs loaded from DB');
} catch (err: any) {
  console.warn('[Startup] Some DB config loads failed (using file fallbacks):', err.message);
}

// US-890: Migrate obsolete messaging tiers ('250'/'2000') to '10000'
migrateObsoleteTiers().catch(err => console.warn('[Startup] Tier migration failed:', err?.message));

// US-891: Load pacing state from DB and start pacing monitor
loadPacingStateFromDb().catch(err => console.warn('[Startup] Pacing state load failed:', err?.message));
startPacingMonitor();

// US-892: Start WABA webhook subscription health check (30s delay, then every 6h)
startWebhookHealthCheck();

// US-884: Start booking sequence processor (60s polling for pre-arrival messages)
startBookingSequenceProcessor();

// US-034: Initialize intent prediction batch queue (flushes every 5s or at 50 items)
initializeQueue();

// US-1039: Start MyInvois e-invoice queue processor (30s polling, 72h retry window)
startEinvoiceQueueProcessor();

// US-433: Load today's LLM cost accumulators from DB
loadTodayCosts().catch(err => console.warn('[Startup] Failed to load LLM cost data:', err.message));

// US-903: Start global LLM budget alert interval (every 30 min)
startBudgetAlertInterval();

// US-495: Load today's WhatsApp message cost accumulators from DB
loadTodayWhatsappCosts().catch(err => console.warn('[Startup] Failed to load WhatsApp cost data:', err.message));

// US-495: Start daily WhatsApp cost aggregation log
startWhatsappCostDailyJob();

// US-431: Start daily quality metrics aggregation job
startQualityMetricsJob();

// US-814: Start daily fallback rate alert scheduler (runs at 8AM)
startFallbackAlertScheduler();

// US-836: Start SLA cron for human handoff breach alerts (runs every 2 min)
startHandoffSlaCron();

// US-839: Daily PDPA breach deadline check (runs every 24h)
setInterval(() => {
  checkBreachDeadlines().catch(err =>
    console.error('[PDPA] Scheduled deadline check failed:', err.message)
  );
}, 24 * 60 * 60 * 1000);

// US-907: PDPA breach detection scheduler (every 15 min, scans for anomalous bulk access)
startBreachDetectionScheduler();

// US-969: Start marketing consent expiry scheduler (every 1h, expires 48h-old pending consents)
startConsentExpiryScheduler();

// US-157: Start data retention scheduler (archival purge at 2 AM MYT daily + PDPA disposal)
startRetentionScheduler();

// US-1030: Periodic messaging volume limit check (every 15 min) — fires 80%/95% alerts
setInterval(() => {
  checkMessagingVolumeLimits().catch(err =>
    console.error('[messaging-limits] Periodic volume check failed:', err.message)
  );
}, 15 * 60 * 1000);

// US-1031: OWASP LLM03:2025 — run deployment-time canary probes and start daily scheduler
runCanaryProbesOnStartup().catch(err =>
  console.warn('[canary-probe] Startup probe failed (non-fatal):', err.message)
);
startCanaryScheduler(); // daily at 03:00 MY time

// US-515: Enable pg_stat_statements and start slow query monitor
ensurePgStatStatements(pool).then(() => {
  setSlowQueryAlertHandler(async (report) => {
    const critical = report.rows.filter(r => r.meanExecTimeMs > 2000);
    if (critical.length > 0) {
      await notifyAdminSlowQuery(
        critical[0].query,
        critical[0].meanExecTimeMs,
        critical.length
      );
    }
  });
  startSlowQueryMonitor(pool);
}).catch(err => console.warn('[Startup] Slow query monitor init failed:', err.message));

const app = express();
const PORT = parseInt(process.env.MCP_SERVER_PORT || '3002', 10);

// US-504: Disable x-powered-by to prevent server fingerprinting
app.disable('x-powered-by');

// Disable ETags to prevent stale cache on normal refresh
app.set('etag', false);

// US-1027: CVE-2024-51999 — Explicitly lock query parser to 'simple' (Node.js built-in querystring.parse).
// Express 5 defaults to 'simple', but we pin it explicitly so any future config change
// cannot accidentally enable the 'extended' parser (qs with allowPrototypes: true).
app.set('query parser', 'simple');

// US-1027: Prototype-pollution guard — strip __proto__, constructor, prototype keys from
// req.query before any route handler runs. Defense-in-depth even if parser changes.
app.use((_req: express.Request, _res: express.Response, next: express.NextFunction) => {
  const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
  function sanitize(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      if (BLOCKED.has(key)) {
        delete obj[key];
      } else if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
        sanitize(obj[key] as Record<string, unknown>);
      }
    }
  }
  if (_req.query && typeof _req.query === 'object') {
    sanitize(_req.query as Record<string, unknown>);
  }
  next();
});

// ── US-464: CSP nonce middleware ─────────────────────────────────────
// Generate a unique nonce per request for inline scripts.
app.use((_req, res, next) => {
  res.locals.cspNonce = randomBytes(16).toString('base64');
  next();
});

// Security headers (US-464 + US-835: CSP connect-src whitelist for AI providers + US-1006: headers hardening)
const isProd = process.env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", ((_req: express.Request, res: express.Response) => `'nonce-${res.locals.cspNonce}'`) as any],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: buildImgSrc(),
      connectSrc: buildConnectSrc(),
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["*"],  // allow any site to embed via iframe (widget support); takes precedence over X-Frame-Options in modern browsers
      baseUri: ["'self'"],
      formAction: ["'self'"],
      reportUri: '/csp-report',
    },
  },
  crossOriginEmbedderPolicy: false,
  // US-1006: X-Frame-Options: DENY. CSP frame-ancestors: ["*"] takes precedence in modern browsers,
  // so iframe embedding for webchat widget continues to work. X-Frame-Options acts as a fallback for
  // legacy browsers that do not support CSP frame-ancestors.
  frameguard: { action: 'deny' },
  // US-1006: Referrer-Policy — Helmet default is no-referrer; override to strict-origin-when-cross-origin
  // to send origin on same-site requests and stripped referrer on cross-site.
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// US-1006: Permissions-Policy — restrict sensitive browser APIs (Helmet v8 does not include this header natively)
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'microphone=(), camera=(), geolocation=()');
  next();
});

// CORS — restrict to explicit allowlist (US-464)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [];
app.use(cors({
  origin: allowedOrigins.length > 0
    ? (origin, callback) => {
        // Allow requests with no Origin header (e.g. server-to-server, curl)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('CORS: origin not allowed'));
        }
      }
    : true, // No ALLOWED_ORIGINS set — allow all (dev default)
  credentials: true,
}));

// Middleware
app.use(compression({
  filter: (req, res) => {
    // Never compress SSE streams — compression buffers the response,
    // preventing EventSource clients from receiving events in real time.
    if (req.headers.accept === 'text/event-stream' || req.url.endsWith('/activity/stream')) return false;
    return compression.filter(req, res);
  }
}));
app.use(express.json({ limit: '2mb', verify: captureRawBody })); // Allow up to 2MB; captureRawBody stores buf on req.rawBody for webhook HMAC
app.use(express.urlencoded({ extended: false, limit: '1mb' } as any)); // Express 5: explicit depth cap (CVE-2024-45590)

// ── US-464: CSP violation report endpoint ───────────────────────────
app.post('/csp-report', express.json({ type: 'application/csp-report' }), (req, res) => {
  const report = req.body?.['csp-report'] ?? req.body;
  console.warn('[CSP-Violation]', JSON.stringify({
    documentUri: report?.['document-uri'],
    violatedDirective: report?.['violated-directive'],
    blockedUri: report?.['blocked-uri'],
    sourceFile: report?.['source-file'],
    lineNumber: report?.['line-number'],
  }));
  res.status(204).end();
});

// Error handler for payload too large
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'Message payload too large. Maximum size is 2MB.' });
    return;
  }
  next(err);
});

// Rate limiters
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many MCP requests, please try again later' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many API requests, please try again later' }
});

// Create HTTP server so Vite HMR WebSocket can attach before listening starts
const server = createHttpServer(app);

// --- Static assets + Vite HMR ---
let viteDevServer: any = null;

// US-522: widget.js — served with CORS and short public cache for cross-origin embedding.
// Two paths: /widget.js (canonical, used by WIDGET_SETTINGS.md) and /public/widget.js
// (legacy alias). Both must be declared BEFORE the no-cache static middleware below.
const _widgetJsPath = join(__dirname_main, 'public', 'widget.js');
function _serveWidgetJs(_req: express.Request, res: express.Response) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Content-Type', 'application/javascript');
  res.set('Pragma', '');
  res.set('Expires', '');
  res.sendFile(_widgetJsPath);
}
app.get('/widget.js', _serveWidgetJs);
app.get('/public/widget.js', _serveWidgetJs);

// US-522 + US-523: webchat.html — CORS for cross-origin loads, CSP frame-ancestors
// to allow the iframe to render inside fnb-online-ordering and pms-capsule (Vercel).
// Helmet sets frameguard: false globally but we explicitly override CSP here.
// US-1040: PCI DSS 4.0 Req 6.4.3 — payment-adjacent page. Script inventory enforced
// at build time (scripts/validate-sri.mjs). CSP restricts script sources; inline scripts
// use 'unsafe-inline' for this legacy route (nonce injection pending migration).
app.get('/webchat.html', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' https://*.vercel.app https://admin.pelangicapsulehostel.com https://pelangicapsulehostel.com; report-uri /csp-report",
  );
  res.sendFile(join(__dirname_main, 'public', 'webchat.html'));
});

// US-893: Serve locally-downloaded WhatsApp media files.
// Files are saved by media-downloader.ts under ./media/<YYYY-MM-DD>/<msgId>.<ext>
// Admin conversation view references these as /media/... URLs.
app.use('/media', express.static(MEDIA_BASE_DIR));

// Serve dashboard static files (CSS, JS, images) with no-cache headers.
// In dev, this MUST come before Vite middleware so that <link> and <script> tags
// get raw files (correct Content-Type), not Vite's JS-module transforms.
app.use(
  '/public',
  express.static(join(__dirname_main, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  })
);

if (process.env.NODE_ENV !== 'production') {
  // Vite: provides HMR client + WebSocket for file-change notifications.
  // Static files are served by Express above; Vite only handles /@vite/* paths.
  const { createServer: createViteServer } = await import('vite');
  viteDevServer = await createViteServer({
    configFile: join(__dirname_main, '..', 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'custom',
  });
  app.use(viteDevServer.middlewares);
}

// Track consecutive /health/ready checks where pool.waitingCount > 0
let _poolWaitingStreak = 0;

// Health check endpoint (liveness — is the process alive?)
app.get('/health', (req, res) => {
  const webhookHealth = getWebhookHealthState();
  res.json({
    status: 'ok',
    service: 'pelangi-mcp-server',
    version: '1.0.0',
    whatsapp: getWhatsAppStatus().state,
    webhookSubscribed: webhookHealth.webhookSubscribed,
    timestamp: new Date().toISOString()
  });
});

// Deep health check (readiness — can this server serve requests?)
app.get('/health/ready', async (req, res) => {
  // US-450: Return 503 until critical subsystems have finished initialising
  if (!isReady()) {
    res.status(503).json({ status: 'starting', timestamp: new Date().toISOString() });
    return;
  }

  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // 1. Backend API reachable
  try {
    await apiClient.get('/api/health', { timeout: 5000 });
    checks.backend = { ok: true };
  } catch (err: any) {
    checks.backend = { ok: false, detail: err.code || err.message };
  }

  // 2. WhatsApp connection
  const waStatus = getWhatsAppStatus();
  checks.whatsapp = {
    ok: waStatus.state === 'open',
    detail: waStatus.state
  };

  // 3. AI provider circuit breakers
  const { circuitBreakerRegistry } = await import('./assistant/circuit-breaker.js');
  const cbStatuses = circuitBreakerRegistry.getAllStatuses();
  const registeredCount = Object.keys(cbStatuses).length;
  const openCircuits = Object.entries(cbStatuses)
    .filter(([, s]) => s.state === 'OPEN')
    .map(([id]) => id);
  checks.aiProviders = {
    ok: openCircuits.length === 0,
    detail: openCircuits.length > 0
      ? `${openCircuits.length} provider(s) circuit-open: ${openCircuits.join(', ')}`
      : registeredCount > 0
        ? `${registeredCount} provider(s) healthy`
        : 'not yet tested (no AI requests since restart)'
  };

  // 4. Config store health
  const corrupted = configStore.getCorruptedFiles();
  checks.config = {
    ok: corrupted.length === 0,
    detail: corrupted.length > 0
      ? `Corrupted: ${corrupted.join(', ')}`
      : 'All configs loaded'
  };

  // 5. Failover status
  const { failoverCoordinator } = await import('./lib/failover-coordinator.js');
  const failoverStatus = failoverCoordinator.getStatus();
  checks.failover = {
    ok: true,
    detail: `Role: ${failoverStatus.role}, Active: ${failoverStatus.isActive}`
  };

  // 6. Message queue (BullMQ) status (US-405)
  const { getQueueHealth } = await import('./lib/message-queue.js');
  const queueHealth = await getQueueHealth();
  checks.messageQueue = {
    ok: queueHealth.enabled ? queueHealth.connected : true, // not-enabled is OK
    detail: queueHealth.enabled
      ? queueHealth.connected
        ? `BullMQ active — waiting: ${queueHealth.waiting}, active: ${queueHealth.active}, failed: ${queueHealth.failed}, dlq: ${queueHealth.deadLetterCount}, concurrency: ${queueHealth.workerConcurrency}`
        : 'BullMQ enabled but Redis disconnected'
      : 'Direct processing (Redis not available)'
  };

  // 7. Account status (US-479 — violations and restrictions from account_update webhook)
  const { getAccountStatus } = await import('./lib/account-status.js');
  const accountStatus = getAccountStatus();
  const hasViolation = accountStatus.activeViolation !== null;
  const hasRestrictions = accountStatus.activeRestrictions.length > 0;
  checks.accountStatus = {
    ok: !hasViolation && !hasRestrictions,
    detail: hasViolation
      ? `Active violation: ${accountStatus.activeViolation!.violationType} (detected ${accountStatus.activeViolation!.detectedAt})`
      : hasRestrictions
        ? `Active restrictions: ${accountStatus.activeRestrictions.map(r => r.restrictionType).join(', ')}`
        : 'No active violations or restrictions',
    ...(hasViolation && { violation: accountStatus.activeViolation }),
    ...(hasRestrictions && { restrictions: accountStatus.activeRestrictions }),
  };

  // 8. Secrets Manager health (US-499)
  const secretsHealth = await checkSecretsHealth();
  checks.secrets = secretsHealth;

  // 9. PostgreSQL pool metrics (synchronous — no DB query issued)
  const poolMetrics = getPoolMetrics();
  if (poolMetrics.waiting > 0) {
    _poolWaitingStreak++;
  } else {
    _poolWaitingStreak = 0;
  }
  // Degrade only after two consecutive checks with waiting > 0 (avoids transient spikes)
  const poolDegraded = _poolWaitingStreak > 1;
  checks.database = {
    ok: !poolDegraded,
    pool: poolMetrics,
    detail: poolDegraded
      ? `Pool pressure: ${poolMetrics.waiting} client(s) waiting (${_poolWaitingStreak} consecutive checks)`
      : `Pool healthy — total: ${poolMetrics.total}, idle: ${poolMetrics.idle}, waiting: ${poolMetrics.waiting}`
  } as { ok: boolean; detail?: string; pool: { total: number; idle: number; waiting: number } };

  const allHealthy = Object.values(checks).every(c => c.ok);
  // WhatsApp can be disconnected and system still works (manual mode)
  const critical = checks.backend.ok && checks.config.ok;
  const status = critical ? (allHealthy ? 'ready' : 'degraded') : 'unhealthy';

  // Always return 200 when the process is up and responding, so monitors (e.g. Fleet Manager)
  // that only check HTTP status show "Online" when the server is reachable. Details go in the body.
  res.status(200).json({
    status,
    checks,
    timestamp: new Date().toISOString()
  });
});

// --- Dashboard HTML ---
const DASHBOARD_HTML_PATH = join(__dirname_main, 'public', 'rainbow-admin.html');
let _dashboardHtmlCache: string | null = null;

function loadDashboardHtml(): string {
  return readFileSync(DASHBOARD_HTML_PATH, 'utf-8');
}

// Eagerly load for production (cache persists for the process lifetime)
try {
  _dashboardHtmlCache = loadDashboardHtml();
} catch {
  // File may not exist yet during build; getDashboardHtml() will throw at request time
}

async function getDashboardHtml(_url: string, nonce: string): Promise<string> {
  if (viteDevServer) {
    // Dev: read fresh from disk, inject Vite HMR client manually.
    // We skip transformIndexHtml because it double-prefixes /public/ URLs
    // (HTML already uses absolute /public/... paths, and Vite prepends base again).
    // Vite's middleware still serves files correctly (strips base from requests).
    let html = readFileSync(DASHBOARD_HTML_PATH, 'utf-8');
    html = html.replace(/__CSP_NONCE__/g, nonce);
    const adminKeyDev = process.env.RAINBOW_ADMIN_KEY || '';
    html = html.replace('<head>', `<head>\n  <script nonce="${nonce}">window.__ADMIN_KEY__=${JSON.stringify(adminKeyDev)};</script>\n  <script type="module" src="/public/@vite/client"></script>`);
    return html;
  }
  // Prod: use cached HTML with cache-bust
  let html = _dashboardHtmlCache ?? loadDashboardHtml();
  html = html.replace(/__CSP_NONCE__/g, nonce);
  const v = Date.now();
  html = html.replace(/(src|href)="(\/public\/[^"]+\.(js|css))"/g, `$1="$2?v=${v}"`);
  // Inject admin key + fetch interceptor for remote browser access.
  // tabs.js / template-loader.js use raw fetch() (not api()), so we patch window.fetch globally
  // to auto-add X-Admin-Key on all /api/rainbow/ requests.
  const adminKey = process.env.RAINBOW_ADMIN_KEY || '';
  const interceptorScript = `<script nonce="${nonce}">
window.__ADMIN_KEY__=${JSON.stringify(adminKey)};
(function(){var _f=window.fetch;window.fetch=function(url,opts){opts=opts||{};if(typeof url==='string'&&url.indexOf('/api/rainbow/')>=0&&window.__ADMIN_KEY__){var h=Object.assign({'X-Admin-Key':window.__ADMIN_KEY__},opts.headers||{});opts=Object.assign({},opts,{headers:h});}return _f.call(this,url,opts);};})();
</script>`;
  html = html.replace('<head>', `<head>\n  ${interceptorScript}`);
  return html;
}

// Rainbow Admin Dashboard - Root path only
// Backward compatibility: redirect old /admin/rainbow routes to hash-based dashboard.
app.get(['/admin/rainbow', '/admin/rainbow/{*rest}'], (req, res) => {
  const subPath = req.path.replace(/^\/admin\/rainbow\/?/, '');
  const hash = subPath ? `#${subPath}` : '#dashboard';
  safeRedirect(res, `/${hash}`);
});

app.get('/', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('html').send(await getDashboardHtml(req.originalUrl, res.locals.cspNonce));
  } catch {
    res.status(500).send('Dashboard file not found');
  }
});

// WhatsApp QR code pairing endpoint (temporary - remove after pairing)
app.get('/admin/whatsapp-qr', async (req, res) => {
  const status = getWhatsAppStatus();
  if (status.state === 'open') {
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>WhatsApp Connected</h2>
      <p>Account: ${status.user?.name || 'Unknown'} (${status.user?.phone || '?'})</p>
      <p style="color:green;font-size:24px">Already paired!</p>
    </body></html>`);
    return;
  }
  if (!status.qr) {
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>WhatsApp QR Code</h2>
      <p>No QR code available yet. Status: <b>${status.state}</b></p>
      <p>Waiting for Baileys to generate QR code...</p>
      <script>setTimeout(()=>location.reload(),3000)</script>
    </body></html>`);
    return;
  }
  try {
    const QRCode = await import('qrcode');
    const qrImage = await QRCode.default.toDataURL(status.qr);
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Scan with WhatsApp</h2>
      <img src="${qrImage}" style="width:300px;height:300px" />
      <p>Open WhatsApp > Linked Devices > Link a Device</p>
      <script>setTimeout(()=>location.reload(),5000)</script>
    </body></html>`);
  } catch (err: any) {
    console.error('[QR] QR code generation failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Public Webchat ---
const WEBCHAT_HTML_PATH = join(__dirname_main, 'public', 'webchat.html');

// Webchat API (rate limited separately — 10 req/min per IP)
app.use('/api/chat', webchatApiRoutes);

// FnB AI Waiter chat (SSE streaming, makan-moments profile)
app.use('/api/fnb', fnbChatRoutes);

// PDPA 2024 Phase 3 — self-service data portability (public, OTP-verified, US-894)
app.use('/api/rainbow', gdprPortabilityRoutes);

// US-909: WhatsApp Flows data-exchange endpoint (public, Meta-encrypted)
app.use(whatsappFlowsRoutes);

// US-920: WhatsApp Flows digital check-in endpoint (public, Meta-encrypted)
app.use(whatsappFlowsCheckinRoutes);

// US-932: WhatsApp Flows menu ordering endpoint with Image Carousel (Makan Moments)
app.use(whatsappFlowsMenuRoutes);

// US-911: WhatsApp in-chat webview for mobile payment page
app.use(paymentWebviewRoutes);

// US-916: PWA push notification subscription API
app.use('/push', pushApiRoutes);

// Webchat page — serves branded chat UI per profile
app.get('/chat/:profileId', (req, res) => {
  const { profileId } = req.params;
  const profile = profileRegistry.getProfile(profileId);

  if (!profile) {
    // Friendly 404 with valid profile links
    const validProfiles = profileRegistry.listProfiles();
    const links = validProfiles.map(p =>
      `<li><a href="/chat/${p.id}">${p.name}</a></li>`
    ).join('\n');
    res.status(404).send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Profile Not Found</h2>
      <p>"${profileId}" is not a valid profile.</p>
      <p>Available profiles:</p>
      <ul style="list-style:none;padding:0">${links}</ul>
    </body></html>`);
    return;
  }

  // Read webchat HTML and inject profile config
  try {
    const html = readFileSync(WEBCHAT_HTML_PATH, 'utf-8');
    const settings = profile.configStore.getSettings() as any;
    const greeting = settings?.greeting
      || `Hello! I'm the AI assistant for ${profile.name}. How can I help you today?`;
    // US-846: Compute availability from business hours config
    const businessHours: BusinessHoursConfig | undefined = settings?.businessHours;
    const { isAvailable, nextOpenTime } = computeAvailability(businessHours);
    // US-905: Webchat onboarding quick-reply buttons
    const onboarding = settings?.webchat_onboarding?.enabled
      ? { enabled: true, buttons: settings.webchat_onboarding.buttons || [] }
      : undefined;
    const profileData = JSON.stringify({
      id: profile.id,
      name: profile.name,
      greeting,
      isAvailable,
      nextOpenTime,
      onboarding,
    });
    const nonce = res.locals.cspNonce;
    // US-1040: Inject nonce into both the profile config script and the main webchat IIFE
    // to comply with Helmet's script-src 'self' 'nonce-xxx' CSP policy.
    let injected = html.replace(
      '<head>',
      `<head>\n  <script nonce="${nonce}">window.__WEBCHAT_PROFILE__=${profileData};</script>`
    );
    // Add nonce to the main inline <script> in the body (webchat IIFE)
    injected = injected.replace(
      /(<script>)\s*\n(\s*\(function\(\)\s*\{)/,
      `<script nonce="${nonce}">\n$2`
    );
    res.type('html').send(injected);
  } catch {
    res.status(500).send('Webchat page not found');
  }
});

// Inbound webhooks (Evolution API, DIGIMAN callbacks) — signature-validated, no admin auth
app.use(webhookRoutes);

// Rainbow Admin API
app.use('/api/rainbow', apiLimiter, adminRoutes);

// Dashboard tab routes (SPA client-side routing)
const dashboardTabs = [
  // Connect
  'dashboard',
  // Train
  'understanding', 'responses', 'intents',
  // Test
  'chat-simulator', 'testing',
  // Monitor
  'performance', 'settings',
  // Standalone
  'help',
  // Legacy (keep for old bookmarks — they show deprecation notices in the SPA)
  'intent-manager', 'static-replies', 'kb', 'preview', 'real-chat', 'workflow',
  'whatsapp-accounts', // removed from nav but URL still works (shows "Page Removed" notice)
];
// US-496: Express 5 path-to-regexp v8 no longer supports inline regex /:tab(pattern).
// Use plain :tab param with a Set lookup instead.
const dashboardTabSet = new Set(dashboardTabs);
app.get('/:tab', async (req, res, next) => {
  if (!dashboardTabSet.has(req.params.tab)) return next();
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('html').send(await getDashboardHtml(req.originalUrl, res.locals.cspNonce));
  } catch {
    res.status(500).send('Dashboard file not found');
  }
});

// MCP protocol endpoint
app.post('/mcp', mcpLimiter, createMCPHandler());

// ── US-504: Custom 404 handler ─────────────────────────────────────
// Return generic 404 without revealing the requested path to the client.
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Express 5 centralized error handler (US-494 + US-504) ──────────
// Express 5 auto-propagates rejected promises from async handlers here.
// Admin router has its own error handler; this catches errors from non-admin routes.
// US-504: Never leak stack traces, file paths, or secrets to the client.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;

  // Log full error server-side for debugging
  console.error('[ErrorHandler]', err);

  const status = typeof err.status === 'number' ? err.status : 500;
  // Never send internal error details to the client
  res.status(status).json({ error: 'Internal server error' });
});

// Configure HTTP server timeouts to prevent 502s from load balancer keep-alive races.
// Node.js defaults (keepAliveTimeout=5s, headersTimeout=60s) are shorter than AWS ALB (60s),
// causing intermittent 502s when the server closes a keep-alive connection the LB is reusing.
const KEEP_ALIVE_TIMEOUT = parseInt(process.env.SERVER_KEEP_ALIVE_TIMEOUT || '65000', 10);
const HEADERS_TIMEOUT = parseInt(process.env.SERVER_HEADERS_TIMEOUT || '66000', 10);
const REQUEST_TIMEOUT = parseInt(process.env.SERVER_REQUEST_TIMEOUT || '30000', 10);

server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
server.headersTimeout = HEADERS_TIMEOUT;
server.requestTimeout = REQUEST_TIMEOUT;
// Destroy sockets that have been open but idle beyond headersTimeout
server.setTimeout(HEADERS_TIMEOUT + 1000);

// Start server - listen on 0.0.0.0 for Docker containers
server.listen(PORT, '0.0.0.0', () => {
  markListening();

  const apiUrl = getApiBaseUrl();
  console.log(`[Startup] Node.js ${process.version}, OpenSSL ${process.versions.openssl} (security level 2)`);
  console.log(`digiman MCP Server running on http://0.0.0.0:${PORT}`);
  console.log(`MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
  console.log(`Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`API URL: ${apiUrl}${process.env.DIGIMAN_MANAGER_HOST || process.env.PELANGI_MANAGER_HOST ? ' (internal host)' : ''}`);
  console.log(`Server timeouts: keepAlive=${KEEP_ALIVE_TIMEOUT}ms headers=${HEADERS_TIMEOUT}ms request=${REQUEST_TIMEOUT}ms`);

  // US-450: DB, configStore, profileRegistry, and KnowledgeBase init all
  // completed before server.listen() was called (top-level awaits above).
  // Mark the server as ready to accept admin API requests.
  markReady();

  // Startup connectivity check: warn if digiman API is unreachable
  setImmediate(async () => {
    try {
      try {
        await apiClient.get('/api/health');
      } catch {
        await apiClient.get('/api/occupancy');
      }
      console.log('digiman API reachable');
    } catch (err: any) {
      const status = err.response?.status;
      const url = `${apiUrl}/api/health`;
      console.warn('');
      console.warn('digiman API not reachable.');
      console.warn(`   URL: ${url}`);
      if (status) console.warn(`   Response: ${status} ${err.response?.statusText || ''}`);
      console.warn('   Set DIGIMAN_API_URL (or legacy PELANGI_API_URL) in Zeabur to your deployed digiman API URL.');
      console.warn('   MCP tools will fail until the API is reachable.');
      console.warn('');
    }

    // Run integration validation (fire-and-forget, non-blocking)
    import('./lib/integration-validator.js').then(({ validateIntegrations }) =>
      validateIntegrations().then(results => {
        for (const r of results) {
          if (r.status === 'ok') console.log(`  ✓ ${r.name}: ${r.message}`);
          else if (r.status === 'warning') console.warn(`  ⚠ ${r.name}: ${r.message}`);
          else console.error(`  ✗ ${r.name}: ${r.message}${r.fix ? ` → ${r.fix}` : ''}`);
        }
      })
    ).catch(() => {});

    // Initialize feedback settings defaults
    await initFeedbackSettings();

    // Initialize admin notification settings
    await initAdminNotificationSettings();

    // Initialize WhatsApp (Baileys) with crash isolation supervisor
    await startBaileysWithSupervision();

    // Initialize scheduled message checker (US-019)
    initScheduler();

    // Initialize failover coordinator (primary/standby)
    const { failoverCoordinator } = await import('./lib/failover-coordinator.js');
    const failoverSettings = configStore.getSettings().failover ?? {
      enabled: true, heartbeatIntervalMs: 20000, failoverThresholdMs: 60000,
      handbackMode: 'immediate' as const, handbackGracePeriodMs: 30000,
    };
    failoverCoordinator.init({
      role: (process.env.RAINBOW_ROLE as 'primary' | 'standby') ?? 'primary',
      peerUrl: process.env.RAINBOW_PEER_URL,
      secret: process.env.RAINBOW_FAILOVER_SECRET ?? '',
      settings: failoverSettings,
    });

    // Wire failover WhatsApp notifications
    const { notifyAdminFailoverActivated, notifyAdminFailoverDeactivated } =
      await import('./lib/admin-notifier.js');
    failoverCoordinator.on('activated', () => {
      notifyAdminFailoverActivated().catch(() => { });
    });
    failoverCoordinator.on('deactivated', () => {
      notifyAdminFailoverDeactivated().catch(() => { });
    });

    // US-1014: Sync KDS config from settings on startup
    const { setKdsConfig } = await import('./lib/kds-webhook.js');
    const kdsSettings = (configStore.getSettings() as any).kds;
    if (kdsSettings) {
      setKdsConfig({ webhookUrl: kdsSettings.webhookUrl, webhookAuthToken: kdsSettings.webhookAuthToken });
    }

    // Update coordinator when settings are hot-reloaded
    configStore.on('reload', (domain: string) => {
      if (['settings', 'all'].includes(domain)) {
        const updated = configStore.getSettings().failover;
        if (updated) failoverCoordinator.updateSettings(updated);
        // US-1014: Sync KDS config on settings change
        const kds = (configStore.getSettings() as any).kds;
        if (kds) setKdsConfig({ webhookUrl: kds.webhookUrl, webhookAuthToken: kds.webhookAuthToken });
      }
    });

    // Run integration diagnostics (fire-and-forget, non-blocking)
    import('./lib/integration-validator.js').then(({ validateIntegrations }) =>
      validateIntegrations().then((results) => {
        const errors = results.filter(r => r.status === 'error');
        const warnings = results.filter(r => r.status === 'warning');
        if (errors.length > 0 || warnings.length > 0) {
          console.warn('[Startup] Integration diagnostics:');
          for (const r of [...errors, ...warnings]) {
            console.warn(`  [${r.status.toUpperCase()}] ${r.name}: ${r.message}`);
            if (r.fix) console.warn(`    Fix: ${r.fix}`);
          }
        } else {
          console.log('[Startup] All integration checks passed');
        }
      })
    ).catch((err) => {
      console.warn('[Startup] Integration validation skipped:', err.message);
    });
  });
});

// ── Graceful shutdown with connection draining (US-437) ──────────────
let isShuttingDown = false;

// Track active connections so we can drain them
const activeConnections = new Set<import('net').Socket>();
server.on('connection', (conn) => {
  activeConnections.add(conn);
  conn.on('close', () => activeConnections.delete(conn));
});

const shutdown = async (signal: string) => {
  if (isShuttingDown) return; // prevent double-entry
  isShuttingDown = true;
  console.log(`\n[SHUTDOWN] Received ${signal}. Draining connections...`);

  // 1. Set Connection: close on all in-flight responses so keep-alive clients disconnect
  //    (Express middleware will add this header to any response sent during drain)
  app.use((_req, res, next) => {
    res.setHeader('Connection', 'close');
    next();
  });

  // 2. Stop accepting new connections
  if (viteDevServer) viteDevServer.close();
  server.close(() => {
    console.log('[SHUTDOWN] HTTP server closed.');
  });

  // 3. Destroy idle keep-alive connections that have no in-flight request
  for (const conn of activeConnections) {
    // If the socket has no pending response, destroy it immediately
    if (!(conn as any)._httpMessage) {
      conn.destroy();
    }
  }

  // 4. Clean up WhatsApp sockets
  try {
    await whatsappManager.stopAll();
  } catch (err: any) {
    console.warn('[SHUTDOWN] WhatsApp cleanup error:', err.message);
  }

  // 5. Drain PostgreSQL pool
  try {
    await pool.end();
    console.log('[SHUTDOWN] PostgreSQL pool drained.');
  } catch (err: any) {
    console.warn('[SHUTDOWN] Pool drain error:', err.message);
  }

  console.log('[SHUTDOWN] Cleanup complete. Exiting.');
  process.exit(0);
};

// Force exit after 10 s if graceful shutdown hangs
const forceExitOnSignal = (signal: string) => {
  setTimeout(() => {
    console.error('[SHUTDOWN] Force exiting after 10 s timeout...');
    process.exit(1);
  }, 10_000).unref(); // unref so timer alone doesn't keep process alive

  shutdown(signal);
};

process.on('SIGINT', () => forceExitOnSignal('SIGINT'));
process.on('SIGTERM', () => forceExitOnSignal('SIGTERM'));
