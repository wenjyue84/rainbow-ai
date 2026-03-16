/**
 * PCI DSS 4.0 Requirement 11.6.1 — HTTP Security Header Tamper Detection
 *
 * Detects and alerts on unauthorised modifications to HTTP security response
 * headers on payment-adjacent routes. Satisfies the PCI DSS 4.0.1 requirement
 * (mandatory from 31 March 2025) to monitor integrity of security headers on
 * pages that process or display payment-related information.
 *
 * How it works:
 *   1. After Helmet sets headers, this middleware reads outgoing response headers
 *   2. Normalizes CSP (strips per-request nonces so hashes are stable)
 *   3. Compares normalized headers against the approved baseline in pci-header-baseline.json
 *   4. Logs a diff alert and triggers an admin WhatsApp alert on any deviation
 *   5. Throttled to one alert per ALERT_COOLDOWN_MS (default 5 minutes per path)
 */

import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('PciHeaderTamper');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Baseline config ─────────────────────────────────────────────────

interface HeaderBaseline {
  paymentAdjacentPaths: string[];
  requiredHeaders: Record<string, {
    expected?: string;
    matchMode: string;
    requiredDirectives?: string[];
    forbiddenValues?: string[];
    requiredInProduction?: boolean;
    minMaxAge?: number;
    pciRequirement?: string;
  }>;
  alertCooldownMs: number;
}

function loadBaseline(): HeaderBaseline {
  try {
    // Works both in src/ (tsx) and dist/ (esbuild) — data/ is copied to dist/
    const candidates = [
      join(__dirname, 'data', 'pci-header-baseline.json'),
      join(__dirname, '..', 'assistant', 'data', 'pci-header-baseline.json'),
      join(__dirname, 'assistant', 'data', 'pci-header-baseline.json'),
    ];
    for (const p of candidates) {
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch {
        // try next
      }
    }
    throw new Error('pci-header-baseline.json not found in any candidate path');
  } catch (err: any) {
    logger.warn('Failed to load PCI header baseline — tamper detection disabled', { error: err.message });
    return { paymentAdjacentPaths: [], requiredHeaders: {}, alertCooldownMs: 300000 };
  }
}

const baseline = loadBaseline();

// ─── Alert rate-limiting ──────────────────────────────────────────────
const lastAlertAt = new Map<string, number>();

// ─── Admin notifier (lazy import to avoid circular deps) ─────────────
let _notifyFn: ((diffs: HeaderDiff[], path: string) => Promise<void>) | null = null;

export function setPciHeaderAlertFn(fn: (diffs: HeaderDiff[], path: string) => Promise<void>): void {
  _notifyFn = fn;
}

// ─── Types ────────────────────────────────────────────────────────────

export interface HeaderDiff {
  header: string;
  issue: string;
  expected?: string;
  actual?: string | null;
}

// ─── Header normalisation ─────────────────────────────────────────────

/** Strip per-request nonces from CSP so the structural hash remains stable. */
function normalizeCsp(csp: string): string {
  return csp.replace(/'nonce-[A-Za-z0-9+/=]+'/g, "'nonce-DYNAMIC'");
}

/** Parse HSTS max-age value from header string */
function parseHstsMaxAge(hsts: string): number {
  const m = hsts.match(/max-age=(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

// ─── Drift detection logic ────────────────────────────────────────────

export function detectHeaderDrift(
  headers: Record<string, string | string[] | number | undefined>,
  isProd: boolean
): HeaderDiff[] {
  const diffs: HeaderDiff[] = [];
  const required = baseline.requiredHeaders;

  for (const [headerName, rule] of Object.entries(required)) {
    const rawVal = headers[headerName];
    const actual = Array.isArray(rawVal) ? rawVal.join(', ') : rawVal != null ? String(rawVal) : null;

    if (rule.matchMode === 'exact') {
      if (!actual) {
        diffs.push({ header: headerName, issue: 'MISSING', expected: rule.expected });
      } else if (actual.toLowerCase() !== (rule.expected ?? '').toLowerCase()) {
        diffs.push({ header: headerName, issue: 'VALUE_CHANGED', expected: rule.expected, actual });
      }
    } else if (rule.matchMode === 'directive-check') {
      if (!actual) {
        diffs.push({ header: headerName, issue: 'MISSING' });
      } else {
        const normalized = normalizeCsp(actual);
        // Check required directives are present
        for (const dir of (rule.requiredDirectives ?? [])) {
          if (!normalized.includes(dir)) {
            diffs.push({ header: headerName, issue: `MISSING_DIRECTIVE:${dir}`, actual: normalized });
          }
        }
        // Check forbidden values are absent
        for (const forbidden of (rule.forbiddenValues ?? [])) {
          if (normalized.includes(forbidden)) {
            diffs.push({ header: headerName, issue: `FORBIDDEN_VALUE:${forbidden}`, actual: normalized });
          }
        }
      }
    } else if (rule.matchMode === 'hsts-check') {
      if (!isProd) continue; // HSTS not required in development
      if (!actual) {
        diffs.push({ header: headerName, issue: 'MISSING_IN_PRODUCTION' });
      } else {
        const maxAge = parseHstsMaxAge(actual);
        if (maxAge < (rule.minMaxAge ?? 0)) {
          diffs.push({
            header: headerName,
            issue: `MAX_AGE_TOO_LOW (got ${maxAge}, min ${rule.minMaxAge})`,
            actual,
          });
        }
      }
    }
  }

  return diffs;
}

// ─── Middleware ───────────────────────────────────────────────────────

function isPaymentAdjacentPath(path: string): boolean {
  return baseline.paymentAdjacentPaths.some(p => path.startsWith(p) || path === p.replace(/\/$/, ''));
}

/**
 * Express middleware: compare outgoing security headers on payment-adjacent routes
 * against the approved PCI baseline and alert on any drift.
 *
 * Mount AFTER Helmet and Permissions-Policy middleware.
 */
export function pciHeaderTamperDetectionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isPaymentAdjacentPath(req.path)) {
    next();
    return;
  }

  // Intercept res.end to inspect final headers
  const originalEnd = res.end.bind(res) as (...args: any[]) => any;
  // @ts-ignore — patching res.end for post-Helmet header inspection
  res.end = function (...args: any[]) {
    try {
      const headers = res.getHeaders() as Record<string, string | string[] | number | undefined>;
      const isProd = process.env.NODE_ENV === 'production';
      const diffs = detectHeaderDrift(headers, isProd);

      if (diffs.length > 0) {
        const path = req.path;
        const now = Date.now();
        const lastAt = lastAlertAt.get(path) ?? 0;
        const cooldown = baseline.alertCooldownMs ?? 300000;

        logger.warn('PCI DSS 11.6.1 — Security header drift detected', {
          path,
          diffs,
          headerHash: crypto.createHash('sha256').update(JSON.stringify(diffs)).digest('hex').slice(0, 8),
        });

        if (now - lastAt > cooldown && _notifyFn) {
          lastAlertAt.set(path, now);
          _notifyFn(diffs, path).catch((err: Error) => {
            logger.error('Failed to send header tamper alert', { error: err.message });
          });
        }
      }
    } catch (err: any) {
      // Non-fatal — never block the response for monitoring errors
      logger.error('Error in PCI header tamper detection', { error: err.message });
    }
    return originalEnd(...args);
  };

  next();
}

// ─── On-demand snapshot (used by monthly scan) ────────────────────────

export interface HeaderSnapshot {
  timestamp: string;
  path: string;
  status: 'COMPLIANT' | 'DRIFTED';
  diffs: HeaderDiff[];
  headers: Record<string, string | null>;
}

/**
 * Compute a compliance snapshot for a given headers map.
 * Used by the monthly scan script without needing a live request.
 */
export function computeHeaderSnapshot(
  path: string,
  headers: Record<string, string | null>,
  isProd: boolean
): HeaderSnapshot {
  const diffs = detectHeaderDrift(headers as any, isProd);
  return {
    timestamp: new Date().toISOString(),
    path,
    status: diffs.length === 0 ? 'COMPLIANT' : 'DRIFTED',
    diffs,
    headers,
  };
}
