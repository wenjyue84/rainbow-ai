/**
 * webhook-raw-events.ts — Persist raw webhook payloads to durable storage (US-895)
 *
 * Every inbound webhook payload is written to the webhook_raw_events table
 * before any processing, so lost or failed events can be replayed from the DLQ.
 *
 * Inserts are fire-and-forget with their own try/catch to avoid blocking
 * the webhook 200 response.
 */

import { db } from './db.js';
import { webhookRawEvents } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Persist a raw webhook payload. Returns the event_id on success, null on failure.
 * This is fire-and-forget — errors are logged but never propagated.
 */
export async function persistRawEvent(
  source: string,
  payload: unknown,
  profile: string = 'pelangi'
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(webhookRawEvents)
      .values({
        source,
        profile,
        payload,
        processed: false,
      })
      .returning({ eventId: webhookRawEvents.eventId });
    return row?.eventId ?? null;
  } catch (err: any) {
    console.error(`[webhook-raw-events] Failed to persist raw event (source=${source}):`, err.message);
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
      .where(eq(webhookRawEvents.eventId, eventId));
  } catch (err: any) {
    console.error(`[webhook-raw-events] Failed to mark event ${eventId} as processed:`, err.message);
  }
}

/**
 * Retrieve a raw event by its event_id (for DLQ inspection).
 */
export async function getRawEventById(eventId: string): Promise<typeof webhookRawEvents.$inferSelect | null> {
  try {
    const [row] = await db
      .select()
      .from(webhookRawEvents)
      .where(eq(webhookRawEvents.eventId, eventId))
      .limit(1);
    return row ?? null;
  } catch (err: any) {
    console.error(`[webhook-raw-events] Failed to fetch event ${eventId}:`, err.message);
    return null;
  }
}
