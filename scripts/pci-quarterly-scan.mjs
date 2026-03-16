/**
 * US-1040: PCI DSS 4.0 Req 6.4.3 — Quarterly script inventory drift scan.
 *
 * Compares the current state of payment-adjacent HTML files against the
 * approved script inventory (pci-script-inventory.json) and generates a
 * compliance report.
 *
 * Run quarterly (or on demand):  node scripts/pci-quarterly-scan.mjs
 *
 * Output: JSON report to stdout (pipe to file for archival).
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const INVENTORY_PATH = join(ROOT, 'src', 'public', 'pci-script-inventory.json');

const PAYMENT_PAGES = [
  'src/public/webchat.html',
];

const SCRIPT_TAG_RE = /<script\b([^>]*)>/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const INTEGRITY_RE = /\bintegrity\s*=\s*["']([^"']+)["']/i;
const CROSSORIGIN_RE = /\bcrossorigin\b/i;
const NONCE_RE = /\bnonce\s*=\s*["']([^"']+)["']/i;

function isThirdParty(src) {
  return src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//');
}

function hashFile(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function main() {
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf-8'));
  const now = new Date().toISOString();

  const report = {
    reportType: 'PCI DSS 4.0 Req 6.4.3 Quarterly Script Inventory Scan',
    generatedAt: now,
    inventoryVersion: inventory.version,
    lastReviewDate: inventory.lastReviewDate,
    nextReviewDate: inventory.nextReviewDate,
    scanResults: [],
    summary: { totalPages: 0, totalExternalScripts: 0, totalInlineScripts: 0, violations: 0, status: 'PASS' },
  };

  for (const relPath of PAYMENT_PAGES) {
    const absPath = join(ROOT, relPath);
    if (!existsSync(absPath)) {
      report.scanResults.push({ page: relPath, status: 'MISSING', scripts: [] });
      report.summary.violations++;
      continue;
    }

    const html = readFileSync(absPath, 'utf-8');
    const pageHash = hashFile(absPath);
    const pageResult = {
      page: relPath,
      fileHash: pageHash,
      status: 'PASS',
      externalScripts: [],
      inlineScripts: [],
      violations: [],
    };

    let match;
    let inlineCount = 0;

    while ((match = SCRIPT_TAG_RE.exec(html)) !== null) {
      const attrs = match[1];
      const srcMatch = attrs.match(SRC_RE);

      if (!srcMatch) {
        inlineCount++;
        const hasNonce = NONCE_RE.test(attrs);
        pageResult.inlineScripts.push({
          index: inlineCount,
          hasNonce,
          protection: hasNonce ? 'CSP nonce' : 'none (static or server-injected)',
        });
        continue;
      }

      const src = srcMatch[1];
      const hasIntegrity = INTEGRITY_RE.test(attrs);
      const hasCrossorigin = CROSSORIGIN_RE.test(attrs);
      const thirdParty = isThirdParty(src);

      const scriptEntry = { src, thirdParty, hasIntegrity, hasCrossorigin };
      pageResult.externalScripts.push(scriptEntry);

      if (thirdParty) {
        if (!hasIntegrity) {
          pageResult.violations.push(`Third-party script ${src} missing integrity attribute`);
        }
        if (!hasCrossorigin) {
          pageResult.violations.push(`Third-party script ${src} missing crossorigin attribute`);
        }
        const inInventory = (inventory.thirdPartyScripts || []).some(s => s.src === src);
        if (!inInventory) {
          pageResult.violations.push(`Third-party script ${src} not in inventory`);
        }
      }
    }

    if (pageResult.violations.length > 0) {
      pageResult.status = 'FAIL';
      report.summary.violations += pageResult.violations.length;
    }

    report.summary.totalPages++;
    report.summary.totalExternalScripts += pageResult.externalScripts.length;
    report.summary.totalInlineScripts += pageResult.inlineScripts.length;
    report.scanResults.push(pageResult);
  }

  // Check widget.js SRI hash
  const widgetPath = join(ROOT, 'src', 'public', 'widget.js');
  if (existsSync(widgetPath)) {
    const content = readFileSync(widgetPath);
    const sri = `sha384-${createHash('sha384').update(content).digest('base64')}`;
    report.widgetSRI = { path: 'src/public/widget.js', hash: sri };
  }

  if (report.summary.violations > 0) {
    report.summary.status = 'FAIL';
  }

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.summary.status === 'PASS' ? 0 : 1);
}

main();
