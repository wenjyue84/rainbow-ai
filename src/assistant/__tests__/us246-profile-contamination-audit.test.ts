/**
 * US-246: Audit Makan Moments profile data files for Pelangi Capsule keyword
 * contamination with fix suggestions.
 *
 * Scans src/assistant/data-makan/ (knowledge.json, routing.json, intent-keywords.json)
 * for hostel-specific keywords (room, guest, check-in, checkout, booking confirmation)
 * that indicate cross-profile contamination. Generates CSV report with filename,
 * line_number, contaminated_term, suggested_replacement.
 *
 * Also validates Southern Homestay profile is free of Pelangi-exclusive
 * hostel keywords that belong only to the Pelangi Capsule profile.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ─── Constants ───────────────────────────────────────────────────────────────

const currentDir = fileURLToPath(new URL('.', import.meta.url));
const DATA_ROOT = resolve(currentDir, '..', 'assistant');

const DATA_MAKAN = join(DATA_ROOT, 'data-makan');
const DATA_SOUTHERN = join(DATA_ROOT, 'data-southern');

/**
 * Hostel-specific keywords that must NOT appear in Makan Moments (cafe) profile.
 * These indicate Pelangi Capsule Hostel contamination in the cafe data.
 *
 * Each entry: { term, replacement } where replacement is a cafe-appropriate alternative.
 */
const HOSTEL_KEYWORDS: Array<{ term: string; replacement: string }> = [
  { term: 'room', replacement: 'table' },
  { term: 'guest', replacement: 'customer' },
  { term: 'check-in', replacement: 'visit' },
  { term: 'checkin', replacement: 'visit' },
  { term: 'check in', replacement: 'visit' },
  { term: 'checkout', replacement: 'payment' },
  { term: 'check-out', replacement: 'payment' },
  { term: 'check out', replacement: 'payment' },
  { term: 'booking confirmation', replacement: 'order confirmation' },
  { term: 'booking', replacement: 'reservation' },
  { term: 'capsule', replacement: 'cafe' },
  { term: 'hostel', replacement: 'cafe' },
  { term: 'dorm', replacement: 'cafe' },
  { term: 'dormitory', replacement: 'cafe' },
  { term: 'pelangi', replacement: 'makan moments' },
  { term: 'accommodation', replacement: 'dining' },
  { term: 'staying', replacement: 'dining' },
  { term: 'bed', replacement: 'seat' },
  { term: 'deck', replacement: 'counter' },
  { term: 'lower deck', replacement: 'counter' },
  { term: 'key card', replacement: 'loyalty card' },
  { term: 'door password', replacement: 'wifi password' },
  { term: 'room availability', replacement: 'table availability' },
  { term: 'arrival', replacement: 'visit' },
  { term: 'departure', replacement: 'farewell' },
  { term: 'capsule pod', replacement: 'dining area' },
];

/**
 * Pelangi-exclusive terms that should NOT appear in the Southern Homestay profile.
 * Southern Homestay is a separate accommodation property; these terms are
 * specific to the Pelangi Capsule Hostel.
 */
const PELANGI_EXCLUSIVE_TERMS = [
  'capsule',
  'pelangi',
  'dorm',
  'dormitory',
  'capsule pod',
  'lower deck',
  'upper deck',
  'hostel_booking',
] as const;

/** Files targeted for audit per the acceptance criteria */
const AUDIT_FILES = ['knowledge.json', 'routing.json', 'intent-keywords.json'];

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuditFinding {
  filename: string;
  line_number: number;
  contaminated_term: string;
  suggested_replacement: string;
}

// ─── Audit Engine ────────────────────────────────────────────────────────────

/**
 * Scan a single file for hostel keyword contamination.
 * Returns an array of findings with filename, line number, matched term,
 * and a cafe-appropriate replacement suggestion.
 */
function auditFileForHostelKeywords(
  dirPath: string,
  filename: string,
  keywords: Array<{ term: string; replacement: string }>,
): AuditFinding[] {
  const filePath = join(dirPath, filename);
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const findings: AuditFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    for (const kw of keywords) {
      if (lineLower.includes(kw.term.toLowerCase())) {
        findings.push({
          filename,
          line_number: i + 1,
          contaminated_term: kw.term,
          suggested_replacement: kw.replacement,
        });
      }
    }
  }

  return findings;
}

/**
 * Scan an entire profile directory for contamination against a given term list.
 * Returns findings across all audited files.
 */
function auditProfileForHostelKeywords(
  dirPath: string,
  keywords: Array<{ term: string; replacement: string }>,
): AuditFinding[] {
  if (!existsSync(dirPath)) return [];

  const allFindings: AuditFinding[] = [];

  for (const file of AUDIT_FILES) {
    const findings = auditFileForHostelKeywords(dirPath, file, keywords);
    allFindings.push(...findings);
  }

  return allFindings;
}

/**
 * Scan a directory for contamination by plain string terms (no replacement needed).
 * Used for Southern Homestay scanning against Pelangi-exclusive terms.
 */
function scanDirectoryForTerms(
  dirPath: string,
  terms: readonly string[],
): Array<{ file: string; term: string; line: number; content: string }> {
  if (!existsSync(dirPath)) return [];

  const files = readdirSync(dirPath).filter(
    (f) => f.endsWith('.json') || f.endsWith('.md'),
  );
  const matches: Array<{ file: string; term: string; line: number; content: string }> = [];

  for (const file of files) {
    const filePath = join(dirPath, file);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineLower = lines[i].toLowerCase();
      for (const term of terms) {
        if (lineLower.includes(term.toLowerCase())) {
          matches.push({
            file,
            term,
            line: i + 1,
            content: lines[i].trim().substring(0, 120),
          });
        }
      }
    }
  }

  return matches;
}

/**
 * Generate a CSV report string from audit findings.
 * Columns: filename, line_number, contaminated_term, suggested_replacement
 */
export function generateCsvReport(findings: AuditFinding[]): string {
  const header = 'filename,line_number,contaminated_term,suggested_replacement';
  const rows = findings.map((f) => {
    const escapedTerm = f.contaminated_term.replace(/"/g, '""');
    const escapedReplacement = f.suggested_replacement.replace(/"/g, '""');
    return `"${f.filename}",${f.line_number},"${escapedTerm}","${escapedReplacement}"`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Format contamination matches into a readable error message for test output.
 */
function formatContaminationReport(
  profileName: string,
  findings: AuditFinding[],
): string {
  if (findings.length === 0) return '';

  const lines = [
    '',
    `=== HOSTEL KEYWORD CONTAMINATION in ${profileName} ===`,
    `Found ${findings.length} contaminated occurrence(s):`,
    '',
    'CSV Report:',
    generateCsvReport(findings),
    '',
    'Remediation: Replace hostel terms with the suggested cafe-appropriate alternatives.',
  ];

  return lines.join('\n');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('US-246: Audit Makan Moments profile for Pelangi Capsule keyword contamination', () => {
  // ── AC1 + AC2: Makan Moments hostel keyword audit ──────────────────────

  describe('Makan Moments knowledge.json must not contain hostel keywords', () => {
    const findings = auditFileForHostelKeywords(
      DATA_MAKAN,
      'knowledge.json',
      HOSTEL_KEYWORDS,
    );

    it('should have zero hostel keyword contaminations in knowledge.json', () => {
      expect(
        findings,
        formatContaminationReport('data-makan/knowledge.json', findings),
      ).toHaveLength(0);
    });
  });

  describe('Makan Moments routing.json must not contain hostel keywords', () => {
    const findings = auditFileForHostelKeywords(
      DATA_MAKAN,
      'routing.json',
      HOSTEL_KEYWORDS,
    );

    it('should have zero hostel keyword contaminations in routing.json', () => {
      expect(
        findings,
        formatContaminationReport('data-makan/routing.json', findings),
      ).toHaveLength(0);
    });
  });

  describe('Makan Moments intent-keywords.json must not contain hostel keywords', () => {
    const findings = auditFileForHostelKeywords(
      DATA_MAKAN,
      'intent-keywords.json',
      HOSTEL_KEYWORDS,
    );

    it('should have zero hostel keyword contaminations in intent-keywords.json', () => {
      expect(
        findings,
        formatContaminationReport('data-makan/intent-keywords.json', findings),
      ).toHaveLength(0);
    });
  });

  describe('Full Makan Moments profile audit', () => {
    const allFindings = auditProfileForHostelKeywords(DATA_MAKAN, HOSTEL_KEYWORDS);

    it('should produce zero findings across all three audited files', () => {
      expect(
        allFindings,
        formatContaminationReport('data-makan (full audit)', allFindings),
      ).toHaveLength(0);
    });

    it('should generate a valid CSV report (even if empty)', () => {
      const csv = generateCsvReport(allFindings);
      expect(csv).toContain('filename,line_number,contaminated_term,suggested_replacement');
    });
  });

  // ── AC3: Southern Homestay must not contain Pelangi-exclusive terms ────

  describe('Southern Homestay must not contain Pelangi-exclusive terms', () => {
    const matches = scanDirectoryForTerms(DATA_SOUTHERN, PELANGI_EXCLUSIVE_TERMS);

    it('should not contain "capsule" in any Southern Homestay data file', () => {
      const capsuleHits = matches.filter((m) => m.term === 'capsule');
      expect(capsuleHits).toHaveLength(0);
    });

    it('should not contain "pelangi" in any Southern Homestay data file', () => {
      const pelangiHits = matches.filter((m) => m.term === 'pelangi');
      expect(pelangiHits).toHaveLength(0);
    });

    it('should not contain "dorm" or "dormitory" in any Southern Homestay data file', () => {
      const dormHits = matches.filter(
        (m) => m.term === 'dorm' || m.term === 'dormitory',
      );
      expect(dormHits).toHaveLength(0);
    });

    it('should have zero Pelangi-exclusive terms across all data files', () => {
      expect(
        matches.length,
        `Found ${matches.length} Pelangi-exclusive term(s) in Southern Homestay:\n` +
          matches
            .map((m) => `  ${m.file}:L${m.line} - "${m.term}" -> ${m.content}`)
            .join('\n'),
      ).toBe(0);
    });
  });

  // ── CSV report format validation ──────────────────────────────────────

  describe('CSV report format', () => {
    it('should produce correct CSV header', () => {
      const csv = generateCsvReport([]);
      expect(csv).toBe('filename,line_number,contaminated_term,suggested_replacement');
    });

    it('should format findings as valid CSV rows', () => {
      const testFindings: AuditFinding[] = [
        {
          filename: 'knowledge.json',
          line_number: 42,
          contaminated_term: 'check-in',
          suggested_replacement: 'visit',
        },
        {
          filename: 'routing.json',
          line_number: 7,
          contaminated_term: 'room',
          suggested_replacement: 'table',
        },
      ];

      const csv = generateCsvReport(testFindings);
      const lines = csv.split('\n');

      expect(lines).toHaveLength(3); // header + 2 rows
      expect(lines[0]).toBe('filename,line_number,contaminated_term,suggested_replacement');
      expect(lines[1]).toBe('"knowledge.json",42,"check-in","visit"');
      expect(lines[2]).toBe('"routing.json",7,"room","table"');
    });

    it('should escape double quotes in CSV output', () => {
      const testFindings: AuditFinding[] = [
        {
          filename: 'test.json',
          line_number: 1,
          contaminated_term: 'term with "quotes"',
          suggested_replacement: 'replacement with "quotes"',
        },
      ];

      const csv = generateCsvReport(testFindings);
      expect(csv).toContain('""quotes""');
    });
  });
});
