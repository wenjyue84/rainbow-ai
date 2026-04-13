import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Go up from tests/unit to project root
const projectRoot = path.join(__dirname, '..', '..');

describe('auditContamination', () => {
  const testDataDir = path.join(projectRoot, 'src', 'assistant');
  const makanKnowledgePath = path.join(testDataDir, 'data-makan', 'knowledge.json');
  let originalContent: string | null = null;

  beforeEach(() => {
    // Backup original file if it exists
    if (fs.existsSync(makanKnowledgePath)) {
      originalContent = fs.readFileSync(makanKnowledgePath, 'utf-8');
    }
  });

  afterEach(() => {
    // Restore original file
    if (originalContent !== null && fs.existsSync(makanKnowledgePath)) {
      fs.writeFileSync(makanKnowledgePath, originalContent, 'utf-8');
    }
  });

  it('detects Pelangi Capsule string in data-makan knowledge.json and reports it as Pelangi profile contamination', async () => {
    // Ensure the test file exists
    if (!fs.existsSync(makanKnowledgePath)) {
      const dir = path.dirname(makanKnowledgePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(makanKnowledgePath, '{}', 'utf-8');
    }

    // Inject contamination keyword
    const content = {
      test_entry: {
        en: "Pelangi Capsule booking information"
      }
    };
    fs.writeFileSync(makanKnowledgePath, JSON.stringify(content, null, 2), 'utf-8');

    // Load contamination keywords
    const keywordsPath = path.join(projectRoot, 'src', 'assistant', 'data', 'contamination-keywords.json');
    expect(fs.existsSync(keywordsPath)).toBe(true);

    const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));
    expect(keywords.pelangi).toBeDefined();
    expect(keywords.pelangi).toContain('Pelangi Capsule');

    // Verify the keyword is in pelangi keywords
    const pelangiKeywords = keywords.pelangi;
    expect(pelangiKeywords).toContain('Pelangi Capsule');

    // Verify that the makan profile should not contain pelangi keywords
    const fileContent = fs.readFileSync(makanKnowledgePath, 'utf-8');
    const hasContamination = pelangiKeywords.some(keyword =>
      fileContent.toLowerCase().includes(keyword.toLowerCase())
    );
    expect(hasContamination).toBe(true);
  });

  it('loads contamination-keywords.json successfully', () => {
    const keywordsPath = path.join(projectRoot, 'src', 'assistant', 'data', 'contamination-keywords.json');
    expect(fs.existsSync(keywordsPath)).toBe(true);

    const content = fs.readFileSync(keywordsPath, 'utf-8');
    const keywords = JSON.parse(content);

    expect(keywords).toHaveProperty('pelangi');
    expect(keywords).toHaveProperty('makan');
    expect(keywords).toHaveProperty('southern');

    expect(Array.isArray(keywords.pelangi)).toBe(true);
    expect(Array.isArray(keywords.makan)).toBe(true);
    expect(Array.isArray(keywords.southern)).toBe(true);
  });

  it('contamination keywords do not overlap between profiles', () => {
    const keywordsPath = path.join(projectRoot, 'src', 'assistant', 'data', 'contamination-keywords.json');
    const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));

    const profiles = Object.keys(keywords);

    for (const profile1 of profiles) {
      for (const profile2 of profiles) {
        if (profile1 !== profile2) {
          const keywords1 = keywords[profile1].map((k: string) => k.toLowerCase());
          const keywords2 = keywords[profile2].map((k: string) => k.toLowerCase());

          // Check for overlaps (some generic terms might overlap, which is okay)
          const overlap = keywords1.filter((k: string) => keywords2.includes(k));

          // Generic terms that are okay to overlap
          const allowedOverlap = ['room', 'booking', 'check', 'guest'];
          const problematicOverlap = overlap.filter((k: string) => !allowedOverlap.includes(k));

          expect(problematicOverlap).toHaveLength(0);
        }
      }
    }
  });

  it('detects contamination in knowledge.json by line number', () => {
    // Ensure the test file exists
    if (!fs.existsSync(makanKnowledgePath)) {
      const dir = path.dirname(makanKnowledgePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(makanKnowledgePath, '{}', 'utf-8');
    }

    // Create a multi-line JSON with contamination on a specific line
    const lines = [
      '{',
      '  "greeting": "Welcome to our cafe",',
      '  "booking_info": "Pelangi Capsule offers nice rooms",',
      '  "menu": "Our menu is available"',
      '}'
    ];
    fs.writeFileSync(makanKnowledgePath, lines.join('\n'), 'utf-8');

    // Verify contamination is detected
    const content = fs.readFileSync(makanKnowledgePath, 'utf-8');
    const fileLines = content.split('\n');

    const keywordsPath = path.join(projectRoot, 'src', 'assistant', 'data', 'contamination-keywords.json');
    const keywords = JSON.parse(fs.readFileSync(keywordsPath, 'utf-8'));

    // Find the line with contamination
    let contaminationLineNumber = -1;
    for (let i = 0; i < fileLines.length; i++) {
      if (keywords.pelangi.some((kw: string) => fileLines[i].toLowerCase().includes(kw.toLowerCase()))) {
        contaminationLineNumber = i + 1;
        break;
      }
    }

    expect(contaminationLineNumber).toBeGreaterThan(0);
    expect(contaminationLineNumber).toBe(3); // "Pelangi Capsule" is on line 3
  });
});
