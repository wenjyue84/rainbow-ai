/**
 * Tests for US-497: safe redirect utility — open-redirect prevention.
 */

import { describe, it, expect, vi } from 'vitest';
import { isRedirectSafe, safeRedirect } from '../../lib/safe-redirect.js';

// ─── isRedirectSafe ─────────────────────────────────────────────────────────

describe('isRedirectSafe', () => {
  it('allows relative paths starting with /', () => {
    expect(isRedirectSafe('/')).toBe(true);
    expect(isRedirectSafe('/dashboard')).toBe(true);
    expect(isRedirectSafe('/#dashboard')).toBe(true);
    expect(isRedirectSafe('/admin/rainbow')).toBe(true);
  });

  it('rejects protocol-relative URLs (//evil.com)', () => {
    expect(isRedirectSafe('//evil.com')).toBe(false);
    expect(isRedirectSafe('//evil.com/path')).toBe(false);
  });

  it('rejects absolute URLs to unlisted hosts', () => {
    expect(isRedirectSafe('https://evil.com')).toBe(false);
    expect(isRedirectSafe('https://evil.com/phishing')).toBe(false);
    expect(isRedirectSafe('http://attacker.net/login')).toBe(false);
  });

  it('rejects non-http schemes', () => {
    expect(isRedirectSafe('javascript:alert(1)')).toBe(false);
    expect(isRedirectSafe('data:text/html,<h1>XSS</h1>')).toBe(false);
    expect(isRedirectSafe('ftp://files.example.com')).toBe(false);
  });

  it('rejects empty and whitespace-only input', () => {
    expect(isRedirectSafe('')).toBe(false);
    expect(isRedirectSafe('   ')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isRedirectSafe('not a url at all')).toBe(false);
  });

  it('allows hosts from extraAllowedHosts', () => {
    const extra = new Set(['example.com', 'trusted.org']);
    expect(isRedirectSafe('https://example.com/callback', extra)).toBe(true);
    expect(isRedirectSafe('https://trusted.org/', extra)).toBe(true);
  });

  it('rejects hosts not in extraAllowedHosts', () => {
    const extra = new Set(['example.com']);
    expect(isRedirectSafe('https://evil.com', extra)).toBe(false);
  });

  // In development, localhost is auto-allowed
  it('allows localhost in development mode', () => {
    // The module loads in test/development mode, so localhost should be allowed
    expect(isRedirectSafe('http://localhost:3002/admin')).toBe(true);
    expect(isRedirectSafe('http://127.0.0.1:3002')).toBe(true);
  });
});

// ─── safeRedirect ───────────────────────────────────────────────────────────

describe('safeRedirect', () => {
  function mockRes() {
    const res: any = {
      redirect: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  }

  it('redirects for safe relative paths', () => {
    const res = mockRes();
    const result = safeRedirect(res, '/#dashboard');
    expect(result).toBe(true);
    expect(res.redirect).toHaveBeenCalledWith(302, '/#dashboard');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 for redirects to evil.com', () => {
    const res = mockRes();
    const result = safeRedirect(res, 'https://evil.com');
    expect(result).toBe(false);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid redirect target' });
  });

  it('allows redirects to extraAllowedHosts', () => {
    const res = mockRes();
    const extra = new Set(['trusted.example.com']);
    const result = safeRedirect(res, 'https://trusted.example.com/ok', 302, extra);
    expect(result).toBe(true);
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://trusted.example.com/ok');
  });

  it('uses custom status code when provided', () => {
    const res = mockRes();
    safeRedirect(res, '/home', 301);
    expect(res.redirect).toHaveBeenCalledWith(301, '/home');
  });

  it('returns 400 for protocol-relative evil URLs', () => {
    const res = mockRes();
    const result = safeRedirect(res, '//evil.com/phish');
    expect(result).toBe(false);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
