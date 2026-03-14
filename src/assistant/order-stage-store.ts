/**
 * order-stage-store.ts — Order stage state machine per webchat session
 *
 * Tracks which stage the guest's order flow is in for the AI waiter (makan-moments).
 * The AI uses this stage alongside cart state to decide how to respond.
 *
 * Stages:
 *   BROWSING   — Guest is asking about the menu (no order intent yet)
 *   ORDERING   — Guest has added items to cart but not yet asked to confirm
 *   CONFIRMING — AI has shown the summary and asked "Shall I place this order?"
 *   PLACED     — Guest confirmed; order has been submitted to kitchen
 */

export type OrderStage = 'BROWSING' | 'ORDERING' | 'CONFIRMING' | 'PLACED';

interface StageSession {
  stage: OrderStage;
  lastAccess: number;
}

const STAGE_TTL_MS = 60 * 60 * 1000; // 1 hour idle timeout (matches cart TTL)

const stageSessions = new Map<string, StageSession>();

// Cleanup idle sessions every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of stageSessions) {
    if (now - session.lastAccess > STAGE_TTL_MS) {
      stageSessions.delete(sessionId);
    }
  }
}, 15 * 60 * 1000);

/** Get the current order stage for a session. Defaults to BROWSING if not set. */
export function getOrderStage(sessionId: string): OrderStage {
  const s = stageSessions.get(sessionId);
  if (s) s.lastAccess = Date.now();
  return s ? s.stage : 'BROWSING';
}

/** Set the order stage for a session. */
export function setOrderStage(sessionId: string, stage: OrderStage): void {
  stageSessions.set(sessionId, { stage, lastAccess: Date.now() });
}

/** Clear order stage (call on order placed or cart cleared). */
export function clearOrderStage(sessionId: string): void {
  stageSessions.delete(sessionId);
}

/**
 * Transition helper — enforces valid stage transitions.
 *
 * Valid transitions:
 *   BROWSING   → ORDERING    (guest adds first item)
 *   ORDERING   → CONFIRMING  (AI asks for confirmation)
 *   CONFIRMING → PLACED      (guest says yes)
 *   CONFIRMING → ORDERING    (guest declines)
 *   PLACED     → BROWSING    (fresh start after order placed)
 *   Any        → BROWSING    (reset)
 *
 * Returns the new stage (same as input if transition is invalid).
 */
export function transitionOrderStage(sessionId: string, to: OrderStage): OrderStage {
  const from = getOrderStage(sessionId);

  const validTransitions: Record<OrderStage, OrderStage[]> = {
    BROWSING:   ['ORDERING', 'BROWSING'],
    ORDERING:   ['CONFIRMING', 'BROWSING', 'ORDERING'],
    CONFIRMING: ['PLACED', 'ORDERING', 'BROWSING'],
    PLACED:     ['BROWSING'],
  };

  if (validTransitions[from].includes(to)) {
    setOrderStage(sessionId, to);
    return to;
  }

  // Invalid transition — keep current stage
  return from;
}

/** Human-readable description of each stage for prompt injection. */
export const ORDER_STAGE_DESCRIPTIONS: Record<OrderStage, string> = {
  BROWSING:   'Guest is browsing the menu. No items ordered yet.',
  ORDERING:   'Guest has items in cart but has NOT yet confirmed. Do NOT submit.',
  CONFIRMING: 'Awaiting guest confirmation. You asked "Shall I place this order?" — wait for yes/no.',
  PLACED:     'Order has been placed. Cart is cleared.',
};
