/**
 * website-kb-sync.ts — Syncs knowledge from the Pelangi website's /api/kb endpoint
 * into the local .rainbow-kb directory as supplementary markdown files.
 *
 * Strategy: ADDITIVE only. Existing operational KB files (pricing.md, location.md,
 * houserules.md, etc.) are never touched. This sync writes two new files that contain
 * content unique to the website — blog guides and published FAQs — which the RAG system
 * will pick up automatically via hot-reload.
 *
 * Files written:
 *   .rainbow-kb/website-blog.md  — neighborhood guides, food posts, travel tips
 *   .rainbow-kb/website-faqs.md  — polished public-facing FAQs from the website
 *
 * Called on startup (after KB init) and then every 24 hours.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PELANGI_WEBSITE_URL =
  process.env.PELANGI_WEBSITE_URL || 'https://pelangicapsulehostel.com';

const KB_DIR =
  process.env.RAINBOW_KB_DIR || resolve(__dirname, '..', '..', '.rainbow-kb');

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface KbPayload {
  version: string;
  property: string;
  updatedAt: string;
  sections: {
    rooms: string;
    faqs: string;
    location: string;
    policies: string;
    blog: string;
  };
}

async function fetchKbPayload(): Promise<KbPayload> {
  const url = `${PELANGI_WEBSITE_URL}/api/kb`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'rainbow-ai/kb-sync' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`/api/kb responded ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<KbPayload>;
}

export async function syncWebsiteKb(): Promise<void> {
  let payload: KbPayload;
  try {
    payload = await fetchKbPayload();
  } catch (err: any) {
    console.warn(`[WebsiteKBSync] Fetch failed (non-fatal): ${err.message}`);
    return;
  }

  try {
    mkdirSync(KB_DIR, { recursive: true });

    const header = `<!-- Auto-synced from ${PELANGI_WEBSITE_URL}/api/kb — do not edit manually -->\n<!-- Last sync: ${new Date().toISOString()} -->\n\n`;

    writeFileSync(
      resolve(KB_DIR, 'website-faqs.md'),
      header + payload.sections.faqs,
      'utf8'
    );

    writeFileSync(
      resolve(KB_DIR, 'website-blog.md'),
      header + payload.sections.blog,
      'utf8'
    );

    console.log(
      `[WebsiteKBSync] Synced website KB (property: ${payload.property}, updatedAt: ${payload.updatedAt})`
    );
  } catch (err: any) {
    console.warn(`[WebsiteKBSync] Write failed (non-fatal): ${err.message}`);
  }
}

let _timer: NodeJS.Timeout | null = null;

export function startWebsiteKbSync(): void {
  // Fire immediately on startup, then repeat every 24h
  syncWebsiteKb().catch(() => {});

  _timer = setInterval(() => {
    syncWebsiteKb().catch(() => {});
  }, SYNC_INTERVAL_MS);

  // Don't let this timer prevent process exit
  _timer.unref();
}

export function stopWebsiteKbSync(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
