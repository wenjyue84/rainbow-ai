/**
 * tests/unit/pelangi-regression-july12.test.ts
 * Regression guards for the July 12 2026 hardening session.
 * No HTTP calls — pure config/JSON validation.
 *
 * Run: npx vitest run tests/unit/pelangi-regression-july12.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'src', 'assistant', 'data');
const KB   = join(ROOT, '.rainbow-kb');

function readJson<T = Record<string, unknown>>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

type IntentEntry = { intent: string; keywords: Record<string, string[]> };

function flatKws(entry: IntentEntry): string[] {
  return Object.values(entry.keywords).flat().map((k) => k.toLowerCase());
}

describe('Pelangi regression — July 12 hardening', () => {

  it('T1: cancel_booking is in pms_capsule intent whitelist', () => {
    const whitelists = readJson<Record<string, string[]>>(
      join(DATA, 'intent-whitelists.json'),
    );
    expect(whitelists.pms_capsule, 'pms_capsule key missing from intent-whitelists.json').toBeDefined();
    expect(whitelists.pms_capsule).toContain('cancel_booking');
  });

  it('T2: booking intent keywords do not include "cancel" or "refund"', () => {
    const file = readJson<{ intents: IntentEntry[] }>(
      join(DATA, 'intent-keywords-pelangi.json'),
    );
    const booking = file.intents.find((i) => i.intent === 'booking');
    expect(booking, 'booking intent missing from intent-keywords-pelangi.json').toBeDefined();
    const kws = flatKws(booking!);
    expect(kws, '"cancel" in booking keywords will hijack cancel flow').not.toContain('cancel');
    expect(kws, '"refund" in booking keywords will hijack cancel flow').not.toContain('refund');
  });

  it('T3: checkout_now has "now"-style triggers exclusive from checkout_info', () => {
    const file = readJson<{ intents: IntentEntry[] }>(
      join(DATA, 'intent-keywords-pelangi.json'),
    );
    const checkoutNow  = file.intents.find((i) => i.intent === 'checkout_now');
    const checkoutInfo = file.intents.find((i) => i.intent === 'checkout_info');
    expect(checkoutNow,  'checkout_now intent missing').toBeDefined();
    expect(checkoutInfo, 'checkout_info intent missing').toBeDefined();

    const nowKws  = flatKws(checkoutNow!);
    const infoSet = new Set(flatKws(checkoutInfo!));

    const hasNowStyle = nowKws.some((k) => /\bnow\b|check.*out.*now/i.test(k));
    expect(hasNowStyle, 'checkout_now has no "now"-style triggers').toBe(true);

    const exclusive = nowKws.filter((k) => !infoSet.has(k));
    expect(exclusive.length, 'checkout_now shares all keywords with checkout_info — cannot rank higher').toBeGreaterThan(0);
  });

  it('T4: extra_amenity_request owns "towel"; facilities_info does not', () => {
    const file = readJson<{ intents: IntentEntry[] }>(
      join(DATA, 'intent-keywords-pelangi.json'),
    );
    const amenity    = file.intents.find((i) => i.intent === 'extra_amenity_request');
    const facilities = file.intents.find((i) => i.intent === 'facilities_info');
    expect(amenity,    'extra_amenity_request intent missing').toBeDefined();
    expect(facilities, 'facilities_info intent missing').toBeDefined();

    expect(
      flatKws(amenity!).some((k) => /towel/i.test(k)),
      '"towel" missing from extra_amenity_request — towel requests will mis-route',
    ).toBe(true);

    expect(
      flatKws(facilities!).some((k) => /towel/i.test(k)),
      '"towel" found in facilities_info — towel requests will bleed to facilities',
    ).toBe(false);
  });

  it('T5: .rainbow-kb/AGENTS.md lists memory/, guests/, contacts/ as RAG-excluded dirs', () => {
    const agents = readFileSync(join(KB, 'AGENTS.md'), 'utf8');
    expect(agents, 'memory/ not in AGENTS.md exclusion list').toMatch(/memory/i);
    expect(agents, 'guests/ not in AGENTS.md exclusion list').toMatch(/guests/i);
    expect(agents, 'contacts/ not in AGENTS.md exclusion list').toMatch(/contacts/i);
  });

  it('T6: all workflow_id values in data/routing.json resolve to existing workflows', () => {
    const routing   = readJson<Record<string, { workflow_id?: string }>>(
      join(DATA, 'routing.json'),
    );
    const workflows = readJson<Record<string, unknown>>(join(DATA, 'workflows.json'));
    const known     = new Set(Object.keys(workflows));

    const missing = Object.entries(routing)
      .filter(([, cfg]) => cfg.workflow_id && !known.has(cfg.workflow_id))
      .map(([intent, cfg]) => `${intent} → "${cfg.workflow_id}"`);

    expect(missing, `Orphaned workflow_id references:\n${missing.join('\n')}`).toEqual([]);
  });

});
