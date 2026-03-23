/**
 * Booking Sequence Admin Routes (US-884)
 *
 * POST /api/bookings              — Create a booking and schedule pre-arrival messages
 * GET  /api/bookings              — List bookings with scheduled message status
 * DELETE /api/bookings/:id        — Cancel a booking's pending messages
 * POST /api/bookings/profile      — Profile booking workflow performance (US-121)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { scheduleBookingSequence, cancelBookingSequence, listBookings } from '../../lib/booking-sequence.js';
import { ok, badRequest, notFound, serverError, validateRequired } from './http-utils.js';
import { getAggregatedMetrics, getWorkflowMetrics, generateOptimizationReport, getRecentMetrics } from '../../assistant/workflow-profiler.js';

const router = Router();

// POST /bookings — Create booking + schedule pre-arrival sequence
router.post('/bookings', async (req: Request, res: Response) => {
  try {
    const err = validateRequired(req.body, ['jid', 'guestName', 'arrivalDate']);
    if (err) { badRequest(res, err); return; }

    const { jid, guestName, arrivalDate, checkInTime, roomType, confirmationNumber } = req.body;

    // Validate arrivalDate is a valid date
    const parsedDate = new Date(arrivalDate);
    if (isNaN(parsedDate.getTime())) {
      badRequest(res, 'arrivalDate must be a valid ISO date (YYYY-MM-DD)');
      return;
    }

    const profileId = (res.locals.profileId as string) || 'pelangi';

    const result = await scheduleBookingSequence({
      jid,
      guestName,
      arrivalDate,
      checkInTime,
      roomType,
      confirmationNumber,
      profileId,
    });

    ok(res, result);
  } catch (error: any) {
    console.error('[BookingSequence] POST /bookings failed:', error.message);
    serverError(res, error);
  }
});

// GET /bookings — List bookings with message status
router.get('/bookings', async (req: Request, res: Response) => {
  try {
    const profileId = (res.locals.profileId as string) || undefined;
    const bookings = await listBookings(profileId);
    ok(res, { bookings });
  } catch (error: any) {
    serverError(res, error);
  }
});

// DELETE /bookings/:id — Cancel booking's pending messages
router.delete('/bookings/:id', async (req: Request, res: Response) => {
  try {
    const bookingId = req.params.id;
    const cancelled = await cancelBookingSequence(bookingId);
    if (cancelled === 0) {
      notFound(res, 'Booking or pending messages');
      return;
    }
    ok(res, { cancelled });
  } catch (error: any) {
    serverError(res, error);
  }
});

// POST /bookings/profile — Profile booking workflow performance (US-121)
router.post('/bookings/profile', async (req: Request, res: Response) => {
  try {
    const { workflowId, minutes = 60 } = req.body || {};

    // Get metrics based on query filters
    let metrics: any[] = [];

    if (workflowId) {
      metrics = getWorkflowMetrics(workflowId);
    } else if (minutes) {
      metrics = getRecentMetrics(minutes);
    } else {
      metrics = getAggregatedMetrics();
    }

    // Generate optimization report
    const report = generateOptimizationReport();

    // Aggregate per-step statistics
    const stepStats = metrics.map(m => ({
      stepId: m.stepId,
      stepType: m.stepType,
      executionCount: m.count,
      latency: {
        avg: Math.round(m.avgDurationMs),
        p95: Math.round(m.p95DurationMs),
        p99: Math.round(m.p99DurationMs),
        min: Math.round(m.minDurationMs),
        max: Math.round(m.maxDurationMs),
      },
      dataSize: {
        avgInput: Math.round(m.avgInputSize),
        avgOutput: Math.round(m.avgOutputSize),
      },
      performance: {
        slowExecutions: m.totalSlowExecutions,
        slowPercentage: m.count > 0 ? Math.round((m.totalSlowExecutions / m.count) * 100) : 0,
        flagged: m.avgDurationMs > 2000 || m.p99DurationMs > 2000,
      }
    }));

    // Sort by average duration descending (bottlenecks first)
    stepStats.sort((a, b) => b.latency.avg - a.latency.avg);

    // Prepare response with heatmap and suggestions
    ok(res, {
      profile: {
        timestamp: new Date().toISOString(),
        filter: {
          workflowId: workflowId || 'all',
          minutesAgo: minutes,
        },
        summary: {
          totalSteps: stepStats.length,
          slowSteps: stepStats.filter(s => s.performance.flagged).length,
          totalExecutions: stepStats.reduce((sum, s) => sum + s.executionCount, 0),
          avgTotalLatency: Math.round(
            stepStats.reduce((sum, s) => sum + s.latency.avg, 0) / (stepStats.length || 1)
          ),
        },
        steps: stepStats,
        heatmap: report.heatmap,
        suggestions: report.suggestions,
      }
    });
  } catch (error: any) {
    console.error('[BookingProfiler] POST /bookings/profile failed:', error.message);
    serverError(res, error);
  }
});

export default router;
