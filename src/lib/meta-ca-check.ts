/**
 * Meta CA certificate startup check (US-478)
 *
 * Meta is replacing DigiCert with its own CA for mTLS-secured webhook delivery,
 * effective 2026-04-01. This module checks that the Meta CA cert is present and
 * warns if it's missing while the deadline is approaching.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Path to the bundled Meta CA cert relative to the project root (process.cwd()).
 * Works for both tsx (dev) and esbuild-bundled (prod) since both are launched
 * from the project root directory.
 */
const BUNDLED_CERT_PATH = join(process.cwd(), 'deploy', 'certs', 'meta-outbound-api-ca-2025-12.pem');

/** Meta CA cert changeover deadline */
const META_CA_DEADLINE = new Date('2026-04-01T00:00:00Z');

/** Warn when within this many milliseconds of the deadline */
const WARN_WINDOW_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

function isPlaceholder(content: string): boolean {
  return content.trimStart().startsWith('#');
}

/**
 * Check if the Meta CA certificate is present and valid.
 * Emits startup warnings if the cert is missing/placeholder and the deadline
 * is within 60 days.
 */
export function checkMetaCACert(): void {
  const now = new Date();
  const msUntilDeadline = META_CA_DEADLINE.getTime() - now.getTime();
  const withinWarningWindow = msUntilDeadline <= WARN_WINDOW_MS;
  const deadlinePassed = msUntilDeadline <= 0;

  // Resolve effective cert path: NODE_EXTRA_CA_CERTS takes precedence
  const envCertPath = process.env.NODE_EXTRA_CA_CERTS;
  const resolvedPath = envCertPath || BUNDLED_CERT_PATH;

  const certExists = existsSync(resolvedPath);
  let certIsReal = false;

  if (certExists) {
    try {
      const content = readFileSync(resolvedPath, 'utf8');
      certIsReal = !isPlaceholder(content) && content.includes('-----BEGIN CERTIFICATE-----');
    } catch {
      certIsReal = false;
    }
  }

  const certSource = envCertPath
    ? `NODE_EXTRA_CA_CERTS=${envCertPath}`
    : `bundled at ${BUNDLED_CERT_PATH}`;

  if (certIsReal) {
    console.log(`[Startup] Meta CA cert OK (${certSource})`);
    return;
  }

  // Cert is missing or placeholder — escalate based on timeline
  if (deadlinePassed) {
    console.error('[Startup] CRITICAL: Meta CA cert is missing/placeholder and the 2026-04-01 deadline has passed!');
    console.error('[Startup]   mTLS webhook delivery from Meta will FAIL until the cert is installed.');
    console.error(`[Startup]   Expected path: ${resolvedPath}`);
    console.error('[Startup]   Replace deploy/certs/meta-outbound-api-ca-2025-12.pem with the real Meta CA cert');
    console.error('[Startup]   and set NODE_EXTRA_CA_CERTS in ecosystem.config.cjs.');
  } else if (withinWarningWindow) {
    const daysLeft = Math.ceil(msUntilDeadline / (24 * 60 * 60 * 1000));
    console.warn(`[Startup] WARNING: Meta CA cert is missing/placeholder — ${daysLeft} day(s) until 2026-04-01 deadline!`);
    console.warn('[Startup]   Meta is replacing DigiCert with its own CA for mTLS webhook delivery.');
    console.warn('[Startup]   mTLS webhooks will FAIL after 2026-04-01 without the real cert installed.');
    console.warn(`[Startup]   Expected: ${resolvedPath}`);
    console.warn('[Startup]   Replace deploy/certs/meta-outbound-api-ca-2025-12.pem with the real Meta CA cert');
    console.warn('[Startup]   and set NODE_EXTRA_CA_CERTS=/var/www/rainbow-ai/deploy/certs/meta-outbound-api-ca-2025-12.pem');
    console.warn('[Startup]   in ecosystem.config.cjs before restarting PM2.');
  } else {
    console.log('[Startup] Meta CA cert: placeholder in place (deadline > 60 days away)');
  }
}
