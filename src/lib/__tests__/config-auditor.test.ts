import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { ConfigAuditor } from '../config-auditor.js';

describe('ConfigAuditor', () => {
  let auditor: ConfigAuditor;
  const projectRoot = path.join(process.cwd());

  beforeEach(() => {
    auditor = new ConfigAuditor(projectRoot);
    // Clear relevant env vars before each test
    delete process.env.DATABASE_URL;
    delete process.env.RAINBOW_ROLE;
    delete process.env.KIMI_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_KEY;
    delete process.env.GEMINI_API_KEY_PELANGI;
    delete process.env.GROQ_API_KEY_PELANGI;
  });

  describe('checkApiKeys', () => {
    it('fails when no AI provider keys are set', () => {
      const result = auditor.checkApiKeys();
      expect(result.passed).toBe(false);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].field).toBe('AI_PROVIDER_KEY');
    });

    it('passes when KIMI_API_KEY is set', () => {
      process.env.KIMI_API_KEY = 'test-key';
      const result = auditor.checkApiKeys();
      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('passes when OLLAMA_BASE_URL is set', () => {
      process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
      const result = auditor.checkApiKeys();
      expect(result.passed).toBe(true);
    });

    it('passes when OPENROUTER_API_KEY is set', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test';
      const result = auditor.checkApiKeys();
      expect(result.passed).toBe(true);
    });

    it('passes when GEMINI_API_KEY_PELANGI is set', () => {
      process.env.GEMINI_API_KEY_PELANGI = 'gemini-key';
      const result = auditor.checkApiKeys();
      expect(result.passed).toBe(true);
    });
  });

  describe('checkEnvVars', () => {
    it('fails when RAINBOW_ROLE is not set', () => {
      const result = auditor.checkEnvVars();
      expect(result.passed).toBe(false);
      expect(result.warnings[0].field).toBe('RAINBOW_ROLE');
    });

    it('passes when RAINBOW_ROLE=primary', () => {
      process.env.RAINBOW_ROLE = 'primary';
      const result = auditor.checkEnvVars();
      expect(result.passed).toBe(true);
    });

    it('passes when RAINBOW_ROLE=standby', () => {
      process.env.RAINBOW_ROLE = 'standby';
      const result = auditor.checkEnvVars();
      expect(result.passed).toBe(true);
    });

    it('fails when RAINBOW_ROLE has invalid value', () => {
      process.env.RAINBOW_ROLE = 'invalid';
      const result = auditor.checkEnvVars();
      expect(result.passed).toBe(false);
      expect(result.warnings[0].message).toContain('invalid');
    });
  });

  describe('checkDirectories', () => {
    it('passes when real project directories exist', () => {
      // Uses actual project root — these dirs should exist in dev
      const result = auditor.checkDirectories();
      // At minimum pelangi dir exists
      const pelangiWarning = result.warnings.find((w) => w.field === 'DIR_PELANGI');
      expect(pelangiWarning).toBeUndefined();
    });

    it('fails when profile directories are missing', () => {
      const fakeAuditor = new ConfigAuditor('/nonexistent/path/12345');
      const result = fakeAuditor.checkDirectories();
      expect(result.passed).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].fix_command).toContain('mkdir');
    });
  });

  describe('runAll', () => {
    it('returns FAIL result schema when checks fail', async () => {
      // No env vars set — DB and API keys will fail
      const result = await auditor.runAll('test');
      expect(result).toMatchObject({
        validation_result: expect.stringMatching(/PASS|FAIL/),
        total_checks: 4,
        passed: expect.any(Number),
        failed: expect.any(Number),
        warnings: expect.any(Array),
        timestamp: expect.any(String),
        environment: 'test',
      });
      expect(result.passed + result.failed).toBe(result.total_checks);
    });

    it('returns FAIL when no AI keys and no RAINBOW_ROLE', async () => {
      const result = await auditor.runAll('production');
      expect(result.validation_result).toBe('FAIL');
      expect(result.failed).toBeGreaterThan(0);
    });

    it('timestamp is a valid ISO string', async () => {
      const result = await auditor.runAll('staging');
      expect(() => new Date(result.timestamp)).not.toThrow();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
