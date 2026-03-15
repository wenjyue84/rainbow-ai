/**
 * WhatsApp Portfolio Pacing Monitor (US-891)
 *
 * Meta's portfolio pacing silently pauses bulk template sends mid-campaign when
 * quality signals (blocks, complaints) are negative. This module polls the Meta
 * Graph API quality_rating endpoint and exposes a `pacingPaused` flag that is
 * surfaced via GET /analytics/messaging-limits.
 *
 * Required env vars (all optional — check is skipped gracefully if absent):
 *   PHONE_NUMBER_ID    — WhatsApp Business phone number ID (from Meta dashboard)
 *   META_ACCESS_TOKEN  — Permanent or system-user Graph API access token
 *
 * Pacing pause is inferred when quality_rating = 'RED' AND status = 'FLAGGED'
 * (Meta's documented signal for paused batch delivery due to quality degradation).
 * The last known state is stored in app_settings to avoid repeated notifications.
 */

import { createModuleLogger } from './logger.js';
import { WA_API_TIMEOUT_MS } from './timeouts.js';
import { db, dbReady } from './db.js';
import { appSettings } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';

const logger = createModuleLogger('PacingMonitor');

const GRAPH_API_BASE = 'https://graph.facebook.com/v20.0';
/** Poll every 5 minutes to meet the "alert within 5 minutes" AC */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const SETTING_KEY_PACING = 'portfolio_pacing_paused';
const SETTING_KEY_PACING_SINCE = 'portfolio_pacing_paused_since';

// ─── In-memory state exposed to messaging-limits endpoint ──────────────────

export interface PacingState {
  pacingPaused: boolean;
  qualityRating: string | null;
  status: string | null;
  pausedSince: string | null;
  lastCheckedAt: string | null;
  skipped: boolean;
}

let _state: PacingState = {
  pacingPaused: false,
  qualityRating: null,
  status: null,
  pausedSince: null,
  lastCheckedAt: null,
  skipped: true,
};

export function getPacingState(): PacingState {
  return { ..._state };
}

// ─── Meta Graph API call ───────────────────────────────────────────────────

interface QualityRatingResponse {
  display_phone_number?: string;
  id?: string;
  quality_rating?: string;   // 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
  status?: string;           // 'CONNECTED' | 'FLAGGED' | 'RESTRICTED' | ...
  messaging_limit_tier?: string;
}

export async function fetchQualityRating(
  phoneNumberId: string,
  token: string,
): Promise<QualityRatingResponse> {
  const url = `${GRAPH_API_BASE}/${phoneNumberId}?fields=quality_rating,status,display_phone_number,messaging_limit_tier`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WA_API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Graph API ${res.status}: ${body}`);
    }

    return (await res.json()) as QualityRatingResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Pacing pause detection ─────────────────────────────────────────────────

/**
 * Pacing is considered paused when:
 *  - quality_rating is 'RED' — severe quality degradation detected by Meta
 *  - status is 'FLAGGED'     — account flagged, batched sends are held
 *
 * A RED rating alone may not pause sends; FLAGGED status confirms the hold.
 */
export function isPacingPaused(rating: string | undefined, status: string | undefined): boolean {
  return rating === 'RED' && status === 'FLAGGED';
}

// ─── DB persistence ─────────────────────────────────────────────────────────

async function persistPacingState(paused: boolean, since: string | null): Promise<void> {
  try {
    const ready = await dbReady;
    if (!ready) return;

    await db.insert(appSettings)
      .values({
        key: SETTING_KEY_PACING,
        value: paused ? 'true' : 'false',
        description: 'Portfolio pacing paused flag (derived from Meta quality_rating)',
        updatedBy: null,
      })
      .onConflictDoUpdate({
        target: [appSettings.key],
        set: { value: paused ? 'true' : 'false', updatedAt: sql`NOW()` },
      });

    if (since !== null) {
      await db.insert(appSettings)
        .values({
          key: SETTING_KEY_PACING_SINCE,
          value: since,
          description: 'ISO timestamp when pacing pause was first detected',
          updatedBy: null,
        })
        .onConflictDoUpdate({
          target: [appSettings.key],
          set: { value: since, updatedAt: sql`NOW()` },
        });
    }
  } catch (err: any) {
    logger.error('Failed to persist pacing state to DB', { error: err.message });
  }
}

async function loadPacingStateFromDb(): Promise<{ paused: boolean; since: string | null }> {
  try {
    const ready = await dbReady;
    if (!ready) return { paused: false, since: null };

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_KEY_PACING));

    const sinceRows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_KEY_PACING_SINCE));

    const paused = rows[0]?.value === 'true';
    const since = sinceRows[0]?.value ?? null;
    return { paused, since };
  } catch (err: any) {
    logger.error('Failed to load pacing state from DB', { error: err.message });
    return { paused: false, since: null };
  }
}

// ─── Main poll cycle ────────────────────────────────────────────────────────

export async function runPacingCheck(): Promise<void> {
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!phoneNumberId || !token) {
    logger.debug('PHONE_NUMBER_ID or META_ACCESS_TOKEN not set — skipping pacing check');
    _state = { ..._state, skipped: true };
    return;
  }

  logger.info('Running portfolio pacing check', { phoneNumberId });

  try {
    const data = await fetchQualityRating(phoneNumberId, token);
    const nowIso = new Date().toISOString();
    const wasPaused = _state.pacingPaused;
    const nowPaused = isPacingPaused(data.quality_rating, data.status);

    _state = {
      pacingPaused: nowPaused,
      qualityRating: data.quality_rating ?? null,
      status: data.status ?? null,
      pausedSince: nowPaused ? (_state.pausedSince ?? nowIso) : null,
      lastCheckedAt: nowIso,
      skipped: false,
    };

    logger.info('Pacing check result', {
      qualityRating: data.quality_rating,
      status: data.status,
      pacingPaused: nowPaused,
    });

    // Newly paused — persist state and send admin notification
    if (nowPaused && !wasPaused) {
      _state.pausedSince = nowIso;
      await persistPacingState(true, nowIso);

      logger.warn('Portfolio pacing PAUSED detected — sending admin alert');
      try {
        const { notifyAdminPortfolioPacingPaused } = await import('./admin-notifier.js');
        await notifyAdminPortfolioPacingPaused(
          data.display_phone_number ?? phoneNumberId,
          data.quality_rating ?? 'RED',
          data.status ?? 'FLAGGED',
        );
      } catch (notifyErr: any) {
        logger.error('Failed to send pacing pause admin notification', { error: notifyErr.message });
      }
    }

    // Resumed — persist cleared state
    if (!nowPaused && wasPaused) {
      logger.info('Portfolio pacing RESUMED');
      await persistPacingState(false, null);
    }
  } catch (err: any) {
    logger.error('Pacing check error', { error: err.message });
    // Don't flip state on transient errors — keep last known state
  }
}

// ─── Startup + scheduler ───────────────────────────────────────────────────

let _started = false;

export function startPacingMonitor(): void {
  if (_started) return;
  _started = true;

  // Load last known state from DB on startup
  loadPacingStateFromDb()
    .then(({ paused, since }) => {
      if (paused) {
        _state = { ..._state, pacingPaused: true, pausedSince: since };
        logger.info('Restored pacing paused state from DB', { pausedSince: since });
      }
    })
    .catch(err => logger.error('Failed to load pacing state from DB on startup', { error: err.message }));

  // Run immediately on startup (fire-and-forget)
  runPacingCheck().catch(err =>
    logger.error('Startup pacing check threw', { error: err.message })
  );

  // Schedule recurring polls every 5 minutes
  setInterval(() => {
    runPacingCheck().catch(err =>
      logger.error('Scheduled pacing check threw', { error: err.message })
    );
  }, POLL_INTERVAL_MS).unref(); // .unref() so this timer won't prevent process exit
}
