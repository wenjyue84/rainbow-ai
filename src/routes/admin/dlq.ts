/**
 * Dead Letter Queue (DLQ) Admin API
 *
 * GET  /api/admin/dlq              — list failed jobs with details
 * GET  /api/admin/dlq/:jobId       — get DLQ job with associated raw event payload (US-895)
 * POST /api/admin/dlq/:jobId/retry — replay a single job through the pipeline
 *
 * US-413, US-895
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDLQJobs, retryDLQJob } from '../../lib/message-queue.js';
import { getRawEventById } from '../../lib/webhook-raw-events.js';

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

// US-895: Get a single DLQ job with associated raw event payload
router.get('/dlq/:jobId', async (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  if (!jobId) {
    res.status(400).json({ error: 'jobId is required' });
    return;
  }
  try {
    const jobs = await getDLQJobs();
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      res.status(404).json({ error: `DLQ job ${jobId} not found` });
      return;
    }
    // Fetch associated raw event payload if available
    let rawEvent = null;
    if (job.rawEventId) {
      rawEvent = await getRawEventById(job.rawEventId);
    }
    res.json({ job, rawEvent });
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
