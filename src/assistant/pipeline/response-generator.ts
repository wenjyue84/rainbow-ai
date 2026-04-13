/**
 * Response Generator Module
 *
 * Handles template-based response generation with dynamic content interpolation.
 * Provides utilities for rendering booking confirmations and other templated responses.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Guest context for booking confirmation
 */
export interface GuestContext {
  guestName: string;
  unit: string;
  checkIn: string;
  checkOut: string;
  price: string;
}

/**
 * Booking confirmation template stored in knowledge.json
 */
interface BookingTemplate {
  en?: string;
  ms?: string;
  zh?: string;
  ta?: string;
}

/**
 * Renders a booking confirmation message by fetching the template from knowledge.json
 * and interpolating guest details using {{field}} placeholder syntax.
 *
 * @param guestContext - Object containing guest details (guestName, unit, checkIn, checkOut, price)
 * @param profileId - Profile identifier (e.g., 'default', 'southern', 'makan', etc.)
 * @param language - Language code ('en', 'ms', 'zh', 'ta'). Defaults to 'en'
 * @returns The rendered confirmation message with all placeholders replaced
 * @throws Error if template not found or context is invalid
 */
export function renderBookingConfirmation(
  guestContext: GuestContext,
  profileId: string = 'default',
  language: 'en' | 'ms' | 'zh' | 'ta' = 'en'
): string {
  // Validate input
  if (!guestContext || typeof guestContext !== 'object') {
    throw new Error('Invalid guestContext: must be an object');
  }

  const { guestName, unit, checkIn, checkOut, price } = guestContext;

  if (!guestName || !unit || !checkIn || !checkOut || !price) {
    throw new Error(
      'Invalid guestContext: missing required fields (guestName, unit, checkIn, checkOut, price)'
    );
  }

  // Load template from knowledge.json
  const template = loadBookingTemplate(profileId, language);

  if (!template) {
    throw new Error(
      `No booking confirmation template found for profile "${profileId}" in language "${language}"`
    );
  }

  // Interpolate placeholders
  const rendered = template
    .replace(/\{\{guestName\}\}/g, guestName)
    .replace(/\{\{unit\}\}/g, unit)
    .replace(/\{\{checkIn\}\}/g, checkIn)
    .replace(/\{\{checkOut\}\}/g, checkOut)
    .replace(/\{\{price\}\}/g, price);

  return rendered;
}

/**
 * Loads booking confirmation template from knowledge.json file
 * @param profileId - Profile identifier (e.g., 'default', 'southern', 'makan', etc.)
 * @param language - Language code ('en', 'ms', 'zh', 'ta')
 * @returns The template string or null if not found
 */
function loadBookingTemplate(
  profileId: string,
  language: 'en' | 'ms' | 'zh' | 'ta'
): string | null {
  // Determine knowledge.json path based on profileId
  let knowledgeJsonPath: string;

  if (profileId === 'default') {
    knowledgeJsonPath = join(process.cwd(), 'src', 'assistant', 'data', 'knowledge.json');
  } else {
    knowledgeJsonPath = join(
      process.cwd(),
      'src',
      'assistant',
      `data-${profileId}`,
      'knowledge.json'
    );
  }

  // Check if file exists
  if (!existsSync(knowledgeJsonPath)) {
    return null;
  }

  try {
    const content = readFileSync(knowledgeJsonPath, 'utf-8');
    const knowledge = JSON.parse(content);

    // Find booking_confirmation intent in static responses
    if (knowledge.static && Array.isArray(knowledge.static)) {
      const bookingConfirmation = knowledge.static.find(
        (item: { intent: string }) => item.intent === 'booking_confirmation'
      );

      if (bookingConfirmation && bookingConfirmation.response) {
        return bookingConfirmation.response[language] || bookingConfirmation.response['en'] || null;
      }
    }

    return null;
  } catch (error) {
    throw new Error(`Failed to load knowledge.json from ${knowledgeJsonPath}: ${String(error)}`);
  }
}
