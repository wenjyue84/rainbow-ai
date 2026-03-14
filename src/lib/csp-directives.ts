/**
 * US-835: CSP connect-src whitelist for AI provider endpoints.
 *
 * Builds CSP directive arrays from static whitelist + dynamic provider URLs
 * read from settings.json. Extracted for testability.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);

/** Always-included connect-src origins (not derived from settings.json). */
const STATIC_CONNECT_ORIGINS: string[] = [
  "'self'",
  'https://*.nvidia.com',
  'https://api.openrouter.ai',
  'https://pps.whatsapp.net',
];

/**
 * Extract the origin (scheme + host + port) from a URL string.
 * Returns null for invalid or localhost URLs.
 */
export function extractOrigin(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    // Skip localhost / 127.0.0.1 — they don't need CSP whitelisting
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return null;
    return u.origin; // e.g. "https://api.groq.com"
  } catch {
    return null;
  }
}

export interface ProviderEntry {
  base_url?: string;
  [key: string]: unknown;
}

/**
 * Read AI provider base URLs from settings.json and return unique origins.
 */
export function readProviderOrigins(settingsPath?: string): string[] {
  const path = settingsPath ?? join(__dirname_local, '..', 'assistant', 'data', 'settings.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    const settings = JSON.parse(raw);
    const providers: ProviderEntry[] = settings?.ai?.providers ?? [];
    const origins = new Set<string>();
    for (const p of providers) {
      if (p.base_url) {
        const origin = extractOrigin(p.base_url);
        if (origin) origins.add(origin);
      }
    }
    // Also check top-level nvidia_base_url
    if (settings?.ai?.nvidia_base_url) {
      const origin = extractOrigin(settings.ai.nvidia_base_url);
      if (origin) origins.add(origin);
    }
    return [...origins];
  } catch {
    return [];
  }
}

/**
 * Build the full connect-src directive array.
 * Merges static whitelist with dynamic provider origins from settings.json.
 */
export function buildConnectSrc(settingsPath?: string): string[] {
  const dynamicOrigins = readProviderOrigins(settingsPath);
  const all = new Set(STATIC_CONNECT_ORIGINS);
  for (const o of dynamicOrigins) {
    all.add(o);
  }
  return [...all];
}

/**
 * Build the img-src directive array.
 * Includes WhatsApp avatar CDN for dashboard profile images.
 */
export function buildImgSrc(): string[] {
  return ["'self'", 'data:', 'https://pps.whatsapp.net'];
}
