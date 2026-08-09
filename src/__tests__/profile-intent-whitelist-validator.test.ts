/**
 * US-363: Profile-Specific Intent Whitelist Validator — Integration Tests
 *
 * Validates:
 * 1. Whitelist JSON structure and content
 * 2. Cross-profile contamination detection (makan routing rejected with pelangi intent)
 * 3. Exit code 1 on violation, 0 on pass
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadWhitelist,
  validateRoutingContent,
  findIntentLineNumber,
  findOwningProfile,
  validateAllProfiles,
  type ProfileWhitelist,
  type Violation,
} from '../tools/validate-profile-intents-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A clean makan routing.json — all intents are makan-owned or shared */
const MAKAN_CLEAN_ROUTING = JSON.stringify({
  schema_version: '1.0',
  greeting: { action: 'static_reply' },
  menu_query: { action: 'static_reply' },
  order_placement: { action: 'workflow', workflow_id: 'order_flow' },
  seasonal_inquiry: { action: 'static_reply' },
  menu_question: { action: 'static_reply' },
  cancel_workflow: { action: 'workflow', workflow_id: 'cancel' },
}, null, 2);

/** Makan routing.json contaminated with a pelangi-owned intent */
const MAKAN_CONTAMINATED_ROUTING = JSON.stringify({
  schema_version: '1.0',
  greeting: { action: 'static_reply' },
  menu_query: { action: 'static_reply' },
  pelangi_booking_inquiry: { action: 'workflow', workflow_id: 'booking_flow' },
  booking_request: { action: 'workflow', workflow_id: 'booking' },
  cancel_workflow: { action: 'workflow', workflow_id: 'cancel' },
}, null, 2);

/** Makan routing with multiple cross-profile violations */
const MAKAN_MULTI_VIOLATION_ROUTING = JSON.stringify({
  schema_version: '1.0',
  greeting: { action: 'static_reply' },
  menu_query: { action: 'static_reply' },
  pelangi_booking_inquiry: { action: 'static_reply' },
  checkin_info: { action: 'static_reply' },
  card_locked: { action: 'workflow', workflow_id: 'card_locked_troubleshoot' },
}, null, 2);

// ---------------------------------------------------------------------------
// Whitelist structure tests
// ---------------------------------------------------------------------------

describe('profile-intent-whitelist.json', () => {
  let whitelist: ProfileWhitelist;

  it('loads without error', () => {
    whitelist = loadWhitelist();
    expect(whitelist).toBeDefined();
  });

  it('has schema_version', () => {
    const wl = loadWhitelist();
    expect(wl.schema_version).toBe('1.0');
  });

  it('has shared_intents array with common intents', () => {
    const wl = loadWhitelist();
    expect(Array.isArray(wl.shared_intents)).toBe(true);
    expect(wl.shared_intents).toContain('greeting');
    expect(wl.shared_intents).toContain('thanks');
    expect(wl.shared_intents).toContain('contact_staff');
  });

  it('has makan profile with seasonal_inquiry and menu_question', () => {
    const wl = loadWhitelist();
    expect(wl.profiles.makan).toBeDefined();
    expect(wl.profiles.makan.owned_intents).toContain('seasonal_inquiry');
    expect(wl.profiles.makan.owned_intents).toContain('menu_question');
  });

  it('has pelangi profile with booking_request and room_inquiry', () => {
    const wl = loadWhitelist();
    expect(wl.profiles.pelangi).toBeDefined();
    expect(wl.profiles.pelangi.owned_intents).toContain('booking_request');
    expect(wl.profiles.pelangi.owned_intents).toContain('room_inquiry');
  });

  it('has pelangi_booking_inquiry in pelangi owned_intents', () => {
    const wl = loadWhitelist();
    expect(wl.profiles.pelangi.owned_intents).toContain('pelangi_booking_inquiry');
  });

  it('makan profile does not own pelangi intents', () => {
    const wl = loadWhitelist();
    expect(wl.profiles.makan.owned_intents).not.toContain('booking_request');
    expect(wl.profiles.makan.owned_intents).not.toContain('room_inquiry');
    expect(wl.profiles.makan.owned_intents).not.toContain('pelangi_booking_inquiry');
  });
});

// ---------------------------------------------------------------------------
// findIntentLineNumber tests
// ---------------------------------------------------------------------------

describe('findIntentLineNumber', () => {
  it('finds the correct line for a JSON key', () => {
    const json = JSON.stringify({ greeting: {}, menu_query: {}, booking: {} }, null, 2);
    const line = findIntentLineNumber(json, 'menu_query');
    expect(line).toBeGreaterThan(0);

    const lines = json.split('\n');
    expect(lines[line - 1]).toMatch(/"menu_query"\s*:/);
  });

  it('returns -1 if intent not found', () => {
    const json = JSON.stringify({ greeting: {} }, null, 2);
    expect(findIntentLineNumber(json, 'nonexistent')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// findOwningProfile tests
// ---------------------------------------------------------------------------

describe('findOwningProfile', () => {
  const whitelist = loadWhitelist();

  it('returns "pelangi" for pelangi_booking_inquiry', () => {
    expect(findOwningProfile('pelangi_booking_inquiry', whitelist)).toBe('pelangi');
  });

  it('returns "makan" for seasonal_inquiry', () => {
    expect(findOwningProfile('seasonal_inquiry', whitelist)).toBe('makan');
  });

  it('returns "makan" for menu_question', () => {
    expect(findOwningProfile('menu_question', whitelist)).toBe('makan');
  });

  it('returns "pelangi" for booking_request', () => {
    expect(findOwningProfile('booking_request', whitelist)).toBe('pelangi');
  });

  it('returns null for shared intents', () => {
    // greeting is shared — first profile wins in iteration, could be any
    // but we care that it's not null only for owned intents
    // shared intents are not in any owned_intents list → null
    const result = findOwningProfile('greeting', whitelist);
    // greeting could appear as owned by a profile or not — depends on whitelist
    // For our whitelist, greeting is shared-only, so should be null
    expect(result).toBeNull();
  });

  it('returns null for completely unknown intent', () => {
    expect(findOwningProfile('totally_made_up_intent_xyz', whitelist)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateRoutingContent — core contamination detection
// ---------------------------------------------------------------------------

describe('validateRoutingContent', () => {
  const whitelist = loadWhitelist();

  it('returns no violations for clean makan routing', () => {
    const violations = validateRoutingContent(
      'makan',
      'makan/routing.json',
      MAKAN_CLEAN_ROUTING,
      whitelist,
    );
    expect(violations).toHaveLength(0);
  });

  it('detects pelangi_booking_inquiry in makan routing — single violation', () => {
    const violations = validateRoutingContent(
      'makan',
      'makan/routing.json',
      MAKAN_CONTAMINATED_ROUTING,
      whitelist,
    );

    const intentNames = violations.map((v: Violation) => v.intent);
    expect(intentNames).toContain('pelangi_booking_inquiry');
    expect(intentNames).toContain('booking_request');
  });

  it('violation message includes filename, line number, and contaminating profile', () => {
    const violations = validateRoutingContent(
      'makan',
      'data-makan/routing.json',
      MAKAN_CONTAMINATED_ROUTING,
      whitelist,
    );

    const bookingViolation = violations.find((v: Violation) => v.intent === 'pelangi_booking_inquiry');
    expect(bookingViolation).toBeDefined();
    expect(bookingViolation!.message).toContain('data-makan/routing.json');
    expect(bookingViolation!.message).toMatch(/:\d+/); // has line number
    expect(bookingViolation!.message).toContain('pelangi');
    expect(bookingViolation!.message).toContain('pelangi_booking_inquiry');
  });

  it('violation has correct contaminatingProfile field', () => {
    const violations = validateRoutingContent(
      'makan',
      'makan/routing.json',
      MAKAN_CONTAMINATED_ROUTING,
      whitelist,
    );

    const v = violations.find((v: Violation) => v.intent === 'pelangi_booking_inquiry')!;
    expect(v.contaminatingProfile).toBe('pelangi');
  });

  it('detects multiple violations', () => {
    const violations = validateRoutingContent(
      'makan',
      'makan/routing.json',
      MAKAN_MULTI_VIOLATION_ROUTING,
      whitelist,
    );

    expect(violations.length).toBeGreaterThanOrEqual(2);
    const intents = violations.map((v: Violation) => v.intent);
    expect(intents).toContain('pelangi_booking_inquiry');
    // checkin_info and card_locked are pelangi-owned
    expect(intents.some((i: string) => ['checkin_info', 'card_locked'].includes(i))).toBe(true);
  });

  it('skips schema_version key', () => {
    const routingWithSchema = JSON.stringify({ schema_version: '1.0', menu_query: {} }, null, 2);
    const violations = validateRoutingContent('makan', 'routing.json', routingWithSchema, whitelist);
    expect(violations.map((v: Violation) => v.intent)).not.toContain('schema_version');
  });

  it('clean pelangi routing returns no violations', () => {
    const pelangRouting = JSON.stringify({
      schema_version: '1.0',
      booking_request: { action: 'workflow', workflow_id: 'booking' },
      checkin_info: { action: 'static_reply' },
      greeting: { action: 'static_reply' },
    }, null, 2);

    const violations = validateRoutingContent('pelangi', 'routing.json', pelangRouting, whitelist);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: exit code simulation
// ---------------------------------------------------------------------------

describe('exit code simulation', () => {
  const whitelist = loadWhitelist();

  it('clean routing → 0 violations (exit 0)', () => {
    const violations = validateRoutingContent(
      'makan',
      'makan/routing.json',
      MAKAN_CLEAN_ROUTING,
      whitelist,
    );
    // Simulate exit code logic: violations.length > 0 ? 1 : 0
    const exitCode = violations.length > 0 ? 1 : 0;
    expect(exitCode).toBe(0);
  });

  it('contaminated routing → violations > 0 (exit 1)', () => {
    const violations = validateRoutingContent(
      'makan',
      'makan/routing.json',
      MAKAN_CONTAMINATED_ROUTING,
      whitelist,
    );
    const exitCode = violations.length > 0 ? 1 : 0;
    expect(exitCode).toBe(1);
  });

  it('makan routing.json is rejected when it contains pelangi_booking_inquiry', () => {
    const routingWithPelangiIntent = JSON.stringify({
      greeting: { action: 'static_reply' },
      pelangi_booking_inquiry: { action: 'workflow', workflow_id: 'booking_flow' },
    }, null, 2);

    const violations = validateRoutingContent(
      'makan',
      'data-makan/routing.json',
      routingWithPelangiIntent,
      whitelist,
    );

    expect(violations.length).toBeGreaterThan(0);
    const intentNames = violations.map((v: Violation) => v.intent);
    expect(intentNames).toContain('pelangi_booking_inquiry');

    // Simulate: exit code 1 on violation
    const exitCode = violations.length > 0 ? 1 : 0;
    expect(exitCode).toBe(1);
  });
});
