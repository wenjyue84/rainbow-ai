/**
 * Rainbow Admin Dashboard — Acceptance Audit
 * Headless Chromium Playwright script.
 * Usage: node scripts/rainbow-admin-audit.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE = 'http://5.223.54.57:3003';
const SCREENSHOT_DIR = join(__dirname, '..', 'tmp', 'audit-screenshots');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const TABS = [
  'dashboard',
  'understanding',
  'responses',
  'intents',
  'chat-simulator',
  'testing',
  'performance',
  'settings',
  'help',
  'intent-manager',
  'static-replies',
  'kb',
  'preview',
  'real-chat',
  'workflow',
];

// Patterns that indicate a genuine error banner/toast (case-insensitive)
const ERROR_TEXT_PATTERNS = [
  /failed to load/i,
  /something went wrong/i,
  /error loading/i,
  /unable to load/i,
  /could not load/i,
  /network error/i,
  /\bfetch failed\b/i,
];

// Console message types to skip (noise)
const SKIP_CONSOLE_PATTERNS = [
  /Download the React DevTools/i,
  /Warning: Each child in a list/i,
  /Warning: ReactDOM/i,
  /\[HMR\]/i,
  /\[vite\]/i,
];

async function auditTab(page, tabName) {
  const consoleErrors = [];
  const uncaughtExceptions = [];
  const failingApis = [];

  // Attach listeners BEFORE navigation
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!SKIP_CONSOLE_PATTERNS.some((p) => p.test(text))) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', (err) => {
    uncaughtExceptions.push(err.message);
  });

  page.on('response', (resp) => {
    const url = resp.url();
    if (url.includes('/api/rainbow') && resp.status() >= 400) {
      failingApis.push({ url, status: resp.status() });
    }
  });

  // Navigate to both hash variants: /#tab/pelangi and /#tab
  const url = `${BASE}/#${tabName}/pelangi`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    // networkidle timeout is OK — page may still be usable
  }

  // Extra settle time
  await page.waitForTimeout(1500);

  // Screenshot
  const screenshotPath = join(SCREENSHOT_DIR, `${tabName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // Check visible text for error banners
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  const errorBanners = ERROR_TEXT_PATTERNS.filter((p) => p.test(bodyText)).map((p) => p.toString());

  // Also look for visible elements with error-like class names (toast, alert, etc.)
  const errorElements = await page.evaluate(() => {
    const selectors = [
      '[class*="error"]',
      '[class*="alert"]',
      '[class*="toast"]',
      '[role="alert"]',
    ];
    const found = [];
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = el.innerText?.trim();
        if (text && text.length > 3 && text.length < 300) {
          found.push({ selector: sel, text });
        }
      }
    }
    return found;
  });

  // Filter error elements to only those that look like actual errors
  const visibleErrorElements = errorElements.filter((e) =>
    ERROR_TEXT_PATTERNS.some((p) => p.test(e.text))
  );

  return {
    tab: tabName,
    consoleErrors,
    uncaughtExceptions,
    failingApis,
    errorBanners,
    visibleErrorElements,
    screenshotPath,
  };
}

async function main() {
  console.log(`\nRainbow Admin Dashboard Acceptance Audit`);
  console.log(`Target: ${BASE}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Tabs: ${TABS.length}\n`);

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const tab of TABS) {
    process.stdout.write(`  Auditing /${tab} ... `);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      // Ignore HTTPS errors for HTTP site
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    try {
      const result = await auditTab(page, tab);
      results.push(result);

      const passed =
        result.consoleErrors.length === 0 &&
        result.uncaughtExceptions.length === 0 &&
        result.failingApis.length === 0 &&
        result.errorBanners.length === 0 &&
        result.visibleErrorElements.length === 0;

      console.log(passed ? 'PASS' : 'FAIL');
    } catch (err) {
      results.push({
        tab,
        consoleErrors: [],
        uncaughtExceptions: [`Script error: ${err.message}`],
        failingApis: [],
        errorBanners: [],
        visibleErrorElements: [],
        screenshotPath: null,
      });
      console.log('FAIL (script error)');
    } finally {
      await context.close();
    }
  }

  await browser.close();

  // ── Output table ──────────────────────────────────────────────────────────
  console.log('\n');
  console.log('═'.repeat(120));
  console.log(' RESULTS TABLE');
  console.log('═'.repeat(120));
  console.log(
    `${'Tab'.padEnd(18)} ${'Result'.padEnd(6)} ${'Uncaught JS'.padEnd(40)} ${'Failing /api/rainbow/* (url:status)'.padEnd(50)} Notes`
  );
  console.log('─'.repeat(120));

  const allFailingApis = new Map(); // url:status -> count

  for (const r of results) {
    const passed =
      r.consoleErrors.length === 0 &&
      r.uncaughtExceptions.length === 0 &&
      r.failingApis.length === 0 &&
      r.errorBanners.length === 0 &&
      r.visibleErrorElements.length === 0;

    const result = passed ? 'PASS' : 'FAIL';

    // Aggregate all failing APIs
    for (const fa of r.failingApis) {
      const key = `${fa.url}:${fa.status}`;
      allFailingApis.set(key, (allFailingApis.get(key) || 0) + 1);
    }

    const uncaughtStr =
      r.uncaughtExceptions.length > 0
        ? r.uncaughtExceptions[0].slice(0, 38) + (r.uncaughtExceptions[0].length > 38 ? '…' : '')
        : '-';

    const failApiStr =
      r.failingApis.length > 0
        ? r.failingApis.map((f) => `${new URL(f.url).pathname}:${f.status}`).join(', ').slice(0, 48)
        : '-';

    const notes = [
      r.consoleErrors.length > 0 ? `${r.consoleErrors.length} console.error(s)` : '',
      r.errorBanners.length > 0 ? `banner: ${r.errorBanners[0]}` : '',
      r.visibleErrorElements.length > 0 ? `visible error element` : '',
    ]
      .filter(Boolean)
      .join('; ') || '-';

    console.log(
      `${r.tab.padEnd(18)} ${result.padEnd(6)} ${uncaughtStr.padEnd(40)} ${failApiStr.padEnd(50)} ${notes}`
    );
  }

  console.log('─'.repeat(120));

  // ── Detailed failures ─────────────────────────────────────────────────────
  const failures = results.filter(
    (r) =>
      r.consoleErrors.length > 0 ||
      r.uncaughtExceptions.length > 0 ||
      r.failingApis.length > 0 ||
      r.errorBanners.length > 0 ||
      r.visibleErrorElements.length > 0
  );

  if (failures.length > 0) {
    console.log('\n── FAILURE DETAILS ──────────────────────────────────────────────────────────');
    for (const r of failures) {
      console.log(`\n[${r.tab}]`);
      if (r.uncaughtExceptions.length > 0) {
        console.log('  Uncaught JS exceptions:');
        r.uncaughtExceptions.forEach((e) => console.log(`    • ${e}`));
      }
      if (r.consoleErrors.length > 0) {
        console.log('  console.error messages:');
        r.consoleErrors.forEach((e) => console.log(`    • ${e}`));
      }
      if (r.failingApis.length > 0) {
        console.log('  Failing /api/rainbow/* requests:');
        r.failingApis.forEach((f) => console.log(`    • ${f.status} ${f.url}`));
      }
      if (r.errorBanners.length > 0) {
        console.log('  Error banners (text match):');
        r.errorBanners.forEach((b) => console.log(`    • ${b}`));
      }
      if (r.visibleErrorElements.length > 0) {
        console.log('  Visible error elements:');
        r.visibleErrorElements.forEach((e) => console.log(`    • [${e.selector}] "${e.text}"`));
      }
    }
  }

  // ── Remaining-work list ───────────────────────────────────────────────────
  console.log('\n── ALL /api/rainbow/* REQUESTS ≥400 (DISTINCT, across all tabs) ──────────');
  if (allFailingApis.size === 0) {
    console.log('  None — all API requests returned 2xx/3xx.');
  } else {
    for (const [key, count] of [...allFailingApis.entries()].sort()) {
      console.log(`  [×${count}] ${key}`);
    }
  }

  console.log(`\n── Screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log(`── Total tabs audited: ${results.length}`);
  const passCount = results.filter(
    (r) =>
      r.consoleErrors.length === 0 &&
      r.uncaughtExceptions.length === 0 &&
      r.failingApis.length === 0 &&
      r.errorBanners.length === 0 &&
      r.visibleErrorElements.length === 0
  ).length;
  console.log(`── PASS: ${passCount}  FAIL: ${results.length - passCount}\n`);
}

main().catch((err) => {
  console.error('Audit script crashed:', err);
  process.exit(1);
});
