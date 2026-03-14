/**
 * Per-JID Inbound Message Rate Limiter (US-833)
 *
 * Sliding-window limiter that throttles abusive senders before pipeline dispatch.
 * Distinct from `src/lib/frequency-cap.ts` (outbound cap) — this is inbound abuse prevention.
 *
 * Defaults: 10 msg / 60-second window per JID.
 * Configurable via `rateLimiting.perUserWindowMs` and `rateLimiting.perUserMaxMessages` in settings.json.
 */

interface JidWindow {
  count: number;
  windowStart: number;
  replySent: boolean; // true once the throttle notice has been sent this window
}

export interface ThrottleEvent {
  jid: string;
  timestamp: number;
}

// ─── Storage ────────────────────────────────────────────────────────

const windows = new Map<string, JidWindow>();
const throttleEvents: ThrottleEvent[] = [];

const CLEANUP_INTERVAL_MS = 5 * 60 * 1_000; // 5 minutes
const EVENT_RETENTION_MS = 24 * 60 * 60 * 1_000; // 24 hours

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ─── Lifecycle ──────────────────────────────────────────────────────

export function startJidRateLimiterCleanup(windowMs: number): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => _cleanup(windowMs), CLEANUP_INTERVAL_MS);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cleanupTimer as any).unref?.();
}

export function stopJidRateLimiterCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function _cleanup(windowMs: number): void {
  const now = Date.now();

  for (const [jid, w] of windows) {
    if (now - w.windowStart >= windowMs) {
      windows.delete(jid);
    }
  }

  // Evict events older than 24 hours
  const cutoff = now - EVENT_RETENTION_MS;
  let i = 0;
  while (i < throttleEvents.length && throttleEvents[i].timestamp < cutoff) i++;
  if (i > 0) throttleEvents.splice(0, i);
}

// ─── Core check ─────────────────────────────────────────────────────

export interface JidRateLimitResult {
  allowed: boolean;
  /** true only on the first over-limit message — caller should send the throttle reply */
  shouldSendReply: boolean;
}

/**
 * Check whether `jid` is within its allowed window.
 *
 * @param jid   Sender JID (e.g. "601234567890@s.whatsapp.net")
 * @param windowMs     Sliding window length in milliseconds
 * @param maxMessages  Maximum messages allowed per window
 */
export function checkJidRate(
  jid: string,
  windowMs: number,
  maxMessages: number
): JidRateLimitResult {
  const now = Date.now();
  let w = windows.get(jid);

  // Expired or new window
  if (!w || now - w.windowStart >= windowMs) {
    windows.set(jid, { count: 1, windowStart: now, replySent: false });
    return { allowed: true, shouldSendReply: false };
  }

  w.count++;

  if (w.count > maxMessages) {
    const shouldSendReply = !w.replySent;
    if (!w.replySent) {
      w.replySent = true;
      throttleEvents.push({ jid, timestamp: now });
    }
    return { allowed: false, shouldSendReply };
  }

  return { allowed: true, shouldSendReply: false };
}

// ─── Admin stats ────────────────────────────────────────────────────

/** Number of JIDs currently throttled (window active + reply sent). */
export function getThrottledJidCount(): number {
  const now = Date.now();
  // We don't know windowMs here — keep any entry that was set; the periodic
  // cleanup handles eviction.  A window is "currently throttled" if replySent.
  let count = 0;
  for (const w of windows.values()) {
    if (w.replySent) count++;
  }
  return count;
}

/** All throttle events recorded in the last 24 hours. */
export function getThrottleEventsLast24h(): ThrottleEvent[] {
  const cutoff = Date.now() - EVENT_RETENTION_MS;
  return throttleEvents.filter(e => e.timestamp >= cutoff);
}

/** Exposed for tests only. */
export function _clearJidRateLimiterState(): void {
  windows.clear();
  throttleEvents.length = 0;
}
