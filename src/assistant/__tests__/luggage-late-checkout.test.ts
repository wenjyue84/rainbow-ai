/**
 * Unit tests for US-022: Luggage Storage and Late Checkout intent handlers
 *
 * Verifies:
 * - luggage_storage intent exists in intents.json (CHECKOUT_DEPARTURE phase)
 * - late_checkout_request intent exists in intents.json (CHECKOUT_DEPARTURE phase)
 * - routing.json maps both intents to 'static_reply' (no LLM cost)
 * - knowledge.json has policy entries for both intents
 * - intent-keywords.json has T2 fuzzy-match keywords for both intents
 * - Both intents resolve at T2 tier via keyword matching (no LLM needed)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'src', 'assistant', 'data');

const intentsData = JSON.parse(readFileSync(join(DATA_DIR, 'intents.json'), 'utf-8'));
const routingData = JSON.parse(readFileSync(join(DATA_DIR, 'routing.json'), 'utf-8'));
const knowledgeData = JSON.parse(readFileSync(join(DATA_DIR, 'knowledge.json'), 'utf-8'));
const keywordsData = JSON.parse(readFileSync(join(DATA_DIR, 'intent-keywords.json'), 'utf-8'));

// Helper: find intent definition across all phases
function findIntent(category: string) {
  for (const cat of intentsData.categories) {
    const found = cat.intents.find((i: { category: string }) => i.category === category);
    if (found) return { ...found, phase: cat.phase };
  }
  return null;
}

// Helper: test if a message matches any intent pattern
function matchesIntent(message: string, patterns: string[], flags: string): boolean {
  return patterns.some(p => new RegExp(p, flags).test(message));
}

// Helper: find knowledge.json static entry
function findKnowledgeEntry(intent: string) {
  const statics: Array<{ intent: string; response: { en: string; ms: string; zh: string } }> =
    knowledgeData.static ?? [];
  return statics.find(e => e.intent === intent) ?? null;
}

// Helper: find intent-keywords.json entry
function findKeywordEntry(intent: string) {
  const intents: Array<{ intent: string; keywords: { en: string[]; ms: string[]; zh: string[] } }> =
    keywordsData.intents ?? [];
  return intents.find(e => e.intent === intent) ?? null;
}

// ─── luggage_storage intent ────────────────────────────────────────

describe('luggage_storage intent — intents.json', () => {
  const intent = findIntent('luggage_storage');

  it('exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('is in CHECKOUT_DEPARTURE phase', () => {
    expect(intent?.phase).toBe('CHECKOUT_DEPARTURE');
  });

  it('has enabled: true', () => {
    expect(intent?.enabled).toBe(true);
  });

  const luggageMessages = [
    { msg: 'luggage storage', desc: 'EN: luggage storage' },
    { msg: 'keep bag', desc: 'EN: keep bag' },
    { msg: 'keep luggage', desc: 'EN: keep luggage' },
    { msg: 'store suitcase', desc: 'EN: store suitcase' },
    { msg: 'simpan beg', desc: 'MS: simpan beg' },
    { msg: '寄存', desc: 'ZH: 寄存' },
    { msg: '行李', desc: 'ZH: 行李' },
    { msg: '存包', desc: 'ZH: 存包' },
  ];

  it.each(luggageMessages)('pattern matches "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── late_checkout_request intent ─────────────────────────────────

describe('late_checkout_request intent — intents.json', () => {
  const intent = findIntent('late_checkout_request');

  it('exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('is in CHECKOUT_DEPARTURE phase', () => {
    expect(intent?.phase).toBe('CHECKOUT_DEPARTURE');
  });

  it('has enabled: true', () => {
    expect(intent?.enabled).toBe(true);
  });

  const lateCheckoutMessages = [
    { msg: 'late checkout', desc: 'EN: late checkout' },
    { msg: 'late check-out', desc: 'EN: late check-out' },
    { msg: 'late check out', desc: 'EN: late check out' },
    { msg: 'extend my stay', desc: 'EN: extend my stay' },
    { msg: 'stay longer', desc: 'EN: stay longer' },
    { msg: 'stay more', desc: 'EN: stay more' },
    { msg: 'lewat keluar', desc: 'MS: lewat keluar' },
    { msg: '延迟退房', desc: 'ZH: 延迟退房' },
    { msg: '晚点走', desc: 'ZH: 晚点走' },
    { msg: '延长', desc: 'ZH: 延长' },
  ];

  it.each(lateCheckoutMessages)('pattern matches "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── routing.json — static_reply (no LLM) ─────────────────────────

describe('luggage_storage routing — routing.json', () => {
  it('maps luggage_storage to static_reply action', () => {
    expect(routingData['luggage_storage']).toBeDefined();
    expect(routingData['luggage_storage'].action).toBe('static_reply');
  });
});

describe('late_checkout_request routing — routing.json', () => {
  it('maps late_checkout_request to static_reply action', () => {
    expect(routingData['late_checkout_request']).toBeDefined();
    expect(routingData['late_checkout_request'].action).toBe('static_reply');
  });
});

// ─── knowledge.json — policy entries ──────────────────────────────

describe('luggage_storage knowledge — knowledge.json', () => {
  const entry = findKnowledgeEntry('luggage_storage');

  it('exists in knowledge.json static entries', () => {
    expect(entry).not.toBeNull();
  });

  it('has English response', () => {
    expect(entry?.response?.en).toBeTruthy();
  });

  it('has Malay response', () => {
    expect(entry?.response?.ms).toBeTruthy();
  });

  it('has Chinese response', () => {
    expect(entry?.response?.zh).toBeTruthy();
  });

  it('English response mentions locker or storage', () => {
    const en = entry?.response?.en?.toLowerCase() ?? '';
    expect(en.includes('locker') || en.includes('storage') || en.includes('store')).toBe(true);
  });
});

describe('late_checkout_request knowledge — knowledge.json', () => {
  const entry = findKnowledgeEntry('late_checkout_request');

  it('exists in knowledge.json static entries', () => {
    expect(entry).not.toBeNull();
  });

  it('has English response', () => {
    expect(entry?.response?.en).toBeTruthy();
  });

  it('has Malay response', () => {
    expect(entry?.response?.ms).toBeTruthy();
  });

  it('has Chinese response', () => {
    expect(entry?.response?.zh).toBeTruthy();
  });

  it('English response mentions checkout time', () => {
    const en = entry?.response?.en?.toLowerCase() ?? '';
    expect(en.includes('check-out') || en.includes('checkout') || en.includes('12')).toBe(true);
  });
});

// ─── intent-keywords.json — T2 fuzzy match coverage ───────────────

describe('luggage_storage keywords — intent-keywords.json (T2 tier)', () => {
  const entry = findKeywordEntry('luggage_storage');

  it('exists in intent-keywords.json', () => {
    expect(entry).toBeDefined();
  });

  it('has English keywords including "luggage storage"', () => {
    const en: string[] = entry?.keywords?.en ?? [];
    expect(en.some(k => k.includes('luggage') || k.includes('bags') || k.includes('store'))).toBe(true);
  });

  it('has Malay keywords including "simpan beg"', () => {
    const ms: string[] = entry?.keywords?.ms ?? [];
    expect(ms).toContain('simpan beg');
  });

  it('has Chinese keywords including 行李寄存', () => {
    const zh: string[] = entry?.keywords?.zh ?? [];
    expect(zh.some(k => k.includes('行李') || k.includes('寄存') || k.includes('存包'))).toBe(true);
  });
});

describe('late_checkout_request keywords — intent-keywords.json (T2 tier)', () => {
  const entry = findKeywordEntry('late_checkout_request');

  it('exists in intent-keywords.json', () => {
    expect(entry).toBeDefined();
  });

  it('has English keywords including "late checkout"', () => {
    const en: string[] = entry?.keywords?.en ?? [];
    expect(en.some(k => k.includes('late checkout') || k.includes('late check out'))).toBe(true);
  });

  it('has Malay keywords', () => {
    const ms: string[] = entry?.keywords?.ms ?? [];
    expect(ms.length).toBeGreaterThan(0);
  });

  it('has Chinese keywords including 延迟退房', () => {
    const zh: string[] = entry?.keywords?.zh ?? [];
    expect(zh).toContain('延迟退房');
  });
});

// ─── T2 tier resolution — keywords present means no LLM needed ────

describe('T2 tier coverage — both intents resolve without LLM', () => {
  it('luggage_storage has keyword entry (T2 bypass)', () => {
    const entry = findKeywordEntry('luggage_storage');
    expect(entry).toBeDefined();
    expect(entry?.keywords?.en?.length).toBeGreaterThan(0);
  });

  it('late_checkout_request has keyword entry (T2 bypass)', () => {
    const entry = findKeywordEntry('late_checkout_request');
    expect(entry).toBeDefined();
    expect(entry?.keywords?.en?.length).toBeGreaterThan(0);
  });

  it('luggage_storage routes to static_reply (not llm_reply)', () => {
    expect(routingData['luggage_storage']?.action).not.toBe('llm_reply');
  });

  it('late_checkout_request routes to static_reply (not llm_reply)', () => {
    expect(routingData['late_checkout_request']?.action).not.toBe('llm_reply');
  });
});
