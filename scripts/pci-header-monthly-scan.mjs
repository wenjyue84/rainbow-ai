#!/usr/bin/env node
/**
 * PCI DSS 4.0 Req 11.6.1 — Monthly Security Header Compliance Scan
 *
 * Performs an automated monthly check that HTTP security headers on
 * payment-adjacent webchat pages match the approved baseline in
 * pci-header-baseline.json. Outputs a JSON compliance report.
 *
 * Run: npm run pci:header-scan
 * Or:  node scripts/pci-header-monthly-scan.mjs [--url=http://localhost:3002]
 *
 * Exit code 0 = all headers compliant
 * Exit code 1 = header drift detected (CI/CD will fail build)
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// ─── Load baseline ────────────────────────────────────────────────────

const baselinePath = join(projectRoot, 'src', 'assistant', 'data', 'pci-header-baseline.json');
let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf-8'));
} catch (err) {
  console.error(`[pci-header-scan] Failed to load baseline: ${err.message}`);
  process.exit(1);
}

// ─── Argument parsing ─────────────────────────────────────────────────

const args = process.argv.slice(2);
const urlArg = args.find(a => a.startsWith('--url='));
const baseUrl = urlArg ? urlArg.split('=')[1] : (process.env.APP_URL ?? 'http://localhost:3002');
const outputDir = join(projectRoot, 'reports');

// ─── Header drift detection (same logic as src/lib/pci-header-tamper-detection.ts) ──

function normalizeCsp(csp) {
  return csp.replace(/'nonce-[A-Za-z0-9+/=]+'/g, "'nonce-DYNAMIC'");
}

function parseHstsMaxAge(hsts) {
  const m = hsts.match(/max-age=(\d+)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function detectHeaderDrift(headers, isProd) {
  const diffs = [];
  const required = baseline.requiredHeaders;

  for (const [headerName, rule] of Object.entries(required)) {
    const rawVal = headers[headerName];
    const actual = rawVal ?? null;

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
        for (const dir of (rule.requiredDirectives ?? [])) {
          if (!normalized.includes(dir)) {
            diffs.push({ header: headerName, issue: `MISSING_DIRECTIVE:${dir}`, actual: normalized });
          }
        }
        for (const forbidden of (rule.forbiddenValues ?? [])) {
          if (normalized.includes(forbidden)) {
            diffs.push({ header: headerName, issue: `FORBIDDEN_VALUE:${forbidden}`, actual: normalized });
          }
        }
      }
    } else if (rule.matchMode === 'hsts-check') {
      if (!isProd) continue;
      if (!actual) {
        diffs.push({ header: headerName, issue: 'MISSING_IN_PRODUCTION' });
      } else {
        const maxAge = parseHstsMaxAge(actual);
        if (maxAge < (rule.minMaxAge ?? 0)) {
          diffs.push({ header: headerName, issue: `MAX_AGE_TOO_LOW (got ${maxAge}, min ${rule.minMaxAge})`, actual });
        }
      }
    }
  }

  return diffs;
}

// ─── Fetch and scan each payment-adjacent path ────────────────────────

async function scanPath(path) {
  const url = `${baseUrl}${path}`;
  try {
    const resp = await fetch(url, { method: 'GET', redirect: 'follow' });
    const headers = {};
    for (const [k, v] of resp.headers.entries()) {
      headers[k.toLowerCase()] = v;
    }
    const isProd = process.env.NODE_ENV === 'production';
    const diffs = detectHeaderDrift(headers, isProd);
    return {
      path,
      url,
      httpStatus: resp.status,
      status: diffs.length === 0 ? 'COMPLIANT' : 'DRIFTED',
      diffs,
      scannedHeaders: Object.fromEntries(
        Object.keys(baseline.requiredHeaders).map(h => [h, headers[h] ?? null])
      ),
    };
  } catch (err) {
    return {
      path,
      url,
      httpStatus: null,
      status: 'ERROR',
      error: err.message,
      diffs: [],
      scannedHeaders: {},
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────

console.log(`[pci-header-scan] PCI DSS 4.0 Req 11.6.1 — Monthly Security Header Scan`);
console.log(`[pci-header-scan] Target: ${baseUrl}`);
console.log(`[pci-header-scan] Scanning ${baseline.paymentAdjacentPaths.length} payment-adjacent paths...`);

const results = [];
for (const path of baseline.paymentAdjacentPaths) {
  const result = await scanPath(path);
  results.push(result);
  const icon = result.status === 'COMPLIANT' ? '✅' : result.status === 'ERROR' ? '⚠️' : '❌';
  console.log(`  ${icon} ${path} — ${result.status}${result.diffs.length > 0 ? ` (${result.diffs.length} issue(s))` : ''}`);
  if (result.diffs.length > 0) {
    for (const d of result.diffs) {
      console.log(`       • ${d.header}: ${d.issue}`);
    }
  }
}

const compliantCount = results.filter(r => r.status === 'COMPLIANT').length;
const driftedCount = results.filter(r => r.status === 'DRIFTED').length;
const errorCount = results.filter(r => r.status === 'ERROR').length;
const allCompliant = driftedCount === 0;

const baselineHash = createHash('sha256').update(JSON.stringify(baseline.requiredHeaders)).digest('hex').slice(0, 16);

const report = {
  _reportType: 'pci-dss-11.6.1-monthly-header-scan',
  _requirement: 'PCI DSS 4.0 Req 11.6.1 — HTTP security header integrity monitoring',
  generatedAt: new Date().toISOString(),
  baselineVersion: baseline._version ?? '1.0.0',
  baselineHash,
  targetUrl: baseUrl,
  summary: {
    totalPaths: results.length,
    compliant: compliantCount,
    drifted: driftedCount,
    errors: errorCount,
    overallStatus: allCompliant ? 'COMPLIANT' : 'DRIFTED',
  },
  paths: results,
};

// Write report
try {
  mkdirSync(outputDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(outputDir, `pci-header-scan-${date}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[pci-header-scan] Report written: ${reportPath}`);
} catch (err) {
  console.warn(`[pci-header-scan] Failed to write report: ${err.message}`);
}

// Summary
console.log(`\n[pci-header-scan] Summary:`);
console.log(`  Compliant: ${compliantCount}/${results.length}`);
console.log(`  Drifted:   ${driftedCount}`);
console.log(`  Errors:    ${errorCount}`);
console.log(`  Overall:   ${allCompliant ? '✅ COMPLIANT' : '❌ DRIFTED — review required'}`);

if (!allCompliant) {
  console.log(`\n[pci-header-scan] ACTION REQUIRED: Header drift detected.`);
  console.log(`  1. Review drift details above`);
  console.log(`  2. If change is intentional, update pci-header-baseline.json`);
  console.log(`  3. Otherwise, revert the security header configuration`);
  process.exit(1);
}
