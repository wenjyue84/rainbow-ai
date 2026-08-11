/**
 * US-094: Profile Routing Isolation Validator
 *
 * Ensures routing.json routes do not reference intents from other profiles.
 * Detects cross-profile contamination at routing layer (e.g., data-makan routing to luggage_storage).
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface RouteIntentMismatch {
  profileId: string;
  route: string;
  referencedIntent?: string;
  reason: string;
}

export interface RoutingValidationResult {
  profileId: string;
  dataDir: string;
  isValid: boolean;
  mismatches: RouteIntentMismatch[];
}

export interface RoutingValidationReport {
  isValid: boolean;
  profiles: RoutingValidationResult[];
}

/**
 * Hostel-specific intent categories (Pelangi + Southern)
 * Cafe profiles must NOT have these routes
 */
const HOSTEL_INTENTS = new Set([
  'check_in_arrival',
  'checkin_info',
  'checkout_info',
  'checkout_procedure',
  'checkout_now',
  'late_checkout_request',
  'stay_extension',
  'extend_stay',
  'facility_orientation',
  'luggage_storage',
  'card_locked',
  'wifi',
  'facilities_info',
  'facilities',
  'lower_deck_preference',
  'capsule_conflict',
  'facility_malfunction',
  'noise_complaint',
  'cleanliness_complaint',
  'climate_control_complaint',
  'general_complaint_in_stay',
  'booking',
  'availability',
  'extra_amenity_request',
  'EXTRA_TOWEL',
  'EXTRA_PILLOW',
  'ROOM_CLEANING',
  'MAINTENANCE_ISSUE',
  'WIFI_PASSWORD',
  'theft_report',
  'theft',
  'post_checkout_complaint',
  'forgot_item_post_checkout',
  'billing_dispute',
  'billing_inquiry',
  'payment_made',
  'tourist_guide',
  'upsell_suggest',
  'room_type_inquiry',
  'booking_modification',
  'booking_cancellation',
]);

/**
 * Cafe-specific intent categories (Makan)
 * Hostel profiles should NOT have these routes (though Pelangi has integrated food ordering)
 */
const CAFE_INTENTS = new Set([
  'ORDER_BROWSE',
  'ORDER_ITEM_ADD',
  'ORDER_CONFIRM',
  'ORDER_DECLINE',
  'ORDER_CANCEL',
  'ORDER_STATUS',
  'MENU_FILTER_PRICE',
  'MENU_SPECIALS',
  'MENU_RECOMMEND',
  'menu_query',
  'menu_browse_category',
  'order_placement',
  'order_feedback_rating',
  'menu_item_detail',
  'allergen_query',
  'vegetarian_query',
  'table_reservation',
  'menu_filter_dietary',
  'specials_query',
  'food_recommendation',
  'budget_query',
  'operating_hours',
  'order_status',
]);

export const PROFILE_CONFIGS: Record<
  string,
  { label: string; dataDir: string; forbiddenIntents: Set<string> }
> = {
  pelangi: {
    label: 'Pelangi Capsule Hostel',
    dataDir: 'src/assistant/data',
    forbiddenIntents: new Set(), // Pelangi can have both hostel and cafe intents
  },
  southern: {
    label: 'Southern Homestay',
    dataDir: 'src/assistant/data-southern',
    forbiddenIntents: CAFE_INTENTS, // Southern is hostel-only
  },
  'makan-moments': {
    label: 'Makan Moments Cafe',
    dataDir: 'src/assistant/data-makan',
    forbiddenIntents: HOSTEL_INTENTS, // Makan is cafe-only
  },
  'pms-capsule': {
    label: 'Pelangi Capsule — Staff Assistant',
    dataDir: 'src/assistant/data-pms-capsule',
    forbiddenIntents: CAFE_INTENTS,
  },
  'pms-southern': {
    label: 'Southern Homestay — Staff Assistant',
    dataDir: 'src/assistant/data-pms-southern',
    forbiddenIntents: CAFE_INTENTS,
  },
  yoongmei: {
    label: 'Yoong Mei Trading And Transport',
    dataDir: 'src/assistant/data-yoongmei',
    forbiddenIntents: new Set([...HOSTEL_INTENTS, ...CAFE_INTENTS]),
  },
  'senai-app': {
    label: 'Senai Room Rental',
    dataDir: 'src/assistant/data-senai',
    forbiddenIntents: CAFE_INTENTS,
  },
  'dental-world': {
    label: 'Dental World Group',
    dataDir: 'src/assistant/data-dental-world',
    forbiddenIntents: new Set([...HOSTEL_INTENTS, ...CAFE_INTENTS]),
  },
};

/**
 * Load the full routing map (route name -> {action, workflow_id?}).
 */
function loadRouting(
  routingFile: string
): Record<string, { action?: string; workflow_id?: string }> {
  if (!existsSync(routingFile)) {
    return {};
  }

  try {
    const content = readFileSync(routingFile, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse routing.json: ${routingFile}`);
  }
}

/**
 * Load the set of workflow ids defined in workflows.json (empty set if absent).
 */
function loadWorkflowIds(workflowsFile: string): Set<string> {
  if (!existsSync(workflowsFile)) {
    return new Set();
  }

  try {
    const content = readFileSync(workflowsFile, 'utf-8');
    const data = JSON.parse(content);
    const list = Array.isArray(data?.workflows) ? data.workflows : [];
    return new Set(list.map((w: { id?: string }) => w.id).filter(Boolean));
  } catch (error) {
    throw new Error(`Failed to parse workflows.json: ${workflowsFile}`);
  }
}

/**
 * Validate a single profile's routing.json for cross-profile contamination
 */
export function validateProfile(
  profileId: string,
  rootDir: string = process.cwd(),
): RoutingValidationResult {
  const config = PROFILE_CONFIGS[profileId];
  if (!config) {
    throw new Error(
      `Unknown profileId: "${profileId}". Valid profiles: ${Object.keys(PROFILE_CONFIGS).join(', ')}`
    );
  }

  const dataDir = join(rootDir, config.dataDir);
  const routingFile = join(dataDir, 'routing.json');

  const routing = loadRouting(routingFile);
  const workflowIds = loadWorkflowIds(join(dataDir, 'workflows.json'));
  const mismatches: RouteIntentMismatch[] = [];

  // Check each route to ensure it's not from a forbidden (other profile's) intent
  for (const [route, entry] of Object.entries(routing)) {
    if (config.forbiddenIntents.has(route)) {
      mismatches.push({
        profileId,
        route,
        reason: `Route "${route}" belongs to a different business profile and should not be in ${config.label} routing.json`,
      });
    }
    // Broken workflow reference: a routed workflow that doesn't exist silently
    // degrades to a generic LLM reply at runtime (this shipped once — the
    // booking_cancellation workflow was deleted while its route remained).
    if (
      entry?.action === 'workflow' &&
      entry.workflow_id &&
      !workflowIds.has(entry.workflow_id)
    ) {
      mismatches.push({
        profileId,
        route,
        referencedIntent: entry.workflow_id,
        reason: `Route "${route}" points to workflow_id "${entry.workflow_id}" which does not exist in workflows.json`,
      });
    }
  }

  return {
    profileId,
    dataDir,
    isValid: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Validate all known profiles' routing configurations
 */
export function validateAllProfiles(
  rootDir: string = process.cwd()
): RoutingValidationReport {
  const profileIds = Object.keys(PROFILE_CONFIGS);
  const profiles = profileIds.map((id) => validateProfile(id, rootDir));

  return {
    isValid: profiles.every((p) => p.isValid),
    profiles,
  };
}

/**
 * Format validation report as human-readable string
 */
export function formatReport(report: RoutingValidationReport): string {
  const lines: string[] = [
    '=== Profile Routing Isolation Report ===',
    '',
  ];

  for (const profile of report.profiles) {
    const status = profile.isValid ? '✓ VALID' : '✗ INVALID';
    const config = PROFILE_CONFIGS[profile.profileId];
    lines.push(`Profile: ${profile.profileId} (${config?.label}) — ${status}`);

    if (!profile.isValid) {
      for (const mismatch of profile.mismatches) {
        lines.push(
          `  Route "${mismatch.route}": ${mismatch.reason}`
        );
      }
    }
  }

  const totalMismatches = report.profiles.reduce(
    (sum, p) => sum + p.mismatches.length,
    0
  );
  lines.push('');
  lines.push(
    `=== Summary: ${totalMismatches} mismatch(es) — ${report.isValid ? 'VALID' : 'INVALID'} ===`
  );

  return lines.join('\n');
}
