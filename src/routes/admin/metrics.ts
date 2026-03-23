import { Router } from 'express';
import type { Request, Response } from 'express';
import { getWhatsAppStatus, whatsappManager } from '../../lib/baileys-client.js';
import { isAIAvailable } from '../../assistant/ai-client.js';

import { trackConfigReloaded } from '../../lib/activity-tracker.js';
import { ok, getStore } from './http-utils.js';
import { getConfigAuditLog } from '../../lib/config-db.js';
import { pool } from '../../lib/db.js';

const router = Router();

// ─── System ─────────────────────────────────────────────────────────

router.post('/reload', async (_req: Request, res: Response) => {
  await getStore(res).forceReload();
  trackConfigReloaded('all');
  ok(res, { message: 'All config reloaded (DB-first, then disk)' });
});

/** POST /restart — exit process so a process manager (e.g. start-all.bat, PM2) can restart the MCP server. */
router.post('/restart', (_req: Request, res: Response) => {
  ok(res, { message: 'Restarting MCP server...' });
  setTimeout(() => process.exit(0), 1500);
});

router.get('/status', async (_req: Request, res: Response) => {
  const wa = getWhatsAppStatus();
  const instances = whatsappManager.getAllStatuses();

  const lastCheckedAt = new Date().toISOString();
  const settings = getStore(res).getSettings();
  const configuredProviders = settings.ai.providers || [];
  const aiProviders = configuredProviders.map(p => {
    const hasKey = p.type === 'ollama' || !!(p.api_key || (p.api_key_env && process.env[p.api_key_env]));
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      priority: p.priority,
      enabled: p.enabled,
      available: hasKey,
      status: hasKey ? 'configured' : 'not_configured',
      details: hasKey
        ? (p.api_key_env ? `${p.api_key_env} set` : p.type === 'ollama' ? p.base_url : 'API key stored')
        : (p.api_key_env ? `${p.api_key_env} not set` : 'No API key')
    };
  });

  res.json({
    servers: {
      mcp: {
        name: 'Rainbow AI',
        description: 'WhatsApp AI assistant + Admin Dashboard (standalone)',
        port: parseInt(process.env.MCP_SERVER_PORT || '3002', 10),
        online: true,
        responseTime: 0,
        lastCheckedAt
      }
    },
    whatsapp: {
      state: wa.state,
      user: wa.user
    },
    whatsappInstances: instances.map(i => ({
      id: i.id,
      label: i.label,
      state: i.state,
      user: i.user,
      unlinkedFromWhatsApp: i.unlinkedFromWhatsApp,
      lastUnlinkedAt: i.lastUnlinkedAt,
      lastConnectedAt: i.lastConnectedAt,
      firstConnectedAt: i.firstConnectedAt ?? null
    })),
    ai: {
      available: isAIAvailable(),
      providers: aiProviders
    },
    config_files: ['knowledge', 'intents', 'templates', 'settings', 'workflow', 'workflows', 'routing'],
    response_modes: settings.response_modes || { default_mode: 'autopilot' },
    isCloud: process.env.RAINBOW_ROLE === 'primary',
    propertyName: process.env.BUSINESS_NAME || ''
  });
});

// ─── Config Audit Log ────────────────────────────────────────────────

router.get('/config-audit', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const rows = await getConfigAuditLog(limit);
  ok(res, rows);
});

// ─── US-324: Workflow Timeout Metrics ────────────────────────────────
// GET /metrics/workflow-timeouts — per-step timeout frequency and average elapsed_ms

router.get('/workflow-timeouts', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 7, 90);
    const { rows } = await pool.query(
      `SELECT
         step_name,
         workflow_id,
         COUNT(*) AS timeout_count,
         AVG(elapsed_ms)::int AS avg_elapsed_ms,
         MAX(elapsed_ms) AS max_elapsed_ms,
         SUM(CASE WHEN fallback_used THEN 1 ELSE 0 END) AS fallback_count
       FROM booking_workflow_events
       WHERE timed_out_at >= NOW() - INTERVAL '1 day' * $1
       GROUP BY step_name, workflow_id
       ORDER BY timeout_count DESC`,
      [days]
    );
    ok(res, { days, rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
