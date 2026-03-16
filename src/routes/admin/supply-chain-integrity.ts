/**
 * supply-chain-integrity.ts — OWASP LLM03:2025 Supply-Chain Admin API (US-1031)
 *
 * GET  /supply-chain/status        — Latest canary run summary + Ollama fallback status
 * POST /supply-chain/probe         — Trigger a manual canary probe run
 * GET  /supply-chain/history       — Last N canary run summaries
 * GET  /supply-chain/probes        — List all defined canary prompt definitions
 * GET  /supply-chain/db-history    — Retrieve historical runs from DB (last 30)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { pool } from '../../lib/db.js';
import {
  runCanarySuite,
  getLatestCanaryRun,
  getCanaryHistory,
  verifyOllamaFallback,
  CANARY_PROMPTS,
} from '../../assistant/canary-probe.js';
import { getProviders } from '../../assistant/ai-provider-manager.js';

const router = Router();

// ─── GET /supply-chain/status ─────────────────────────────────────────
router.get('/supply-chain/status', async (_req: Request, res: Response) => {
  const latest = getLatestCanaryRun();
  const providers = getProviders();

  // Quick Ollama status (non-blocking, short timeout)
  const ollamaStatus = await verifyOllamaFallback().catch(() => ({
    available: false,
    latencyMs: 0,
    error: 'Check failed',
  }));

  res.json({
    lastRun: latest
      ? {
          runAt: latest.runAt,
          totalProbes: latest.totalProbes,
          passed: latest.passed,
          failed: latest.failed,
          alerts: latest.alerts,
        }
      : null,
    ollamaFallback: ollamaStatus,
    providerCount: providers.length,
    providers: providers.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      priority: p.priority,
      enabled: p.enabled,
    })),
    supplyChainRisk: latest && latest.alerts.length > 0 ? 'elevated' : 'normal',
  });
});

// ─── POST /supply-chain/probe ─────────────────────────────────────────
router.post('/supply-chain/probe', async (req: Request, res: Response) => {
  const { probeAllProviders = false } = req.body as { probeAllProviders?: boolean };

  try {
    const summary = await runCanarySuite({ probeAllProviders });
    res.json({
      message: 'Canary probe suite completed',
      summary: {
        runAt: summary.runAt,
        totalProbes: summary.totalProbes,
        passed: summary.passed,
        failed: summary.failed,
        alerts: summary.alerts,
      },
      results: summary.providerResults,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Canary probe failed', detail: err.message });
  }
});

// ─── GET /supply-chain/history ────────────────────────────────────────
router.get('/supply-chain/history', (_req: Request, res: Response) => {
  const history = getCanaryHistory();
  res.json({
    count: history.length,
    runs: history.map(r => ({
      runAt: r.runAt,
      totalProbes: r.totalProbes,
      passed: r.passed,
      failed: r.failed,
      alertCount: r.alerts.length,
      alerts: r.alerts,
    })),
  });
});

// ─── GET /supply-chain/probes ─────────────────────────────────────────
router.get('/supply-chain/probes', (_req: Request, res: Response) => {
  res.json({
    count: CANARY_PROMPTS.length,
    probes: CANARY_PROMPTS.map(p => ({
      id: p.id,
      description: p.description,
      expectedKeywords: p.expectedKeywords,
      forbiddenPatternCount: p.forbiddenPatterns.length,
      maxResponseLength: p.maxResponseLength,
    })),
  });
});

// ─── GET /supply-chain/db-history ────────────────────────────────────
router.get('/supply-chain/db-history', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<{
      id: number;
      run_at: Date;
      total_probes: number;
      passed: number;
      failed: number;
      alerts: string[];
    }>(
      `SELECT id, run_at, total_probes, passed, failed, alerts
       FROM canary_probe_runs
       ORDER BY run_at DESC
       LIMIT 30`
    );

    res.json({
      count: result.rows.length,
      runs: result.rows.map(r => ({
        id: r.id,
        runAt: r.run_at,
        totalProbes: r.total_probes,
        passed: r.passed,
        failed: r.failed,
        alertCount: (r.alerts as unknown as string[]).length,
        alerts: r.alerts,
      })),
    });
  } catch (err: any) {
    // Table may not exist yet on first run
    if (err.message?.includes('does not exist')) {
      res.json({ count: 0, runs: [] });
    } else {
      res.status(500).json({ error: 'DB query failed', detail: err.message });
    }
  }
});

export default router;
