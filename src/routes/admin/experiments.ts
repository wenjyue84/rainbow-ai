/**
 * Admin API: A/B Experiment Framework (US-837)
 *
 * GET    /api/rainbow/experiments              — List all experiments
 * GET    /api/rainbow/experiments/:id/results   — Variant comparison with stats
 * POST   /api/rainbow/experiments              — Create/update an experiment
 * PATCH  /api/rainbow/experiments/:id/activate  — Activate an experiment
 * PATCH  /api/rainbow/experiments/:id/deactivate — Deactivate an experiment
 * DELETE /api/rainbow/experiments/:id           — Remove an experiment
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { configStore } from '../../assistant/config-store.js';
import { experimentSchema } from '../../assistant/schemas.js';
import { getExperimentResults } from '../../lib/experiments.js';
import type { Experiment } from '../../assistant/schemas.js';

const router = Router();

/** Helper: read experiments array from settings (always returns array). */
function getExperiments(): Experiment[] {
  const settings = configStore.getSettings() as any;
  return Array.isArray(settings.experiments) ? settings.experiments : [];
}

/** Helper: save experiments array back to settings. */
function saveExperiments(experiments: Experiment[]): void {
  const settings = configStore.getSettings() as any;
  configStore.setSettings({ ...settings, experiments });
}

// GET /api/rainbow/experiments — List all experiments
router.get('/experiments', (_req: Request, res: Response) => {
  try {
    const experiments = getExperiments();
    res.json({ success: true, experiments });
  } catch (error: any) {
    console.error('[Experiments] Failed to list:', error.message);
    res.status(500).json({ error: 'Failed to list experiments' });
  }
});

// GET /api/rainbow/experiments/:id/results — Variant comparison
router.get('/experiments/:id/results', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const experiments = getExperiments();
    const experiment = experiments.find(e => e.id === id);
    if (!experiment) {
      res.status(404).json({ error: 'Experiment not found' });
      return;
    }

    const results = await getExperimentResults(id);
    res.json({ success: true, experiment, results });
  } catch (error: any) {
    console.error('[Experiments] Failed to get results:', error.message);
    res.status(500).json({ error: 'Failed to retrieve experiment results' });
  }
});

// POST /api/rainbow/experiments — Create or update an experiment
router.post('/experiments', (req: Request, res: Response) => {
  try {
    const parsed = experimentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid experiment config', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const newExp = parsed.data;
    const experiments = getExperiments();
    const existingIdx = experiments.findIndex(e => e.id === newExp.id);

    if (existingIdx >= 0) {
      experiments[existingIdx] = newExp;
    } else {
      experiments.push(newExp);
    }

    saveExperiments(experiments);
    res.json({ success: true, experiment: newExp });
  } catch (error: any) {
    console.error('[Experiments] Failed to save:', error.message);
    res.status(500).json({ error: 'Failed to save experiment' });
  }
});

// PATCH /api/rainbow/experiments/:id/activate
router.patch('/experiments/:id/activate', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const experiments = getExperiments();
    const experiment = experiments.find(e => e.id === id);
    if (!experiment) {
      res.status(404).json({ error: 'Experiment not found' });
      return;
    }

    experiment.active = true;
    saveExperiments(experiments);
    res.json({ success: true, experiment });
  } catch (error: any) {
    console.error('[Experiments] Failed to activate:', error.message);
    res.status(500).json({ error: 'Failed to activate experiment' });
  }
});

// PATCH /api/rainbow/experiments/:id/deactivate
router.patch('/experiments/:id/deactivate', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const experiments = getExperiments();
    const experiment = experiments.find(e => e.id === id);
    if (!experiment) {
      res.status(404).json({ error: 'Experiment not found' });
      return;
    }

    experiment.active = false;
    saveExperiments(experiments);
    res.json({ success: true, experiment });
  } catch (error: any) {
    console.error('[Experiments] Failed to deactivate:', error.message);
    res.status(500).json({ error: 'Failed to deactivate experiment' });
  }
});

// DELETE /api/rainbow/experiments/:id
router.delete('/experiments/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const experiments = getExperiments();
    const filtered = experiments.filter(e => e.id !== id);
    if (filtered.length === experiments.length) {
      res.status(404).json({ error: 'Experiment not found' });
      return;
    }

    saveExperiments(filtered);
    res.json({ success: true, deleted: id });
  } catch (error: any) {
    console.error('[Experiments] Failed to delete:', error.message);
    res.status(500).json({ error: 'Failed to delete experiment' });
  }
});

export default router;
