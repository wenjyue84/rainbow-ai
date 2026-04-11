/**
 * Tests for Profile Data File Integrity Checker (US-465)
 *
 * Tests corruption detection: invalid JSON syntax, schema violations,
 * cross-profile keyword contamination, and unknown workflow references.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProfileIntegrityChecker } from '../src/tools/profile-integrity-checker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'profile-integrity');

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function setupFixtureDir(profileId: string): string {
  const dir = path.join(FIXTURE_DIR, profileId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFixture(dir: string, filename: string, content: string) {
  fs.writeFileSync(path.join(dir, filename), content, 'utf8');
}

function cleanupFixtureDir(profileId: string) {
  const dir = path.join(FIXTURE_DIR, profileId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Valid JSON fixtures ──────────────────────────────────────────────────────

const VALID_ROUTING = JSON.stringify({
  greeting: { action: 'static_reply' },
  pricing: { action: 'static_reply' },
  booking: { action: 'workflow', workflow_id: 'booking_flow' },
}, null, 2);

const VALID_WORKFLOWS = JSON.stringify({
  workflows: [
    {
      id: 'booking_flow',
      steps: [
        {
          id: 'step1',
          message: { en: 'Hello', ms: 'Halo', zh: '你好' },
          waitForReply: false,
        },
      ],
    },
  ],
}, null, 2);

const VALID_KNOWLEDGE = JSON.stringify({
  static: [
    {
      intent: 'greeting',
      response: { en: 'Hello!', ms: 'Halo!', zh: '你好！' },
    },
  ],
  dynamic: {},
}, null, 2);

const VALID_INTENT_KEYWORDS = JSON.stringify({
  intents: [
    {
      intent: 'greeting',
      keywords: { en: ['hi', 'hello'], ms: ['helo', 'hai'], zh: ['你好'] },
    },
  ],
}, null, 2);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProfileIntegrityChecker — syntax error detection', () => {
  const PROFILE_ID = 'test-syntax-clean';

  beforeEach(() => {
    const dir = setupFixtureDir(PROFILE_ID);
    writeFixture(dir, 'routing.json', VALID_ROUTING);
    writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
  });

  afterEach(() => cleanupFixtureDir(PROFILE_ID));

  it('should pass when all files have valid JSON', () => {
    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    // Override profileDir to use fixture
    (checker as unknown as { profileDir: string }).profileDir = path.join(FIXTURE_DIR, PROFILE_ID);
    const report = checker.check();
    expect(report.passed).toBe(true);
    expect(report.criticalCount).toBe(0);
  });

  it('should return IntegrityReport with correct structure', () => {
    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    (checker as unknown as { profileDir: string }).profileDir = path.join(FIXTURE_DIR, PROFILE_ID);
    const report = checker.check();
    expect(report).toHaveProperty('profile');
    expect(report).toHaveProperty('profileDir');
    expect(report).toHaveProperty('timestamp');
    expect(report).toHaveProperty('filesChecked');
    expect(report).toHaveProperty('issues');
    expect(report).toHaveProperty('criticalCount');
    expect(report).toHaveProperty('warningCount');
    expect(report).toHaveProperty('passed');
  });
});

describe('ProfileIntegrityChecker — test_detects_syntax_errors', () => {
  const PROFILE_ID = 'test-syntax-errors';

  beforeEach(() => {
    const dir = setupFixtureDir(PROFILE_ID);
    writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
  });

  afterEach(() => cleanupFixtureDir(PROFILE_ID));

  it('test_detects_syntax_errors: detects invalid JSON (missing closing brace)', () => {
    const dir = path.join(FIXTURE_DIR, PROFILE_ID);
    writeFixture(dir, 'routing.json', '{ "greeting": { "action": "static_reply" '); // malformed

    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    expect(report.passed).toBe(false);
    const syntaxIssues = report.issues.filter(i => i.errorType === 'invalid_json');
    expect(syntaxIssues.length).toBeGreaterThan(0);
    expect(syntaxIssues[0].severity).toBe('critical');
    expect(syntaxIssues[0].file).toContain('routing.json');
  });

  it('test_detects_syntax_errors: detects trailing comma in JSON', () => {
    const dir = path.join(FIXTURE_DIR, PROFILE_ID);
    writeFixture(dir, 'routing.json', '{ "greeting": { "action": "static_reply" }, }');

    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    expect(report.passed).toBe(false);
    const syntaxIssues = report.issues.filter(i => i.errorType === 'invalid_json');
    expect(syntaxIssues.length).toBeGreaterThan(0);
    expect(syntaxIssues[0].severity).toBe('critical');
  });

  it('test_detects_syntax_errors: includes line number in report when available', () => {
    const dir = path.join(FIXTURE_DIR, PROFILE_ID);
    // Multi-line JSON with syntax error on line 3
    writeFixture(dir, 'routing.json', '{\n  "greeting": {\n    "action": "static_reply",\n  },\n}');

    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const syntaxIssues = report.issues.filter(i => i.errorType === 'invalid_json');
    expect(syntaxIssues.length).toBeGreaterThan(0);
    // Line number should be provided when detectable
    expect(syntaxIssues[0]).toHaveProperty('message');
    expect(syntaxIssues[0].message).toContain('JSON parse error');
  });

  it('test_detects_syntax_errors: detects git conflict markers as critical error', () => {
    const dir = path.join(FIXTURE_DIR, PROFILE_ID);
    const conflictContent = `{
<<<<<<< HEAD
  "greeting": { "action": "static_reply" }
=======
  "greeting": { "action": "llm_reply" }
>>>>>>> feature/update
}`;
    writeFixture(dir, 'routing.json', conflictContent);

    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    expect(report.passed).toBe(false);
    const conflictIssues = report.issues.filter(i => i.errorType === 'git_conflict_marker');
    expect(conflictIssues.length).toBeGreaterThan(0);
    expect(conflictIssues[0].severity).toBe('critical');
    expect(conflictIssues[0].line).toBeGreaterThan(0);
  });

  it('test_detects_syntax_errors: passes for valid JSON', () => {
    const dir = path.join(FIXTURE_DIR, PROFILE_ID);
    writeFixture(dir, 'routing.json', VALID_ROUTING);

    const checker = new ProfileIntegrityChecker(PROFILE_ID);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const syntaxIssues = report.issues.filter(i => i.errorType === 'invalid_json');
    expect(syntaxIssues.length).toBe(0);
  });
});

describe('ProfileIntegrityChecker — test_detects_cross_profile_keywords', () => {
  const PROFILE_ID = 'data-makan';
  const FIXTURE_PROFILE = 'test-cross-profile-makan';

  beforeEach(() => {
    const dir = setupFixtureDir(FIXTURE_PROFILE);
    writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
  });

  afterEach(() => cleanupFixtureDir(FIXTURE_PROFILE));

  it('test_detects_cross_profile_keywords: detects Pelangi capsule terms in data-makan routing.json', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    const contamRoutingJson = JSON.stringify({
      greeting: { action: 'static_reply' },
      capsule_conflict: { action: 'workflow', workflow_id: 'some_flow' }, // Pelangi-specific!
    }, null, 2);
    writeFixture(dir, 'routing.json', contamRoutingJson);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);

    // Use data-makan profile ID so cross-profile check runs
    const checker = new ProfileIntegrityChecker('data-makan');
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    expect(report.passed).toBe(false);
    const contamIssues = report.issues.filter(i => i.errorType === 'cross_profile_contamination');
    expect(contamIssues.length).toBeGreaterThan(0);
    expect(contamIssues[0].severity).toBe('critical');
    expect(contamIssues[0].message).toContain('capsule_conflict');
  });

  it('test_detects_cross_profile_keywords: detects Pelangi hostel term in knowledge.json', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    const contamKnowledge = JSON.stringify({
      static: [
        {
          intent: 'welcome',
          response: { en: 'Welcome to Pelangi capsule hostel!', ms: 'Selamat datang', zh: '欢迎' },
        },
      ],
      dynamic: {},
    }, null, 2);
    writeFixture(dir, 'routing.json', VALID_ROUTING);
    writeFixture(dir, 'knowledge.json', contamKnowledge);
    writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);

    const checker = new ProfileIntegrityChecker('data-makan');
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    expect(report.passed).toBe(false);
    const contamIssues = report.issues.filter(i => i.errorType === 'cross_profile_contamination');
    expect(contamIssues.length).toBeGreaterThan(0);
    // Should mention 'capsule' or 'pelangi'
    const messages = contamIssues.map(i => i.message.toLowerCase()).join(' ');
    expect(messages).toMatch(/capsule|pelangi/);
  });

  it('test_detects_cross_profile_keywords: detects Pelangi intent in intent-keywords.json', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    const contamKeywords = JSON.stringify({
      intents: [
        { intent: 'greeting', keywords: { en: ['hi', 'hello'] } },
        { intent: 'card_locked', keywords: { en: ['card', 'locked'] } }, // Pelangi-specific!
      ],
    }, null, 2);
    writeFixture(dir, 'routing.json', VALID_ROUTING);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', contamKeywords);

    const checker = new ProfileIntegrityChecker('data-makan');
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    expect(report.passed).toBe(false);
    const contamIssues = report.issues.filter(i => i.errorType === 'cross_profile_contamination');
    expect(contamIssues.length).toBeGreaterThan(0);
    expect(contamIssues.some(i => i.message.includes('card_locked'))).toBe(true);
  });

  it('test_detects_cross_profile_keywords: passes clean data-makan profile with no Pelangi terms', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    const cleanKeywords = JSON.stringify({
      intents: [
        { intent: 'greeting', keywords: { en: ['hi', 'hello'] } },
        { intent: 'menu_query', keywords: { en: ['menu', 'show menu'] } },
      ],
    }, null, 2);
    writeFixture(dir, 'routing.json', VALID_ROUTING);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', cleanKeywords);

    const checker = new ProfileIntegrityChecker('data-makan');
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const contamIssues = report.issues.filter(i => i.errorType === 'cross_profile_contamination');
    expect(contamIssues.length).toBe(0);
  });
});

describe('ProfileIntegrityChecker — workflow reference validation', () => {
  const FIXTURE_PROFILE = 'test-workflow-refs';

  beforeEach(() => {
    const dir = setupFixtureDir(FIXTURE_PROFILE);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
  });

  afterEach(() => cleanupFixtureDir(FIXTURE_PROFILE));

  it('warns when routing.json references unknown workflow_id', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'workflows.json', VALID_WORKFLOWS); // has 'booking_flow'
    writeFixture(dir, 'routing.json', JSON.stringify({
      booking: { action: 'workflow', workflow_id: 'nonexistent_flow' }, // doesn't exist!
    }, null, 2));

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const refIssues = report.issues.filter(i => i.errorType === 'unknown_workflow_reference');
    expect(refIssues.length).toBeGreaterThan(0);
    expect(refIssues[0].severity).toBe('warning');
    expect(refIssues[0].message).toContain('nonexistent_flow');
  });

  it('passes when routing.json references workflow_id that exists in workflows.json', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'workflows.json', VALID_WORKFLOWS); // has 'booking_flow'
    writeFixture(dir, 'routing.json', VALID_ROUTING); // references 'booking_flow'

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const refIssues = report.issues.filter(i => i.errorType === 'unknown_workflow_reference');
    expect(refIssues.length).toBe(0);
  });
});

describe('ProfileIntegrityChecker — repair function', () => {
  const FIXTURE_PROFILE = 'test-repair';

  beforeEach(() => setupFixtureDir(FIXTURE_PROFILE));
  afterEach(() => cleanupFixtureDir(FIXTURE_PROFILE));

  it('repairs trailing commas in dry-run mode without writing', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    const originalContent = '{ "greeting": { "action": "static_reply" }, }';
    writeFixture(dir, 'routing.json', originalContent);

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const result = checker.repair(/* dryRun */ true);

    expect(result.repaired.some(r => r.includes('dry-run'))).toBe(true);
    // File should NOT be modified in dry-run mode
    const fileContent = fs.readFileSync(path.join(dir, 'routing.json'), 'utf8');
    expect(fileContent).toBe(originalContent);
  });

  it('repairs trailing commas and writes fixed content', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', '{ "greeting": { "action": "static_reply" }, }');

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const result = checker.repair(/* dryRun */ false);

    expect(result.repaired.some(r => r.includes('routing.json'))).toBe(true);

    // File should now be valid JSON
    const fileContent = fs.readFileSync(path.join(dir, 'routing.json'), 'utf8');
    expect(() => JSON.parse(fileContent)).not.toThrow();
  });

  it('refuses to repair git conflict markers', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', `{
<<<<<<< HEAD
  "greeting": { "action": "static_reply" }
=======
  "greeting": { "action": "llm_reply" }
>>>>>>> feature/update
}`);

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const result = checker.repair();

    expect(result.skipped.some(s => s.includes('conflict'))).toBe(true);
    expect(result.repaired.length).toBe(0);
  });

  it('skips files that are already valid JSON', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', VALID_ROUTING);

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const result = checker.repair();

    expect(result.skipped.some(s => s.includes('routing.json'))).toBe(true);
    expect(result.repaired.length).toBe(0);
  });
});

describe('ProfileIntegrityChecker — report structure', () => {
  const FIXTURE_PROFILE = 'test-report-structure';

  beforeEach(() => {
    const dir = setupFixtureDir(FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', VALID_ROUTING);
    writeFixture(dir, 'workflows.json', VALID_WORKFLOWS);
    writeFixture(dir, 'knowledge.json', VALID_KNOWLEDGE);
    writeFixture(dir, 'intent-keywords.json', VALID_INTENT_KEYWORDS);
  });

  afterEach(() => cleanupFixtureDir(FIXTURE_PROFILE));

  it('includes file path in each issue', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', '{ bad json }');

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const issues = report.issues.filter(i => i.errorType === 'invalid_json');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].file).toContain('routing.json');
  });

  it('issue includes severity field as critical or warning', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', '{ bad json }');

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    for (const issue of report.issues) {
      expect(['critical', 'warning']).toContain(issue.severity);
    }
  });

  it('issue includes error type field', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', '{ bad json }');

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    for (const issue of report.issues) {
      expect(issue).toHaveProperty('errorType');
      expect(issue).toHaveProperty('message');
    }
  });

  it('criticalCount and warningCount match issues array', () => {
    const dir = path.join(FIXTURE_DIR, FIXTURE_PROFILE);
    writeFixture(dir, 'routing.json', '{ bad json }');

    const checker = new ProfileIntegrityChecker(FIXTURE_PROFILE);
    (checker as unknown as { profileDir: string }).profileDir = dir;
    const report = checker.check();

    const actualCritical = report.issues.filter(i => i.severity === 'critical').length;
    const actualWarnings = report.issues.filter(i => i.severity === 'warning').length;
    expect(report.criticalCount).toBe(actualCritical);
    expect(report.warningCount).toBe(actualWarnings);
  });
});
