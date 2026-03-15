/**
 * order-feedback-handler.ts — Detects and handles star rating feedback responses (US-869)
 *
 * Detects when a guest replies with a 1-5 star rating in response to the feedback request.
 * Stores the rating and sends appropriate follow-up messages.
 */

import { createModuleLogger } from '../lib/logger.js';
import { getPhoneByOrderId } from './order-id-store.js';
import { db } from '../lib/db.js';
import { rainbowMessages } from '../../shared/schema-tables.js';

const logger = createModuleLogger('OrderFeedbackHandler');

/** Detects if a message is a star rating (1-5) or a skip. Returns the rating or null. */
export function detectStarRating(text: string): number | null {
  const normalized = text.toLowerCase().trim();

  // Handle numeric ratings 1-5
  const numMatch = normalized.match(/^[1-5]$/);
  if (numMatch) {
    return parseInt(numMatch[0], 10);
  }

  // Handle word ratings (one to five)
  const wordRatings: Record<string, number> = {
    'one': 1,
    'two': 2,
    'three': 3,
    'four': 4,
    'five': 5,
    'satu': 1,      // Malay
    'dua': 2,       // Malay
    'tiga': 3,      // Malay
    'empat': 4,     // Malay
    'lima': 5,      // Malay
    '一': 1,        // Chinese
    '二': 2,        // Chinese
    '三': 3,        // Chinese
    '四': 4,        // Chinese
    '五': 5,        // Chinese
  };

  for (const [word, rating] of Object.entries(wordRatings)) {
    if (normalized.includes(word)) {
      return rating;
    }
  }

  return null;
}

/** Get the follow-up message based on the rating. */
export function getFollowUpMessage(rating: number, language: 'en' | 'ms' | 'zh' = 'en'): string | null {
  if (rating === 1 || rating === 2) {
    // Low ratings get empathetic follow-up
    const messages = {
      en: 'Sorry to hear that. Let us know how we can improve.',
      ms: 'Maaf mendengarnya. Beri tahu kami bagaimana kami dapat meningkat.',
      zh: '很遗憾听到这个消息。请告诉我们我们如何能改进。'
    };
    return messages[language] || messages.en;
  } else if (rating === 4 || rating === 5) {
    // High ratings get thank you
    const messages = {
      en: 'Thank you for the kind words! See you again soon.',
      ms: 'Terima kasih atas kata-kata baik Anda! Sampai jumpa lagi segera.',
      zh: '感谢您的好评！希望很快再次见到您。'
    };
    return messages[language] || messages.en;
  }

  // Rating of 3 (neutral) — no follow-up needed
  return null;
}

/**
 * Handle a star rating feedback response.
 * Stores the rating in the database and sends appropriate follow-up.
 */
export async function handleFeedbackRating(
  phone: string,
  orderId: string | null,
  rating: number,
  language: 'en' | 'ms' | 'zh' = 'en'
): Promise<{ stored: boolean; followUp: string | null }> {
  try {
    // Store the rating in rainbow_messages with a special marker
    const timestamp = new Date();
    await db.insert(rainbowMessages).values({
      phone,
      role: 'user',
      content: rating.toString(),
      timestamp,
      intent: 'order_feedback_rating',
      action: `star_${rating}`,
      messageType: 'feedback_rating',
      source: orderId ? `order:${orderId}` : 'order_feedback'
    });

    logger.info('Stored feedback rating', { phone, orderId, rating });

    // Get follow-up message if applicable
    const followUp = getFollowUpMessage(rating, language);

    return {
      stored: true,
      followUp
    };
  } catch (error) {
    logger.error('Failed to store feedback rating', { phone, orderId, rating, error });
    return {
      stored: false,
      followUp: null
    };
  }
}

/** Detect if a message looks like feedback and contains a rating. */
export function isFeedbackMessage(text: string): boolean {
  const rating = detectStarRating(text);
  return rating !== null;
}
