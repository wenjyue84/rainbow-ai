/**
 * US-896: Webchat widget dark-mode visual regression test.
 *
 * Prerequisites:
 *   npm i -D @playwright/test
 *   npx playwright install chromium
 *
 * Run:
 *   npx playwright test e2e/webchat-dark-mode.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

test.describe('Webchat dark mode', () => {
  test('renders dark palette when OS prefers dark', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();

    await page.goto(`${BASE}/chat/pelangi`);
    await page.waitForSelector('.header');

    // Verify CSS variables resolved to dark palette
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(bg).toBe('#0f172a');

    // Screenshot for visual comparison
    await page.screenshot({ path: 'e2e/screenshots/webchat-dark.png', fullPage: true });

    await context.close();
  });

  test('renders light palette when OS prefers light', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    await page.goto(`${BASE}/chat/pelangi`);
    await page.waitForSelector('.header');

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(bg).toBe('#f8fafc');

    await context.close();
  });

  test('forced dark theme via query param ignores OS light preference', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'light' });
    const page = await context.newPage();

    await page.goto(`${BASE}/chat/pelangi?theme=dark`);
    await page.waitForSelector('.header');

    const hasDarkClass = await page.evaluate(() =>
      document.documentElement.classList.contains('dark-theme'),
    );
    expect(hasDarkClass).toBe(true);

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(bg).toBe('#0f172a');

    await page.screenshot({ path: 'e2e/screenshots/webchat-dark-forced.png', fullPage: true });

    await context.close();
  });

  test('forced light theme via query param ignores OS dark preference', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();

    await page.goto(`${BASE}/chat/pelangi?theme=light`);
    await page.waitForSelector('.header');

    const hasLightClass = await page.evaluate(() =>
      document.documentElement.classList.contains('light-theme'),
    );
    expect(hasLightClass).toBe(true);

    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    );
    expect(bg).toBe('#f8fafc');

    await context.close();
  });
});
