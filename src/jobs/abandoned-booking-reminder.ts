/**
 * abandoned-booking-reminder.ts — Cron job for sending abandoned workflow reminders
 *
 * Queries for booking workflows that have been abandoned (no interaction > 30 minutes,
 * status != 'completed') and sends contextual reminder messages via WhatsApp.
 *
 * Implements smart reminder logic:
 * - First reminder sent at 30 min of inactivity
 * - Second reminder sent at 24 hours + if still abandoned
 * - No more reminders after second
 *
 * US-562: Booking Workflow Abandonment Recovery with Smart Reminders
 */

import type { Queue } from 'bullmq';
import { Worker } from 'bullmq';
import { createModuleLogger } from '../lib/logger.js';
import { db } from '../lib/db.js';
import { bookingWorkflows } from '../../shared/schema-tables.js';
import { eq, and, ne, lt, or } from 'drizzle-orm';
import {
  buildCompleteReminderNotification,
  getStepLabel,
  type ReminderContext,
} from '../lib/reminder-builder.js';

const logger = createModuleLogger('AbandonedBookingReminderJob');

// ─── Types ────────────────────────────────────────────────────────────────

export interface AbandonedBookingReminderJobData {
  jobId?: string;
  workflowIds?: string[];  // Optional: target specific workflows
  dryRun?: boolean;        // If true, log reminders but don't send
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** Workflow is considered abandoned after 30 minutes of no interaction */
export const ABANDONMENT_THRESHOLD_MINUTES = 30;

/** Second reminder not sent until 24 hours of abandonment */
export const SECOND_REMINDER_DELAY_HOURS = 24;

// ─── Job Handler ──────────────────────────────────────────────────────────

/**
 * Main job handler for processing abandoned workflow reminders
 *
 * Finds all abandoned workflows and sends reminders according to strategy:
 * - First reminder: 30 min inactivity, reminderSentCount == 0
 * - Second reminder: 24+ hours inactivity, reminderSentCount == 1
 *
 * Returns summary of reminders sent
 */
export async function processAbandonedBookingReminders(
  data: AbandonedBookingReminderJobData,
): Promise<{ sent: number; skipped: number; errors: number }> {
  const now = new Date();
  const stats = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Calculate cutoff times
    const thirtyMinutesAgo = new Date(now.getTime() - ABANDONMENT_THRESHOLD_MINUTES * 60000);
    const twentyFourHoursAgo = new Date(now.getTime() - SECOND_REMINDER_DELAY_HOURS * 3600000);

    // Query 1: First reminders (30+ min abandoned, no reminders sent yet)
    logger.info('Querying workflows for first reminders...');
    const firstReminderWorkflows = await db
      .select()
      .from(bookingWorkflows)
      .where(
        and(
          ne(bookingWorkflows.status, 'completed'),
          eq(bookingWorkflows.reminderSentCount, 0),
          lt(bookingWorkflows.lastInteractionAt, thirtyMinutesAgo),
        ),
      )
      .limit(100); // Process max 100 per run

    // Query 2: Second reminders (24+ hours abandoned, first reminder sent)
    logger.info('Querying workflows for second reminders...');
    const secondReminderWorkflows = await db
      .select()
      .from(bookingWorkflows)
      .where(
        and(
          ne(bookingWorkflows.status, 'completed'),
          eq(bookingWorkflows.reminderSentCount, 1),
          lt(bookingWorkflows.lastInteractionAt, twentyFourHoursAgo),
        ),
      )
      .limit(100);

    // Process first reminders
    logger.info(`Found ${firstReminderWorkflows.length} workflows for first reminder`, {
      count: firstReminderWorkflows.length,
    });

    for (const workflow of firstReminderWorkflows) {
      try {
        const stepLabel = getStepLabel(
          workflow.workflowId,
          workflow.currentStep,
          workflow.userLanguage as 'en' | 'ms' | 'zh' | 'ta',
        );

        const reminderContext: ReminderContext = {
          stepName: stepLabel,
          workflowId: workflow.workflowId,
          userLanguage: workflow.userLanguage as 'en' | 'ms' | 'zh' | 'ta',
          reminderNumber: 1,
          guestName: workflow.guestName || undefined,
        };

        const message = buildCompleteReminderNotification(reminderContext);

        if (!data.dryRun) {
          // Send message via WhatsApp (requires sendMessage function from caller)
          await sendReminderViaBaileys(workflow.guestPhone, message);

          // Update workflow to track reminder
          await db
            .update(bookingWorkflows)
            .set({
              reminderSentCount: 1,
              firstReminderAt: now,
              lastReminderAt: now,
              updatedAt: now,
            })
            .where(eq(bookingWorkflows.id, workflow.id));

          logger.info('First reminder sent', {
            workflowId: workflow.id,
            phone: workflow.guestPhone,
            profile: workflow.profile,
          });
          stats.sent++;
        } else {
          logger.info('[DRY RUN] Would send first reminder', {
            workflowId: workflow.id,
            phone: workflow.guestPhone,
            message,
          });
          stats.sent++;
        }
      } catch (err) {
        logger.error('Error sending first reminder', {
          workflowId: workflow.id,
          error: err instanceof Error ? err.message : String(err),
        });
        stats.errors++;
      }
    }

    // Process second reminders
    logger.info(`Found ${secondReminderWorkflows.length} workflows for second reminder`, {
      count: secondReminderWorkflows.length,
    });

    for (const workflow of secondReminderWorkflows) {
      try {
        const stepLabel = getStepLabel(
          workflow.workflowId,
          workflow.currentStep,
          workflow.userLanguage as 'en' | 'ms' | 'zh' | 'ta',
        );

        const reminderContext: ReminderContext = {
          stepName: stepLabel,
          workflowId: workflow.workflowId,
          userLanguage: workflow.userLanguage as 'en' | 'ms' | 'zh' | 'ta',
          reminderNumber: 2,
          guestName: workflow.guestName || undefined,
        };

        const message = buildCompleteReminderNotification(reminderContext);

        if (!data.dryRun) {
          // Send message via WhatsApp
          await sendReminderViaBaileys(workflow.guestPhone, message);

          // Update workflow to track second reminder
          await db
            .update(bookingWorkflows)
            .set({
              reminderSentCount: 2,
              lastReminderAt: now,
              updatedAt: now,
            })
            .where(eq(bookingWorkflows.id, workflow.id));

          logger.info('Second reminder sent', {
            workflowId: workflow.id,
            phone: workflow.guestPhone,
            profile: workflow.profile,
          });
          stats.sent++;
        } else {
          logger.info('[DRY RUN] Would send second reminder', {
            workflowId: workflow.id,
            phone: workflow.guestPhone,
            message,
          });
          stats.sent++;
        }
      } catch (err) {
        logger.error('Error sending second reminder', {
          workflowId: workflow.id,
          error: err instanceof Error ? err.message : String(err),
        });
        stats.errors++;
      }
    }

    logger.info('Abandoned booking reminder job completed', {
      sent: stats.sent,
      errors: stats.errors,
    });

    return stats;
  } catch (err) {
    logger.error('Job execution failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ─── WhatsApp Message Sender ───────────────────────────────────────────────

/**
 * Send reminder message via Baileys WhatsApp client
 *
 * This is a placeholder — in production, integrate with the active Baileys
 * client from the main index.ts or a global WhatsApp manager.
 */
async function sendReminderViaBaileys(phone: string, message: string): Promise<void> {
  // Placeholder: In production, use the WhatsApp client from index.ts
  // Example: await whatsappClient.sendMessage(`${phone}@s.whatsapp.net`, message);
  //
  // For now, just log it
  logger.debug('Sending reminder via Baileys', { phone, messageLength: message.length });

  // TODO: Integrate with global Baileys client when available
  // This will be wired up in the job scheduling infrastructure
}

// ─── Bullmq Worker Setup ──────────────────────────────────────────────────

/**
 * Create and configure a Bullmq Worker for this job
 *
 * Usage:
 *   const worker = createAbandonedBookingReminderWorker(redisConnection);
 *   worker.on('completed', (job) => console.log('Job done'));
 *   worker.on('failed', (job, err) => console.error('Job failed', err));
 */
export function createAbandonedBookingReminderWorker(redisUrl?: string) {
  return new Worker(
    'abandoned-booking-reminders',
    async (job) => {
      logger.info('Processing abandoned booking reminders job', { jobId: job.id });
      return processAbandonedBookingReminders(job.data);
    },
    {
      connection: redisUrl
        ? { url: redisUrl }
        : {
            // Default: use REDIS_URL env var or local Redis
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          },
      concurrency: 1, // Process one job at a time
    },
  );
}

/**
 * Enqueue a reminder job to be processed
 *
 * Usage:
 *   const queue = new Queue('abandoned-booking-reminders', { connection: ... });
 *   await enqueueReminderJob(queue);
 */
export async function enqueueReminderJob(
  queue: Queue,
  data?: Partial<AbandonedBookingReminderJobData>,
): Promise<void> {
  const jobData: AbandonedBookingReminderJobData = {
    jobId: `reminder-job-${Date.now()}`,
    ...data,
  };

  await queue.add(jobData.jobId || 'process-reminders', jobData, {
    repeat: {
      pattern: '*/15 * * * *', // Every 15 minutes
    },
    removeOnComplete: true,
    removeOnFail: false, // Keep failed jobs for debugging
  });

  logger.info('Enqueued reminder job', { jobId: jobData.jobId });
}
