/**
 * US-835: CSP connect-src whitelist for AI provider endpoints.
 *
 * Verifies that the CSP directives include required connect-src values
 * for AI providers and WhatsApp avatar CDN.
 */

import { describe, it, expect } from 'vitest';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  buildConnectSrc,
  buildImgSrc,
  extractOrigin,
  readProviderOrigins,
} from '../../lib/csp-directives.js';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);
const SETTINGS_PATH = join(__dirname_local, '..', 'data', 'settings.json');

// ─── extractOrigin ──────────────────────────────────────────────────────────

describe('extractOrigin', () => {
  it('extracts origin from a full URL', () => {
    expect(extractOrigin('https://api.groq.com/openai/v1')).toBe('https://api.groq.com');
  });

  it('returns null for localhost URLs', () => {
    expect(extractOrigin('http://localhost:11434/v1')).toBeNull();
    expect(extractOrigin('http://127.0.0.1:11434/v1')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(extractOrigin('not-a-url')).toBeNull();
    expect(extractOrigin('')).toBeNull();
  });
});

// ─── readProviderOrigins ────────────────────────────────────────────────────

describe('readProviderOrigins', () => {
  it('reads provider origins from the real settings.json', () => {
    const origins = readProviderOrigins(SETTINGS_PATH);
    // Should include at least Groq and NVIDIA
    expect(origins).toContain('https://api.groq.com');
    expect(origins).toContain('https://integrate.api.nvidia.com');
  });

  it('returns empty array for a nonexistent file', () => {
    expect(readProviderOrigins('/nonexistent/settings.json')).toEqual([]);
  });
});

// ─── buildConnectSrc ────────────────────────────────────────────────────────

describe('buildConnectSrc', () => {
  it('includes required static origins', () => {
    const csp = buildConnectSrc(SETTINGS_PATH);
    expect(csp).toContain("'self'");
    expect(csp).toContain('https://*.nvidia.com');
    expect(csp).toContain('https://api.openrouter.ai');
    expect(csp).toContain('https://pps.whatsapp.net');
  });

  it('includes dynamic origins from settings.json providers', () => {
    const csp = buildConnectSrc(SETTINGS_PATH);
    expect(csp).toContain('https://api.groq.com');
    expect(csp).toContain('https://integrate.api.nvidia.com');
    expect(csp).toContain('https://generativelanguage.googleapis.com');
  });

  it('does not include unsafe-eval or unsafe-inline', () => {
    const csp = buildConnectSrc(SETTINGS_PATH);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  it('does not include localhost origins', () => {
    const csp = buildConnectSrc(SETTINGS_PATH);
    for (const entry of csp) {
      expect(entry).not.toMatch(/localhost/);
      expect(entry).not.toMatch(/127\.0\.0\.1/);
    }
  });

  it('has no duplicate entries', () => {
    const csp = buildConnectSrc(SETTINGS_PATH);
    expect(new Set(csp).size).toBe(csp.length);
  });
});

// ─── buildImgSrc ────────────────────────────────────────────────────────────

describe('buildImgSrc', () => {
  it('includes self, data:, and WhatsApp avatar CDN', () => {
    const imgSrc = buildImgSrc();
    expect(imgSrc).toContain("'self'");
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('https://pps.whatsapp.net');
  });

  it('does not include unsafe-eval or unsafe-inline', () => {
    const imgSrc = buildImgSrc();
    expect(imgSrc).not.toContain("'unsafe-eval'");
    expect(imgSrc).not.toContain("'unsafe-inline'");
  });
});
