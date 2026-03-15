/**
 * webhook-raw-events.ts — Persist raw webhook payloads before processing (US-895)
 *
 * Every inbound message is written to the webhook_raw_events table before
 * being enqueued into BullMQ (or processed directly). This ensures lost or
 * failed events can be replayed from durable storage.
 *
 * The insert is fire-and-forget with its own try/catch to avoid blocking
 * the webhook 200 response.
 */

import { db } from './db.js';
import { webhookRawEvents } from '../../shared/schema-tables.js';
import { eq, lt, and, sql } from 'drizzle-orm';
import type { IncomingMessage } from '../assistant/types.js';

/**
 * Persist a raw incoming message payload to durable storage.
 * Returns the generated event ID (UUID) on success, or null on failure.
 *
 * This is designed as fire-and-forget — errors are caught and logged
 * but never propagated to the caller.
 */
export async function persistRawEvent(
  msg: IncomingMessage,
  profileId: string = 'pelangi'
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(webhookRawEvents)
      .values({
        profileId,
        payload: JSON.stringify(msg),
        processed: false,
      })
      .returning({ id: webhookRawEvents.id });
    return row?.id ?? null;
  } catch (err: any) {
    console.error(`[WebhookRawEvents] Failed to persist raw event: ${err.message}`);
    return null;
  }
}

/**
 * Mark a raw event as processed after successful pipeline execution.
 */
export async function markRawEventProcessed(eventId: string): Promise<void> {
  try {
    await db
      .update(webhookRawEvents)
      .set({ processed: true })
      .where(eq(webhookRawEvents.id, eventId));
  } catch (err: any) {
    console.error(`[WebhookRawEvents] Failed to mark event ${eventId} as processed: ${err.message}`);
  }
}

/**
 * Retrieve a raw event by ID — used by the DLQ admin endpoint to
 * return the original payload for inspection.
 */
export async function getRawEventById(eventId: string) {
  try {
    const [row] = await db
      .select()
      .from(webhookRawEvents)
      .where(eq(webhookRawEvents.id, eventId));
    return row ?? null;
  } catch (err: any) {
    console.error(`[WebhookRawEvents] Failed to fetch event ${eventId}: ${err.message}`);
    return null;
  }
}

/**
 * Prune raw events older than the given number of days.
 * Called by the data-retention scheduler (30-day default).
 */
export async function pruneRawEvents(retentionDays: number = 30): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const deleted = await db
      .delete(webhookRawEvents)
      .where(and(
        lt(webhookRawEvents.receivedAt, cutoff),
        eq(webhookRawEvents.processed, true),
      ))
      .returning({ id: webhookRawEvents.id });
    return deleted.length;
  } catch (err: any) {
    console.error(`[WebhookRawEvents] Prune failed: ${err.message}`);
    return 0;
  }
}
