/**
 * Quick check: verify the fetch interceptor injects X-Admin-Key,
 * and confirm which routes return 200 vs 404 with auth.
 */
import { chromium } from 'playwright';

const BASE = 'http://5.223.54.57:3003';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const requestHeaders = new Map();
  const responses = new Map();

  page.on('request', (req) => {
    if (req.url().includes('/api/rainbow/')) {
      requestHeaders.set(req.url(), req.headers());
    }
  });

  page.on('response', (resp) => {
    if (resp.url().includes('/api/rainbow/')) {
      responses.set(resp.url(), resp.status());
    }
  });

  await page.goto(`${BASE}/#dashboard/pelangi`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  console.log('\n── API requests made by browser on #dashboard/pelangi ──');
  for (const [url, status] of responses.entries()) {
    const hdrs = requestHeaders.get(url) || {};
    const hasKey = !!hdrs['x-admin-key'];
    const path = new URL(url).pathname + new URL(url).search;
    console.log(`  ${String(status).padEnd(4)} key=${hasKey ? 'YES' : 'NO '} ${path}`);
  }

  // Also check the admin key injected in the page
  const adminKey = await page.evaluate(() => window.__ADMIN_KEY__);
  console.log(`\n  window.__ADMIN_KEY__ = ${adminKey ? adminKey.slice(0, 16) + '...' : 'NOT SET'}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
