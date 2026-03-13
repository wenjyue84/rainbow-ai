import { Router } from 'express';
import type { Request, Response } from 'express';
import { getKBFilesHealth } from '../../lib/config-db.js';

const router = Router();

router.get('/kb-health', async (_req: Request, res: Response) => {
  try {
    const files = await getKBFilesHealth();
    const staleCount = files.filter(f => f.stale).length;

    res.json({
      timestamp: new Date().toISOString(),
      totalFiles: files.length,
      staleFiles: staleCount,
      freshFiles: files.length - staleCount,
      files,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
