/**
 * US-057: Profile-aware intent validation at startup.
 *
 * Detects when a profile's intents data contains terms or categories
 * that should not exist in that profile type (cross-contamination).
 */

import type { IntentsData } from '../assistant/schemas.js';

/**
 * Intent categories that belong exclusively to hostel profiles.
 * Should NOT appear in cafe profiles like 'makan-moments'.
 */
export const HOSTEL_INTENT_CATEGORIES = new Set([
  'check_in_arrival',
  'checkin_info',
  'checkout_info',
  'checkout_procedure',
  'late_checkout_request',
  'stay_extension',
  'facility_orientation',
  'luggage_storage',
  'card_locked',
  'wifi',
  'facilities_info',
  'lower_deck_preference',
  'capsule_conflict',
  'facility_malfunction',
  'noise_complaint',
  'cleanliness_complaint',
  'climate_control_complaint',
  'general_complaint_in_stay',
  'booking',
  'availability',
  'pricing',
  'extra_amenity_request',
  'theft_report',
  'post_checkout_complaint',
  'forgot_item_post_checkout',
  'billing_dispute',
  'billing_inquiry',
  'payment_made',
  'tourist_guide',
  'upsell_suggest',
]);

/**
 * Profile type definitions: which profiles are cafe vs hostel.
 * Cafe profiles must NOT contain hostel intent categories.
 */
export const PROFILE_TYPES: Record<string, 'hostel' | 'cafe'> = {
  'pelangi': 'hostel',
  'southern': 'hostel',
  'makan-moments': 'cafe',
};

/**
 * Validates that a profile's loaded intents match the expected profile type.
 *
 * For cafe profiles: throws an error if hostel-specific intent categories are found.
 * This catches cross-contamination from copy-paste errors during development.
 *
 * @param profileId - Profile identifier (e.g., 'makan-moments', 'pelangi')
 * @param intentsData - Loaded IntentsData object with categories array
 * @throws Error if contamination detected (hostel intents in cafe profile)
 */
export function validateProfileIntents(
  profileId: string,
  intentsData: IntentsData
): void {
  const profileType = PROFILE_TYPES[profileId];

  // Skip validation for unknown profiles or hostel profiles
  if (!profileType || profileType === 'hostel') {
    return;
  }

  // For cafe profiles, check that no hostel-specific intents are present
  const contaminated: string[] = [];

  if (Array.isArray(intentsData.categories)) {
    for (const category of intentsData.categories) {
      if (!Array.isArray(category.intents)) continue;

      for (const intent of category.intents) {
        if (HOSTEL_INTENT_CATEGORIES.has(intent.category)) {
          contaminated.push(intent.category);
        }
      }
    }
  }

  if (contaminated.length > 0) {
    const unique = [...new Set(contaminated)];
    throw new Error(
      `[Startup] Profile contamination detected in profile "${profileId}": ` +
      `found ${unique.length} hostel-specific intent(s) that should not exist in a cafe profile. ` +
      `Contaminated intents: ${unique.join(', ')}`
    );
  }
}
