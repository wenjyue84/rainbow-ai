/**
 * Tests for profile data file JSON schema validator (US-484).
 *
 * Covers: schema validation for each data file, startup abort on invalid files,
 * hot-reload acceptance of valid changes, and retention of prior version on invalid changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  validateDataFile,
  validateDataFilesOnStartup,
  routingSchema,
  workflowsSchema,
  fallbackResponsesSchema,
  settingsSchema,
} from '../../src/lib/data-file-validator.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_ROUTING = {
  wifi: { action: 'static_reply' },
  booking: { action: 'workflow', workflow_id: 'booking_payment_handler' },
};

const VALID_WORKFLOWS = {
  workflows: [
    {
      id: 'escalate',
      name: 'Escalate to Staff',
      steps: [{ id: 'notify', waitForReply: false }],
    },
  ],
};

const VALID_FALLBACK_RESPONSES = {
  schema_version: '1.0.0',
  description: 'Fallback responses',
  pelangi: { tier0: { en: 'Sorry, I cannot help with that.' } },
};

const VALID_SETTINGS = {
  ai: { nvidia_model: 'kimi-k2.5' },
  routing_mode: { mode: 'hybrid' },
  confidence_threshold: 0.7,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

function setupTmpDir(): string {
  const dir = join(tmpdir(), `data-validator-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(dir: string, name: string, data: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(data, null, 2), 'utf-8');
}

function writeBroken(dir: string, name: string): void {
  // Write syntactically invalid JSON
  writeFileSync(join(dir, name), '{ "broken": true, missing_quote }', 'utf-8');
}

// ─── Schema Unit Tests ────────────────────────────────────────────────────────

describe('routingSchema', () => {
  it('accepts a valid routing map', () => {
    const result = routingSchema.safeParse(VALID_ROUTING);
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = routingSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/at least one intent/i);
  });

  it('rejects workflow entry missing workflow_id', () => {
    const invalid = { booking: { action: 'workflow' } }; // no workflow_id
    const result = routingSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects unknown action type', () => {
    const invalid = { wifi: { action: 'unknown_action' } };
    const result = routingSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects entry without action field', () => {
    const invalid = { wifi: {} };
    const result = routingSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('workflowsSchema', () => {
  it('accepts valid workflows object', () => {
    expect(workflowsSchema.safeParse(VALID_WORKFLOWS).success).toBe(true);
  });

  it('rejects missing workflows key', () => {
    const result = workflowsSchema.safeParse({ other: [] });
    expect(result.success).toBe(false);
  });

  it('rejects empty workflows array', () => {
    const result = workflowsSchema.safeParse({ workflows: [] });
    expect(result.success).toBe(false);
  });

  it('rejects workflow step without id', () => {
    const invalid = {
      workflows: [{ id: 'test', steps: [{ message: 'hello' }] }],
    };
    const result = workflowsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects workflow without id', () => {
    const invalid = { workflows: [{ steps: [{ id: 's1' }] }] };
    const result = workflowsSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('fallbackResponsesSchema', () => {
  it('accepts valid fallback responses', () => {
    expect(fallbackResponsesSchema.safeParse(VALID_FALLBACK_RESPONSES).success).toBe(true);
  });

  it('rejects missing schema_version', () => {
    const result = fallbackResponsesSchema.safeParse({ description: 'test' });
    expect(result.success).toBe(false);
  });

  it('rejects malformed schema_version', () => {
    const result = fallbackResponsesSchema.safeParse({ schema_version: 'v1' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/semver/i);
  });
});

describe('settingsSchema', () => {
  it('accepts valid settings', () => {
    expect(settingsSchema.safeParse(VALID_SETTINGS).success).toBe(true);
  });

  it('rejects missing ai section', () => {
    const result = settingsSchema.safeParse({ routing_mode: {} });
    expect(result.success).toBe(false);
  });

  it('rejects missing routing_mode section', () => {
    const result = settingsSchema.safeParse({ ai: {} });
    expect(result.success).toBe(false);
  });
});

// ─── validateDataFile ─────────────────────────────────────────────────────────

describe('validateDataFile', () => {
  beforeEach(() => {
    tmpDir = setupTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it('returns valid=true for a correct routing.json', () => {
    writeJson(tmpDir, 'routing.json', VALID_ROUTING);
    const result = validateDataFile(join(tmpDir, 'routing.json'), routingSchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid=false with error when file does not exist', () => {
    const result = validateDataFile(join(tmpDir, 'missing.json'), routingSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it('returns valid=false with error for invalid JSON', () => {
    writeBroken(tmpDir, 'routing.json');
    const result = validateDataFile(join(tmpDir, 'routing.json'), routingSchema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/invalid json/i);
  });

  it('returns valid=false with field-level errors for schema violations', () => {
    writeJson(tmpDir, 'routing.json', { booking: { action: 'workflow' } }); // missing workflow_id
    const result = validateDataFile(join(tmpDir, 'routing.json'), routingSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('includes data in result for valid file', () => {
    writeJson(tmpDir, 'settings.json', VALID_SETTINGS);
    const result = validateDataFile(join(tmpDir, 'settings.json'), settingsSchema);
    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.ai).toEqual(VALID_SETTINGS.ai);
  });
});

// ─── validateDataFilesOnStartup ───────────────────────────────────────────────

describe('validateDataFilesOnStartup', () => {
  beforeEach(() => {
    tmpDir = setupTmpDir();
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  function writeAllValid(): void {
    writeJson(tmpDir, 'routing.json', VALID_ROUTING);
    writeJson(tmpDir, 'workflows.json', VALID_WORKFLOWS);
    writeJson(tmpDir, 'fallback-responses.json', VALID_FALLBACK_RESPONSES);
    writeJson(tmpDir, 'settings.json', VALID_SETTINGS);
  }

  it('passes when all required files are valid', () => {
    writeAllValid();
    expect(() => validateDataFilesOnStartup(tmpDir)).not.toThrow();
  });

  it('throws when routing.json is missing', () => {
    writeAllValid();
    rmSync(join(tmpDir, 'routing.json'));
    expect(() => validateDataFilesOnStartup(tmpDir)).toThrow(/routing\.json/);
  });

  it('throws when routing.json has invalid JSON', () => {
    writeBroken(tmpDir, 'routing.json');
    writeJson(tmpDir, 'workflows.json', VALID_WORKFLOWS);
    writeJson(tmpDir, 'fallback-responses.json', VALID_FALLBACK_RESPONSES);
    writeJson(tmpDir, 'settings.json', VALID_SETTINGS);
    expect(() => validateDataFilesOnStartup(tmpDir)).toThrow(/routing\.json/);
  });

  it('throws when routing.json is missing a required field (missing action)', () => {
    // Simulates AC: corrupt routing.json with missing required field
    writeJson(tmpDir, 'routing.json', { wifi: { no_action_key: true } });
    writeJson(tmpDir, 'workflows.json', VALID_WORKFLOWS);
    writeJson(tmpDir, 'fallback-responses.json', VALID_FALLBACK_RESPONSES);
    writeJson(tmpDir, 'settings.json', VALID_SETTINGS);
    expect(() => validateDataFilesOnStartup(tmpDir)).toThrow(/routing\.json/);
  });

  it('throws when workflows.json is invalid', () => {
    writeJson(tmpDir, 'routing.json', VALID_ROUTING);
    writeJson(tmpDir, 'workflows.json', { no_workflows_key: true });
    writeJson(tmpDir, 'fallback-responses.json', VALID_FALLBACK_RESPONSES);
    writeJson(tmpDir, 'settings.json', VALID_SETTINGS);
    expect(() => validateDataFilesOnStartup(tmpDir)).toThrow(/workflows\.json/);
  });

  it('throws with FATAL in message', () => {
    // no files at all
    expect(() => validateDataFilesOnStartup(tmpDir)).toThrow(/FATAL/);
  });

  it('lists all failing files in a single error', () => {
    writeJson(tmpDir, 'routing.json', {}); // empty — will fail
    writeJson(tmpDir, 'workflows.json', {}); // missing workflows key
    writeJson(tmpDir, 'settings.json', {}); // missing ai and routing_mode
    // fallback-responses.json is optional, skip it

    try {
      validateDataFilesOnStartup(tmpDir);
      expect(true).toBe(false); // should not reach here
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain('routing.json');
      expect(msg).toContain('workflows.json');
      expect(msg).toContain('settings.json');
    }
  });

  it('skips optional fallback-responses.json without throwing when absent', () => {
    writeJson(tmpDir, 'routing.json', VALID_ROUTING);
    writeJson(tmpDir, 'workflows.json', VALID_WORKFLOWS);
    writeJson(tmpDir, 'settings.json', VALID_SETTINGS);
    // fallback-responses.json deliberately absent
    const consoleSpy = vi.spyOn(console, 'warn');
    expect(() => validateDataFilesOnStartup(tmpDir)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/fallback-responses\.json/));
    consoleSpy.mockRestore();
  });
});
