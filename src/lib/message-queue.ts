/**
 * Message Queue — BullMQ-based async message processing
 *
 * Decouples WhatsApp webhook ingestion from message processing.
 * The Baileys event handler enqueues raw messages and returns immediately,
 * while a worker drains the queue at its own pace.
 *
 * Falls back to direct (synchronous) processing if Redis is unavailable.
 *
 * US-405
 */
import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import Redis from 'ioredis';
import net from 'net';
import type { IncomingMessage } from '../assistant/types.js';
import { persistRawEvent, markRawEventProcessed } from './webhook-raw-events.js';

// ─── Types ───────────────────────────────────────────────────────

export interface QueueHealthMetrics {
  enabled: boolean;
  connected: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  workerConcurrency: number;
  deadLetterCount: number;
  dedupHits: number;           // US-1008: total duplicate messages dropped
}

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

/** Job payload shape — IncomingMessage + optional raw event tracking */
interface QueueJobData extends IncomingMessage {
  _rawEventId?: string;
}

// ─── Constants ───────────────────────────────────────────────────

const QUEUE_NAME = 'rainbow-messages';
const DLQ_NAME = 'rainbow-messages-dlq';
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_CONCURRENCY = 3;
const REDIS_CONNECT_TIMEOUT_MS = 3000;
const DEDUP_KEY_PREFIX = 'whatsapp:msg:';       // US-1008: Redis key format
const DEFAULT_DEDUP_TTL_SECONDS = 14400;        // US-1008: 4-hour TTL to bound memory

// ─── State ───────────────────────────────────────────────────────

let queue: Queue | null = null;
let dlq: Queue | null = null;
let worker: Worker | null = null;
let queueEvents: QueueEvents | null = null;
let redisClient: Redis | null = null;
let isConnected = false;
let directHandler: MessageHandler | null = null;
let dlqCount = 0;
let dedupTtlSeconds = DEFAULT_DEDUP_TTL_SECONDS;

// US-1008: Dedup hit counter — tracks how many duplicate messages were dropped
let dedupHitCount = 0;

// In-memory dedup fallback when Redis is unavailable (US-991)
const memoryDedup = new Map<string, number>();
const MEMORY_DEDUP_MAX = 2000;

// ─── Redis connection config ─────────────────────────────────────

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
 * Probe Redis connectivity with a raw TCP socket.
 * Faster and more reliable than ioredis for connectivity checks.
 */
async function probeRedis(config: { host: string; port: number }): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, REDIS_CONNECT_TIMEOUT_MS);

    socket.connect(config.port, config.host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

// ─── Init ────────────────────────────────────────────────────────

/**
 * Initialize the message queue system.
 * If Redis is unavailable, falls back to direct processing.
 *
 * @param handler - The message processing function (handleIncomingMessage)
 * @param concurrency - Worker concurrency (default from settings or 3)
 */
export async function initMessageQueue(
  handler: MessageHandler,
  concurrency: number = DEFAULT_CONCURRENCY
): Promise<boolean> {
  directHandler = handler;

  const redisConfig = getRedisConfig();

  // Fast-fail: probe Redis before creating BullMQ objects
  const redisAvailable = await probeRedis(redisConfig);
  if (!redisAvailable) {
    console.warn(
      `[MessageQueue] Redis not available at ${redisConfig.host}:${redisConfig.port} — using direct processing`
    );
    return false;
  }

  const connectionOpts = {
    host: redisConfig.host,
    port: redisConfig.port,
    password: redisConfig.password,
    maxRetriesPerRequest: null as null,
  };

  try {
    // Create a dedicated ioredis client for dedup SETNX (US-991)
    redisClient = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      password: redisConfig.password,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
    await redisClient.connect();

    // Create main queue
    queue = new Queue(QUEUE_NAME, {
      connection: connectionOpts,
      defaultJobOptions: {
        attempts: MAX_RETRY_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: 1000, // 1s, 2s, 4s
        },
        removeOnComplete: { count: 1000 }, // keep last 1000 completed
        removeOnFail: false, // keep failed for DLQ inspection
      },
    });

    // Dead letter queue
    dlq = new Queue(DLQ_NAME, { connection: connectionOpts });

    // Worker — processes jobs from the queue
    worker = new Worker(
      QUEUE_NAME,
      async (job: Job<QueueJobData>) => {
        const { _rawEventId, ...msg } = job.data;
        await handler(msg);
        // Mark raw event as processed on success
        if (_rawEventId) {
          markRawEventProcessed(_rawEventId).catch(() => {});
        }
      },
      {
        connection: connectionOpts,
        concurrency,
        limiter: {
          max: concurrency * 10,
          duration: 1000,
        },
      }
    );

    // Move permanently failed jobs to DLQ
    worker.on('failed', async (job: Job<QueueJobData> | undefined, err: Error) => {
      if (!job) return;
      const attemptsMade = job.attemptsMade;

      if (attemptsMade >= MAX_RETRY_ATTEMPTS) {
        console.error(
          `[MessageQueue] Job ${job.id} permanently failed after ${attemptsMade} attempts: ${err.message}`
        );
        // Move to dead letter queue
        try {
          if (dlq) {
            await dlq.add('dead-letter', {
              originalJobId: job.id,
              data: job.data,
              rawEventId: job.data._rawEventId ?? null,
              error: err.message,
              failedAt: new Date().toISOString(),
            } as any);
            dlqCount++;
            // Fire alert if DLQ depth exceeds threshold
            maybeSendDLQAlert(dlqCount).catch(() => {});
          }
        } catch (dlqErr: any) {
          console.error(`[MessageQueue] Failed to add to DLQ: ${dlqErr.message}`);
        }
      } else {
        console.warn(
          `[MessageQueue] Job ${job.id} failed (attempt ${attemptsMade}/${MAX_RETRY_ATTEMPTS}): ${err.message}`
        );
      }
    });

    worker.on('error', (err: Error) => {
      // Suppress connection errors after initial setup — these are expected during Redis restarts
      if (!err.message.includes('ECONNREFUSED')) {
        console.error(`[MessageQueue] Worker error: ${err.message}`);
      }
    });

    // Queue events for monitoring
    queueEvents = new QueueEvents(QUEUE_NAME, { connection: connectionOpts });

    // Wait for queue to be ready (should be fast since we already probed)
    await queue.waitUntilReady();

    isConnected = true;
    console.log(
      `[MessageQueue] Connected to Redis at ${redisConfig.host}:${redisConfig.port} — worker concurrency: ${concurrency}`
    );
    return true;
  } catch (err: any) {
    console.warn(
      `[MessageQueue] BullMQ init failed (${err.message}) — falling back to direct processing`
    );
    await closeQueue();
    isConnected = false;
    return false;
  }
}

// ─── Enqueue ─────────────────────────────────────────────────────

/**
 * Enqueue an incoming message for async processing.
 * If Redis is unavailable, processes directly (fallback).
 *
 * US-895: Persists the raw payload to webhook_raw_events before enqueuing.
 * The insert is fire-and-forget — a DB failure does not block processing.
 *
 * Returns within 200ms in queue mode.
 */
export async function enqueueMessage(msg: IncomingMessage): Promise<void> {
  // US-1008: Idempotency guard — check whatsapp:msg:{message_id} key before processing
  if (msg.messageId && await isDuplicateMessage(msg.messageId)) {
    dedupHitCount++;
    console.log(`[MessageQueue] Dedup: skipping duplicate messageId=${msg.messageId} totalHits=${dedupHitCount}`);
    return; // ACK with 200 but don't enqueue — no duplicate AI call
  }

  // US-895: Persist raw payload before any processing
  const rawEventId = await persistRawEvent(msg, msg.instanceId ?? 'pelangi');

  if (isConnected && queue) {
    try {
      const jobData: QueueJobData = { ...msg, _rawEventId: rawEventId ?? undefined };
      await queue.add('incoming-message', jobData, {
        jobId: `msg-${msg.messageId}-${Date.now()}`,
      });
      return;
    } catch (err: any) {
      console.error(`[MessageQueue] Enqueue failed, processing directly: ${err.message}`);
      // Fall through to direct processing
    }
  }

  // Fallback: direct processing
  if (directHandler) {
    await directHandler(msg);
    // Mark as processed on success in direct mode
    if (rawEventId) {
      markRawEventProcessed(rawEventId).catch(() => {});
    }
  }
}

/**
 * US-991: Check if a message ID has already been seen using Redis SETNX.
 * Falls back to in-memory Map if Redis is unavailable.
 * Returns true if the message is a duplicate, false if it's new.
 */
async function isDuplicateMessage(messageId: string): Promise<boolean> {
  const key = `${DEDUP_KEY_PREFIX}${messageId}`;

  // Try Redis SETNX first
  if (redisClient) {
    try {
      // SET key 1 NX EX ttl — atomic check-and-set with TTL
      const result = await redisClient.set(key, '1', 'EX', dedupTtlSeconds, 'NX');
      // result is 'OK' if key was set (new message), null if key already exists (duplicate)
      return result === null;
    } catch {
      // Redis error — fall through to in-memory
    }
  }

  // In-memory fallback
  const now = Date.now();
  if (memoryDedup.has(messageId)) {
    const seenAt = memoryDedup.get(messageId)!;
    if (now - seenAt < dedupTtlSeconds * 1000) {
      return true; // duplicate
    }
    // Entry expired, treat as new
  }

  memoryDedup.set(messageId, now);

  // Evict expired entries if map is getting large
  if (memoryDedup.size > MEMORY_DEDUP_MAX) {
    for (const [id, ts] of memoryDedup) {
      if (now - ts > dedupTtlSeconds * 1000) {
        memoryDedup.delete(id);
      }
    }
  }

  return false;
}

/**
 * US-991: Set the dedup TTL (in seconds). Called from settings loader.
 */
export function setDedupTtl(ttlSeconds: number): void {
  if (ttlSeconds > 0) {
    dedupTtlSeconds = ttlSeconds;
  }
}

/**
 * US-1008: Get dedup statistics for monitoring / admin dashboard.
 */
export function getDedupStats(): { dedupHits: number; ttlSeconds: number; memoryDedupSize: number } {
  return {
    dedupHits: dedupHitCount,
    ttlSeconds: dedupTtlSeconds,
    memoryDedupSize: memoryDedup.size,
  };
}

// ─── Health Metrics ──────────────────────────────────────────────

/**
 * Get queue health metrics for admin dashboard.
 */
export async function getQueueHealth(): Promise<QueueHealthMetrics> {
  if (!isConnected || !queue) {
    return {
      enabled: false,
      connected: false,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      workerConcurrency: 0,
      deadLetterCount: 0,
      dedupHits: dedupHitCount,
    };
  }

  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      enabled: true,
      connected: true,
      waiting,
      active,
      completed,
      failed,
      delayed,
      workerConcurrency: worker?.opts?.concurrency ?? DEFAULT_CONCURRENCY,
      deadLetterCount: dlqCount,
      dedupHits: dedupHitCount,
    };
  } catch (err: any) {
    console.error(`[MessageQueue] Health check failed: ${err.message}`);
    return {
      enabled: true,
      connected: false,
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      workerConcurrency: 0,
      deadLetterCount: dlqCount,
      dedupHits: dedupHitCount,
    };
  }
}

/**
 * Check if the queue is active (connected to Redis).
 */
export function isQueueActive(): boolean {
  return isConnected;
}

// ─── DLQ Inspection & Replay ─────────────────────────────────────

export interface DLQJob {
  id: string;
  phone: string;
  messageContent: string;
  failureReason: string;
  failedAt: string;
  retryCount: number;
  originalJobId: string | undefined;
  rawEventId: string | null;  // US-895: reference to webhook_raw_events row
}

/**
 * Get all jobs currently in the dead letter queue.
 */
export async function getDLQJobs(): Promise<DLQJob[]> {
  if (!dlq) return [];
  try {
    const jobs = await dlq.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed'], 0, 100);
    return jobs.map((job) => {
      const data = job.data as any;
      const msg: IncomingMessage = data.data || {};
      return {
        id: job.id ?? '',
        phone: msg.from || 'unknown',
        messageContent: msg.text || (msg as any).message || '',
        failureReason: data.error || 'unknown',
        failedAt: data.failedAt || new Date(job.timestamp).toISOString(),
        retryCount: job.attemptsMade || 0,
        originalJobId: data.originalJobId,
        rawEventId: data.rawEventId ?? null,
      };
    });
  } catch (err: any) {
    console.error(`[MessageQueue] getDLQJobs error: ${err.message}`);
    return [];
  }
}

/**
 * Get current depth of the dead letter queue.
 */
export async function getDLQDepth(): Promise<number> {
  if (!dlq) return dlqCount;
  try {
    const counts = await dlq.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
    return Object.values(counts).reduce((sum: number, n: number) => sum + n, 0);
  } catch {
    return dlqCount;
  }
}

/**
 * Replay a single DLQ job back through the main message queue.
 */
export async function retryDLQJob(dlqJobId: string): Promise<{ ok: boolean; error?: string }> {
  if (!dlq || !queue) {
    return { ok: false, error: 'Queue not connected' };
  }
  try {
    const job = await dlq.getJob(dlqJobId);
    if (!job) {
      return { ok: false, error: `DLQ job ${dlqJobId} not found` };
    }
    const data = job.data as any;
    const originalMsg: IncomingMessage = data.data || {};
    await queue.add('incoming-message', originalMsg, {
      jobId: `dlq-retry-${dlqJobId}-${Date.now()}`,
    });
    await job.remove();
    if (dlqCount > 0) dlqCount--;
    console.log(`[MessageQueue] DLQ job ${dlqJobId} replayed for phone=${originalMsg.from}`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

// ─── DLQ Depth Alerting ──────────────────────────────────────────

const DLQ_ALERT_THRESHOLD = 10;
let dlqAlertLastFiredAt = 0;
const DLQ_ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 min cool-down

type DLQAlertFn = (depth: number) => Promise<void>;
let dlqAlertFn: DLQAlertFn | null = null;

/**
 * Register a callback that fires when DLQ depth exceeds the threshold (10 jobs).
 * The callback is rate-limited to once per 15 minutes.
 */
export function setDLQAlertHandler(fn: DLQAlertFn): void {
  dlqAlertFn = fn;
}

async function maybeSendDLQAlert(depth: number): Promise<void> {
  if (!dlqAlertFn) return;
  if (depth < DLQ_ALERT_THRESHOLD) return;
  const now = Date.now();
  if (now - dlqAlertLastFiredAt < DLQ_ALERT_COOLDOWN_MS) return;
  dlqAlertLastFiredAt = now;
  try {
    await dlqAlertFn(depth);
  } catch (err: any) {
    console.error(`[MessageQueue] DLQ alert callback error: ${err.message}`);
  }
}

// ─── Shutdown ────────────────────────────────────────────────────

/**
 * Gracefully close the queue, worker, and Redis connections.
 */
export async function closeQueue(): Promise<void> {
  try {
    if (queueEvents) {
      await queueEvents.close();
      queueEvents = null;
    }
    if (worker) {
      await worker.close();
      worker = null;
    }
    if (dlq) {
      await dlq.close();
      dlq = null;
    }
    if (queue) {
      await queue.close();
      queue = null;
    }
    if (redisClient) {
      await redisClient.quit().catch(() => {});
      redisClient = null;
    }
  } catch (err: any) {
    console.error(`[MessageQueue] Shutdown error: ${err.message}`);
  }
  isConnected = false;
  memoryDedup.clear();
}

// ─── Test Exports (US-991) ──────────────────────────────────────

export const _testExports = {
  get memoryDedup() { return memoryDedup; },
  get dedupTtlSeconds() { return dedupTtlSeconds; },
  get dedupHitCount() { return dedupHitCount; },
  resetDedupHitCount() { dedupHitCount = 0; },
  isDuplicateMessage,
  setDedupTtl,
};
