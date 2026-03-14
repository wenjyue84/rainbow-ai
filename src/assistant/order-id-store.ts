/**
 * order-id-store.ts — In-memory store for placed order IDs per webchat session
 *
 * After a successful order_confirm_submit, the FnB MCP response includes an
 * order ID (e.g. "MM-A1B2"). This store maps sessionId → orderId so the AI
 * can look up order status without the guest needing to remember the ID.
 */

interface OrderIdSession {
  orderId: string;
  placedAt: number;
  lastAccess: number;
}

const ORDER_ID_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (longer than cart TTL — guest may check status later)

const orderIdSessions = new Map<string, OrderIdSession>();

// Cleanup expired sessions every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of orderIdSessions) {
    if (now - session.lastAccess > ORDER_ID_TTL_MS) {
      orderIdSessions.delete(sessionId);
    }
  }
}, 15 * 60 * 1000);

/** Store the placed order ID for a session. */
export function setSessionOrderId(sessionId: string, orderId: string): void {
  orderIdSessions.set(sessionId, {
    orderId,
    placedAt: Date.now(),
    lastAccess: Date.now(),
  });
}

/** Get the stored order ID for a session. Returns undefined if no order placed. */
export function getSessionOrderId(sessionId: string): string | undefined {
  const session = orderIdSessions.get(sessionId);
  if (session) {
    session.lastAccess = Date.now();
    return session.orderId;
  }
  return undefined;
}

/** Clear the stored order ID (e.g. on session reset). */
export function clearSessionOrderId(sessionId: string): void {
  orderIdSessions.delete(sessionId);
}
