import { Router } from 'express';
import type { Request, Response } from 'express';
import { getKBFilesHealth } from '../../lib/config-db.js';

const router = Router();

// Express 5: async errors auto-propagate to error-handling middleware
router.get('/kb-health', async (_req: Request, res: Response) => {
  const files = await getKBFilesHealth();
  const staleCount = files.filter(f => f.stale).length;

  res.json({
    timestamp: new Date().toISOString(),
    totalFiles: files.length,
    staleFiles: staleCount,
    freshFiles: files.length - staleCount,
    files,
  });
});

export default router;
