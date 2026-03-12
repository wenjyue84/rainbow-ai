/**
 * Admin API — Profile Management
 *
 * Endpoints for listing and inspecting multi-profile configuration.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { profileRegistry } from '../../assistant/profile-registry.js';

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
  });
});

export default router;
