/**
 * US-558: Job Worker Initialization
 *
 * Initializes BullMQ workers for background jobs including booking timeout handlers.
 * This should be called once during server startup.
 */

import { Worker, Queue } from 'bullmq';
import Redis from 'ioredis';
import { handleBookingTimeout } from './booking-timeout-handler.js';
import type { BookingTimeoutJobData } from './booking-timeout-handler.js';
import { processAbandonedBookingReminders } from '../../jobs/abandoned-booking-reminder.js';
import type { AbandonedBookingReminderJobData } from '../../jobs/abandoned-booking-reminder.js';
import type { Job } from 'bullmq';

// ─── Constants ───────────────────────────────────────────────────────

const QUEUE_NAME = 'booking-workflow-timeouts';
const WORKER_CONCURRENCY = 5; // Number of jobs to process in parallel

// ─── State ───────────────────────────────────────────────────────────

let timeoutWorker: Worker | null = null;
let reminderWorker: Worker | null = null;
let reminderQueue: Queue | null = null;

/**
 * Get Redis configuration from environment variables
 */
function getRedisConfig(): { host: string; port: number; password?: string } {
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      return {
        host: parsed.hostname || '127.0.0.1',
        port: parseInt(parsed.port, 10) || 6379,
        password: parsed.password || undefined,
      };
    } catch {
      // fall through to defaults
    }
  }
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

/**
 * Initialize all background job workers
 * Should be called once during server startup
 */
export async function initializeWorkers(): Promise<void> {
  try {
    const redisConfig = getRedisConfig();
    const connectionOpts = {
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      maxRetriesPerRequest: null as null,
    };

    // Initialize booking timeout worker
    timeoutWorker = new Worker(
      QUEUE_NAME,
      async (job: Job<BookingTimeoutJobData>) => {
        await handleBookingTimeout(job);
      },
      {
        connection: connectionOpts,
        concurrency: WORKER_CONCURRENCY,
      }
    );

    timeoutWorker.on('failed', (job: Job<BookingTimeoutJobData> | undefined, err: Error) => {
      if (!job) return;
      console.error(
        `[JobWorkers] Booking timeout job failed (${job.id}): ${err.message}`
      );
    });

    timeoutWorker.on('completed', (job: Job<BookingTimeoutJobData>) => {
      console.log(`[JobWorkers] Booking timeout job completed (${job.id})`);
    });

    timeoutWorker.on('error', (err: Error) => {
      // Suppress connection errors — expected during Redis restarts
      if (!err.message.includes('ECONNREFUSED')) {
        console.error(`[JobWorkers] Worker error: ${err.message}`);
      }
    });

    // Initialize abandoned booking reminder worker (US-562)
    reminderQueue = new Queue(
      'abandoned-booking-reminders',
      {
        connection: connectionOpts,
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: false,
        },
      }
    );

    reminderWorker = new Worker(
      'abandoned-booking-reminders',
      async (job: Job<AbandonedBookingReminderJobData>) => {
        return await processAbandonedBookingReminders(job.data);
      },
      {
        connection: connectionOpts,
        concurrency: 1, // Process one reminder job at a time
      }
    );

    // Schedule reminder job to run every 15 minutes
    await reminderQueue.add(
      'process-abandoned-reminders',
      {
        jobId: `reminder-job-${Date.now()}`,
      } as AbandonedBookingReminderJobData,
      {
        repeat: {
          pattern: '*/15 * * * *', // Every 15 minutes
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    reminderWorker.on('failed', (job: Job<AbandonedBookingReminderJobData> | undefined, err: Error) => {
      if (!job) return;
      console.error(
        `[JobWorkers] Abandoned booking reminder job failed (${job.id}): ${err.message}`
      );
    });

    reminderWorker.on('completed', (job: Job<AbandonedBookingReminderJobData>) => {
      console.log(`[JobWorkers] Abandoned booking reminder job completed (${job.id})`);
    });

    reminderWorker.on('error', (err: Error) => {
      if (!err.message.includes('ECONNREFUSED')) {
        console.error(`[JobWorkers] Reminder worker error: ${err.message}`);
      }
    });

    console.log(
      `[JobWorkers] Initialized workers (timeout queue: ${QUEUE_NAME}, reminder queue: abandoned-booking-reminders, concurrency: ${WORKER_CONCURRENCY})`
    );
  } catch (error) {
    console.error('[JobWorkers] Failed to initialize workers:', error);
    throw error;
  }
}

/**
 * Shutdown all background job workers
 * Should be called during server shutdown
 */
export async function shutdownWorkers(): Promise<void> {
  try {
    if (timeoutWorker) {
      await timeoutWorker.close();
      timeoutWorker = null;
    }
    if (reminderWorker) {
      await reminderWorker.close();
      reminderWorker = null;
    }
    if (reminderQueue) {
      await reminderQueue.close();
      reminderQueue = null;
    }
    console.log('[JobWorkers] All workers shut down');
  } catch (error) {
    console.error('[JobWorkers] Error shutting down workers:', error);
  }
}
