/**
 * webhooks/handlers.ts — Webhook handler registry
 *
 * Provides a dispatch map of event-type strings to async handler functions.
 * Used by the /webhooks/events endpoint for synchronous event routing.
 *
 * US-821: Complete webhook event routing to registered notification handlers
 */

import { createModuleLogger } from '../../lib/logger.js';
import { notifyAdminDisconnection } from '../../lib/admin-notifier.js';
import { loadAdminNotificationSettings } from '../../lib/admin-notification-settings.js';

const logger = createModuleLogger('WebhookHandlers');

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WebhookEvent {
  type: string;
  [key: string]: unknown;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void>;

// ─── Individual Handlers ────────────────────────────────────────────────────

/**
 * Handle payment_confirmed events.
 * Sends a WhatsApp confirmation message to the admin/operator.
 */
async function handlePaymentConfirmed(event: WebhookEvent): Promise<void> {
  const { guestName, amount, currency, bookingRef, phone } = event as {
    guestName?: string;
    amount?: number;
    currency?: string;
    bookingRef?: string;
    phone?: string;
    [key: string]: unknown;
  };

  logger.info('Handling payment_confirmed', { guestName, amount, bookingRef });

  const settings = await loadAdminNotificationSettings();
  if (!settings.enabled || settings.operators.length === 0) {
    logger.info('Admin notifications disabled — skipping payment_confirmed message');
    return;
  }

  // Build confirmation message
  const lines = [
    '💳 *Payment Confirmed*',
    '',
    guestName ? `👤 *Guest:* ${guestName}` : null,
    bookingRef ? `🔖 *Booking:* ${bookingRef}` : null,
    amount != null ? `💰 *Amount:* ${currency ?? 'RM'} ${amount}` : null,
    phone ? `📱 *Phone:* ${phone}` : null,
    '',
    `🕐 *Time:* ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`,
    '🤖 _Notification by Rainbow AI_',
  ].filter(Boolean).join('\n');

  // Send via operator escalation — requires escalationContext to be initialized at startup.
  const { sendToOperatorWithEscalation } = await import('../../lib/operator-escalation.js');
  const messageId = `payment_confirmed_${bookingRef ?? Date.now()}`;
  await sendToOperatorWithEscalation(messageId, lines, 'payment');
}

/**
 * Handle booking_created events.
 * Logs receipt; extend with notification logic as needed.
 */
async function handleBookingCreated(event: WebhookEvent): Promise<void> {
  const { bookingRef, guestName, checkIn, checkOut } = event as Record<string, unknown>;
  logger.info('Received booking_created', { bookingRef, guestName, checkIn, checkOut });
}

/**
 * Handle checkin_completed events.
 * Logs receipt; operators are notified via the /notify-checkin admin route.
 */
async function handleCheckinCompleted(event: WebhookEvent): Promise<void> {
  const { bookingRef, guestName, unit } = event as Record<string, unknown>;
  logger.info('Received checkin_completed', { bookingRef, guestName, unit });
}

/**
 * Handle checkout_completed events.
 */
async function handleCheckoutCompleted(event: WebhookEvent): Promise<void> {
  const { bookingRef, guestName, unit } = event as Record<string, unknown>;
  logger.info('Received checkout_completed', { bookingRef, guestName, unit });
}

// ─── Handler Registry ────────────────────────────────────────────────────────

/**
 * Registry mapping event-type strings to their async handler functions.
 * Add new event types here as integrations are enabled.
 */
export const handlerRegistry: Record<string, WebhookHandler> = {
  payment_confirmed: handlePaymentConfirmed,
  booking_created: handleBookingCreated,
  checkin_completed: handleCheckinCompleted,
  checkout_completed: handleCheckoutCompleted,
};

// ─── Dispatch ────────────────────────────────────────────────────────────────

/**
 * Dispatch a webhook event to the registered handler.
 *
 * @throws {UnrecognizedEventError} if the event type has no registered handler
 * @throws Re-throws handler errors for the caller to handle
 */
export class UnrecognizedEventError extends Error {
  constructor(public readonly eventType: string) {
    super(`Unrecognized event type: "${eventType}"`);
    this.name = 'UnrecognizedEventError';
  }
}

export async function dispatchWebhookEvent(event: WebhookEvent): Promise<void> {
  const handler = handlerRegistry[event.type];
  if (!handler) {
    throw new UnrecognizedEventError(event.type);
  }
  await handler(event);
}
