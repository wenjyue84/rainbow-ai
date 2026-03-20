/**
 * Profile Data Accuracy Tests (US-032)
 *
 * Validates that each profile's JSON data files (intents.json, knowledge.json,
 * routing.json, etc.) contain business-specific content and correct routing.
 * Ensures business profile separation at the data level.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

// Resolve project root
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function readDataFile(profile: string, filename: string): any {
  const filePath = join(ROOT, 'src', 'assistant', profile, filename);
  if (!existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// ─── Makan Moments Data: Cafe-specific content ───────────────────────────────

describe('data-makan — intents.json business alignment', () => {
  const intents = readDataFile('data-makan', 'intents.json');

  it('should contain cafe-relevant categories', () => {
    const categories = intents.categories?.map((c: any) => c.category) ?? [];
    expect(categories.length).toBeGreaterThan(0);
    // Should have general support
    expect(categories.some((c: string) => c.toLowerCase().includes('support'))).toBe(true);
  });

  it('should not contain hostel-specific phases', () => {
    const categories = intents.categories?.map((c: any) => c.category.toLowerCase()) ?? [];
    const hostelPhases = ['arrival_checkin', 'during_stay', 'checkout_departure', 'post_checkout'];
    for (const phase of hostelPhases) {
      expect(categories).not.toContain(phase);
    }
  });

  it('should have cafe-specific intents', () => {
    const allIntents = intents.categories?.flatMap((c: any) => c.intents?.map((i: any) => i.category) ?? []) ?? [];
    const cafeIntents = ['menu_query', 'order_placement', 'operating_hours'];
    for (const intent of cafeIntents) {
      expect(allIntents).toContain(intent);
    }
  });
});

describe('data-makan — knowledge.json business alignment', () => {
  const knowledge = readDataFile('data-makan', 'knowledge.json');

  it('should have static responses section', () => {
    expect(knowledge.static).toBeDefined();
    expect(Array.isArray(knowledge.static)).toBe(true);
  });

  it('should contain cafe-specific static replies', () => {
    const intents = knowledge.static?.map((s: any) => s.intent) ?? [];
    const cafeIntents = ['operating_hours', 'menu_query'];
    for (const intent of cafeIntents) {
      expect(intents).toContain(intent);
    }
  });

  it('should not have hostel-specific replies', () => {
    const intents = knowledge.static?.map((s: any) => s.intent.toLowerCase()) ?? [];
    const hostelIntents = ['checkin_info', 'checkout_info', 'room_booking', 'capsule_facilities'];
    for (const intent of hostelIntents) {
      expect(intents).not.toContain(intent);
    }
  });
});

describe('data-makan — routing.json business alignment', () => {
  const routing = readDataFile('data-makan', 'routing.json');

  it('should have routing entries', () => {
    expect(Object.keys(routing).length).toBeGreaterThan(0);
  });

  it('should not route to hostel-specific workflows', () => {
    const routes = Object.values(routing).map((r: any) => {
      if (typeof r === 'object' && r !== null && 'action' in r) {
        return r.action;
      }
      return String(r);
    });
    const routesStr = routes.join('|').toLowerCase();
    expect(routesStr).not.toContain('checkin');
    expect(routesStr).not.toContain('checkout');
    expect(routesStr).not.toContain('room');
  });

  it('should have cafe-relevant routing', () => {
    const routes = Object.keys(routing);
    expect(routes.some(r => r.includes('menu') || r.includes('order'))).toBe(true);
  });
});

// ─── Southern Homestay Data: Homestay-specific content ─────────────────────

describe('data-southern — intents.json business alignment', () => {
  const intents = readDataFile('data-southern', 'intents.json');

  it('should contain homestay-relevant categories', () => {
    const categories = intents.categories?.map((c: any) => c.category) ?? [];
    expect(categories.length).toBeGreaterThan(0);
  });

  it('should have booking and check-in phases', () => {
    const categories = intents.categories?.map((c: any) => c.category.toUpperCase()) ?? [];
    // Should have phases related to guest stay lifecycle
    expect(categories.some(c => c.includes('BOOKING') || c.includes('ARRIVAL') || c.includes('CHECKIN'))).toBe(true);
  });

  it('should not contain cafe-specific intents', () => {
    const allIntents = intents.categories?.flatMap((c: any) => c.intents?.map((i: any) => i.category.toLowerCase()) ?? []) ?? [];
    const cafeIntents = ['menu_query', 'order_placement', 'allergen_query'];
    for (const intent of cafeIntents) {
      expect(allIntents).not.toContain(intent);
    }
  });
});

describe('data-southern — knowledge.json business alignment', () => {
  const knowledge = readDataFile('data-southern', 'knowledge.json');

  it('should have static responses section', () => {
    expect(knowledge.static).toBeDefined();
    expect(Array.isArray(knowledge.static)).toBe(true);
  });

  it('should contain homestay-specific static replies', () => {
    const intents = knowledge.static?.map((s: any) => s.intent) ?? [];
    const homestayIntents = ['checkin_info', 'checkout_info', 'pricing', 'facilities'];
    for (const intent of homestayIntents) {
      expect(intents).toContain(intent);
    }
  });

  it('should not have cafe-specific replies', () => {
    const intents = knowledge.static?.map((s: any) => s.intent.toLowerCase()) ?? [];
    const cafeIntents = ['menu_query', 'order_placement', 'operating_hours'];
    for (const intent of cafeIntents) {
      expect(intents).not.toContain(intent);
    }
  });
});

describe('data-southern — routing.json business alignment', () => {
  const routing = readDataFile('data-southern', 'routing.json');

  it('should have routing entries', () => {
    expect(Object.keys(routing).length).toBeGreaterThan(0);
  });

  it('should have homestay-specific routing', () => {
    const routes = Object.keys(routing);
    expect(routes.some(r => r.includes('checkin') || r.includes('checkout') || r.includes('booking'))).toBe(true);
  });

  it('should not route to cafe-specific workflows', () => {
    const routesStr = Object.keys(routing).join('|').toLowerCase();
    expect(routesStr).not.toContain('menu');
    expect(routesStr).not.toContain('order');
    expect(routesStr).not.toContain('allergen');
  });
});

// ─── Intent-Keywords Validation ──────────────────────────────────────────────

describe('data-makan — intent-keywords.json cafe alignment', () => {
  const keywords = readDataFile('data-makan', 'intent-keywords.json');

  it('should have intents array', () => {
    expect(Array.isArray(keywords.intents)).toBe(true);
    expect(keywords.intents.length).toBeGreaterThan(0);
  });

  it('should not have hostel-specific intents', () => {
    const intents = keywords.intents?.map((i: any) => i.intent.toLowerCase()) ?? [];
    const hostelIntents = ['checkin_info', 'room_booking', 'capsule_facilities'];
    for (const intent of hostelIntents) {
      expect(intents).not.toContain(intent);
    }
  });
});

describe('data-southern — intent-keywords.json homestay alignment', () => {
  const keywords = readDataFile('data-southern', 'intent-keywords.json');

  it('should have intents array', () => {
    expect(Array.isArray(keywords.intents)).toBe(true);
    expect(keywords.intents.length).toBeGreaterThan(0);
  });

  it('should not have cafe-specific intents', () => {
    const intents = keywords.intents?.map((i: any) => i.intent.toLowerCase()) ?? [];
    const cafeIntents = ['menu_query', 'order_placement', 'allergen_query'];
    for (const intent of cafeIntents) {
      expect(intents).not.toContain(intent);
    }
  });
});

// ─── Settings Validation ───────────────────────────────────────────────────

describe('data-makan — settings.json cafe configuration', () => {
  const settings = readDataFile('data-makan', 'settings.json');

  it('should have settings object', () => {
    expect(settings).toBeDefined();
    expect(typeof settings === 'object').toBe(true);
  });

  it('should not contain hostel-specific settings', () => {
    const settingsStr = JSON.stringify(settings).toLowerCase();
    // Should not mention capsule facilities or hostel services
    expect(settingsStr).not.toContain('capsule_facilities');
  });
});

describe('data-southern — settings.json homestay configuration', () => {
  const settings = readDataFile('data-southern', 'settings.json');

  it('should have settings object', () => {
    expect(settings).toBeDefined();
    expect(typeof settings === 'object').toBe(true);
  });

  it('should not contain cafe-specific settings', () => {
    const settingsStr = JSON.stringify(settings).toLowerCase();
    // Should not mention menu or ordering
    expect(settingsStr).not.toContain('menu_');
    expect(settingsStr).not.toContain('order_');
  });
});
