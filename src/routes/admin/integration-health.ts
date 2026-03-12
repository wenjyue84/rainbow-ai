import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDigimanCircuitStatus, getRequestStats } from '../../lib/http-client.js';
import { circuitBreakerRegistry } from '../../assistant/circuit-breaker.js';
import { whatsappManager } from '../../lib/baileys-client.js';
import { pool } from '../../lib/db.js';

const router = Router();

type IntegrationStatus = 'healthy' | 'degraded' | 'down';

interface IntegrationHealth {
  name: string;
  status: IntegrationStatus;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  errorCount5m: number;
  circuitState: string | null;
  avgResponseMs: number | null;
  details?: Record<string, unknown>;
}

function deriveDigimanStatus(
  circuitState: string,
  errorCount5m: number
): IntegrationStatus {
  if (circuitState === 'OPEN') return 'down';
  if (circuitState === 'HALF_OPEN' || errorCount5m > 0) return 'degraded';
  return 'healthy';
}

function deriveWhatsAppStatus(instances: Array<{ state: string }>): IntegrationStatus {
  if (instances.length === 0) return 'down';
  const connected = instances.filter(i => i.state === 'open').length;
  if (connected === instances.length) return 'healthy';
  if (connected > 0) return 'degraded';
  return 'down';
}

async function checkDatabase(): Promise<{ status: IntegrationStatus; latencyMs: number | null; error?: string }> {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    return { status: 'healthy', latencyMs: Date.now() - start };
  } catch (err: any) {
    return { status: 'down', latencyMs: null, error: err.message };
  }
}

router.get('/integration-health', async (_req: Request, res: Response) => {
  try {
    // Gather all health data concurrently
    const [dbResult] = await Promise.all([checkDatabase()]);

    // DIGIMAN API
    const digimanCircuit = getDigimanCircuitStatus();
    const requestStats = getRequestStats();
    const digimanHealth: IntegrationHealth = {
      name: 'DIGIMAN API (PMS)',
      status: deriveDigimanStatus(digimanCircuit.state, requestStats.errorCount5m),
      lastSuccessAt: requestStats.lastSuccessAt,
      lastErrorAt: requestStats.lastErrorAt,
      errorCount5m: requestStats.errorCount5m,
      circuitState: digimanCircuit.state,
      avgResponseMs: requestStats.avgResponseMs,
      details: {
        failureCount: digimanCircuit.failureCount,
        cooldownRemaining: digimanCircuit.cooldownRemaining,
        totalRequests: requestStats.totalRequests,
      },
    };

    // AI Providers (from circuit breaker registry)
    const aiStatuses = circuitBreakerRegistry.getAllStatuses();
    const aiProviders: Record<string, IntegrationHealth> = {};
    for (const [providerId, cbStatus] of Object.entries(aiStatuses)) {
      if (providerId === 'digiman-api') continue; // already covered above
      const status: IntegrationStatus = cbStatus.state === 'OPEN'
        ? 'down'
        : cbStatus.state === 'HALF_OPEN' ? 'degraded' : 'healthy';
      aiProviders[providerId] = {
        name: providerId,
        status,
        lastSuccessAt: null,
        lastErrorAt: null,
        errorCount5m: 0,
        circuitState: cbStatus.state,
        avgResponseMs: null,
        details: {
          failureCount: cbStatus.failureCount,
          cooldownRemaining: cbStatus.cooldownRemaining,
        },
      };
    }

    // WhatsApp
    const waStatuses = whatsappManager.getAllStatuses();
    const waHealth: IntegrationHealth = {
      name: 'WhatsApp (Baileys)',
      status: deriveWhatsAppStatus(waStatuses),
      lastSuccessAt: null,
      lastErrorAt: null,
      errorCount5m: 0,
      circuitState: null,
      avgResponseMs: null,
      details: {
        instances: waStatuses.map(i => ({
          id: i.id,
          label: i.label,
          state: i.state,
          user: i.user?.name || null,
          lastConnectedAt: i.lastConnectedAt,
        })),
      },
    };

    // Database
    const dbHealth: IntegrationHealth = {
      name: 'PostgreSQL (Neon)',
      status: dbResult.status,
      lastSuccessAt: dbResult.status === 'healthy' ? new Date().toISOString() : null,
      lastErrorAt: dbResult.error ? new Date().toISOString() : null,
      errorCount5m: dbResult.status === 'down' ? 1 : 0,
      circuitState: null,
      avgResponseMs: dbResult.latencyMs,
      details: dbResult.error ? { error: dbResult.error } : undefined,
    };

    // Overall status
    const allStatuses = [
      digimanHealth.status,
      waHealth.status,
      dbHealth.status,
      ...Object.values(aiProviders).map(p => p.status),
    ];
    let overall: IntegrationStatus = 'healthy';
    if (allStatuses.includes('down')) overall = 'down';
    else if (allStatuses.includes('degraded')) overall = 'degraded';

    res.json({
      timestamp: new Date().toISOString(),
      overall,
      integrations: {
        digiman: digimanHealth,
        ai: aiProviders,
        whatsapp: waHealth,
        database: dbHealth,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
