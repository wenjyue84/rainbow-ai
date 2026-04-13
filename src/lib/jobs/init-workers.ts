/**
 * US-558: Job Worker Initialization
 *
 * Initializes BullMQ workers for background jobs including booking timeout handlers.
 * This should be called once during server startup.
 */

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { handleBookingTimeout } from './booking-timeout-handler.js';
import type { BookingTimeoutJobData } from './booking-timeout-handler.js';
import type { Job } from 'bullmq';

// ─── Constants ───────────────────────────────────────────────────────

const QUEUE_NAME = 'booking-workflow-timeouts';
const WORKER_CONCURRENCY = 5; // Number of jobs to process in parallel

// ─── State ───────────────────────────────────────────────────────────

let timeoutWorker: Worker | null = null;

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

    console.log(
      `[JobWorkers] Initialized workers (queue: ${QUEUE_NAME}, concurrency: ${WORKER_CONCURRENCY})`
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
      console.log('[JobWorkers] All workers shut down');
    }
  } catch (error) {
    console.error('[JobWorkers] Error shutting down workers:', error);
  }
}
