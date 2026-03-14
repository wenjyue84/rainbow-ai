/**
 * Admin API — Profile Management
 *
 * Endpoints for listing and inspecting multi-profile configuration.
 * US-827: Profile cloning support.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { profileRegistry } from '../../assistant/profile-registry.js';
import type { ProfilesFile } from '../../assistant/profile-registry.js';
import { pool } from '../../lib/db.js';

const router = Router();

/** GET /api/rainbow/profiles — List all enabled profiles */
router.get('/profiles', (_req: Request, res: Response) => {
  const profiles = profileRegistry.listProfiles();
  res.json({
    profiles: profiles.map(p => ({
      id: p.id,
      name: p.name,
      instanceIds: p.config.instanceIds,
      kbDir: p.config.kbDir,
      dataDir: p.config.dataDir,
      enabled: p.config.enabled,
      // US-449: Per-profile WhatsApp instance assignment
      whatsappInstanceId: profileRegistry.getInstanceForProfile(p.id) ?? null,
      // External link to the property's public-facing website or app
      // e.g. pelangicapsulehostel.com, pms-southern.vercel.app, fnb-online-order.vercel.app/en
      siteUrl: p.config.siteUrl ?? null,
    })),
    defaultProfileId: profileRegistry.getDefaultProfileId(),
  });
});

/** GET /api/rainbow/profiles/active — Get currently active admin profile context */
router.get('/profiles/active', (req: Request, res: Response) => {
  const profileId = (req.headers['x-profile-id'] as string) || req.query.profileId as string;
  const profile = profileId
    ? profileRegistry.getProfile(profileId)
    : profileRegistry.getDefaultProfile();

  if (!profile) {
    res.status(404).json({ error: `Profile "${profileId}" not found` });
    return;
  }

  res.json({
    id: profile.id,
    name: profile.name,
    instanceIds: profile.config.instanceIds,
    kbDir: profile.config.kbDir,
    dataDir: profile.config.dataDir,
    enabled: profile.config.enabled,
    isDefault: profile.id === profileRegistry.getDefaultProfileId(),
    // US-449: Per-profile WhatsApp instance assignment
    whatsappInstanceId: profileRegistry.getInstanceForProfile(profile.id) ?? null,
  });
});

// ─── Config files to clone per profile ────────────────────────────────
const CLONE_CONFIG_FILES = [
  'knowledge.json',
  'intents.json',
  'templates.json',
  'settings.json',
  'workflow.json',
  'workflows.json',
  'routing.json',
];

// Fields to strip from cloned settings (WhatsApp-specific)
const SETTINGS_STRIP_FIELDS = ['whatsappInstanceId', 'whatsappPhoneNumber'];

/**
 * POST /api/rainbow/profiles/:sourceId/clone
 * US-827: Clone a profile's configuration as a template for a new profile.
 *
 * Body: { newProfileId: string, displayName: string }
 * Returns: { profileId, copied, message }
 */
router.post('/profiles/:sourceId/clone', async (req: Request, res: Response) => {
  try {
    const { sourceId } = req.params;
    const { newProfileId, displayName } = req.body || {};

    // ── Validate inputs ───────────────────────────────────────────
    if (!newProfileId || typeof newProfileId !== 'string') {
      res.status(400).json({ error: 'newProfileId is required (string)' });
      return;
    }
    if (!displayName || typeof displayName !== 'string') {
      res.status(400).json({ error: 'displayName is required (string)' });
      return;
    }

    // Validate profileId format: lowercase alphanumeric + hyphens
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(newProfileId) && !/^[a-z0-9]$/.test(newProfileId)) {
      res.status(400).json({ error: 'newProfileId must be lowercase alphanumeric with hyphens (e.g., "my-new-profile")' });
      return;
    }

    // ── Validate source profile exists ────────────────────────────
    const sourceProfile = profileRegistry.getProfile(sourceId);
    if (!sourceProfile) {
      res.status(404).json({ error: `Source profile "${sourceId}" not found` });
      return;
    }

    // ── Check newProfileId doesn't already exist ──────────────────
    const profilesPath = join(process.cwd(), 'profiles.json');
    let profilesFile: ProfilesFile;
    try {
      profilesFile = JSON.parse(readFileSync(profilesPath, 'utf-8'));
    } catch {
      res.status(500).json({ error: 'Failed to read profiles.json' });
      return;
    }

    if (profilesFile.profiles.some(p => p.id === newProfileId)) {
      res.status(409).json({ error: `Profile "${newProfileId}" already exists` });
      return;
    }

    // ── Derive new profile paths ──────────────────────────────────
    const newDbConfigPrefix = newProfileId;
    const newDataDir = `src/assistant/data-${newProfileId}`;
    const newKbDir = `.rainbow-kb-${newProfileId}`;

    // ── Copy rainbow_configs rows in DB ───────────────────────────
    const sourcePrefix = sourceProfile.config.dbConfigPrefix;
    const copied: string[] = [];

    if (process.env.DATABASE_URL) {
      await pool.query('BEGIN');
      try {
        for (const configFile of CLONE_CONFIG_FILES) {
          const sourceKey = sourcePrefix ? `${sourcePrefix}:${configFile}` : configFile;
          const newKey = `${newDbConfigPrefix}:${configFile}`;

          const { rows } = await pool.query(
            'SELECT data FROM rainbow_configs WHERE key = $1',
            [sourceKey]
          );

          if (rows.length > 0) {
            let data = rows[0].data;

            // Strip WhatsApp-specific fields from settings
            if (configFile === 'settings.json' && data && typeof data === 'object') {
              data = { ...data };
              for (const field of SETTINGS_STRIP_FIELDS) {
                delete (data as Record<string, unknown>)[field];
              }
            }

            await pool.query(
              `INSERT INTO rainbow_configs (key, data, version, updated_at, updated_by)
               VALUES ($1, $2, 1, NOW(), $3)
               ON CONFLICT (key) DO NOTHING`,
              [newKey, JSON.stringify(data), 'clone']
            );
            copied.push(configFile);
          }
        }
        await pool.query('COMMIT');
      } catch (dbErr) {
        await pool.query('ROLLBACK').catch(() => {});
        throw dbErr;
      }
    }

    // ── Create local data directory with cloned JSON files ────────
    const absDataDir = join(process.cwd(), newDataDir);
    if (!existsSync(absDataDir)) {
      mkdirSync(absDataDir, { recursive: true });
    }

    // Copy JSON files from source data directory to new data directory
    const sourceDataDir = join(process.cwd(), sourceProfile.config.dataDir);
    for (const configFile of CLONE_CONFIG_FILES) {
      const sourcePath = join(sourceDataDir, configFile);
      if (existsSync(sourcePath)) {
        let content = readFileSync(sourcePath, 'utf-8');

        // Strip WhatsApp-specific fields from settings
        if (configFile === 'settings.json') {
          try {
            const parsed = JSON.parse(content);
            for (const field of SETTINGS_STRIP_FIELDS) {
              delete parsed[field];
            }
            content = JSON.stringify(parsed, null, 2);
          } catch { /* keep original if parse fails */ }
        }

        writeFileSync(join(absDataDir, configFile), content, 'utf-8');
        if (!copied.includes(configFile)) copied.push(configFile);
      }
    }

    // Also copy kb-patterns.json if it exists (used by KnowledgeBaseInstance)
    const kbPatternsSource = join(sourceDataDir, 'kb-patterns.json');
    if (existsSync(kbPatternsSource)) {
      writeFileSync(
        join(absDataDir, 'kb-patterns.json'),
        readFileSync(kbPatternsSource, 'utf-8'),
        'utf-8'
      );
      copied.push('kb-patterns.json');
    }

    // ── Create empty KB directory ─────────────────────────────────
    const absKbDir = join(process.cwd(), newKbDir);
    if (!existsSync(absKbDir)) {
      mkdirSync(absKbDir, { recursive: true });
    }

    // ── Update profiles.json ──────────────────────────────────────
    profilesFile.profiles.push({
      id: newProfileId,
      name: displayName,
      instanceIds: [],
      kbDir: newKbDir,
      dataDir: newDataDir,
      dbConfigPrefix: newDbConfigPrefix,
      enabled: true,
    });
    writeFileSync(profilesPath, JSON.stringify(profilesFile, null, 2) + '\n', 'utf-8');

    console.log(`[Profiles] Cloned profile "${sourceId}" → "${newProfileId}" (${copied.length} config files)`);

    res.status(201).json({
      profileId: newProfileId,
      displayName,
      copied,
      kbDir: newKbDir,
      dataDir: newDataDir,
      message: `Profile cloned successfully. Restart server to activate the new profile.`,
    });
  } catch (err: any) {
    console.error('[Profiles] Clone failed:', err.message);
    res.status(500).json({ error: 'Clone operation failed' });
  }
});

export default router;
