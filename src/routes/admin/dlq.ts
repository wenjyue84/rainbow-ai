/**
 * Dead Letter Queue (DLQ) Admin API
 *
 * GET  /api/admin/dlq              — list failed jobs with details
 * POST /api/admin/dlq/:jobId/retry — replay a single job through the pipeline
 *
 * US-413
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDLQJobs, retryDLQJob } from '../../lib/message-queue.js';

const router = Router();

router.get('/dlq', async (_req: Request, res: Response) => {
  try {
    const jobs = await getDLQJobs();
    res.json({
      count: jobs.length,
      jobs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/dlq/:jobId/retry', async (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }
  const result = await retryDLQJob(jobId);
  if (result.ok) {
    res.json({ success: true, jobId });
  } else {
    res.status(result.error?.includes('not found') ? 404 : 500).json({ error: result.error });
  }
});

export default router;
