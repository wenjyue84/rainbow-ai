// ─── US-914: Consecutive Low-Confidence Escalation Tracker ────────────────
// Tracks AI confidence scores per conversation and triggers escalation
// when consecutive responses fall below a configurable threshold (default 0.4).

import { StateManager } from './state-manager.js';

interface ConfidenceState {
  phone: string;
  consecutiveLow: number;      // count of consecutive below-threshold responses
  lastEscalationAt: number | null;
}

// 1-hour TTL (matches conversation TTL)
const confidenceManager = new StateManager<ConfidenceState>(3_600_000);

// ─── Configuration defaults ─────────────────────────────────────────────────
const DEFAULT_THRESHOLD = 0.4;
const DEFAULT_CONSECUTIVE = 2;
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

/** Track a response's confidence score for a phone number. */
export function trackConfidence(phone: string, confidence: number, settings?: any): void {
  const cfg = settings?.confidence_escalation;
  const threshold = cfg?.threshold ?? DEFAULT_THRESHOLD;

  const state = confidenceManager.getOrCreate(phone, () => ({
    phone,
    consecutiveLow: 0,
    lastEscalationAt: null,
  }));

  if (confidence < threshold) {
    state.consecutiveLow++;
  } else {
    state.consecutiveLow = 0; // Reset on any above-threshold response
  }
}

/** Check whether consecutive low-confidence responses should trigger escalation. */
export function shouldEscalateOnConfidence(phone: string, settings?: any): {
  shouldEscalate: boolean;
  consecutiveCount: number;
} {
  const state = confidenceManager.get(phone);
  if (!state) {
    return { shouldEscalate: false, consecutiveCount: 0 };
  }

  const cfg = settings?.confidence_escalation;
  const consecutiveRequired = cfg?.consecutive_count ?? DEFAULT_CONSECUTIVE;
  const cooldownMs = cfg?.cooldown_minutes != null
    ? cfg.cooldown_minutes * 60 * 1000
    : DEFAULT_COOLDOWN_MS;

  // Respect cooldown
  if (state.lastEscalationAt) {
    const elapsed = Date.now() - state.lastEscalationAt;
    if (elapsed < cooldownMs) {
      return { shouldEscalate: false, consecutiveCount: state.consecutiveLow };
    }
  }

  if (state.consecutiveLow >= consecutiveRequired) {
    return { shouldEscalate: true, consecutiveCount: state.consecutiveLow };
  }

  return { shouldEscalate: false, consecutiveCount: state.consecutiveLow };
}

/** Mark that an escalation was sent (sets cooldown, resets counter). */
export function markConfidenceEscalation(phone: string): void {
  const state = confidenceManager.get(phone);
  if (state) {
    state.lastEscalationAt = Date.now();
    state.consecutiveLow = 0;
  }
}

/** Reset tracking (e.g. when staff resolves handoff). */
export function resetConfidenceTracking(phone: string): void {
  const state = confidenceManager.get(phone);
  if (state) {
    state.consecutiveLow = 0;
  }
}

/** Check if confidence escalation is enabled for a profile's settings. */
export function isConfidenceEscalationEnabled(settings: any): boolean {
  return settings?.confidence_escalation?.enabled !== false;
}

/** Get current stats (for debugging / analytics). */
export function getConfidenceStats(phone: string): {
  consecutiveLow: number;
  lastEscalationAt: number | null;
} | null {
  const state = confidenceManager.get(phone);
  if (!state) return null;
  return {
    consecutiveLow: state.consecutiveLow,
    lastEscalationAt: state.lastEscalationAt,
  };
}
