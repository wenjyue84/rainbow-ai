import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateIntegrations, getSystemInfo } from '../../lib/integration-validator.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware
router.get('/diagnostics', async (_req: Request, res: Response) => {
  const [validationResults, system] = await Promise.all([
    validateIntegrations(),
    Promise.resolve(getSystemInfo()),
  ]);

  res.json({
    timestamp: new Date().toISOString(),
    system,
    validationResults,
  });
});

export default router;
