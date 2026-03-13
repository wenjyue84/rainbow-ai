// Catch silent crashes from Baileys / unhandled rejections
process.on('uncaughtException', (err) => {
  console.error('[CRASH] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] Unhandled rejection:', reason);
});

import express from 'express';
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
import { pool, getPoolMetrics } from './lib/db.js';
import adminRoutes from './routes/admin/index.js';
import webchatApiRoutes from './routes/public/webchat-api.js';
import webhookRoutes from './routes/webhooks/index.js';
import { captureRawBody } from './lib/webhook-signature.js';
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
import { loadOptOutCache } from './assistant/opt-out.js';
import { startQualityMetricsJob } from './lib/quality-metrics.js';
import { loadQualityStateFromDb } from './lib/phone-quality.js';
import { checkMetaCACert } from './lib/meta-ca-check.js';
import { loadTodayCosts } from './assistant/llm-cost-budget.js';
import { isReady, markReady, markListening } from './lib/readiness.js';

const __filename_main = fileURLToPath(import.meta.url);
const __dirname_main = dirname(__filename_main);

// Env loading: dotenv-cli pre-loads .env.southern.local for the Southern instance.
// For Pelangi (npm run dev / start-rainbow.bat), we load .env.pelangi.local explicitly.
// cwd dotenv() picks up any remaining vars from repo root .env without overriding.
if (!process.env.BUSINESS_NAME) {
  dotenv.config({ path: join(__dirname_main, '..', '.env.pelangi.local') });
}
dotenv.config();

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

// CRITICAL: Initialize configStore BEFORE mounting admin routes
// This is the global singleton for the default profile (backward compat).
// Per-profile ConfigStores are already initialized by ProfileRegistry above.
try {
  await configStore.init();
  console.log('[Startup] Default ConfigStore initialized successfully');
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

// US-433: Load today's LLM cost accumulators from DB
loadTodayCosts().catch(err => console.warn('[Startup] Failed to load LLM cost data:', err.message));

// US-431: Start daily quality metrics aggregation job
startQualityMetricsJob();

const app = express();
const PORT = parseInt(process.env.MCP_SERVER_PORT || '3002', 10);

// Disable ETags to prevent stale cache on normal refresh
app.set('etag', false);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Admin dashboard uses inline scripts
  crossOriginEmbedderPolicy: false,
  frameguard: false, // Allow embedding in iframes (e.g. from makanmoments.cafe admin)
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
app.use(cors());
app.use(express.json({ limit: '2mb', verify: captureRawBody })); // Allow up to 2MB; captureRawBody stores buf on req.rawBody for webhook HMAC

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
  res.json({
    status: 'ok',
    service: 'pelangi-mcp-server',
    version: '1.0.0',
    whatsapp: getWhatsAppStatus().state,
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

  // 7. PostgreSQL pool metrics (synchronous — no DB query issued)
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

async function getDashboardHtml(_url: string): Promise<string> {
  if (viteDevServer) {
    // Dev: read fresh from disk, inject Vite HMR client manually.
    // We skip transformIndexHtml because it double-prefixes /public/ URLs
    // (HTML already uses absolute /public/... paths, and Vite prepends base again).
    // Vite's middleware still serves files correctly (strips base from requests).
    let html = readFileSync(DASHBOARD_HTML_PATH, 'utf-8');
    const adminKeyDev = process.env.RAINBOW_ADMIN_KEY || '';
    html = html.replace('<head>', `<head>\n  <script>window.__ADMIN_KEY__=${JSON.stringify(adminKeyDev)};</script>\n  <script type="module" src="/public/@vite/client"></script>`);
    return html;
  }
  // Prod: use cached HTML with cache-bust
  let html = _dashboardHtmlCache ?? loadDashboardHtml();
  const v = Date.now();
  html = html.replace(/(src|href)="(\/public\/[^"]+\.(js|css))"/g, `$1="$2?v=${v}"`);
  // Inject admin key + fetch interceptor for remote browser access.
  // tabs.js / template-loader.js use raw fetch() (not api()), so we patch window.fetch globally
  // to auto-add X-Admin-Key on all /api/rainbow/ requests.
  const adminKey = process.env.RAINBOW_ADMIN_KEY || '';
  const interceptorScript = `<script>
window.__ADMIN_KEY__=${JSON.stringify(adminKey)};
(function(){var _f=window.fetch;window.fetch=function(url,opts){opts=opts||{};if(typeof url==='string'&&url.indexOf('/api/rainbow/')>=0&&window.__ADMIN_KEY__){var h=Object.assign({'X-Admin-Key':window.__ADMIN_KEY__},opts.headers||{});opts=Object.assign({},opts,{headers:h});}return _f.call(this,url,opts);};})();
</script>`;
  html = html.replace('<head>', `<head>\n  ${interceptorScript}`);
  return html;
}

// Rainbow Admin Dashboard - Root path only
// Backward compatibility: redirect old /admin/rainbow routes to hash-based dashboard.
app.get(['/admin/rainbow', '/admin/rainbow/*'], (req, res) => {
  const subPath = req.path.replace(/^\/admin\/rainbow\/?/, '');
  const hash = subPath ? `#${subPath}` : '#dashboard';
  res.redirect(`/${hash}`);
});

app.get('/', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('html').send(await getDashboardHtml(req.originalUrl));
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
    res.status(500).json({ error: err.message });
  }
});

// --- Public Webchat ---
const WEBCHAT_HTML_PATH = join(__dirname_main, 'public', 'webchat.html');

// Webchat API (rate limited separately — 10 req/min per IP)
app.use('/api/chat', webchatApiRoutes);

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
    const greeting = profile.configStore.getSettings()?.greeting
      || `Hello! I'm the AI assistant for ${profile.name}. How can I help you today?`;
    const profileData = JSON.stringify({ id: profile.id, name: profile.name, greeting });
    const injected = html.replace(
      '<head>',
      `<head>\n  <script>window.__WEBCHAT_PROFILE__=${profileData};</script>`
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
app.get(`/:tab(${dashboardTabs.join('|')})`, async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.type('html').send(await getDashboardHtml(req.originalUrl));
  } catch {
    res.status(500).send('Dashboard file not found');
  }
});

// MCP protocol endpoint
app.post('/mcp', mcpLimiter, createMCPHandler());

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

    // Update coordinator when settings are hot-reloaded
    configStore.on('reload', (domain: string) => {
      if (['settings', 'all'].includes(domain)) {
        const updated = configStore.getSettings().failover;
        if (updated) failoverCoordinator.updateSettings(updated);
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
