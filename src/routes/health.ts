/**
 * health.ts — Express Router for health check endpoints
 *
 * Handles: GET /health (liveness), GET /health/ready (readiness)
 *
 * Extracted from index.ts to keep that file manageable.
 */

import { Router } from 'express';
import { apiClient } from '../lib/http-client.js';
import { getWhatsAppStatus } from '../lib/baileys-client.js';
import { isReady } from '../lib/readiness.js';
import { configStore } from '../assistant/config-store.js';
import { checkSecretsHealth } from '../lib/secrets.js';
import { getPoolMetrics } from '../lib/db.js';
import { getWebhookHealthState } from '../lib/waba-webhook-health.js';

// Track consecutive /health/ready checks where pool.waitingCount > 0
let _poolWaitingStreak = 0;

const router = Router();

// Health check endpoint (liveness — is the process alive?)
router.get('/health', (req, res) => {
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
router.get('/health/ready', async (req, res) => {
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
  const { circuitBreakerRegistry } = await import('../assistant/circuit-breaker.js');
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
  const { failoverCoordinator } = await import('../lib/failover-coordinator.js');
  const failoverStatus = failoverCoordinator.getStatus();
  checks.failover = {
    ok: true,
    detail: `Role: ${failoverStatus.role}, Active: ${failoverStatus.isActive}`
  };

  // 6. Message queue (BullMQ) status (US-405)
  const { getQueueHealth } = await import('../lib/message-queue.js');
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
  const { getAccountStatus } = await import('../lib/account-status.js');
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
  // that only check HTTP status show Online when the server is reachable. Details go in the body.
  res.status(200).json({
    status,
    checks,
    timestamp: new Date().toISOString()
  });
});

export default router;
