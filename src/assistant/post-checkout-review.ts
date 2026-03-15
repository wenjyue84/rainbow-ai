/**
 * post-checkout-review.ts — Proactive post-stay WhatsApp review request (US-1022)
 *
 * Schedules a delayed WhatsApp utility template message to request Google/Booking.com/Airbnb-style
 * reviews after guest checkout. Suppresses if guest already provided 4+ star CSAT rating.
 *
 * US-1022: Proactive post-stay WhatsApp review request via utility template
 */

import { createModuleLogger } from '../lib/logger.js';
import { db } from '../lib/db.js';
import { rainbowFeedback, rainbowMessages } from '../../shared/schema-tables.js';
import { eq, and, desc } from 'drizzle-orm';
import { isOptedOut } from './opt-out.js';

const logger = createModuleLogger('PostCheckoutReview');

// Default delay before sending review request: 2 hours (in ms)
const DEFAULT_REVIEW_REQUEST_DELAY_MS = 2 * 60 * 60 * 1000;

// Track pending review requests in-memory to avoid duplicates
const pendingReviewRequests = new Map<string, NodeJS.Timeout>();

/**
 * Get the guest's highest CSAT rating from their conversation feedback.
 * Returns null if no feedback found.
 */
export async function getGuestHighestCsatRating(phone: string): Promise<number | null> {
  try {
    const ratings = await db
      .select({ rating: rainbowFeedback.rating })
      .from(rainbowFeedback)
      .where(eq(rainbowFeedback.phoneNumber, phone))
      .orderBy(desc(rainbowFeedback.rating))
      .limit(1);

    return ratings.length > 0 ? ratings[0].rating : null;
  } catch (error) {
    logger.error('Failed to query guest CSAT rating', { phone, error });
    return null;
  }
}

/**
 * Check if a review request should be suppressed for this guest.
 * Returns true if guest should NOT receive review request.
 */
async function shouldSuppressReviewRequest(phone: string): Promise<boolean> {
  // Check opt-out status (fast in-memory check)
  if (isOptedOut(phone)) {
    logger.info('Suppressing review request: guest opted out', { phone });
    return true;
  }

  // Check if guest already gave 4+ star CSAT rating
  const highestRating = await getGuestHighestCsatRating(phone);
  if (highestRating !== null && highestRating >= 4) {
    logger.info('Suppressing review request: guest gave high CSAT rating', {
      phone,
      highestRating,
    });
    return true;
  }

  return false;
}

/**
 * Schedule a post-checkout review request with configurable delay.
 * Resolves when the job is scheduled (not when it runs).
 */
export async function schedulePostCheckoutReview(
  phone: string,
  guestName?: string,
  bookingRef?: string,
  delayMs: number = DEFAULT_REVIEW_REQUEST_DELAY_MS
): Promise<boolean> {
  try {
    // Check suppression criteria
    if (await shouldSuppressReviewRequest(phone)) {
      return false;
    }

    // Prevent duplicate scheduling for same phone
    if (pendingReviewRequests.has(phone)) {
      logger.warn('Review request already scheduled for guest', { phone });
      return false;
    }

    logger.info('Scheduling post-checkout review request', {
      phone,
      guestName,
      bookingRef,
      delayMs: delayMs / 1000 + 's',
    });

    // Schedule delayed execution
    const timeout = setTimeout(async () => {
      try {
        pendingReviewRequests.delete(phone);
        await sendPostCheckoutReviewRequest(phone, guestName, bookingRef);
      } catch (error) {
        logger.error('Failed to send scheduled review request', { phone, error });
      }
    }, delayMs);

    pendingReviewRequests.set(phone, timeout);
    return true;
  } catch (error) {
    logger.error('Failed to schedule review request', { phone, error });
    return false;
  }
}

/**
 * Send the actual review request message via WhatsApp.
 * This is called after the delay expires.
 */
async function sendPostCheckoutReviewRequest(
  phone: string,
  guestName?: string,
  bookingRef?: string
): Promise<void> {
  try {
    const { sendWhatsAppMessage } = await import('../lib/baileys-client.js');

    // Build the review request message
    const greeting = guestName ? `Hi ${guestName}!` : 'Hi!';
    const message =
      greeting +
      '\n\n' +
      'Thank you for staying with us! We\'d love to hear about your experience.' +
      '\n\n' +
      '⭐ Please leave a review on:\n' +
      '🔗 Google: [review-link-google]\n' +
      '🔗 Booking.com: [review-link-booking]\n' +
      '🔗 Airbnb: [review-link-airbnb]\n\n' +
      'Your feedback helps us improve! 😊';

    // Send via WhatsApp
    await sendWhatsAppMessage(phone, message);

    // Track in analytics
    await recordReviewRequestSent(phone, bookingRef ?? null);

    logger.info('Sent post-checkout review request', { phone, guestName, bookingRef });
  } catch (error) {
    logger.error('Failed to send review request message', { phone, error });
    throw error;
  }
}

/**
 * Record review request send event in analytics.
 */
async function recordReviewRequestSent(phone: string, bookingRef: string | null): Promise<void> {
  try {
    const now = new Date();
    await db.insert(rainbowMessages).values({
      phone,
      role: 'assistant',
      content: 'post-checkout-review-request',
      timestamp: now,
      intent: 'post_checkout_review',
      action: 'send_review_request',
      messageType: 'system',
      source: bookingRef ? `booking:${bookingRef}` : 'post_checkout_review',
    });

    logger.info('Recorded review request send event', { phone, bookingRef });
  } catch (error) {
    logger.error('Failed to record review request event', { phone, error });
    // Don't throw — this is non-blocking analytics tracking
  }
}

/**
 * Cancel a pending review request (e.g., if guest opts out before delay expires).
 */
export function cancelPendingReviewRequest(phone: string): boolean {
  const timeout = pendingReviewRequests.get(phone);
  if (timeout) {
    clearTimeout(timeout);
    pendingReviewRequests.delete(phone);
    logger.info('Cancelled pending review request', { phone });
    return true;
  }
  return false;
}

/**
 * Get count of pending scheduled review requests (for debugging).
 */
export function getPendingReviewRequestCount(): number {
  return pendingReviewRequests.size;
}
