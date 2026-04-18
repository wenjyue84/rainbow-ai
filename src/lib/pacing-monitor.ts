/**
 * Portfolio Pacing Monitor (US-891, US-995)
 *
 * Detects when Meta's portfolio pacing silently pauses bulk template sends
 * mid-campaign due to negative quality signals (blocks, complaints).
 *
 * US-891: Polls Meta's WABA quality endpoint every 5 minutes and alerts admin.
 * US-995: Adds queue-depth visibility via messaging_volume analytics endpoint,
 *         logs pacing events to the DB audit log, and exposes a combined
 *         pacing status panel for the admin dashboard.
 *
 * State is persisted to app_settings to avoid repeated notifications.
 */

import { db, dbReady } from './db.js';
import { appSettings } from '../../shared/schema.js';
import { eq, sql } from 'drizzle-orm';
import { loadAdminNotificationSettings } from './admin-notification-settings.js';
import { auditConfigChange } from './config-db.js';

// ─── Types ────────────────────────────────────────────────────────

export interface QueueDepthMetrics {
  messagesSent24h: number;
  messagesPending: number;
  messagesDelivered: number;
  messagesFailed: number;
  volumeAvailable: boolean;  // false if token lacks scope
}

export interface PacingState {
  pacingPaused: boolean;
  affectedTemplateName: string | null;
  percentNotDelivered: number | null;
  lastCheckedAt: string;
  pauseDetectedAt: string | null;
  queueDepth: QueueDepthMetrics | null;
}

/** Combined pacing status panel data for the admin dashboard (US-995) */
export interface PacingStatusPanel {
  pacingActive: boolean;
  status: 'normal' | 'pacing_active' | 'degraded' | 'unavailable';
  messagesSent: number;
  messagesQueued: number;
  messagesDelivered: number;
  messagesFailed: number;
  affectedTemplate: string | null;
  percentNotDelivered: number | null;
  pauseDetectedAt: string | null;
  lastCheckedAt: string;
  warning: string | null;
}

interface MetaQualityResponse {
  data?: Array<{
    quality_score?: { score?: string };
    messaging_limit_tier?: string;
    current_limit?: string;
    pacing_status?: string; // 'paused' | 'active' | 'unknown'
    template_name?: string;
    sent_count?: number;
    total_count?: number;
  }>;
  error?: { message: string };
}

interface MetaAnalyticsResponse {
  data?: Array<{
    data_points?: Array<{
      sent?: number;
      delivered?: number;
      failed?: number;
    }>;
  }>;
  error?: { message: string; code?: number };
}

// ─── Constants ────────────────────────────────────────────────────

const SETTING_KEY_PACING = 'rainbow_pacing_state';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between alerts

// ─── In-memory state ──────────────────────────────────────────────

let _pacingState: PacingState = {
  pacingPaused: false,
  affectedTemplateName: null,
  percentNotDelivered: null,
  lastCheckedAt: new Date().toISOString(),
  pauseDetectedAt: null,
  queueDepth: null,
};

let _intervalHandle: ReturnType<typeof setInterval> | null = null;
let _lastNotificationAt = 0;

// Pluggable notification sender (set by initPacingNotifier)
let _sendNotification: ((phone: string, text: string) => Promise<any>) | null = null;

// ─── Public API ───────────────────────────────────────────────────

/** Get the current pacing state (for GET /analytics/messaging-limits) */
export function getPacingState(): PacingState {
  return { ..._pacingState };
}

/**
 * US-995: Get the combined pacing status panel data for the admin dashboard.
 * Returns a structured object suitable for direct rendering in a dashboard panel.
 */
export function getPacingStatusPanel(): PacingStatusPanel {
  const qd = _pacingState.queueDepth;
  const hasCredentials = !!(process.env.WABA_PHONE_NUMBER_ID &&
    (process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN));

  if (!hasCredentials) {
    return {
      pacingActive: false,
      status: 'unavailable',
      messagesSent: 0,
      messagesQueued: 0,
      messagesDelivered: 0,
      messagesFailed: 0,
      affectedTemplate: null,
      percentNotDelivered: null,
      pauseDetectedAt: null,
      lastCheckedAt: _pacingState.lastCheckedAt,
      warning: null,
    };
  }

  const messagesSent = qd?.messagesSent24h ?? 0;
  const messagesQueued = qd?.messagesPending ?? 0;
  const messagesDelivered = qd?.messagesDelivered ?? 0;
  const messagesFailed = qd?.messagesFailed ?? 0;

  let status: PacingStatusPanel['status'] = 'normal';
  let warning: string | null = null;

  if (_pacingState.pacingPaused) {
    status = 'pacing_active';
    warning = `Portfolio pacing is currently active. Messages may be queued and delivered in batches. ${messagesQueued > 0 ? `${messagesQueued} messages pending.` : ''}`.trim();
  } else if (qd && !qd.volumeAvailable) {
    status = 'degraded';
    warning = 'Messaging volume data unavailable — Graph API token may lack the required analytics scope.';
  }

  return {
    pacingActive: _pacingState.pacingPaused,
    status,
    messagesSent,
    messagesQueued,
    messagesDelivered,
    messagesFailed,
    affectedTemplate: _pacingState.affectedTemplateName,
    percentNotDelivered: _pacingState.percentNotDelivered,
    pauseDetectedAt: _pacingState.pauseDetectedAt,
    lastCheckedAt: _pacingState.lastCheckedAt,
    warning,
  };
}

/** Initialize the notification sender (called once at startup) */
export function initPacingNotifier(
  sendMessage: (phone: string, text: string) => Promise<any>
): void {
  _sendNotification = sendMessage;
}

/**
 * Start the pacing monitor polling loop.
 * Checks Meta's quality endpoint every 5 minutes.
 */
export function startPacingMonitor(): void {
  if (_intervalHandle) return; // Already running

  // Initial check after 30s delay (let server stabilize)
  setTimeout(() => {
    checkPacingStatus().catch(err =>
      console.error('[PacingMonitor] Initial check failed:', err.message)
    );
  }, 30_000);

  _intervalHandle = setInterval(() => {
    checkPacingStatus().catch(err =>
      console.error('[PacingMonitor] Poll failed:', err.message)
    );
  }, POLL_INTERVAL_MS);

  console.log('[PacingMonitor] Started (polling every 5 minutes)');
}

/** Stop the polling loop (for testing/cleanup) */
export function stopPacingMonitor(): void {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

// ─── Core Check Logic ─────────────────────────────────────────────

/**
 * Poll Meta's quality endpoint and update pacing state.
 * US-995: Also fetches messaging volume for queue-depth visibility.
 * Exported for testing and manual trigger.
 */
export async function checkPacingStatus(): Promise<PacingState> {
  const phoneNumberId = process.env.WABA_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;

  if (!phoneNumberId || !accessToken) {
    // No Meta credentials configured — skip silently
    _pacingState.lastCheckedAt = new Date().toISOString();
    return _pacingState;
  }

  try {
    // Fetch quality signals and messaging volume in parallel
    const [qualityResponse, volumeMetrics] = await Promise.all([
      fetchMetaQualitySignals(phoneNumberId, accessToken),
      fetchMessagingVolume(phoneNumberId, accessToken).catch(err => {
        console.warn('[PacingMonitor] Messaging volume fetch failed (token may lack scope):', err.message);
        return null;
      }),
    ]);

    const newState = parsePacingFromResponse(qualityResponse);
    newState.queueDepth = volumeMetrics;

    const wasPaused = _pacingState.pacingPaused;
    const nowPaused = newState.pacingPaused;

    _pacingState = newState;

    // Persist to DB
    await persistPacingState(newState);

    // US-995: Log pacing state transitions to audit log
    if (wasPaused !== nowPaused) {
      await logPacingEventToAudit(wasPaused, nowPaused, newState);
    }

    // Notify admin on state change: not paused -> paused
    if (!wasPaused && nowPaused) {
      await notifyAdminPacingPaused(newState);
    }
  } catch (err: any) {
    console.error('[PacingMonitor] Check failed:', err.message);
    _pacingState.lastCheckedAt = new Date().toISOString();
  }

  return _pacingState;
}

// ─── Meta API Abstraction ─────────────────────────────────────────

/**
 * Fetch quality signals from Meta's Graph API.
 * Abstracted for testability — callers can mock this.
 */
export async function fetchMetaQualitySignals(
  phoneNumberId: string,
  accessToken: string
): Promise<MetaQualityResponse> {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=quality_rating,messaging_limit_tier,health_status&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Meta API returned ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<MetaQualityResponse>;
}

/**
 * US-995: Fetch messaging volume analytics from Meta's Graph API.
 * Returns queue-depth metrics (sent, delivered, failed, pending estimate).
 * Returns null if the token lacks the required analytics scope.
 */
export async function fetchMessagingVolume(
  phoneNumberId: string,
  accessToken: string
): Promise<QueueDepthMetrics> {
  // Use the analytics endpoint for 24h messaging volume
  const since = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=analytics.start(${since}).end(${until}).granularity(DAY).phone_numbers([])&access_token=${accessToken}`;

  const res = await fetch(url);

  if (!res.ok) {
    const status = res.status;
    // 403 or 190 error = token lacks analytics scope — degrade gracefully
    if (status === 403 || status === 400) {
      return {
        messagesSent24h: 0,
        messagesPending: 0,
        messagesDelivered: 0,
        messagesFailed: 0,
        volumeAvailable: false,
      };
    }
    const body = await res.text().catch(() => '');
    throw new Error(`Meta Analytics API returned ${status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json() as MetaAnalyticsResponse;
  const dataPoints = json?.data?.[0]?.data_points || [];

  let sent = 0;
  let delivered = 0;
  let failed = 0;

  for (const dp of dataPoints) {
    sent += dp?.sent ?? 0;
    delivered += dp?.delivered ?? 0;
    failed += dp?.failed ?? 0;
  }

  // Pending estimate: sent but not yet delivered or failed
  const pending = Math.max(0, sent - delivered - failed);

  return {
    messagesSent24h: sent,
    messagesPending: pending,
    messagesDelivered: delivered,
    messagesFailed: failed,
    volumeAvailable: true,
  };
}

/**
 * Parse pacing state from Meta's quality response.
 * Exported for testing.
 */
export function parsePacingFromResponse(response: MetaQualityResponse): PacingState {
  const now = new Date().toISOString();

  // Check health_status for pacing signals
  const data = response as any;
  const healthStatus = data?.health_status;
  const entities = healthStatus?.entities || [];

  let pacingPaused = false;
  let affectedTemplateName: string | null = null;
  let percentNotDelivered: number | null = null;

  // Look for pacing indicators in health_status entities
  for (const entity of entities) {
    const canSendMessage = entity?.can_send_message;
    if (canSendMessage === 'LIMITED' || canSendMessage === 'BLOCKED') {
      pacingPaused = true;
    }

    // Check entity_type for template-specific pacing
    if (entity?.entity_type === 'TEMPLATE' && entity?.id) {
      affectedTemplateName = entity.id;
    }

    // Check for errors array which indicates pacing issues
    const errors = entity?.errors || [];
    for (const error of errors) {
      const errorCode = error?.error_code;
      // Error code 131026 = template pacing, 131047 = re-engagement needed
      if (errorCode === 131026 || error?.possible_solution?.includes('pacing')) {
        pacingPaused = true;
        if (error?.error_description) {
          // Try to extract percentage from error description
          const match = error.error_description.match(/(\d+(?:\.\d+)?)%/);
          if (match) {
            percentNotDelivered = parseFloat(match[1]);
          }
        }
      }
    }
  }

  // Also check quality_rating for degradation signals
  const qualityRating = data?.quality_rating;
  if (qualityRating === 'RED') {
    // RED quality rating often correlates with pacing pauses
    pacingPaused = true;
  }

  return {
    pacingPaused,
    affectedTemplateName,
    percentNotDelivered,
    lastCheckedAt: now,
    pauseDetectedAt: pacingPaused ? now : null,
    queueDepth: null, // Populated separately by checkPacingStatus
  };
}

// ─── Audit Logging (US-995) ──────────────────────────────────────

/**
 * Log pacing state transitions to the DB audit log.
 * Called when pacing state changes (paused/resumed).
 */
async function logPacingEventToAudit(
  wasPaused: boolean,
  nowPaused: boolean,
  state: PacingState
): Promise<void> {
  try {
    const action = nowPaused ? 'pacing_activated' : 'pacing_resolved';
    await auditConfigChange(
      'system:pacing-monitor',
      'pacing_monitor',
      { pacingPaused: wasPaused },
      {
        pacingPaused: nowPaused,
        action,
        affectedTemplateName: state.affectedTemplateName,
        percentNotDelivered: state.percentNotDelivered,
        queueDepth: state.queueDepth,
        timestamp: state.lastCheckedAt,
      }
    );
    console.log(`[PacingMonitor] Audit log: ${action} at ${state.lastCheckedAt}`);
  } catch (err: any) {
    console.error('[PacingMonitor] Failed to write audit log:', err.message);
  }
}

// ─── Persistence ──────────────────────────────────────────────────

/** Load pacing state from DB on startup */
export async function loadPacingStateFromDb(): Promise<void> {
  try {
    const isConnected = await dbReady;
    if (!isConnected) return;

    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, SETTING_KEY_PACING));

    if (rows[0]?.value) {
      try {
        const stored = JSON.parse(rows[0].value);
        _pacingState = {
          pacingPaused: stored.pacingPaused ?? false,
          affectedTemplateName: stored.affectedTemplateName ?? null,
          percentNotDelivered: stored.percentNotDelivered ?? null,
          lastCheckedAt: stored.lastCheckedAt ?? new Date().toISOString(),
          pauseDetectedAt: stored.pauseDetectedAt ?? null,
          queueDepth: stored.queueDepth ?? null,
        };
        console.log(`[PacingMonitor] Loaded state from DB (paused: ${_pacingState.pacingPaused})`);
      } catch {
        // Corrupt JSON — start fresh
      }
    }
  } catch (err: any) {
    console.error('[PacingMonitor] Failed to load state from DB:', err.message);
  }
}

async function persistPacingState(state: PacingState): Promise<void> {
  try {
    const isConnected = await dbReady;
    if (!isConnected) return;

    await db.insert(appSettings)
      .values({
        key: SETTING_KEY_PACING,
        value: JSON.stringify(state),
        description: 'Portfolio pacing monitor state (US-891)',
        updatedBy: null,
      })
      .onConflictDoUpdate({
        target: [appSettings.key],
        set: {
          value: JSON.stringify(state),
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  } catch (err: any) {
    console.error('[PacingMonitor] Failed to persist state:', err.message);
  }
}

// ─── Admin Notification ───────────────────────────────────────────

async function notifyAdminPacingPaused(state: PacingState): Promise<void> {
  const now = Date.now();
  if (now - _lastNotificationAt < NOTIFICATION_COOLDOWN_MS) {
    console.log('[PacingMonitor] Notification skipped (cooldown)');
    return;
  }
  _lastNotificationAt = now;

  if (!_sendNotification) {
    console.warn('[PacingMonitor] No notification sender — cannot alert admin');
    return;
  }

  try {
    const settings = await loadAdminNotificationSettings();
    if (!settings.enabled) return;

    const templateInfo = state.affectedTemplateName
      ? `Affected Template: *${state.affectedTemplateName}*\n`
      : '';
    const deliveryInfo = state.percentNotDelivered != null
      ? `Batch Not Delivered: *${state.percentNotDelivered.toFixed(1)}%*\n`
      : '';

    const message = `⚠️ *WhatsApp Portfolio Pacing PAUSED*\n\n` +
      `Meta has silently paused your bulk template delivery due to negative quality signals.\n\n` +
      templateInfo +
      deliveryInfo +
      `Detected At: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n` +
      `**Impact:**\n` +
      `Scheduled bulk messages are not being delivered. Recipients will not receive your templates until pacing resumes.\n\n` +
      `**Actions:**\n` +
      `1. Check Meta Business Manager for quality signals\n` +
      `2. Pause any active campaigns to prevent further quality degradation\n` +
      `3. Review recent template content for compliance issues\n` +
      `4. Monitor via: GET /api/rainbow/analytics/messaging-limits\n\n` +
      `_Pacing usually resumes automatically when quality signals improve._`;

    await _sendNotification(settings.systemAdminPhone, message);
    console.log('[PacingMonitor] Sent pacing pause notification');
  } catch (err: any) {
    console.error('[PacingMonitor] Failed to send notification:', err.message);
  }
}

// ─── Test Helpers ─────────────────────────────────────────────────

/** Reset internal state (for testing only) */
export function _resetForTesting(): void {
  _pacingState = {
    pacingPaused: false,
    affectedTemplateName: null,
    percentNotDelivered: null,
    lastCheckedAt: new Date().toISOString(),
    pauseDetectedAt: null,
    queueDepth: null,
  };
  _lastNotificationAt = 0;
  _sendNotification = null;
  stopPacingMonitor();
}
