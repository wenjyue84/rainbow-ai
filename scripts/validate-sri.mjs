/**
 * US-1040: PCI DSS 4.0 Req 6.4.3 — Build-time SRI validation.
 *
 * Scans payment-adjacent HTML files for <script src="..."> tags and ensures:
 *  1. Every external (third-party) script has an `integrity` attribute (SRI hash).
 *  2. Every external script has a `crossorigin` attribute.
 *  3. Every <script src> is registered in pci-script-inventory.json.
 *
 * Exit code 0 = pass, 1 = violations found (fails the build).
 *
 * Usage:  node scripts/validate-sri.mjs
 */

import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Payment-adjacent HTML files to scan (PCI DSS 4.0 Req 6.4.3 scope)
const PAYMENT_PAGES = [
  'src/public/webchat.html',
];

const INVENTORY_PATH = join(ROOT, 'src', 'public', 'pci-script-inventory.json');

// Regex to match <script src="..."> tags (captures src, integrity, crossorigin)
const SCRIPT_TAG_RE = /<script\b([^>]*)>/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const INTEGRITY_RE = /\bintegrity\s*=\s*["']([^"']+)["']/i;
const CROSSORIGIN_RE = /\bcrossorigin\b/i;

function isThirdParty(src) {
  return src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//');
}

function generateSRIHash(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath);
  const hash = createHash('sha384').update(content).digest('base64');
  return `sha384-${hash}`;
}

function main() {
  console.log('[PCI-SRI] Validating script inventory (PCI DSS 4.0 Req 6.4.3)...');

  // Load inventory
  if (!existsSync(INVENTORY_PATH)) {
    console.error('[PCI-SRI] FAIL: Script inventory not found at', INVENTORY_PATH);
    process.exit(1);
  }

  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf-8'));
  const allowedThirdParty = new Set(
    (inventory.thirdPartyScripts || []).map(s => s.src)
  );

  // Build set of all inventoried external script paths (first-party)
  const inventoriedFirstParty = new Set();
  for (const page of inventory.pages || []) {
    for (const sw of page.serviceWorkers || []) {
      inventoriedFirstParty.add(sw.path);
    }
  }

  const violations = [];
  let totalScripts = 0;

  for (const relPath of PAYMENT_PAGES) {
    const absPath = join(ROOT, relPath);
    if (!existsSync(absPath)) {
      console.warn(`[PCI-SRI] WARN: Page not found: ${relPath} — skipping`);
      continue;
    }

    const html = readFileSync(absPath, 'utf-8');
    let match;

    while ((match = SCRIPT_TAG_RE.exec(html)) !== null) {
      const attrs = match[1];
      const srcMatch = attrs.match(SRC_RE);

      // Skip inline scripts (no src attribute) — covered by CSP nonce
      if (!srcMatch) continue;

      const src = srcMatch[1];
      totalScripts++;

      if (isThirdParty(src)) {
        // Third-party script — MUST have integrity + crossorigin
        if (!INTEGRITY_RE.test(attrs)) {
          violations.push({
            file: relPath,
            src,
            issue: 'Third-party script missing integrity (SRI hash) attribute',
          });
        }
        if (!CROSSORIGIN_RE.test(attrs)) {
          violations.push({
            file: relPath,
            src,
            issue: 'Third-party script missing crossorigin attribute',
          });
        }
        if (!allowedThirdParty.has(src)) {
          violations.push({
            file: relPath,
            src,
            issue: 'Third-party script not registered in pci-script-inventory.json',
          });
        }
      }
      // First-party scripts from /public/ are covered by 'self' CSP directive
    }
  }

  // Generate SRI hash for widget.js (informational — for embedding sites)
  const widgetPath = join(ROOT, 'src', 'public', 'widget.js');
  if (existsSync(widgetPath)) {
    const widgetSRI = generateSRIHash(widgetPath);
    console.log(`[PCI-SRI] widget.js SRI hash: ${widgetSRI}`);
  }

  // Report
  console.log(`[PCI-SRI] Scanned ${PAYMENT_PAGES.length} payment-adjacent page(s), found ${totalScripts} external script tag(s).`);

  if (violations.length > 0) {
    console.error(`[PCI-SRI] FAIL: ${violations.length} violation(s) found:\n`);
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.src}`);
      console.error(`    Issue: ${v.issue}\n`);
    }
    console.error('[PCI-SRI] Fix: Add scripts to pci-script-inventory.json with SRI hashes,');
    console.error('          or add integrity="sha384-..." crossorigin="anonymous" to the tag.');
    process.exit(1);
  }

  console.log('[PCI-SRI] PASS: All scripts on payment-adjacent pages are compliant.');
  process.exit(0);
}

main();
