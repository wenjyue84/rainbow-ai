/**
 * Safe redirect utility — prevents open-redirect vulnerabilities.
 *
 * Validates redirect targets against a configurable host allowlist
 * using the URL constructor. Relative paths are always allowed
 * (they stay on the same host).
 *
 * US-497: Replace open-redirect risk with strict URL allowlist validation.
 */

import type { Response } from 'express';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Build the set of allowed redirect hosts from environment + defaults.
 * Called once at module load.
 */
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();

  // Always allow localhost variants in development
  if (isDev) {
    hosts.add('localhost');
    hosts.add('127.0.0.1');
  }

  // Parse ALLOWED_REDIRECT_HOSTS env var (comma-separated)
  const envHosts = process.env.ALLOWED_REDIRECT_HOSTS;
  if (envHosts) {
    for (const h of envHosts.split(',')) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }

  return hosts;
}

const allowedHosts = buildAllowedHosts();

/**
 * Check whether a redirect URL is safe.
 *
 * - Relative paths (starting with `/`) are always safe.
 * - Absolute URLs must have their host in the allowlist.
 * - Protocol-relative URLs (`//evil.com`) are treated as absolute and validated.
 * - Malformed URLs are rejected.
 *
 * @returns `true` if the URL is safe to redirect to.
 */
export function isRedirectSafe(
  url: string,
  extraAllowedHosts?: ReadonlySet<string>,
): boolean {
  // Reject empty or whitespace-only
  if (!url || !url.trim()) return false;

  const trimmed = url.trim();

  // Relative paths are always safe (no host component)
  // But reject protocol-relative URLs like //evil.com
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return true;
  }

  // Parse as absolute URL
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Malformed URL — reject
    return false;
  }

  // Only allow http/https schemes
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  // Check module-level allowlist
  if (allowedHosts.has(host)) return true;

  // Check caller-provided extra hosts
  if (extraAllowedHosts?.has(host)) return true;

  return false;
}

/**
 * Perform a safe redirect. If the target URL is not in the allowlist,
 * responds with HTTP 400 instead of redirecting.
 *
 * @param res - Express response object
 * @param url - The redirect target URL
 * @param statusCode - HTTP redirect status (default: 302)
 * @param extraAllowedHosts - Optional additional allowed hosts for this call
 * @returns `true` if redirect was performed, `false` if blocked
 */
export function safeRedirect(
  res: Response,
  url: string,
  statusCode: number = 302,
  extraAllowedHosts?: ReadonlySet<string>,
): boolean {
  if (isRedirectSafe(url, extraAllowedHosts)) {
    res.redirect(statusCode, url);
    return true;
  }

  res.status(400).json({ error: 'Invalid redirect target' });
  return false;
}
