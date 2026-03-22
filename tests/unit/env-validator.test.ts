/**
 * Tests for environment variable validation (US-033).
 *
 * Covers: missing required vars, malformed values, out-of-range ports, valid configs, optional var warnings.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateEnvironment } from '../../src/lib/env-validator.js';

describe('validateEnvironment', () => {
  // Save original env
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset to original for each test
    Object.assign(process.env, originalEnv);
    // Clear NODE_OPTIONS in case it affects test isolation
    delete process.env.NODE_OPTIONS;
  });

  // ─── Required Variables ──────────────────────────────────────

  it('should throw when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/DATABASE_URL.*required/i);
  });

  it('should throw when DATABASE_URL does not start with postgres://', () => {
    process.env.DATABASE_URL = 'mysql://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/DATABASE_URL.*postgres:\/\//i);
  });

  it('should throw when MCP_SERVER_PORT is missing', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    delete process.env.MCP_SERVER_PORT;
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/MCP_SERVER_PORT.*required/i);
  });

  it('should throw when MCP_SERVER_PORT is not a number', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = 'not-a-number';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/MCP_SERVER_PORT.*number/i);
  });

  it('should throw when MCP_SERVER_PORT is below 1024', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '512';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/MCP_SERVER_PORT.*1024/i);
  });

  it('should throw when MCP_SERVER_PORT is above 65535', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '99999';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/MCP_SERVER_PORT.*65535/i);
  });

  it('should throw when NODE_ENV is missing', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    delete process.env.NODE_ENV;

    expect(() => validateEnvironment()).toThrow(/NODE_ENV.*required/i);
  });

  it('should throw when NODE_ENV is invalid', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'staging';

    expect(() => validateEnvironment()).toThrow(/NODE_ENV.*development.*production/i);
  });

  // ─── Valid Configurations ───────────────────────────────────

  it('should pass with all required vars present and valid', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('should pass with production NODE_ENV', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/rainbow';
    process.env.MCP_SERVER_PORT = '8080';
    process.env.NODE_ENV = 'production';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('should pass with port at boundary 1024', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '1024';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).not.toThrow();
  });

  it('should pass with port at boundary 65535', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '65535';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).not.toThrow();
  });

  // ─── Optional Variables (warnings only) ──────────────────────

  it('should warn when DIGIMAN_API_URL is missing', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';
    delete process.env.DIGIMAN_API_URL;

    const consoleSpy = vi.spyOn(console, 'warn');
    expect(() => validateEnvironment()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DIGIMAN_API_URL'));
    consoleSpy.mockRestore();
  });

  it('should warn when DIGIMAN_API_TOKEN is missing', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';
    delete process.env.DIGIMAN_API_TOKEN;

    const consoleSpy = vi.spyOn(console, 'warn');
    expect(() => validateEnvironment()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('DIGIMAN_API_TOKEN'));
    consoleSpy.mockRestore();
  });

  it('should not warn when optional vars are set', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/db';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';
    process.env.DIGIMAN_API_URL = 'http://admin.example.com';
    process.env.DIGIMAN_API_TOKEN = 'secret-token';

    const consoleSpy = vi.spyOn(console, 'warn');
    expect(() => validateEnvironment()).not.toThrow();
    // Should not warn about optional vars when they're set
    const warnings = consoleSpy.mock.calls.filter(call =>
      call[0]?.toString().includes('DIGIMAN_API_URL') ||
      call[0]?.toString().includes('DIGIMAN_API_TOKEN')
    );
    expect(warnings.length).toBe(0);
    consoleSpy.mockRestore();
  });

  // ─── Combined/Multiple Failures ────────────────────────────

  it('should report all failures together in error message', () => {
    delete process.env.DATABASE_URL;
    process.env.MCP_SERVER_PORT = 'invalid';
    delete process.env.NODE_ENV;

    try {
      validateEnvironment();
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err.message).toContain('DATABASE_URL');
      expect(err.message).toContain('MCP_SERVER_PORT');
      expect(err.message).toContain('NODE_ENV');
      expect(err.message).toContain('FATAL');
    }
  });

  it('should include postgres:// requirement in error for DATABASE_URL', () => {
    process.env.DATABASE_URL = 'http://localhost:3000';
    process.env.MCP_SERVER_PORT = '3002';
    process.env.NODE_ENV = 'development';

    expect(() => validateEnvironment()).toThrow(/postgres:\/\//);
  });
});
