/**
 * Brute-force protection for admin authentication endpoints (US-460).
 *
 * Tracks failed auth attempts per IP in an in-memory store.
 * After AUTH_MAX_ATTEMPTS failures within AUTH_WINDOW_MS, the IP is locked
 * out and receives 429 responses until the window expires.
 *
 * Configurable via environment variables:
 *   AUTH_RATELIMIT_WINDOW_MS  - lockout window in ms (default: 900000 = 15 min)
 *   AUTH_RATELIMIT_MAX        - max failed attempts before lockout (default: 5)
 *   ADMIN_IP_ALLOWLIST        - comma-separated IPs that bypass lockout
 */

export interface FailRecord {
  count: number;
  windowStart: number;
}

export class AuthBruteForceStore {
  private store = new Map<string, FailRecord>();
  private windowMs: number;
  private maxAttempts: number;
  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(windowMs: number, maxAttempts: number) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;
  }

  /** Start a background timer that purges expired entries. */
  startPurge(): void {
    if (this.purgeTimer) return;
    this.purgeTimer = setInterval(() => this.purge(), this.windowMs);
    // Allow Node.js to exit even if this timer is still running
    if (typeof this.purgeTimer === 'object' && this.purgeTimer !== null && 'unref' in this.purgeTimer) {
      (this.purgeTimer as NodeJS.Timeout).unref();
    }
  }

  stopPurge(): void {
    if (this.purgeTimer) {
      clearInterval(this.purgeTimer);
      this.purgeTimer = null;
    }
  }

  /** Remove entries whose window has expired. */
  purge(): void {
    const now = Date.now();
    for (const [ip, rec] of this.store) {
      if (now - rec.windowStart >= this.windowMs) this.store.delete(ip);
    }
  }

  /**
   * Record a failed authentication attempt from `ip`.
   * Returns the updated failure count.
   */
  recordFailure(ip: string, now = Date.now()): number {
    const rec = this.store.get(ip);
    if (!rec || now - rec.windowStart >= this.windowMs) {
      this.store.set(ip, { count: 1, windowStart: now });
      return 1;
    }
    rec.count += 1;
    if (rec.count >= this.maxAttempts) {
      console.warn(
        `[auth] Lockout triggered for IP ${ip} after ${rec.count} failed attempts at ${new Date(now).toISOString()}`
      );
    }
    return rec.count;
  }

  /** Returns true if the IP is currently locked out. */
  isLockedOut(ip: string, now = Date.now()): boolean {
    const rec = this.store.get(ip);
    if (!rec) return false;
    if (now - rec.windowStart >= this.windowMs) {
      this.store.delete(ip);
      return false;
    }
    return rec.count >= this.maxAttempts;
  }

  /** Clear the failure record for an IP (called on successful auth). */
  clearRecord(ip: string): void {
    this.store.delete(ip);
  }

  /** Returns snapshot of internal store (for testing / diagnostics). */
  snapshot(): Map<string, FailRecord> {
    return new Map(this.store);
  }

  /** Total number of tracked IPs. */
  size(): number {
    return this.store.size;
  }
}

// ─── Singleton used by the admin router ─────────────────────────────

export const AUTH_WINDOW_MS = parseInt(process.env.AUTH_RATELIMIT_WINDOW_MS ?? '900000', 10);
export const AUTH_MAX_ATTEMPTS = parseInt(process.env.AUTH_RATELIMIT_MAX ?? '5', 10);
export const ADMIN_IP_ALLOWLIST = new Set<string>(
  (process.env.ADMIN_IP_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean)
);

export const authBruteForceStore = new AuthBruteForceStore(AUTH_WINDOW_MS, AUTH_MAX_ATTEMPTS);
authBruteForceStore.startPurge();
