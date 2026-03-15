/**
 * MM Lite Admin API (US-1007)
 *
 * Exposes MM Lite configuration, campaign send, and A/B delivery benchmark.
 *
 * GET  /mm-lite/settings              — current MM Lite settings
 * PUT  /mm-lite/settings              — update enabled flag, default TTL, phone number ID
 * POST /mm-lite/send                  — send marketing template to one recipient via MM Lite
 * GET  /analytics/mm-lite/benchmark   — A/B delivery rate comparison (MM Lite vs standard)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getMmLiteSettings,
  saveMmLiteSettings,
  sendMmLiteTemplate,
  queryMmLiteBenchmark,
  MM_LITE_MIN_TTL_HOURS,
  MM_LITE_MAX_TTL_HOURS,
} from '../../lib/mm-lite.js';
import { badRequest, ok, serverError } from './http-utils.js';
import { createModuleLogger } from '../../lib/logger.js';

const router = Router();
const log = createModuleLogger('MmLiteAdmin');

// ─── GET /mm-lite/settings ─────────────────────────────────────────────────

/**
 * Returns current MM Lite configuration.
 *
 * Response:
 *   { ok: true, settings: { enabled, defaultTtlHours, phoneNumberId } }
 */
router.get('/mm-lite/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await getMmLiteSettings();
    // Mask the phone number ID for display (show last 4 chars only)
    const maskedPhoneNumberId = settings.phoneNumberId
      ? `...${settings.phoneNumberId.slice(-4)}`
      : null;
    ok(res, {
      settings: {
        enabled: settings.enabled,
        defaultTtlHours: settings.defaultTtlHours,
        phoneNumberId: maskedPhoneNumberId,
        minTtlHours: MM_LITE_MIN_TTL_HOURS,
        maxTtlHours: MM_LITE_MAX_TTL_HOURS,
      },
    });
  } catch (err) {
    serverError(res, err instanceof Error ? err : new Error('Failed to load MM Lite settings'));
  }
});

// ─── PUT /mm-lite/settings ─────────────────────────────────────────────────

/**
 * Update MM Lite settings.
 *
 * Body (all fields optional):
 *   { enabled?: boolean, defaultTtlHours?: number (12-720), phoneNumberId?: string }
 */
router.put('/mm-lite/settings', async (req: Request, res: Response) => {
  try {
    const { enabled, defaultTtlHours, phoneNumberId } = req.body as {
      enabled?: boolean;
      defaultTtlHours?: number;
      phoneNumberId?: string;
    };

    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return badRequest(res, 'enabled must be a boolean');
    }
    if (defaultTtlHours !== undefined) {
      if (typeof defaultTtlHours !== 'number' || !Number.isInteger(defaultTtlHours)) {
        return badRequest(res, 'defaultTtlHours must be an integer');
      }
      if (defaultTtlHours < MM_LITE_MIN_TTL_HOURS || defaultTtlHours > MM_LITE_MAX_TTL_HOURS) {
        return badRequest(res, `defaultTtlHours must be between ${MM_LITE_MIN_TTL_HOURS} and ${MM_LITE_MAX_TTL_HOURS}`);
      }
    }
    if (phoneNumberId !== undefined && typeof phoneNumberId !== 'string') {
      return badRequest(res, 'phoneNumberId must be a string');
    }

    await saveMmLiteSettings({ enabled, defaultTtlHours, phoneNumberId });

    log.info('MM Lite settings updated', {
      enabled,
      defaultTtlHours,
      phoneNumberIdProvided: !!phoneNumberId,
    });

    const updated = await getMmLiteSettings();
    ok(res, {
      message: 'MM Lite settings updated',
      settings: {
        enabled: updated.enabled,
        defaultTtlHours: updated.defaultTtlHours,
        phoneNumberId: updated.phoneNumberId ? `...${updated.phoneNumberId.slice(-4)}` : null,
      },
    });
  } catch (err) {
    serverError(res, err instanceof Error ? err : new Error('Failed to update MM Lite settings'));
  }
});

// ─── POST /mm-lite/send ─────────────────────────────────────────────────────

/**
 * Send a marketing template to a single recipient via MM Lite (or standard path).
 *
 * Body:
 *   {
 *     phone: string,
 *     profileId?: string,            (default: "pelangi")
 *     campaignId: string,            (e.g. "makan-daily-2026-03-16")
 *     templateName: string,
 *     templateLanguage?: string,     (default: "en")
 *     components?: TemplateComponent[],
 *     ttlHours?: number,             (12-720, overrides defaultTtlHours)
 *     useStandardApi?: boolean,      (true = A/B control: send without MM Lite)
 *   }
 */
router.post('/mm-lite/send', async (req: Request, res: Response) => {
  try {
    const {
      phone,
      profileId = 'pelangi',
      campaignId,
      templateName,
      templateLanguage,
      components,
      ttlHours,
      useStandardApi,
    } = req.body as {
      phone?: string;
      profileId?: string;
      campaignId?: string;
      templateName?: string;
      templateLanguage?: string;
      components?: any[];
      ttlHours?: number;
      useStandardApi?: boolean;
    };

    if (!phone || typeof phone !== 'string') {
      return badRequest(res, 'phone is required');
    }
    if (!campaignId || typeof campaignId !== 'string') {
      return badRequest(res, 'campaignId is required');
    }
    if (!templateName || typeof templateName !== 'string') {
      return badRequest(res, 'templateName is required');
    }
    if (ttlHours !== undefined) {
      if (typeof ttlHours !== 'number' || !Number.isInteger(ttlHours)) {
        return badRequest(res, 'ttlHours must be an integer');
      }
      if (ttlHours < MM_LITE_MIN_TTL_HOURS || ttlHours > MM_LITE_MAX_TTL_HOURS) {
        return badRequest(res, `ttlHours must be between ${MM_LITE_MIN_TTL_HOURS} and ${MM_LITE_MAX_TTL_HOURS}`);
      }
    }

    const result = await sendMmLiteTemplate({
      phone,
      profileId,
      campaignId,
      templateName,
      templateLanguage,
      components,
      ttlHours,
      useStandardApi,
    });

    if (!result.success) {
      return res.status(502).json({
        ok: false,
        error: result.errorInfo || 'MM Lite send failed',
        sendId: result.sendId,
        sendApi: result.sendApi,
      });
    }

    ok(res, {
      sendId: result.sendId,
      metaMessageId: result.metaMessageId,
      sendApi: result.sendApi,
      ttlHours: result.ttlHours,
      ttlExpiresAt: result.ttlExpiresAt?.toISOString() ?? null,
    });
  } catch (err) {
    serverError(res, err instanceof Error ? err : new Error('Failed to send via MM Lite'));
  }
});

// ─── GET /analytics/mm-lite/benchmark ─────────────────────────────────────

/**
 * A/B delivery benchmark: MM Lite vs standard send path.
 *
 * Query params:
 *   days?: number  (1-90, default 7)
 *
 * Response includes delivery rates for each send path and the uplift delta.
 */
router.get('/analytics/mm-lite/benchmark', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const benchmark = await queryMmLiteBenchmark(days);
    ok(res, { benchmark, queryDays: days });
  } catch (err) {
    log.error('MM Lite benchmark query failed', { err: (err as Error).message });
    serverError(res, err instanceof Error ? err : new Error('Failed to query MM Lite benchmark'));
  }
});

export default router;
