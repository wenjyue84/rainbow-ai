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
import { markKitchenAccepted } from '../../assistant/order-modification-store.js';
import { isFeedbackRequested, markFeedbackRequested, getPhoneByOrderId } from '../../assistant/order-id-store.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';
import { db } from '../../lib/db.js';
import { rainbowFeedback, insertRainbowFeedbackSchema } from '../../../shared/schema.js';
import { sendPushNotification } from '../../lib/push-notifications.js';
import { schedulePostCheckoutReview } from '../../assistant/post-checkout-review.js';

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
 * Handle checkout_completed events (US-1022).
 * Triggers a delayed post-checkout review request via WhatsApp.
 *
 * Payload: { type: "checkout_completed", bookingRef: "...", guestName: "...", phone: "...", unit: "..." }
 */
async function handleCheckoutCompleted(event: WebhookEvent): Promise<void> {
  const { bookingRef, guestName, unit, phone } = event as Record<string, unknown>;
  logger.info('Received checkout_completed', { bookingRef, guestName, unit, phone });

  // US-1022: Schedule post-checkout review request if phone is provided
  if (phone && typeof phone === 'string') {
    const scheduled = await schedulePostCheckoutReview(
      phone,
      guestName ? String(guestName) : undefined,
      bookingRef ? String(bookingRef) : undefined
    );

    if (scheduled) {
      logger.info('Post-checkout review request scheduled', { phone, bookingRef });
    }
  } else {
    logger.warn('checkout_completed missing phone number — cannot schedule review request', {
      bookingRef,
      guestName,
    });
  }
}

/**
 * Handle kitchen_accepted events (US-881).
 * Closes the order modification window when the kitchen/POS accepts the order.
 * Payload: { type: "kitchen_accepted", orderId: "MM-A1B2" }
 */
async function handleKitchenAccepted(event: WebhookEvent): Promise<void> {
  const { orderId } = event as { orderId?: string; [key: string]: unknown };
  if (!orderId) {
    logger.warn('kitchen_accepted event missing orderId');
    return;
  }
  const found = markKitchenAccepted(orderId);
  logger.info('kitchen_accepted processed', { orderId, windowClosed: found });
}

/**
 * Handle order_served events (US-869).
 * Sends a feedback request when an order is marked as served.
 * Payload: { type: "order_served", orderId: "MM-A1B2" }
 */
async function handleOrderServed(event: WebhookEvent): Promise<void> {
  const { orderId } = event as { orderId?: string; [key: string]: unknown };
  if (!orderId) {
    logger.warn('order_served event missing orderId');
    return;
  }

  // Check if feedback was already requested for this order
  if (isFeedbackRequested(orderId)) {
    logger.info('Feedback already requested for order', { orderId });
    return;
  }

  // Get the phone number for this order
  const phone = getPhoneByOrderId(orderId);
  if (!phone) {
    logger.warn('Could not find phone for order', { orderId });
    return;
  }

  // Mark feedback as requested to prevent duplicate requests
  markFeedbackRequested(orderId);

  // Determine if this is WhatsApp (numeric phone) or webchat (starts with 'webchat-')
  const isWhatsApp = /^\d+$/.test(phone);

  if (isWhatsApp) {
    // Send feedback request via WhatsApp
    const feedbackMessage = 'Hope you enjoyed your meal! Rate your experience: 1 to 5 stars';
    try {
      await sendWhatsAppMessage(phone, feedbackMessage);
      logger.info('Sent feedback request via WhatsApp', { phone, orderId });
    } catch (error) {
      logger.error('Failed to send feedback request via WhatsApp', { phone, orderId, error });
    }
  } else {
    // US-916: For webchat, send push notification if subscribed
    sendPushNotification(phone, {
      title: 'Your order is ready!',
      body: `Order ${orderId} is ready for pickup. Enjoy your meal!`,
      tag: 'order_ready',
      data: { orderId, action: 'order_ready' },
      actions: [{ action: 'view_order', title: 'View Order' }],
    }).catch(err => {
      logger.warn('Push notification failed for order_served', { phone, orderId, error: err.message });
    });
    logger.info('Push notification queued for webchat order', { phone, orderId });
  }
}

/**
 * Handle reaction webhook events (US-886).
 * Process incoming WhatsApp reaction events (emoji reactions to bot messages)
 * and use them as lightweight CSAT feedback signals.
 * Payload: { type: "reaction", phone: "1234567890", messageId: "...", emoji: "👍" or "👎" }
 */
async function handleReaction(event: WebhookEvent): Promise<void> {
  const { phone, messageId, emoji } = event as {
    phone?: string;
    messageId?: string;
    emoji?: string;
    [key: string]: unknown;
  };

  if (!phone || !messageId || !emoji) {
    logger.warn('reaction event missing required fields', { phone, messageId, emoji });
    return;
  }

  // Map emoji to CSAT rating: thumbs-up = 1 (positive), thumbs-down = -1 (negative)
  let rating: number | null = null;
  if (emoji === '👍' || emoji === ':+1:' || emoji === 'thumbsup') {
    rating = 1;
  } else if (emoji === '👎' || emoji === ':-1:' || emoji === 'thumbsdown') {
    rating = -1;
  } else {
    // Other emojis are not mapped to CSAT; log and skip
    logger.info('Reaction emoji not mapped to CSAT', { phone, emoji });
    return;
  }

  // Generate a simple conversation ID using phone and current timestamp
  // This matches the pattern used in routing.ts: `${phone}-${Date.now()}`
  const conversationId = `${phone}-${Date.now()}`;

  try {
    // Validate and insert the feedback into rainbowFeedback table
    const feedbackData = {
      conversationId,
      phoneNumber: phone,
      messageId,
      rating,
      // feedbackText is left undefined/null for emoji-only reactions
    };

    const validated = insertRainbowFeedbackSchema.parse(feedbackData);
    const [inserted] = await db.insert(rainbowFeedback).values(validated).returning();

    logger.info('Reaction feedback recorded', {
      phone,
      messageId,
      emoji,
      rating,
      feedbackId: inserted.id,
    });

    // If thumbs-down, send a follow-up message asking what went wrong
    if (rating === -1) {
      const followUpMessage =
        'We\'re sorry to hear that! Could you let us know what went wrong so we can improve?';
      try {
        await sendWhatsAppMessage(phone, followUpMessage);
        logger.info('Sent follow-up message for negative reaction', { phone });
      } catch (error) {
        logger.error('Failed to send follow-up message for negative reaction', {
          phone,
          error,
        });
      }
    }
  } catch (error) {
    logger.error('Failed to process reaction event', { phone, messageId, emoji, error });
  }
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
  kitchen_accepted: handleKitchenAccepted,
  order_served: handleOrderServed,
  reaction: handleReaction,
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
