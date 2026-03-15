/**
 * mm-lite.ts — WhatsApp Marketing Messages Lite (MM Lite) API (US-1007)
 *
 * Meta's MM Lite API delivers marketing templates via AI-optimised delivery timing,
 * yielding up to 30% higher delivery rates compared to the standard send path.
 * A configurable TTL (12 hours – 30 days) ensures expired flash-sale messages are
 * never delivered late.
 *
 * Key behaviours:
 * - Routes marketing sends through Cloud API with ttl.seconds set when mm_lite_enabled=true
 * - Default TTL: 30 days (720h / 2592000 seconds)
 * - Admin may override TTL per campaign (12h minimum, 720h maximum)
 * - TTL expiry is tracked in mm_lite_sends; a background sweeper marks expired rows
 * - Sends are tagged sendApi='mm_lite' or sendApi='standard' for A/B benchmarking
 *
 * NOTE: MM Lite requires:
 *   1. Cloud API access (META_ACCESS_TOKEN + WABA_PHONE_NUMBER_ID env vars)
 *   2. WABA opt-in (enabled in WhatsApp Manager)
 *   3. Pre-approved template names (marketing category)
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/
 */

import { pool } from './db.js';
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('MmLite');

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default TTL: 30 days in hours */
export const MM_LITE_DEFAULT_TTL_HOURS = 720;
/** Minimum allowed TTL: 12 hours */
export const MM_LITE_MIN_TTL_HOURS = 12;
/** Maximum allowed TTL: 30 days in hours */
export const MM_LITE_MAX_TTL_HOURS = 720;
/** Meta Cloud API graph version */
const GRAPH_API_VERSION = 'v21.0';
/** Base URL for Meta Cloud API */
const GRAPH_BASE = 'https://graph.facebook.com';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MmLiteSettings {
  enabled: boolean;
  defaultTtlHours: number;
  phoneNumberId: string | null;
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters?: Array<{ type: string; text?: string; [key: string]: any }>;
  sub_type?: string;
  index?: number;
}

export interface SendMmLiteTemplateOptions {
  phone: string;
  profileId: string;
  campaignId: string;
  templateName: string;
  templateLanguage?: string;
  components?: TemplateComponent[];
  /** TTL in hours (12-720). Overrides default if provided. */
  ttlHours?: number;
  /** If true, bypasses MM Lite and uses standard send path (for A/B control group) */
  useStandardApi?: boolean;
}

export interface SendMmLiteTemplateResult {
  success: boolean;
  sendId: string | null;
  metaMessageId: string | null;
  sendApi: 'mm_lite' | 'standard';
  ttlHours: number;
  ttlExpiresAt: Date | null;
  errorInfo: string | null;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

/**
 * Load MM Lite settings from app_settings table.
 * Falls back to env vars / defaults if DB unavailable.
 */
export async function getMmLiteSettings(): Promise<MmLiteSettings> {
  try {
    const result = await pool.query(
      `SELECT key, value FROM app_settings WHERE key IN ('mm_lite_enabled', 'mm_lite_default_ttl_hours', 'mm_lite_phone_number_id')`
    );
    const rows: Record<string, string> = {};
    for (const row of result.rows) {
      rows[row.key] = row.value;
    }
    return {
      enabled: rows['mm_lite_enabled'] === 'true',
      defaultTtlHours: rows['mm_lite_default_ttl_hours']
        ? Math.min(MM_LITE_MAX_TTL_HOURS, Math.max(MM_LITE_MIN_TTL_HOURS, parseInt(rows['mm_lite_default_ttl_hours'], 10)))
        : MM_LITE_DEFAULT_TTL_HOURS,
      phoneNumberId: rows['mm_lite_phone_number_id'] || process.env.WABA_PHONE_NUMBER_ID || null,
    };
  } catch (err) {
    log.warn('Could not load MM Lite settings from DB, using defaults', { err: (err as Error).message });
    return {
      enabled: false,
      defaultTtlHours: MM_LITE_DEFAULT_TTL_HOURS,
      phoneNumberId: process.env.WABA_PHONE_NUMBER_ID || null,
    };
  }
}

/**
 * Persist MM Lite settings to app_settings.
 */
export async function saveMmLiteSettings(settings: Partial<MmLiteSettings>): Promise<void> {
  const updates: Array<{ key: string; value: string; description: string }> = [];

  if (settings.enabled !== undefined) {
    updates.push({
      key: 'mm_lite_enabled',
      value: String(settings.enabled),
      description: 'US-1007: Route marketing template sends via MM Lite API when true',
    });
  }
  if (settings.defaultTtlHours !== undefined) {
    const ttl = Math.min(MM_LITE_MAX_TTL_HOURS, Math.max(MM_LITE_MIN_TTL_HOURS, settings.defaultTtlHours));
    updates.push({
      key: 'mm_lite_default_ttl_hours',
      value: String(ttl),
      description: 'US-1007: Default TTL in hours for MM Lite marketing sends (12-720)',
    });
  }
  if (settings.phoneNumberId !== undefined && settings.phoneNumberId !== null) {
    updates.push({
      key: 'mm_lite_phone_number_id',
      value: settings.phoneNumberId,
      description: 'US-1007: Cloud API phone number ID for MM Lite sends',
    });
  }

  for (const u of updates) {
    await pool.query(
      `INSERT INTO app_settings (key, value, description, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW()`,
      [u.key, u.value, u.description]
    );
  }
}

// ─── Core Send Logic ──────────────────────────────────────────────────────────

/**
 * Send a marketing template message via MM Lite API (or standard path if opted out).
 *
 * When mm_lite_enabled=true and useStandardApi=false, the message is sent via the
 * Cloud API with a TTL set. When disabled or useStandardApi=true, sends without TTL
 * (standard path) so A/B comparisons can be made.
 *
 * The send record is always persisted in mm_lite_sends for benchmarking.
 */
export async function sendMmLiteTemplate(
  opts: SendMmLiteTemplateOptions
): Promise<SendMmLiteTemplateResult> {
  const settings = await getMmLiteSettings();
  const useApi = !opts.useStandardApi && settings.enabled ? 'mm_lite' : 'standard';
  const ttlHours = opts.ttlHours
    ? Math.min(MM_LITE_MAX_TTL_HOURS, Math.max(MM_LITE_MIN_TTL_HOURS, opts.ttlHours))
    : settings.defaultTtlHours;

  // Create the send record first (status=queued)
  const sendId = await insertMmLiteSend({
    campaignId: opts.campaignId,
    profileId: opts.profileId,
    phone: opts.phone,
    templateName: opts.templateName,
    sendApi: useApi,
    ttlHours,
  });

  const accessToken = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = settings.phoneNumberId;

  // If credentials missing, mark as failed immediately
  if (!accessToken || !phoneNumberId) {
    const errorInfo = !accessToken
      ? 'META_ACCESS_TOKEN not configured'
      : 'WABA_PHONE_NUMBER_ID not configured';
    await updateMmLiteSendStatus(sendId, 'failed', { errorInfo });
    log.warn('MM Lite send skipped: missing Cloud API credentials', { phone: opts.phone, errorInfo });
    return {
      success: false,
      sendId,
      metaMessageId: null,
      sendApi: useApi,
      ttlHours,
      ttlExpiresAt: null,
      errorInfo,
    };
  }

  // Build Cloud API request body
  const ttlSeconds = ttlHours * 3600;
  const body: Record<string, any> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizePhone(opts.phone),
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.templateLanguage || 'en' },
      ...(opts.components && opts.components.length > 0 ? { components: opts.components } : {}),
    },
  };

  // TTL is only applied for MM Lite path
  if (useApi === 'mm_lite') {
    body.ttl = { seconds: ttlSeconds };
  }

  try {
    const url = `${GRAPH_BASE}/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const responseData = await response.json() as any;

    if (!response.ok || responseData.error) {
      const errorInfo = responseData.error?.message || `HTTP ${response.status}`;
      await updateMmLiteSendStatus(sendId, 'failed', { errorInfo });
      log.error('MM Lite Cloud API send failed', {
        phone: opts.phone,
        status: response.status,
        errorInfo,
      });
      return {
        success: false,
        sendId,
        metaMessageId: null,
        sendApi: useApi,
        ttlHours,
        ttlExpiresAt: null,
        errorInfo,
      };
    }

    const metaMessageId = responseData.messages?.[0]?.id || null;
    const sentAt = new Date();
    const ttlExpiresAt = useApi === 'mm_lite' ? new Date(sentAt.getTime() + ttlSeconds * 1000) : null;

    await updateMmLiteSendStatus(sendId, 'sent', {
      metaMessageId,
      sentAt,
      ttlExpiresAt,
    });

    log.info('MM Lite send accepted', {
      phone: opts.phone,
      templateName: opts.templateName,
      sendApi: useApi,
      ttlHours,
      metaMessageId,
    });

    return {
      success: true,
      sendId,
      metaMessageId,
      sendApi: useApi,
      ttlHours,
      ttlExpiresAt,
      errorInfo: null,
    };
  } catch (err) {
    const errorInfo = (err as Error).message;
    await updateMmLiteSendStatus(sendId, 'failed', { errorInfo });
    log.error('MM Lite send network error', { phone: opts.phone, errorInfo });
    return {
      success: false,
      sendId,
      metaMessageId: null,
      sendApi: useApi,
      ttlHours,
      ttlExpiresAt: null,
      errorInfo,
    };
  }
}

// ─── Delivery Status Update ───────────────────────────────────────────────────

/**
 * Update delivery status for a MM Lite send when a webhook delivery update arrives.
 * Called by the webhook handler when a status update is received for a meta message ID.
 */
export async function updateMmLiteDeliveryStatus(
  metaMessageId: string,
  status: 'delivered' | 'failed',
  timestamp?: Date
): Promise<void> {
  try {
    const ts = timestamp || new Date();
    const col = status === 'delivered' ? 'delivered_at' : null;
    await pool.query(
      `UPDATE mm_lite_sends
       SET delivery_status = $1, ${col ? `${col} = $2,` : ''} updated_at = NOW()
       WHERE meta_message_id = $3 AND delivery_status NOT IN ('expired', 'delivered')`,
      col ? [status, ts, metaMessageId] : [status, metaMessageId]
    );
  } catch (err) {
    log.warn('Failed to update MM Lite delivery status', { metaMessageId, status, err: (err as Error).message });
  }
}

// ─── TTL Expiry Sweeper ───────────────────────────────────────────────────────

/**
 * Mark all MM Lite sends whose TTL has elapsed and are still in 'sent' state as 'expired'.
 * Should be called periodically (e.g. every 5 minutes) via a background interval.
 *
 * Returns the number of rows marked expired.
 */
export async function expireMmLiteSends(): Promise<number> {
  try {
    const result = await pool.query(
      `UPDATE mm_lite_sends
       SET delivery_status = 'expired',
           expired_at = NOW(),
           updated_at = NOW()
       WHERE send_api = 'mm_lite'
         AND delivery_status = 'sent'
         AND ttl_expires_at IS NOT NULL
         AND ttl_expires_at < NOW()
       RETURNING id`
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      log.info('MM Lite TTL sweeper: marked sends as expired', { count });
    }
    return count;
  } catch (err) {
    log.warn('MM Lite TTL sweeper failed', { err: (err as Error).message });
    return 0;
  }
}

let _sweepInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background TTL expiry sweeper.
 * Runs every 5 minutes. Safe to call multiple times (idempotent).
 */
export function startMmLiteSweeper(): void {
  if (_sweepInterval) return;
  _sweepInterval = setInterval(() => {
    expireMmLiteSends().catch((err) =>
      log.warn('MM Lite sweeper interval error', { err: (err as Error).message })
    );
  }, 5 * 60 * 1000);
  log.info('MM Lite TTL sweeper started (5-minute interval)');
}

// ─── A/B Benchmark ───────────────────────────────────────────────────────────

export interface MmLiteDeliveryBenchmark {
  /** ISO date string for the query window start */
  since: string;
  /** ISO date string for the query window end */
  until: string;
  mmLite: {
    sent: number;
    delivered: number;
    failed: number;
    expired: number;
    deliveryRate: number; // 0-1
  };
  standard: {
    sent: number;
    delivered: number;
    failed: number;
    deliveryRate: number; // 0-1
  };
  /** Absolute delivery rate uplift: mmLite.deliveryRate - standard.deliveryRate */
  deliveryRateUplift: number;
}

/**
 * Query the A/B delivery benchmark comparing MM Lite vs standard sends.
 * @param days Number of days to look back (default 7, max 90)
 */
export async function queryMmLiteBenchmark(days = 7): Promise<MmLiteDeliveryBenchmark> {
  const safeDays = Math.min(90, Math.max(1, days));
  const since = new Date(Date.now() - safeDays * 24 * 3600 * 1000);
  const until = new Date();

  const result = await pool.query(
    `SELECT
       send_api,
       COUNT(*) FILTER (WHERE delivery_status IN ('sent','delivered','failed','expired')) AS total_sent,
       COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS total_delivered,
       COUNT(*) FILTER (WHERE delivery_status = 'failed') AS total_failed,
       COUNT(*) FILTER (WHERE delivery_status = 'expired') AS total_expired
     FROM mm_lite_sends
     WHERE sent_at >= $1
     GROUP BY send_api`,
    [since]
  );

  const mmLiteRow = result.rows.find((r: any) => r.send_api === 'mm_lite') || {};
  const standardRow = result.rows.find((r: any) => r.send_api === 'standard') || {};

  const mmSent = parseInt(mmLiteRow.total_sent || '0', 10);
  const mmDelivered = parseInt(mmLiteRow.total_delivered || '0', 10);
  const mmFailed = parseInt(mmLiteRow.total_failed || '0', 10);
  const mmExpired = parseInt(mmLiteRow.total_expired || '0', 10);
  const mmDeliveryRate = mmSent > 0 ? mmDelivered / mmSent : 0;

  const stdSent = parseInt(standardRow.total_sent || '0', 10);
  const stdDelivered = parseInt(standardRow.total_delivered || '0', 10);
  const stdFailed = parseInt(standardRow.total_failed || '0', 10);
  const stdDeliveryRate = stdSent > 0 ? stdDelivered / stdSent : 0;

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    mmLite: {
      sent: mmSent,
      delivered: mmDelivered,
      failed: mmFailed,
      expired: mmExpired,
      deliveryRate: Math.round(mmDeliveryRate * 10000) / 10000,
    },
    standard: {
      sent: stdSent,
      delivered: stdDelivered,
      failed: stdFailed,
      deliveryRate: Math.round(stdDeliveryRate * 10000) / 10000,
    },
    deliveryRateUplift: Math.round((mmDeliveryRate - stdDeliveryRate) * 10000) / 10000,
  };
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function insertMmLiteSend(params: {
  campaignId: string;
  profileId: string;
  phone: string;
  templateName: string;
  sendApi: 'mm_lite' | 'standard';
  ttlHours: number;
}): Promise<string> {
  const result = await pool.query(
    `INSERT INTO mm_lite_sends
       (campaign_id, profile_id, phone, template_name, send_api, ttl_hours, delivery_status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', NOW(), NOW())
     RETURNING id`,
    [params.campaignId, params.profileId, params.phone, params.templateName, params.sendApi, params.ttlHours]
  );
  return result.rows[0].id as string;
}

async function updateMmLiteSendStatus(
  sendId: string,
  status: string,
  extra: {
    metaMessageId?: string | null;
    sentAt?: Date;
    ttlExpiresAt?: Date | null;
    errorInfo?: string;
  } = {}
): Promise<void> {
  await pool.query(
    `UPDATE mm_lite_sends
     SET delivery_status = $1,
         meta_message_id = COALESCE($2, meta_message_id),
         sent_at = COALESCE($3, sent_at),
         ttl_expires_at = COALESCE($4, ttl_expires_at),
         error_info = COALESCE($5, error_info),
         updated_at = NOW()
     WHERE id = $6`,
    [
      status,
      extra.metaMessageId ?? null,
      extra.sentAt ?? null,
      extra.ttlExpiresAt ?? null,
      extra.errorInfo ?? null,
      sendId,
    ]
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Normalise phone to E.164 format (strip non-digits, ensure country code prefix) */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // If already has country code (11-15 digits), return as-is
  if (digits.length >= 11) return digits;
  // Default: prepend Malaysia country code
  return `60${digits}`;
}
