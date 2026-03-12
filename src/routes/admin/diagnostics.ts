import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateIntegrations, getSystemInfo } from '../../lib/integration-validator.js';

const router = Router();

router.get('/diagnostics', async (_req: Request, res: Response) => {
  try {
    const [validationResults, system] = await Promise.all([
      validateIntegrations(),
      Promise.resolve(getSystemInfo()),
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      system,
      validationResults,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
