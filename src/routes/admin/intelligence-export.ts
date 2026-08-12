/**
 * intelligence-export.ts — Export / Import Intelligence Bundle (US-export)
 *
 * GET  /api/rainbow/intelligence/export — download all config as a single JSON bundle
 * POST /api/rainbow/intelligence/import — upload a bundle and apply config via setters
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { getStore } from './http-utils.js';
import { atomicWriteJSON } from './file-utils.js';
import { auditConfigChange } from '../../lib/config-db.js';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { intentKeywordsDataSchema } from '../../assistant/schemas.js';
import { checkRole } from '../../lib/rbac.js';

const router = Router();

const requireOperator = checkRole(['operator', 'super-admin']);

// ─── Helper: get profile data directory ─────────────────────────────
const DEFAULT_DATA_DIR = join(process.cwd(), 'src', 'assistant', 'data');

function getProfileDataDir(req: Request): string {
  const profileId = req.headers['x-profile-id'] as string | undefined;
  if (profileId) {
    const profile = profileRegistry.getProfile(profileId);
    if (profile) return resolve(process.cwd(), profile.config.dataDir);
  }
  return DEFAULT_DATA_DIR;
}

// ─── Helper: extract admin user identifier ───────────────────────────
function getAdminUser(req: Request): string | null {
  return (req.headers['x-admin-role'] as string) || 'admin';
}

// ─── Multer: memory storage, 5 MB limit ─────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5_242_880 },
});

// ─── GET /api/rainbow/intelligence/export ───────────────────────────
router.get('/intelligence/export', requireOperator, async (req: Request, res: Response) => {
  try {
    const store = getStore(res);
    const profileId = (res.locals.profileId as string | undefined) ?? 'default';
    const dataDir = getProfileDataDir(req);

    // Read intent-keywords.json from disk (not managed by ConfigStore)
    let intentKeywords: unknown = null;
    try {
      const raw = await readFile(join(dataDir, 'intent-keywords.json'), 'utf-8');
      intentKeywords = JSON.parse(raw);
    } catch {
      // File may not exist for some profiles — skip silently
    }

    const bundle = {
      manifest: {
        profileId,
        exportedAt: new Date().toISOString(),
        version: '1.0',
      },
      files: {
        knowledge: store.getKnowledge(),
        settings: store.getSettings(),
        routing: store.getRouting(),
        'intent-keywords': intentKeywords,
        intents: store.getIntents(),
        templates: store.getTemplates(),
        workflows: store.getWorkflows(),
      },
    };

    const filename = `intelligence-${profileId}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(bundle, null, 2));
  } catch (err: any) {
    console.error('[intelligence-export] export error:', err);
    res.status(500).json({ error: 'Failed to export intelligence bundle' });
  }
});

// ─── POST /api/rainbow/intelligence/import ──────────────────────────
router.post(
  '/intelligence/import',
  requireOperator,
  upload.single('file'),
  async (req: Request, res: Response) => {
    // Parse bundle
    let bundle: any;
    try {
      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: 'No file uploaded. Send a multipart/form-data request with field "file".' });
        return;
      }
      bundle = JSON.parse(req.file.buffer.toString('utf-8'));
    } catch {
      res.status(400).json({ error: 'Malformed JSON — could not parse uploaded file.' });
      return;
    }

    // Validate top-level structure
    if (!bundle || typeof bundle !== 'object') {
      res.status(400).json({ error: 'Invalid bundle: expected a JSON object.' });
      return;
    }
    if (!bundle.manifest || bundle.manifest.version !== '1.0') {
      res.status(400).json({ error: 'Version mismatch: bundle manifest.version must be "1.0".' });
      return;
    }
    if (!bundle.files || typeof bundle.files !== 'object') {
      res.status(400).json({ error: 'Invalid bundle: missing "files" object.' });
      return;
    }

    const store = getStore(res);
    const dataDir = getProfileDataDir(req);
    const adminUser = getAdminUser(req);
    const { files } = bundle;

    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    // Apply each dataset via setter — skip if undefined / null
    const applySection = (
      key: string,
      getter: () => unknown,
      setter: (data: any) => void,
    ) => {
      if (files[key] === undefined || files[key] === null) {
        skipped.push(key);
        return;
      }
      try {
        const before = getter();
        setter(files[key]);
        auditConfigChange(adminUser, `POST /api/rainbow/intelligence/import → ${key}`, before, files[key]);
        imported.push(key);
      } catch (err: any) {
        errors.push(`${key}: ${err?.message ?? String(err)}`);
      }
    };

    applySection('knowledge', () => store.getKnowledge(), (d) => store.setKnowledge(d));
    applySection('settings', () => store.getSettings(), (d) => store.setSettings(d));
    applySection('routing', () => store.getRouting(), (d) => store.setRouting(d));
    applySection('intents', () => store.getIntents(), (d) => store.setIntents(d));
    applySection('templates', () => store.getTemplates(), (d) => store.setTemplates(d));
    applySection('workflows', () => store.getWorkflows(), (d) => store.setWorkflows(d));

    // intent-keywords: ConfigStore has no setter — write directly to disk
    if (files['intent-keywords'] !== undefined && files['intent-keywords'] !== null) {
      try {
        const parsed = intentKeywordsDataSchema.safeParse(files['intent-keywords']);
        if (!parsed.success) {
          errors.push(`intent-keywords: ${parsed.error.issues.map(i => i.message).join('; ')}`);
        } else {
        const keywordsPath = join(dataDir, 'intent-keywords.json');
        const before = await readFile(keywordsPath, 'utf-8').then(JSON.parse).catch(() => null);
        await atomicWriteJSON(keywordsPath, parsed.data);
        auditConfigChange(adminUser, 'POST /api/rainbow/intelligence/import → intent-keywords', before, parsed.data);
        imported.push('intent-keywords');
        }
      } catch (err: any) {
        errors.push(`intent-keywords: ${err?.message ?? String(err)}`);
      }
    } else {
      skipped.push('intent-keywords');
    }

    if (errors.length > 0) {
      res.status(422).json({ error: `Import completed with errors: ${errors.join('; ')}`, imported, skipped, errors });
      return;
    }

    res.json({ ok: true, imported, skipped });
  },
);

export default router;
