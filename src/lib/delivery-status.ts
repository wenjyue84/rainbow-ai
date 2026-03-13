/**
 * delivery-status.ts — Persist WhatsApp message delivery status (US-426)
 *
 * Listens to Baileys message-update events (via WhatsAppManager EventEmitter)
 * and upserts delivery status into the message_delivery_status table.
 *
 * Status codes from Baileys:
 *   0 = PENDING, 1 = SERVER_ACK (sent), 2 = DELIVERY_ACK (delivered),
 *   3 = READ, 4 = PLAYED
 *
 * Out-of-order handling: only update if new status code > existing status code,
 * preventing a late-arriving "delivered" from overwriting "read".
 */
import { db } from './db.js';
import { sql } from 'drizzle-orm';
import type { MessageStatusEvent, MessageStatusCode } from './whatsapp/types.js';

/** Map Baileys numeric status to human-readable label */
const STATUS_LABEL: Record<MessageStatusCode, string> = {
  0: 'pending',
  1: 'sent',
  2: 'delivered',
  3: 'read',
  4: 'played',
};

/**
 * Persist a message delivery status event.
 * Uses an idempotent upsert keyed on baileys_message_id.
 * Only updates if the new status code is higher (handles out-of-order delivery).
 */
export async function persistDeliveryStatus(event: MessageStatusEvent): Promise<void> {
  const { phone, messageId, status, instanceId } = event;
  if (!messageId) return;

  const label = STATUS_LABEL[status] ?? 'unknown';
  const now = new Date();

  // Log failed delivery as warning
  if (status === 0) {
    console.warn(`[DeliveryStatus] Failed/pending delivery for message ${messageId} to ${phone}`);
  }

  try {
    // Upsert: insert if not exists, update only if new status is higher
    await db.execute(sql`
      INSERT INTO message_delivery_status (baileys_message_id, phone, status, status_timestamp, instance_id, updated_at)
      VALUES (${messageId}, ${phone}, ${label}, ${now}, ${instanceId}, ${now})
      ON CONFLICT (baileys_message_id)
      DO UPDATE SET
        status = CASE
          WHEN (
            CASE message_delivery_status.status
              WHEN 'pending' THEN 0
              WHEN 'sent' THEN 1
              WHEN 'delivered' THEN 2
              WHEN 'read' THEN 3
              WHEN 'played' THEN 4
              ELSE -1
            END
          ) < ${status}
          THEN ${label}
          ELSE message_delivery_status.status
        END,
        status_timestamp = CASE
          WHEN (
            CASE message_delivery_status.status
              WHEN 'pending' THEN 0
              WHEN 'sent' THEN 1
              WHEN 'delivered' THEN 2
              WHEN 'read' THEN 3
              WHEN 'played' THEN 4
              ELSE -1
            END
          ) < ${status}
          THEN ${now}
          ELSE message_delivery_status.status_timestamp
        END,
        updated_at = ${now}
    `);
  } catch (err: any) {
    console.error(`[DeliveryStatus] Failed to persist status for ${messageId}: ${err.message}`);
  }
}

/**
 * Query delivery status for a specific Baileys message ID.
 */
export async function getDeliveryStatus(baileysMessageId: string): Promise<any | null> {
  try {
    const result = await db.execute(sql`
      SELECT baileys_message_id, phone, status, status_timestamp, instance_id, updated_at
      FROM message_delivery_status
      WHERE baileys_message_id = ${baileysMessageId}
      LIMIT 1
    `);
    const rows = (result as any).rows;
    return rows?.length > 0 ? rows[0] : null;
  } catch (err: any) {
    console.error(`[DeliveryStatus] Failed to query status for ${baileysMessageId}: ${err.message}`);
    return null;
  }
}

/**
 * Query all delivery statuses for a phone number, ordered by most recent first.
 */
export async function getDeliveryStatusByPhone(phone: string, limit = 50): Promise<any[]> {
  try {
    const result = await db.execute(sql`
      SELECT baileys_message_id, phone, status, status_timestamp, instance_id, updated_at
      FROM message_delivery_status
      WHERE phone = ${phone}
      ORDER BY status_timestamp DESC
      LIMIT ${limit}
    `);
    return (result as any).rows ?? [];
  } catch (err: any) {
    console.error(`[DeliveryStatus] Failed to query statuses for ${phone}: ${err.message}`);
    return [];
  }
}
