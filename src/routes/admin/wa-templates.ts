/**
 * Admin API: WhatsApp Template Validator (US-906) + Utility Template Linter Config (US-1013)
 *
 * POST /wa-templates/validate
 *   — Validates a template body for common rejection triggers.
 *   — Returns warnings array; empty array means no issues found.
 *   — Intended for real-time client-side use as admin types.
 *
 * PUT  /wa-templates/:name
 *   — Stores/updates a WA message template definition.
 *   — Runs server-side validation and logs validation_warnings field.
 *
 * GET  /wa-templates/linter-config
 *   — Returns current linter keyword config (US-1013).
 *
 * PUT  /wa-templates/linter-config
 *   — Updates linter keyword list; persists to settings (US-1013).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { validateTemplate, DEFAULT_PROMO_KEYWORDS } from '../../lib/template-validator.js';
import { badRequest, ok, getStore } from './http-utils.js';
import { createModuleLogger } from '../../lib/logger.js';

const router = Router();
const log = createModuleLogger('wa-templates');

// ─── In-memory template store per profile ─────────────────────────────────────
// Maps profileId -> { [templateName]: body }
// A real implementation would persist to the DB; this lightweight store is
// sufficient for validation purposes (duplicate-body detection requires the list).
const templateStore = new Map<string, Map<string, string>>();

function getProfileTemplates(profileId: string): string[] {
  const map = templateStore.get(profileId);
  if (!map) return [];
  return Array.from(map.values());
}

// ─── POST /wa-templates/validate ─────────────────────────────────────────────

router.post('/wa-templates/validate', (req: Request, res: Response) => {
  const { body: templateBody, existingTemplates, promoKeywords } = req.body as {
    body?: string;
    existingTemplates?: string[];
    promoKeywords?: string[];
  };

  if (!templateBody || typeof templateBody !== 'string') {
    badRequest(res, 'body (string) is required');
    return;
  }

  const existing = Array.isArray(existingTemplates) ? existingTemplates : [];
  const keywords = Array.isArray(promoKeywords) ? promoKeywords : DEFAULT_PROMO_KEYWORDS;

  const warnings = validateTemplate(templateBody, existing, keywords);

  ok(res, { warnings, valid: warnings.filter(w => w.severity === 'error').length === 0 });
});

// ─── PUT /wa-templates/:name ──────────────────────────────────────────────────

router.put('/wa-templates/:name', (req: Request, res: Response) => {
  const { name } = req.params as { name: string };
  const { body: templateBody, category, promoKeywords } = req.body as {
    body?: string;
    category?: string;
    promoKeywords?: string[];
  };

  if (!templateBody || typeof templateBody !== 'string') {
    badRequest(res, 'body (string) is required');
    return;
  }

  // Sanitize template name (prevent directory traversal / injection)
  const safeName = name.replace(/[^a-z0-9_-]/gi, '');
  if (!safeName) {
    badRequest(res, 'Invalid template name');
    return;
  }

  const profileId = (req.headers['x-profile-id'] as string) || 'default';

  // Fetch existing templates for this profile (excluding current name being updated)
  if (!templateStore.has(profileId)) {
    templateStore.set(profileId, new Map());
  }
  const profileMap = templateStore.get(profileId)!;
  const existingBodies = getProfileTemplates(profileId).filter((_, idx) => {
    const keys = Array.from(profileMap.keys());
    return keys[idx] !== safeName;
  });

  const keywords = Array.isArray(promoKeywords) ? promoKeywords : DEFAULT_PROMO_KEYWORDS;
  const validationWarnings = validateTemplate(templateBody, existingBodies, keywords);

  // Log server-side validation warnings
  if (validationWarnings.length > 0) {
    log.warn(`Template "${safeName}" (profile: ${profileId}) has ${validationWarnings.length} validation warning(s)`, {
      templateName: safeName,
      profileId,
      validation_warnings: validationWarnings,
    });
  }

  // Persist to in-memory store
  profileMap.set(safeName, templateBody);

  ok(res, {
    templateName: safeName,
    category: category || 'utility',
    validation_warnings: validationWarnings,
    valid: validationWarnings.filter(w => w.severity === 'error').length === 0,
  });
});

// ─── GET /wa-templates ────────────────────────────────────────────────────────

router.get('/wa-templates', (req: Request, res: Response) => {
  const profileId = (req.headers['x-profile-id'] as string) || 'default';
  const profileMap = templateStore.get(profileId);

  const templates = profileMap
    ? Array.from(profileMap.entries()).map(([name, body]) => ({ name, body }))
    : [];

  ok(res, { templates });
});

// ─── GET /wa-templates/linter-config (US-1013) ───────────────────────────────

router.get('/wa-templates/linter-config', (req: Request, res: Response) => {
  const settings = getStore(res).getSettings() as any;
  const linterConfig = settings.templateLinter || {};
  const keywords: string[] = Array.isArray(linterConfig.marketingKeywords)
    ? linterConfig.marketingKeywords
    : DEFAULT_PROMO_KEYWORDS;
  const enabled: boolean = linterConfig.enabled !== false;

  ok(res, { enabled, marketingKeywords: keywords });
});

// ─── PUT /wa-templates/linter-config (US-1013) ───────────────────────────────

router.put('/wa-templates/linter-config', (req: Request, res: Response) => {
  const { enabled, marketingKeywords } = req.body as {
    enabled?: boolean;
    marketingKeywords?: string[] | null;
  };

  // null means "reset to defaults" — treat same as undefined (omit from update)
  const kws = marketingKeywords === null ? undefined : marketingKeywords;
  if (kws !== undefined && !Array.isArray(kws)) {
    badRequest(res, 'marketingKeywords must be an array of strings');
    return;
  }
  if (kws !== undefined && kws.some((k: unknown) => typeof k !== 'string')) {
    badRequest(res, 'All marketingKeywords must be strings');
    return;
  }

  const store = getStore(res);
  const settings = store.getSettings() as any;
  const existing = settings.templateLinter || {};

  const updated = {
    ...existing,
    ...(enabled !== undefined ? { enabled } : {}),
    ...(kws !== undefined ? { marketingKeywords: kws } : {}),
  };
  settings.templateLinter = updated;
  store.setSettings(settings);

  log.info('Template linter config updated', { enabled: updated.enabled, keywordCount: (updated.marketingKeywords || []).length });

  ok(res, { enabled: updated.enabled !== false, marketingKeywords: updated.marketingKeywords || DEFAULT_PROMO_KEYWORDS });
});

export default router;
