/**
 * smoke-admin-tabs.mjs
 * Final acceptance smoke test for Rainbow Admin Dashboard
 * Tests all tabs for user-visible errors (uncaught JS exceptions + visible error banners/toasts)
 *
 * Usage: node scripts/smoke-admin-tabs.mjs
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = 'http://5.223.54.57:3003';
const PROFILE = 'pelangi';
const SCREENSHOT_DIR = path.join(__dirname, '..', 'tmp', 'smoke-screenshots');

// Admin key from .env RAINBOW_PEER_ADMIN_KEY
const ADMIN_KEY = '6b640ec46a33caace9490488b002ebc5fdadb631d8636f2758a40cb505659fdd';

// All tabs the user wants tested — maps user-facing name => hash fragment
// Tabs not in the HTML sidebar will still be navigated and observed
const TABS = [
  { name: 'dashboard',       hash: 'dashboard'     },
  { name: 'understanding',   hash: 'understanding' },
  { name: 'responses',       hash: 'responses'     },
  { name: 'intents',         hash: 'intents'       },
  { name: 'chat-simulator',  hash: 'chat-simulator'},
  { name: 'testing',         hash: 'testing'       },
  { name: 'performance',     hash: 'performance'   },
  { name: 'settings',        hash: 'settings'      },
  { name: 'help',            hash: 'help'          },
  { name: 'intent-manager',  hash: 'intent-manager'},
  { name: 'static-replies',  hash: 'static-replies'},
  { name: 'kb',              hash: 'kb'            },
  { name: 'preview',         hash: 'preview'       },
  { name: 'real-chat',       hash: 'live-chat'     },
  { name: 'workflow',        hash: 'workflow'      },
];

// Error text patterns that count as user-visible failures
const ERROR_PATTERNS = [
  /failed to load/i,
  /something went wrong/i,
  /error loading/i,
  /unable to load/i,
  /could not load/i,
  /network error/i,
  /fetch failed/i,
];

function isErrorText(text) {
  return ERROR_PATTERNS.some(p => p.test(text));
}

async function scanForVisibleErrors(page) {
  const selectors = [
    '#toast-container',
    '.toast',
    '[class*="toast"]',
    '[role="alert"]',
    '.text-red-500',
    '.text-red-600',
    '.text-red-700',
  ];
  const errors = [];
  for (const sel of selectors) {
    try {
      const elements = await page.$$(sel);
      for (const el of elements) {
        const visible = await el.isVisible();
        if (!visible) continue;
        const text = (await el.innerText()).trim();
        if (text && isErrorText(text)) {
          errors.push({ selector: sel, text: text.substring(0, 200) });
        }
      }
    } catch (_) {}
  }
  return errors;
}

async function main() {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Inject window.__ADMIN_KEY__ and fetch-patch before page scripts run
  await context.addInitScript((key) => {
    window.__ADMIN_KEY__ = key;
    const _f = window.fetch;
    window.fetch = function(url, opts) {
      opts = opts || {};
      if (typeof url === 'string' && url.indexOf('/api/rainbow/') >= 0 && window.__ADMIN_KEY__) {
        const hdrs = opts.headers || {};
        const hasKey = Object.keys(hdrs).some(k => k.toLowerCase() === 'x-admin-key');
        if (!hasKey) {
          opts = Object.assign({}, opts, { headers: Object.assign({ 'x-admin-key': window.__ADMIN_KEY__ }, hdrs) });
        }
      }
      return _f.call(this, url, opts);
    };
  }, ADMIN_KEY);

  const results = [];

  for (const tab of TABS) {
    const url = `${BASE_URL}/#${tab.hash}/${PROFILE}`;
    const page = await context.newPage();

    const uncaughtErrors = [];
    const consoleErrors = [];

    // Attach listeners BEFORE navigation
    page.on('pageerror', err => { uncaughtErrors.push(err.message); });
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

    let navError = null;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
    } catch (e) {
      navError = e.message;
    }

    // Wait additional 1.5s for async renders / toasts
    await page.waitForTimeout(1500);

    const visibleErrors = await scanForVisibleErrors(page);

    const screenshotPath = path.join(SCREENSHOT_DIR, `${tab.name}.png`);
    try { await page.screenshot({ path: screenshotPath, fullPage: false }); } catch (_) {}

    const hasFail = !!navError || uncaughtErrors.length > 0 || visibleErrors.length > 0;
    const errorDetails = [];
    if (navError) errorDetails.push(`NAV_ERROR: ${navError}`);
    uncaughtErrors.forEach(e => errorDetails.push(`UNCAUGHT: ${e.substring(0, 250)}`));
    visibleErrors.forEach(e => errorDetails.push(`VISIBLE[${e.selector}]: ${e.text}`));

    results.push({ tab: tab.name, pass: !hasFail, errors: errorDetails, consoleErrors: consoleErrors.slice(0, 5) });

    console.log(`  [${!hasFail ? 'PASS' : 'FAIL'}] ${tab.name}${errorDetails.length > 0 ? ' — ' + errorDetails[0].substring(0, 80) : ''}`);

    await page.close();
  }

  await browser.close();

  console.log('\n');
  console.log('| Tab              | Status   | Visible error text                                 |');
  console.log('|------------------|----------|----------------------------------------------------|');
  let passCount = 0;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    const errorText = r.errors.length > 0 ? r.errors[0].substring(0, 50) : '';
    console.log(`| ${r.tab.padEnd(16)} | ${status.padEnd(8)} | ${errorText.padEnd(50)} |`);
    if (r.pass) passCount++;
  }

  console.log(`\n${passCount}/${results.length} visibly clean.\n`);

  const failures = results.filter(r => !r.pass);
  if (failures.length === 0) {
    console.log('All tabs PASS. Zero user-visible errors detected.\n');
  } else {
    console.log('=== REMAINING FAILURES (detail) ===\n');
    for (const f of failures) {
      console.log(`TAB: ${f.tab}`);
      f.errors.forEach(e => console.log(`  ERROR: ${e}`));
      if (f.consoleErrors.length > 0) {
        console.log('  CONSOLE ERRORS:');
        f.consoleErrors.forEach(e => console.log(`    ${e.substring(0, 300)}`));
      }
      console.log('');
    }
  }

  console.log(`Screenshots: ${SCREENSHOT_DIR}\n`);
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => { console.error('Smoke test fatal error:', err); process.exit(2); });
