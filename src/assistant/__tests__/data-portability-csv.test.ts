/**
 * US-894: PDPA 2024 Phase 3 — CSV data portability export tests
 *
 * Verifies:
 * - CSV output is RFC 4180 compliant with BOM for Excel
 * - All required fields are present: timestamp, direction, content, intent, sentiment
 * - Formula-injection characters are sanitized
 * - Empty/null fields are handled gracefully
 */
import { describe, test, expect } from 'vitest';
import { buildMessageCsv, sanitizeCsvField } from '../../routes/admin/gdpr-data-export.js';

const SAMPLE_MESSAGES = [
  {
    timestamp: new Date('2026-01-15T10:30:00Z'),
    role: 'user',
    content: 'Hello, I want to check in',
    intent: 'checkin_inquiry',
  },
  {
    timestamp: new Date('2026-01-15T10:30:05Z'),
    role: 'assistant',
    content: 'Welcome! Let me help you with check-in. What is your booking reference?',
    intent: 'checkin_response',
  },
  {
    timestamp: new Date('2026-01-15T10:31:00Z'),
    role: 'user',
    content: 'My booking ref is ABC123',
    intent: null,
  },
];

describe('CSV Data Export (US-894)', () => {
  test('CSV starts with UTF-8 BOM for Excel compatibility', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  test('CSV has correct header row with all 5 required fields', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    // Strip BOM, get first line
    const firstLine = csv.substring(1).split('\r\n')[0];
    expect(firstLine).toBe('timestamp,direction,content,intent,sentiment');
  });

  test('CSV uses CRLF line endings (RFC 4180)', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    const withoutBom = csv.substring(1);
    // Every line break should be \r\n
    const lines = withoutBom.split('\r\n');
    // header + 3 data rows + trailing empty (from final \r\n)
    expect(lines.length).toBe(5);
    expect(lines[4]).toBe(''); // trailing CRLF produces empty last element
  });

  test('CSV maps role to direction correctly', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    const lines = csv.substring(1).split('\r\n');
    // First data row: user -> inbound
    expect(lines[1]).toContain('inbound');
    // Second data row: assistant -> outbound
    expect(lines[2]).toContain('outbound');
  });

  test('100% field coverage — all 5 columns present in every row', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    const header = lines[0]!;
    const expectedColumns = header!.split(',').length;
    expect(expectedColumns).toBe(5);

    for (let i = 1; i < lines.length; i++) {
      // Parse considering quoted fields with commas
      const fields = parseCsvLine(lines[i]!);
      expect(fields.length).toBe(expectedColumns);
    }
  });

  test('null intent is exported as empty string, not "null"', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2026-01-15T10:31:00Z'), role: 'user', content: 'test', intent: null },
    ]);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    const fields = parseCsvLine(lines[1]!);
    // intent is index 3
    expect(fields[3]).toBe('');
    expect(fields[3]).not.toBe('null');
  });

  test('sentiment column is present (empty — not stored per-message)', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]!);
      // sentiment is the last field (index 4)
      expect(fields[4]).toBeDefined();
    }
  });

  test('fields containing commas are properly quoted', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2026-01-15T10:31:00Z'), role: 'user', content: 'Hello, world', intent: null },
    ]);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    // content field should be quoted because it has a comma
    expect(lines[1]).toContain('"Hello, world"');
  });

  test('fields containing double quotes are escaped with double-double quotes', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2026-01-15T10:31:00Z'), role: 'user', content: 'He said "hello"', intent: null },
    ]);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    expect(lines[1]).toContain('"He said ""hello"""');
  });

  test('empty message array produces header-only CSV', () => {
    const csv = buildMessageCsv([]);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    expect(lines.length).toBe(1); // header only
    expect(lines[0]).toBe('timestamp,direction,content,intent,sentiment');
  });

  test('timestamps are in ISO 8601 format', () => {
    const csv = buildMessageCsv(SAMPLE_MESSAGES);
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    const fields = parseCsvLine(lines[1]!);
    const ts = fields[0]!;
    // Should be valid ISO date
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

describe('Formula Injection Sanitization (US-894)', () => {
  test.each([
    ['=cmd()', "'=cmd()"],
    ['+cmd()', "'+cmd()"],
    ['-cmd()', "'-cmd()"],
    ['@SUM(A1:A10)', "'@SUM(A1:A10)"],
    ['\tcmd', "'\tcmd"],
    ['\rcmd', "'\rcmd"],
  ])('sanitizeCsvField(%j) → %j', (input, expected) => {
    expect(sanitizeCsvField(input)).toBe(expected);
  });

  test('safe strings are not modified', () => {
    expect(sanitizeCsvField('Hello world')).toBe('Hello world');
    expect(sanitizeCsvField('123.45')).toBe('123.45');
    expect(sanitizeCsvField('normal text')).toBe('normal text');
  });

  test('null and undefined become empty string', () => {
    expect(sanitizeCsvField(null)).toBe('');
    expect(sanitizeCsvField(undefined)).toBe('');
  });

  test('formula-injection characters are sanitized in full CSV output', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2026-01-15T10:00:00Z'), role: 'user', content: '=HYPERLINK("evil.com")', intent: null },
      { timestamp: new Date('2026-01-15T10:01:00Z'), role: 'user', content: '+cmd|/C calc', intent: null },
      { timestamp: new Date('2026-01-15T10:02:00Z'), role: 'user', content: '-1+1', intent: null },
      { timestamp: new Date('2026-01-15T10:03:00Z'), role: 'user', content: '@SUM(A1)', intent: null },
    ]);

    // None of the data lines should start a field with =, +, -, or @
    const lines = csv.substring(1).split('\r\n').filter(l => l.length > 0);
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]!);
      for (const field of fields) {
        if (field.length > 0) {
          expect(field[0]).not.toMatch(/^[=+\-@]/);
        }
      }
    }
  });
});

// ─── CSV Line Parser (handles quoted fields) ────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}
