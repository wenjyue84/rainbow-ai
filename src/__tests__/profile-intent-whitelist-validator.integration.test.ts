/**
 * US-363: Profile-Specific Intent Whitelist Validator CLI — Integration Tests
 *
 * Validates that:
 * - makan routing.json is rejected when it contains pelangi-owned intents
 * - clean routing.json passes validation
 * - violations report filename and intent name
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loadWhitelist,
  validateRoutingContent,
  validateAllProfiles,
  findIntentLineNumber,
  findOwningProfile,
} from '../tools/validate-profile-intents-cli.js';

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(currentDir, '..', '..');

// ---------------------------------------------------------------------------
// Whitelist loading
// ---------------------------------------------------------------------------

describe('loadWhitelist', () => {
  it('loads the whitelist file from src/data/', () => {
    const whitelist = loadWhitelist();
    expect(whitelist.schema_version).toBe('1.0');
    expect(whitelist.shared_intents).toContain('greeting');
    expect(whitelist.profiles).toHaveProperty('makan');
    expect(whitelist.profiles).toHaveProperty('pelangi');
    expect(whitelist.profiles).toHaveProperty('southern');
  });

  it('makan profile owns menu_query but not pelangi_booking_inquiry', () => {
    const whitelist = loadWhitelist();
    expect(whitelist.profiles.makan.owned_intents).toContain('menu_query');
    expect(whitelist.profiles.makan.owned_intents).not.toContain('pelangi_booking_inquiry');
  });

  it('pelangi profile owns pelangi_booking_inquiry', () => {
    const whitelist = loadWhitelist();
    expect(whitelist.profiles.pelangi.owned_intents).toContain('pelangi_booking_inquiry');
  });
});

// ---------------------------------------------------------------------------
// findOwningProfile
// ---------------------------------------------------------------------------

describe('findOwningProfile', () => {
  it('returns pelangi for pelangi_booking_inquiry', () => {
    const whitelist = loadWhitelist();
    expect(findOwningProfile('pelangi_booking_inquiry', whitelist)).toBe('pelangi');
  });

  it('returns makan for menu_query', () => {
    const whitelist = loadWhitelist();
    expect(findOwningProfile('menu_query', whitelist)).toBe('makan');
  });

  it('returns null for shared intents', () => {
    const whitelist = loadWhitelist();
    expect(findOwningProfile('greeting', whitelist)).toBeNull();
  });

  it('returns null for unknown intents', () => {
    const whitelist = loadWhitelist();
    expect(findOwningProfile('completely_unknown_intent_xyz', whitelist)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findIntentLineNumber
// ---------------------------------------------------------------------------

describe('findIntentLineNumber', () => {
  it('finds the line number of an intent key', () => {
    const json = `{
  "greeting": { "action": "static_reply" },
  "pelangi_booking_inquiry": { "action": "llm_reply" },
  "menu_query": { "action": "static_reply" }
}`;
    expect(findIntentLineNumber(json, 'pelangi_booking_inquiry')).toBe(3);
  });

  it('returns -1 when intent not found', () => {
    const json = `{ "greeting": {} }`;
    expect(findIntentLineNumber(json, 'nonexistent')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// validateRoutingContent — CORE acceptance criterion
// ---------------------------------------------------------------------------

describe('validateRoutingContent — makan profile with pelangi_booking_inquiry', () => {
  it('reports violation when makan routing contains pelangi_booking_inquiry', () => {
    const whitelist = loadWhitelist();

    // makan routing.json contaminated with a pelangi-owned intent
    const contaminatedRouting = JSON.stringify({
      greeting: { action: 'static_reply' },
      menu_query: { action: 'static_reply' },
      pelangi_booking_inquiry: { action: 'llm_reply' }, // VIOLATION
    }, null, 2);

    const violations = validateRoutingContent(
      'makan',
      'src/assistant/data-makan/routing.json',
      contaminatedRouting,
      whitelist,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0].intent).toBe('pelangi_booking_inquiry');
    expect(violations[0].profile).toBe('makan');
    expect(violations[0].contaminatingProfile).toBe('pelangi');
    expect(violations[0].routingFile).toBe('src/assistant/data-makan/routing.json');
    expect(violations[0].lineNumber).toBeGreaterThan(0);
    expect(violations[0].message).toContain('pelangi_booking_inquiry');
    expect(violations[0].message).toContain('pelangi');
  });

  it('returns zero violations for a clean makan routing', () => {
    const whitelist = loadWhitelist();

    const cleanRouting = JSON.stringify({
      greeting: { action: 'static_reply' },
      menu_query: { action: 'static_reply' },
      order_placement: { action: 'workflow' },
    }, null, 2);

    const violations = validateRoutingContent(
      'makan',
      'src/assistant/data-makan/routing.json',
      cleanRouting,
      whitelist,
    );

    expect(violations).toHaveLength(0);
  });

  it('exit code logic: 1 on violation, 0 on pass', () => {
    const whitelist = loadWhitelist();

    const contaminated = JSON.stringify({ pelangi_booking_inquiry: {} }, null, 2);
    const clean = JSON.stringify({ menu_query: {} }, null, 2);

    const violationsOnContaminated = validateRoutingContent('makan', 'routing.json', contaminated, whitelist);
    const violationsOnClean = validateRoutingContent('makan', 'routing.json', clean, whitelist);

    // Simulates: process.exit(totalViolations > 0 ? 1 : 0)
    expect(violationsOnContaminated.length > 0 ? 1 : 0).toBe(1);
    expect(violationsOnClean.length > 0 ? 1 : 0).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// validateRoutingContent — additional profiles
// ---------------------------------------------------------------------------

describe('validateRoutingContent — cross-profile contamination detection', () => {
  it('detects makan intent in southern profile routing', () => {
    const whitelist = loadWhitelist();

    const southernWithMakanIntent = JSON.stringify({
      booking: { action: 'workflow' },
      menu_query: { action: 'static_reply' }, // makan intent in southern
    }, null, 2);

    const violations = validateRoutingContent(
      'southern',
      'src/assistant/data-southern/routing.json',
      southernWithMakanIntent,
      whitelist,
    );

    expect(violations.length).toBeGreaterThan(0);
    const v = violations.find(v => v.intent === 'menu_query');
    expect(v).toBeDefined();
    expect(v?.contaminatingProfile).toBe('makan');
  });

  it('shared intents are allowed in any profile', () => {
    const whitelist = loadWhitelist();

    // All shared intents should be valid in makan
    const sharedOnly = Object.fromEntries(
      whitelist.shared_intents.map(i => [i, { action: 'static_reply' }])
    );

    const violations = validateRoutingContent(
      'makan',
      'test-routing.json',
      JSON.stringify(sharedOnly, null, 2),
      whitelist,
    );

    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateAllProfiles — real files
// ---------------------------------------------------------------------------

describe('validateAllProfiles — real project routing files', () => {
  it('validates actual makan routing.json against whitelist without throwing', () => {
    const whitelist = loadWhitelist();
    const assistantDir = resolve(rootDir, 'src', 'assistant');

    // Should not throw; result may have violations or not
    expect(() => validateAllProfiles(whitelist, assistantDir)).not.toThrow();
  });

  it('returns results for profiles that have routing.json files', () => {
    const whitelist = loadWhitelist();
    const assistantDir = resolve(rootDir, 'src', 'assistant');

    const results = validateAllProfiles(whitelist, assistantDir);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result).toHaveProperty('profile');
      expect(result).toHaveProperty('violations');
      expect(result).toHaveProperty('checked');
      expect(Array.isArray(result.violations)).toBe(true);
    }
  });
});
