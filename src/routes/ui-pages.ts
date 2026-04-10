/**
 * ui-pages.ts — Express Router for HTML page endpoints
 *
 * Handles: GET / (dashboard), GET /admin/rainbow (redirect),
 *          GET /admin/whatsapp-qr, GET /chat/:profileId (webchat)
 *
 * Extracted from index.ts to keep that file manageable.
 * Uses a factory function to receive a lazy ref to viteDevServer.
 */

import { Router } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { safeRedirect } from '../lib/safe-redirect.js';
import { getWhatsAppStatus } from '../lib/baileys-client.js';
import { profileRegistry } from '../assistant/profile-registry.js';
import { computeAvailability } from '../assistant/business-hours.js';
import type { BusinessHoursConfig } from '../assistant/business-hours.js';

// ─── Dashboard HTML helpers ──────────────────────────────────────────────────

function loadDashboardHtml(dashboardHtmlPath: string): string {
  return readFileSync(dashboardHtmlPath, 'utf-8');
}

async function getDashboardHtml(
  dashboardHtmlPath: string,
  nonce: string,
  viteDevServer: any,
): Promise<string> {
  if (viteDevServer) {
    // Dev: read fresh from disk, inject Vite HMR client manually.
    // We skip transformIndexHtml because it double-prefixes /public/ URLs
    // (HTML already uses absolute /public/... paths, and Vite prepends base again).
    // Vite's middleware still serves files correctly (strips base from requests).
    let html = readFileSync(dashboardHtmlPath, 'utf-8');
    html = html.replace(/__CSP_NONCE__/g, nonce);
    const adminKeyDev = process.env.RAINBOW_ADMIN_KEY || '';
    html = html.replace('<head>', `<head>\n  <script nonce="${nonce}">window.__ADMIN_KEY__=${JSON.stringify(adminKeyDev)};</script>\n  <script type="module" src="/public/@vite/client"></script>`);
    return html;
  }
  // Prod: use cached HTML with cache-bust
  let html = loadDashboardHtml(dashboardHtmlPath);
  html = html.replace(/__CSP_NONCE__/g, nonce);
  const v = Date.now();
  html = html.replace(/(src|href)="(\/public\/[^"]+\.(js|css))"/g, `$1="$2?v=${v}"`);
  // Inject admin key + fetch interceptor for remote browser access.
  // tabs.js / template-loader.js use raw fetch() (not api()), so we patch window.fetch globally
  // to auto-add X-Admin-Key on all /api/rainbow/ requests.
  const adminKey = process.env.RAINBOW_ADMIN_KEY || '';
  const interceptorScript = `<script nonce="${nonce}">
window.__ADMIN_KEY__=${JSON.stringify(adminKey)};
(function(){var _f=window.fetch;window.fetch=function(url,opts){opts=opts||{};if(typeof url==='string'&&url.indexOf('/api/rainbow/')>=0&&window.__ADMIN_KEY__){var h=Object.assign({'x-admin-key':window.__ADMIN_KEY__},opts.headers||{});opts=Object.assign({},opts,{headers:h});}return _f.call(this,url,opts);};})();
</script>`;
  html = html.replace('<head>', `<head>\n  ${interceptorScript}`);
  return html;
}

// ─── Router factory ──────────────────────────────────────────────────────────

/**
 * Create the UI page router.
 *
 * @param getViteServer - lazy getter for the Vite dev server (null in production)
 * @param dirMain      - __dirname equivalent for src/index.ts (resolves public/ paths)
 */
export function createUiPageRoutes(
  getViteServer: () => any,
  dirMain: string,
): Router {
  const router = Router();

  const DASHBOARD_HTML_PATH = join(dirMain, 'public', 'rainbow-admin.html');
  const WEBCHAT_HTML_PATH = join(dirMain, 'public', 'webchat.html');

  // Eagerly cache dashboard HTML for production (refreshed on each request in dev)
  // Rainbow Admin Dashboard - Root path only
  // Backward compatibility: redirect old /admin/rainbow routes to hash-based dashboard.
  router.get(['/admin/rainbow', '/admin/rainbow/{*rest}'], (req, res) => {
    const subPath = req.path.replace(/^\/admin\/rainbow\/?/, '');
    const hash = subPath ? `#${subPath}` : '#dashboard';
    safeRedirect(res, `/${hash}`);
  });

  router.get('/', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.setHeader('Surrogate-Control', 'no-store');
      res.type('html').send(await getDashboardHtml(DASHBOARD_HTML_PATH, res.locals.cspNonce, getViteServer()));
    } catch {
      res.status(500).send('Dashboard file not found');
    }
  });

  // WhatsApp QR code pairing endpoint (temporary - remove after pairing)
  router.get('/admin/whatsapp-qr', async (req, res) => {
    const status = getWhatsAppStatus();
    if (status.state === 'open') {
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>WhatsApp Connected</h2>
      <p>Account: ${status.user?.name || 'Unknown'} (${status.user?.phone || '?'})</p>
      <p style="color:green;font-size:24px">Already paired!</p>
    </body></html>`);
      return;
    }
    if (!status.qr) {
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>WhatsApp QR Code</h2>
      <p>No QR code available yet. Status: <b>${status.state}</b></p>
      <p>Waiting for Baileys to generate QR code...</p>
      <script>setTimeout(()=>location.reload(),3000)</script>
    </body></html>`);
      return;
    }
    try {
      const QRCode = await import('qrcode');
      const qrImage = await QRCode.default.toDataURL(status.qr);
      res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Scan with WhatsApp</h2>
      <img src="${qrImage}" style="width:300px;height:300px" />
      <p>Open WhatsApp > Linked Devices > Link a Device</p>
      <script>setTimeout(()=>location.reload(),5000)</script>
    </body></html>`);
    } catch (err: any) {
      console.error('[QR] QR code generation failed:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Webchat page — serves branded chat UI per profile
  router.get('/chat/:profileId', (req, res) => {
    const { profileId } = req.params;
    const profile = profileRegistry.getProfile(profileId);

    if (!profile) {
      // Friendly 404 with valid profile links
      const validProfiles = profileRegistry.listProfiles();
      const links = validProfiles.map(p =>
        `<li><a href="/chat/${p.id}">${p.name}</a></li>`
      ).join('\n');
      res.status(404).send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Profile Not Found</h2>
      <p>"${profileId}" is not a valid profile.</p>
      <p>Available profiles:</p>
      <ul style="list-style:none;padding:0">${links}</ul>
    </body></html>`);
      return;
    }

    // Read webchat HTML and inject profile config
    try {
      const html = readFileSync(WEBCHAT_HTML_PATH, 'utf-8');
      const settings = profile.configStore.getSettings() as any;
      const greeting = settings?.greeting
        || `Hello! I'm the AI assistant for ${profile.name}. How can I help you today?`;
      // US-846: Compute availability from business hours config
      const businessHours: BusinessHoursConfig | undefined = settings?.businessHours;
      const { isAvailable, nextOpenTime } = computeAvailability(businessHours);
      // US-905: Webchat onboarding quick-reply buttons
      const onboarding = settings?.webchat_onboarding?.enabled
        ? { enabled: true, buttons: settings.webchat_onboarding.buttons || [] }
        : undefined;
      const profileData = JSON.stringify({
        id: profile.id,
        name: profile.name,
        greeting,
        isAvailable,
        nextOpenTime,
        onboarding,
      });
      const nonce = res.locals.cspNonce;
      // US-1040: Inject nonce into both the profile config script and the main webchat IIFE
      // to comply with Helmet's script-src 'self' 'nonce-xxx' CSP policy.
      let injected = html.replace(
        '<head>',
        `<head>\n  <script nonce="${nonce}">window.__WEBCHAT_PROFILE__=${profileData};</script>`
      );
      // Add nonce to the main inline <script> in the body (webchat IIFE)
      injected = injected.replace(
        /(<script>)\s*\n(\s*\(function\(\)\s*\{)/,
        `<script nonce="${nonce}">\n$2`
      );
      res.type('html').send(injected);
    } catch {
      res.status(500).send('Webchat page not found');
    }
  });

  return router;
}
