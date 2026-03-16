/**
 * Admin API: AI Bill of Materials (US-952)
 * OWASP LLM03:2025 Supply Chain — track AI model dependencies
 *
 * GET /ai-bom                  — Machine-readable CycloneDX AI-BOM
 * GET /ai-bom/dashboard        — Admin dashboard view with last-verified timestamps
 * POST /ai-bom/verify/:id      — Mark a provider as verified (update timestamp)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getProviders } from '../../assistant/ai-provider-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Path to the committed AI-BOM file at project root
const AI_BOM_PATH = join(__dirname, '../../../ai-bom.json');

// In-memory store for runtime verification data (persisted to ai-bom.json)
interface VerificationRecord {
  providerId: string;
  lastVerified: string;
  pinnedVersion: string;
  detectedVersion?: string;
  mismatch?: boolean;
}

function loadBom(): Record<string, unknown> {
  try {
    if (existsSync(AI_BOM_PATH)) {
      return JSON.parse(readFileSync(AI_BOM_PATH, 'utf-8'));
    }
  } catch {
    // fall through to default
  }
  return { components: [] };
}

function saveBom(bom: Record<string, unknown>): void {
  writeFileSync(AI_BOM_PATH, JSON.stringify(bom, null, 2) + '\n', 'utf-8');
}

function getPinnedVersion(providerId: string, bom: Record<string, unknown>): string | null {
  const components = (bom.components as Array<Record<string, unknown>>) || [];
  const comp = components.find((c) => {
    const props = (c.properties as Array<{ name: string; value: string }>) || [];
    return props.some((p) => p.name === 'ai:provider-id' && p.value === providerId);
  });
  if (!comp) return null;
  const props = (comp.properties as Array<{ name: string; value: string }>) || [];
  const pinned = props.find((p) => p.name === 'ai:pinned-version');
  return pinned?.value ?? null;
}

function updateLastVerified(bom: Record<string, unknown>, providerId: string, timestamp: string): void {
  const components = (bom.components as Array<Record<string, unknown>>) || [];
  const comp = components.find((c) => {
    const props = (c.properties as Array<{ name: string; value: string }>) || [];
    return props.some((p) => p.name === 'ai:provider-id' && p.value === providerId);
  });
  if (!comp) return;
  const props = (comp.properties as Array<{ name: string; value: string }>) || [];
  const lv = props.find((p) => p.name === 'ai:last-verified');
  if (lv) {
    lv.value = timestamp;
  } else {
    props.push({ name: 'ai:last-verified', value: timestamp });
  }
}

// ─── GET /ai-bom ─────────────────────────────────────────────────────
// Returns the full CycloneDX AI-BOM JSON (machine-readable)
router.get('/ai-bom', (_req: Request, res: Response) => {
  const bom = loadBom();
  res.json(bom);
});

// ─── GET /ai-bom/dashboard ───────────────────────────────────────────
// Admin dashboard view: active model versions + last-verified timestamps
router.get('/ai-bom/dashboard', (_req: Request, res: Response) => {
  const bom = loadBom();
  const liveProviders = getProviders();
  const components = (bom.components as Array<Record<string, unknown>>) || [];

  const dashboard = liveProviders.map((p) => {
    const comp = components.find((c) => {
      const props = (c.properties as Array<{ name: string; value: string }>) || [];
      return props.some((prop) => prop.name === 'ai:provider-id' && prop.value === p.id);
    });

    const props = comp ? ((comp.properties as Array<{ name: string; value: string }>) || []) : [];
    const getVal = (name: string) => props.find((x) => x.name === name)?.value ?? null;

    const pinnedVersion = getVal('ai:pinned-version') ?? p.model;
    const lastVerified = getVal('ai:last-verified') ?? null;
    const datePinned = getVal('ai:date-pinned') ?? null;

    // Check if last-verified is older than 30 days
    const verifiedAt = lastVerified ? new Date(lastVerified) : null;
    const daysSinceVerified = verifiedAt
      ? Math.floor((Date.now() - verifiedAt.getTime()) / 86_400_000)
      : null;

    return {
      id: p.id,
      name: p.name,
      providerType: p.type,
      baseUrl: p.base_url,
      pinnedModel: pinnedVersion,
      currentModel: p.model,
      versionMatch: pinnedVersion === p.model,
      priority: p.priority,
      enabled: p.enabled,
      lastVerified,
      datePinned,
      daysSinceVerified,
      stale: daysSinceVerified !== null ? daysSinceVerified > 30 : true,
    };
  });

  const alerts = dashboard
    .filter((d) => !d.versionMatch || d.stale)
    .map((d) => ({
      providerId: d.id,
      providerName: d.name,
      alert: !d.versionMatch
        ? `Model version mismatch: pinned=${d.pinnedModel}, current=${d.currentModel}`
        : `Verification stale: ${d.daysSinceVerified ?? 'never'} days since last check`,
    }));

  res.json({
    generatedAt: new Date().toISOString(),
    totalProviders: dashboard.length,
    mismatches: dashboard.filter((d) => !d.versionMatch).length,
    stale: dashboard.filter((d) => d.stale).length,
    providers: dashboard,
    alerts,
  });
});

// ─── POST /ai-bom/verify/:id ──────────────────────────────────────────
// Mark a provider as verified (update last-verified timestamp in ai-bom.json)
router.post('/ai-bom/verify/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const bom = loadBom();
  const pinnedVersion = getPinnedVersion(id, bom);

  if (pinnedVersion === null) {
    res.status(404).json({ error: `Provider '${id}' not found in AI-BOM` });
    return;
  }

  const timestamp = new Date().toISOString();
  updateLastVerified(bom, id, timestamp);
  bom.version = ((bom.version as number) || 1) + 1;
  saveBom(bom);

  res.json({
    providerId: id,
    pinnedVersion,
    lastVerified: timestamp,
    message: 'AI-BOM verification record updated',
  });
});

// ─── POST /ai-bom/alert ───────────────────────────────────────────────
// Called internally when a model-version response header differs from pinned
router.post('/ai-bom/alert', (req: Request, res: Response) => {
  const { providerId, pinnedVersion, detectedVersion } = req.body as VerificationRecord;

  if (!providerId || !pinnedVersion || !detectedVersion) {
    res.status(400).json({ error: 'providerId, pinnedVersion, detectedVersion required' });
    return;
  }

  const mismatch = pinnedVersion !== detectedVersion;

  if (mismatch) {
    // Log the supply chain alert
    console.warn(
      `[AI-BOM] SUPPLY CHAIN ALERT: Provider '${providerId}' version mismatch. ` +
        `Pinned: ${pinnedVersion}, Detected: ${detectedVersion}. ` +
        `OWASP LLM03:2025 — investigate model provenance.`,
    );
  }

  res.json({
    providerId,
    pinnedVersion,
    detectedVersion,
    mismatch,
    timestamp: new Date().toISOString(),
  });
});

export default router;
