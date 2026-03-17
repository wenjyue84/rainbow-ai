/**
 * Unit tests for US-024: Tamil (ta) language intent patterns
 *
 * Verifies:
 * - greeting, thanks, wifi, pricing, directions intents in intents.json have Tamil script patterns
 * - Tamil script messages match the regex patterns (resolve without LLM)
 * - intent-keywords.json has Tamil (ta) keyword entries for T2 fuzzy matching
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'src', 'assistant', 'data');

const intentsData = JSON.parse(readFileSync(join(DATA_DIR, 'intents.json'), 'utf-8'));
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

// Helper: check if a pattern array contains any Tamil Unicode (U+0B80–U+0BFF)
function hasTamilPattern(patterns: string[]): boolean {
  return patterns.some(p => /[\u0B80-\u0BFF]/.test(p));
}

// Helper: find intent-keywords.json entry
function findKeywordEntry(intent: string) {
  const intents: Array<{ intent: string; keywords: Record<string, string[]> }> =
    keywordsData.intents ?? [];
  return intents.find(e => e.intent === intent) ?? null;
}

// ─── greeting intent — Tamil patterns ─────────────────────────────

describe('greeting intent — Tamil patterns', () => {
  const intent = findIntent('greeting');

  it('greeting intent exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('greeting patterns include Tamil script (U+0B80–U+0BFF)', () => {
    expect(hasTamilPattern(intent.patterns)).toBe(true);
  });

  const tamilGreetings = [
    { msg: 'வணக்கம்', desc: 'vanakkam (hello/greetings)' },
    { msg: 'நமஸ்கார', desc: 'namaskaram (respectful greeting)' },
    { msg: 'ஹலோ', desc: 'hello in Tamil script' },
  ];

  it.each(tamilGreetings)('pattern matches Tamil greeting "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── thanks intent — Tamil patterns ───────────────────────────────

describe('thanks intent — Tamil patterns', () => {
  const intent = findIntent('thanks');

  it('thanks intent exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('thanks patterns include Tamil script (U+0B80–U+0BFF)', () => {
    expect(hasTamilPattern(intent.patterns)).toBe(true);
  });

  const tamilThanks = [
    { msg: 'நன்றி', desc: 'nandri (thank you)' },
    { msg: 'மிக்க நன்றி', desc: 'mikka nandri (many thanks)' },
  ];

  it.each(tamilThanks)('pattern matches Tamil thanks "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── wifi intent — Tamil patterns ─────────────────────────────────

describe('wifi intent — Tamil patterns', () => {
  const intent = findIntent('wifi');

  it('wifi intent exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('wifi patterns include Tamil script (U+0B80–U+0BFF)', () => {
    expect(hasTamilPattern(intent.patterns)).toBe(true);
  });

  const tamilWifi = [
    { msg: 'வைஃபை', desc: 'wifi in Tamil script' },
    { msg: 'கடவுச்சொல்', desc: 'password in Tamil' },
  ];

  it.each(tamilWifi)('pattern matches Tamil wifi query "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── pricing intent — Tamil patterns ──────────────────────────────

describe('pricing intent — Tamil patterns', () => {
  const intent = findIntent('pricing');

  it('pricing intent exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('pricing patterns include Tamil script (U+0B80–U+0BFF)', () => {
    expect(hasTamilPattern(intent.patterns)).toBe(true);
  });

  const tamilPricing = [
    { msg: 'விலை', desc: 'vilai (price)' },
    { msg: 'எவ்வளவு', desc: 'evvalavu (how much)' },
  ];

  it.each(tamilPricing)('pattern matches Tamil pricing query "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── directions intent — Tamil patterns ───────────────────────────

describe('directions intent — Tamil patterns', () => {
  const intent = findIntent('directions');

  it('directions intent exists in intents.json', () => {
    expect(intent).not.toBeNull();
  });

  it('directions patterns include Tamil script (U+0B80–U+0BFF)', () => {
    expect(hasTamilPattern(intent.patterns)).toBe(true);
  });

  const tamilDirections = [
    { msg: 'முகவரி', desc: 'mugavari (address)' },
    { msg: 'எப்படி போவது', desc: 'eppadi pōvathu (how to go)' },
  ];

  it.each(tamilDirections)('pattern matches Tamil directions query "$msg" ($desc)', ({ msg }) => {
    expect(matchesIntent(msg, intent.patterns, intent.flags || 'i')).toBe(true);
  });
});

// ─── intent-keywords.json — Tamil (ta) keywords for T2 matching ───

describe('intent-keywords.json — Tamil (ta) keyword entries', () => {
  const targetIntents = ['greeting', 'thanks', 'wifi', 'pricing', 'directions'];

  it.each(targetIntents)('%s has Tamil (ta) keyword list', (intentName) => {
    const entry = findKeywordEntry(intentName);
    expect(entry).not.toBeNull();
    expect(entry?.keywords).toHaveProperty('ta');
    expect(Array.isArray(entry?.keywords.ta)).toBe(true);
    expect((entry?.keywords.ta as string[]).length).toBeGreaterThan(0);
  });

  it('greeting ta keywords include vanakkam (வணக்கம்)', () => {
    const entry = findKeywordEntry('greeting');
    expect(entry?.keywords.ta).toContain('வணக்கம்');
  });

  it('thanks ta keywords include nandri (நன்றி)', () => {
    const entry = findKeywordEntry('thanks');
    expect(entry?.keywords.ta).toContain('நன்றி');
  });

  it('wifi ta keywords include Tamil wifi word (வைஃபை)', () => {
    const entry = findKeywordEntry('wifi');
    expect(entry?.keywords.ta).toContain('வைஃபை');
  });

  it('pricing ta keywords include vilai (விலை)', () => {
    const entry = findKeywordEntry('pricing');
    expect(entry?.keywords.ta).toContain('விலை');
  });

  it('directions ta keywords include address (முகவரி)', () => {
    const entry = findKeywordEntry('directions');
    expect(entry?.keywords.ta).toContain('முகவரி');
  });
});
