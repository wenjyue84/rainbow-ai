/**
 * Vitest tests for PDPA 2024 Phase 3 — CSV data portability export (US-894)
 *
 * Verifies:
 * - CSV header and field order (timestamp, direction, content, intent, sentiment)
 * - RFC 4180 compliance (BOM, CRLF, double-quote wrapping, escaped quotes)
 * - Formula injection protection (=, +, -, @ at field start are neutralised)
 * - 100% field coverage (all rows parsed back correctly)
 * - direction mapping (user->inbound, assistant->outbound)
 * - Null/empty field handling
 */
import { describe, test, expect } from 'vitest';
import { sanitizeCsvField, buildMessageCsv } from '../../routes/admin/gdpr-data-export.js';

// ─── sanitizeCsvField ────────────────────────────────────────────────────────

describe('sanitizeCsvField', () => {
  test('wraps plain strings in double-quotes', () => {
    expect(sanitizeCsvField('hello')).toBe('"hello"');
  });

  test('escapes internal double-quotes per RFC 4180', () => {
    expect(sanitizeCsvField('say "hello" now')).toBe('"say ""hello"" now"');
  });

  test('returns empty double-quotes for null', () => {
    expect(sanitizeCsvField(null)).toBe('""');
  });

  test('returns empty double-quotes for undefined', () => {
    expect(sanitizeCsvField(undefined)).toBe('""');
  });

  test('converts Date to ISO string', () => {
    const d = new Date('2025-06-01T10:00:00.000Z');
    expect(sanitizeCsvField(d)).toBe('"2025-06-01T10:00:00.000Z"');
  });

  // Formula injection protection — OWASP CSV injection prevention
  test('prepends tab before leading = to neutralise formula', () => {
    const result = sanitizeCsvField('=SUM(A1:A10)');
    expect(result).toBe('"\t=SUM(A1:A10)"');
    expect(result).not.toMatch(/^"=/); // must not start with "=
  });

  test('prepends tab before leading + to neutralise formula', () => {
    const result = sanitizeCsvField('+malicious()');
    expect(result).toBe('"\t+malicious()"');
  });

  test('prepends tab before leading - to neutralise formula', () => {
    const result = sanitizeCsvField('-1+2');
    expect(result).toBe('"\t-1+2"');
  });

  test('prepends tab before leading @ to neutralise formula', () => {
    const result = sanitizeCsvField('@SUM()');
    expect(result).toBe('"\t@SUM()"');
  });

  test('does NOT modify fields that do not start with formula chars', () => {
    expect(sanitizeCsvField('Normal message')).toBe('"Normal message"');
    expect(sanitizeCsvField('1+2 = 3')).toBe('"1+2 = 3"'); // + not at start
    expect(sanitizeCsvField(' =not formula')).toBe('" =not formula"'); // space first
  });

  test('handles boolean', () => {
    expect(sanitizeCsvField(true)).toBe('"true"');
    expect(sanitizeCsvField(false)).toBe('"false"');
  });

  test('handles numbers', () => {
    expect(sanitizeCsvField(42)).toBe('"42"');
  });
});

// ─── buildMessageCsv ─────────────────────────────────────────────────────────

describe('buildMessageCsv', () => {
  const messages = [
    { timestamp: new Date('2025-06-01T08:00:00.000Z'), role: 'user', content: 'Hello', intent: 'greeting' },
    { timestamp: new Date('2025-06-01T08:00:05.000Z'), role: 'assistant', content: 'Hi there!', intent: 'greeting_response' },
    { timestamp: new Date('2025-06-01T08:01:00.000Z'), role: 'user', content: 'What is the price?', intent: 'price_inquiry' },
    { timestamp: new Date('2025-06-01T08:01:10.000Z'), role: 'assistant', content: 'Room rate is RM80/night', intent: null },
  ];

  test('starts with UTF-8 BOM for Excel compatibility', () => {
    const csv = buildMessageCsv(messages);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
  });

  test('has correct header row', () => {
    const csv = buildMessageCsv(messages);
    const lines = csv.split('\r\n');
    // First line after BOM removal
    const header = lines[0]!.replace('\uFEFF', '');
    expect(header).toBe('timestamp,direction,content,intent,sentiment');
  });

  test('uses CRLF line endings per RFC 4180', () => {
    const csv = buildMessageCsv(messages);
    // Remove BOM for testing
    const withoutBom = csv.replace('\uFEFF', '');
    // Should have CRLF separators
    const crlf = withoutBom.split('\r\n');
    expect(crlf.length).toBe(messages.length + 1); // header + data rows
  });

  test('maps user role to inbound direction', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2025-01-01T00:00:00.000Z'), role: 'user', content: 'test', intent: null },
    ]);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    const row = lines[1]!;
    const fields = parseRfc4180Row(row);
    expect(fields[1]).toBe('inbound');
  });

  test('maps assistant role to outbound direction', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2025-01-01T00:00:00.000Z'), role: 'assistant', content: 'test', intent: null },
    ]);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    const row = lines[1]!;
    const fields = parseRfc4180Row(row);
    expect(fields[1]).toBe('outbound');
  });

  test('100% field coverage — all 5 columns present and parseable', () => {
    const csv = buildMessageCsv(messages);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    // Skip header
    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row) continue;
      const fields = parseRfc4180Row(row);
      expect(fields).toHaveLength(5);
      const [ts, direction, content, intent, sentiment] = fields;
      expect(ts).toBeTruthy(); // timestamp must not be empty
      expect(['inbound', 'outbound']).toContain(direction);
      expect(content).toBeTruthy(); // content must not be empty
      // intent and sentiment may be empty
      expect(typeof intent).toBe('string');
      expect(typeof sentiment).toBe('string');
    }
  });

  test('handles null intent gracefully', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2025-01-01T00:00:00.000Z'), role: 'user', content: 'test', intent: null },
    ]);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    const fields = parseRfc4180Row(lines[1]!);
    expect(fields[3]).toBe(''); // intent is empty
  });

  test('formula injection protection in content field', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date('2025-01-01T00:00:00.000Z'), role: 'user', content: '=HYPERLINK("evil.com","click")', intent: null },
    ]);
    // Raw CSV should not contain unprotected leading =
    // The field should be wrapped in quotes and the = should be preceded by \t
    expect(csv).toContain('\t=HYPERLINK');
    // Should not appear as "=HYPERLINK (unguarded)
    const match = csv.match(/"=HYPERLINK/);
    expect(match).toBeNull();
  });

  test('empty message array returns only header', () => {
    const csv = buildMessageCsv([]);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('timestamp,direction,content,intent,sentiment');
  });

  test('quotes with internal double-quotes are properly escaped', () => {
    const csv = buildMessageCsv([
      { timestamp: new Date(), role: 'user', content: 'He said "hello" to me', intent: null },
    ]);
    expect(csv).toContain('He said ""hello"" to me');
  });

  test('correct row count matches message count', () => {
    const csv = buildMessageCsv(messages);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    // header + 4 messages
    expect(lines).toHaveLength(5);
  });
});

// ─── Helper: parse one RFC 4180 quoted CSV row into fields ───────────────────

function parseRfc4180Row(row: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === '"') {
      // Quoted field
      i++; // skip opening quote
      let field = '';
      while (i < row.length) {
        if (row[i] === '"' && row[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (row[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += row[i];
          i++;
        }
      }
      // Strip leading tab from formula-injection protection
      if (field.startsWith('\t')) field = field.substring(1);
      fields.push(field);
      if (row[i] === ',') i++; // skip comma
    } else {
      // Unquoted field (e.g. header)
      const end = row.indexOf(',', i);
      if (end === -1) {
        fields.push(row.substring(i));
        break;
      } else {
        fields.push(row.substring(i, end));
        i = end + 1;
      }
    }
  }
  return fields;
}
