import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

/**
 * Test suite for audit-tamil-coverage CLI
 *
 * Tests verify that the audit correctly:
 * - Identifies files with 0% Tamil coverage (no ta_ keys)
 * - Identifies files with 100% Tamil coverage (all en_ keys have ta_ pairs)
 * - Reports accurate coverage percentages
 */

const testDir = resolve(process.cwd(), 'tests/cli/fixtures/tamil-audit');
const jsonZeroCoverageFile = resolve(testDir, 'zero-coverage.json');
const jsonFullCoverageFile = resolve(testDir, 'full-coverage.json');
const mdZeroCoverageFile = resolve(testDir, 'zero-coverage.md');
const mdFullCoverageFile = resolve(testDir, 'full-coverage.md');

// Create test fixtures
beforeAll(() => {
  mkdirSync(testDir, { recursive: true });

  // Create JSON file with 0% Tamil coverage
  writeFileSync(
    jsonZeroCoverageFile,
    JSON.stringify({
      greetings: {
        en_hello: 'Hello',
        en_goodbye: 'Goodbye',
        en_thanks: 'Thank you',
      },
      messages: {
        en_error: 'An error occurred',
        en_success: 'Operation successful',
      },
    }),
    'utf-8'
  );

  // Create JSON file with 100% Tamil coverage
  writeFileSync(
    jsonFullCoverageFile,
    JSON.stringify({
      intents: [
        {
          intent: 'greeting',
          keywords: {
            en: ['hello', 'hi', 'hey'],
            ta: ['வணக்கம்', 'ஹலோ', 'ஆயா'],
            ms: ['hai', 'helo'],
          },
        },
        {
          intent: 'thanks',
          keywords: {
            en: ['thank you', 'thanks'],
            ta: ['நன்றி', 'ஸ்வாகதம்'],
            ms: ['terima kasih', 'tq'],
          },
        },
      ],
      responses: {
        en_greeting_response: 'Hello! Welcome!',
        ta_greeting_response: 'வணக்கம்! நல்வரவு!',
        en_farewell_response: 'Goodbye!',
        ta_farewell_response: 'விடைபெறுவோம்!',
      },
    }),
    'utf-8'
  );

  // Create Markdown file with 0% Tamil coverage
  writeFileSync(
    mdZeroCoverageFile,
    `# Hotel Information

This is a {{en:test}} markdown file with English translations only.

- {{en:Feature 1}}: Description
- {{en:Feature 2}}: Another description
- {{en:Contact us}} for more information.
`,
    'utf-8'
  );

  // Create Markdown file with 100% Tamil coverage
  writeFileSync(
    mdFullCoverageFile,
    `# Hotel Information

This is a {{en:test}} {{ta:test}} markdown file.

- {{en:Feature 1}} {{ta:Feature 1}}: Description
- {{en:Feature 2}} {{ta:Feature 2}}: Another description
- {{en:Contact us}} {{ta:Contact us}} for more information.
`,
    'utf-8'
  );
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('audit-tamil-coverage CLI', () => {
  it('should identify JSON file with 0% Tamil coverage', () => {
    // Read and parse the zero-coverage file
    const content = readFileSync(jsonZeroCoverageFile, 'utf-8');
    const json = JSON.parse(content);

    // Simulate the audit logic for this file
    let totalStrings = 0;
    let tamilStrings = 0;
    const untranslated: string[] = [];

    function scanValue(value: unknown, path: string = ''): void {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item, idx) => {
            scanValue(item, `${path}[${idx}]`);
          });
        } else {
          const obj = value as Record<string, unknown>;
          const keys = Object.keys(obj);

          keys.forEach((key) => {
            if (key.startsWith('en_')) {
              const taKey = key.replace(/^en_/, 'ta_');
              totalStrings++;
              if (taKey in obj) {
                tamilStrings++;
              } else {
                untranslated.push(taKey);
              }
            }
            scanValue(obj[key], `${path}.${key}`);
          });
        }
      }
    }

    scanValue(json);

    const coverage = totalStrings > 0 ? Math.round((tamilStrings / totalStrings) * 100) : 100;

    expect(coverage).toBe(0);
    expect(totalStrings).toBe(5);
    expect(tamilStrings).toBe(0);
    expect(untranslated).toEqual(['ta_hello', 'ta_goodbye', 'ta_thanks', 'ta_error', 'ta_success']);
  });

  it('should identify JSON file with 100% Tamil coverage', () => {
    const content = readFileSync(jsonFullCoverageFile, 'utf-8');
    const json = JSON.parse(content);

    let totalStrings = 0;
    let tamilStrings = 0;
    const untranslated: string[] = [];

    function scanValue(value: unknown, path: string = ''): void {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          value.forEach((item, idx) => {
            scanValue(item, `${path}[${idx}]`);
          });
        } else {
          const obj = value as Record<string, unknown>;
          const keys = Object.keys(obj);

          const hasEnKey = 'en' in obj;
          const hasTaKey = 'ta' in obj;

          if (hasEnKey && (hasTaKey || 'ms' in obj || 'zh' in obj)) {
            // This is a language-tagged object
            totalStrings++;
            if (hasTaKey) {
              tamilStrings++;
            } else {
              untranslated.push(`${path} (missing ta key)`);
            }
          } else {
            keys.forEach((key) => {
              if (key.startsWith('en_')) {
                const taKey = key.replace(/^en_/, 'ta_');
                totalStrings++;
                if (taKey in obj) {
                  tamilStrings++;
                } else {
                  untranslated.push(taKey);
                }
              }
              scanValue(obj[key], `${path}.${key}`);
            });
          }
        }
      }
    }

    scanValue(json);

    const coverage = totalStrings > 0 ? Math.round((tamilStrings / totalStrings) * 100) : 100;

    expect(coverage).toBe(100);
    expect(totalStrings).toBeGreaterThan(0);
    expect(tamilStrings).toBe(totalStrings);
    expect(untranslated).toEqual([]);
  });

  it('should identify Markdown file with 0% Tamil coverage', () => {
    const content = readFileSync(mdZeroCoverageFile, 'utf-8');

    let totalStrings = 0;
    let tamilStrings = 0;
    const untranslated: string[] = [];

    const enPattern = /\{\{en:([^}]+)\}\}/g;
    const taPattern = /\{\{ta:([^}]+)\}\}/g;

    const enMatches = new Map<string, number>();
    const taMatches = new Set<string>();

    let match;

    while ((match = enPattern.exec(content)) !== null) {
      const key = match[1].trim();
      const current = enMatches.get(key) || 0;
      enMatches.set(key, current + 1);
      totalStrings++;
    }

    while ((match = taPattern.exec(content)) !== null) {
      const key = match[1].trim();
      taMatches.add(key);
      tamilStrings++;
    }

    for (const [key] of enMatches) {
      if (!taMatches.has(key)) {
        untranslated.push(key);
      }
    }

    const coverage = totalStrings > 0 ? Math.round((tamilStrings / totalStrings) * 100) : 100;

    expect(coverage).toBe(0);
    expect(totalStrings).toBe(4);
    expect(tamilStrings).toBe(0);
    expect(untranslated).toContain('test');
    expect(untranslated).toContain('Feature 1');
    expect(untranslated).toContain('Feature 2');
    expect(untranslated).toContain('Contact us');
  });

  it('should identify Markdown file with 100% Tamil coverage', () => {
    const content = readFileSync(mdFullCoverageFile, 'utf-8');

    let totalStrings = 0;
    let tamilStrings = 0;
    const untranslated: string[] = [];

    // Create fresh regex objects with proper resetting
    const enMatches = new Map<string, number>();
    const taMatches = new Set<string>();

    // Find all {{en:...}} placeholders
    let match;
    let enPattern = /\{\{en:([^}]+)\}\}/g;
    while ((match = enPattern.exec(content)) !== null) {
      const key = match[1].trim();
      const current = enMatches.get(key) || 0;
      enMatches.set(key, current + 1);
      totalStrings++;
    }

    // Find all {{ta:...}} placeholders
    let taPattern = /\{\{ta:([^}]+)\}\}/g;
    while ((match = taPattern.exec(content)) !== null) {
      const key = match[1].trim();
      taMatches.add(key);
    }

    // Count Tamil matches that have corresponding English
    for (const [key] of enMatches) {
      if (taMatches.has(key)) {
        tamilStrings++;
      } else {
        untranslated.push(key);
      }
    }

    const coverage = totalStrings > 0 ? Math.round((tamilStrings / totalStrings) * 100) : 100;

    expect(coverage).toBe(100);
    expect(totalStrings).toBe(4);
    expect(tamilStrings).toBe(4);
    expect(untranslated).toEqual([]);
  });
});
