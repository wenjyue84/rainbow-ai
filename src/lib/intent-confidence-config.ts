/**
 * US-534: Intent Confidence Thresholds Configuration
 *
 * Loads and manages per-intent confidence thresholds from JSON config.
 * Used by the classification pipeline to determine if an intent classification
 * is reliable enough for action, or if clarifying questions should be asked.
 */

import fs from 'fs';
import path from 'path';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('IntentConfidenceConfig');

interface ThresholdsConfig {
  version: string;
  description: string;
  lastUpdated: string;
  thresholds: Record<string, number>;
  categories?: Record<string, any>;
}

let cachedConfig: ThresholdsConfig | null = null;

/**
 * Load the intent confidence thresholds from the JSON config file.
 * Cached in memory to avoid repeated file I/O.
 */
function loadThresholdsConfig(): ThresholdsConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    // Load from src/assistant/config/intent-confidence-thresholds.json
    const configPath = path.join(
      process.cwd(),
      'src',
      'assistant',
      'config',
      'intent-confidence-thresholds.json'
    );

    if (!fs.existsSync(configPath)) {
      logger.warn('intent-confidence-thresholds.json not found, using default fallback');
      cachedConfig = getDefaultThresholds();
      return cachedConfig;
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    cachedConfig = JSON.parse(fileContent);
    logger.debug('intent-confidence-thresholds config loaded', {
      intentCount: Object.keys(cachedConfig.thresholds).length,
    });

    return cachedConfig;
  } catch (err) {
    logger.warn('Failed to load intent-confidence-thresholds.json', {
      error: String(err),
    });
    cachedConfig = getDefaultThresholds();
    return cachedConfig;
  }
}

/**
 * Get the default thresholds fallback (when config file doesn't exist).
 */
function getDefaultThresholds(): ThresholdsConfig {
  return {
    version: '1.0.0',
    description: 'Default per-intent confidence thresholds',
    lastUpdated: new Date().toISOString(),
    thresholds: {
      greeting: 0.95,
      thanks: 0.9,
      contact_staff: 0.8,
      pricing: 0.85,
      availability: 0.7,
      booking: 0.75,
      directions: 0.85,
      facilities_info: 0.67,
      rules_policy: 0.8,
      payment_info: 0.8,
      payment_made: 0.67,
      checkin_info: 0.8,
      checkout_info: 0.8,
      checkout_procedure: 0.8,
      check_in_arrival: 0.67,
      billing_inquiry: 0.8,
      billing_dispute: 0.67,
      cleanliness_complaint: 0.67,
      climate_control_complaint: 0.67,
      facility_malfunction: 0.67,
      facility_orientation: 0.67,
      noise_complaint: 0.67,
      extra_amenity_request: 0.67,
      general_complaint_in_stay: 0.6,
      post_checkout_complaint: 0.6,
      review_feedback: 0.8,
      tourist_guide: 0.67,
      luggage_storage: 0.85,
      late_checkout_request: 0.85,
      lower_deck_preference: 0.85,
      forgot_item_post_checkout: 0.67,
      card_locked: 0.3,
      theft_report: 0.3,
      wifi: 0.95,
      unknown: 0.0,
    },
  };
}

/**
 * Get the confidence threshold for a specific intent.
 * Returns the configured threshold, or a default of 0.65 if not configured.
 *
 * @param intent - The intent name
 * @returns The minimum confidence threshold for this intent
 */
export function getIntentThreshold(intent: string): number {
  const config = loadThresholdsConfig();
  const threshold = config.thresholds[intent];

  // If intent is in config, use it. Otherwise, use default 0.65
  if (threshold !== undefined) {
    return threshold;
  }

  logger.debug('intent-threshold-default', {
    intent,
    defaultThreshold: 0.65,
  });

  return 0.65;
}

/**
 * Check if a confidence score is below the threshold for a given intent.
 *
 * @param intent - The intent name
 * @param confidence - The confidence score
 * @returns true if confidence is below the threshold, false otherwise
 */
export function isBelowIntentThreshold(intent: string, confidence: number): boolean {
  const threshold = getIntentThreshold(intent);
  return confidence < threshold;
}

/**
 * Reload the cached configuration (useful for testing or runtime updates).
 */
export function reloadThresholdsConfig(): void {
  cachedConfig = null;
  loadThresholdsConfig();
}

/**
 * Get the full thresholds config (for admin/debugging).
 */
export function getThresholdsConfig(): ThresholdsConfig {
  return loadThresholdsConfig();
}
