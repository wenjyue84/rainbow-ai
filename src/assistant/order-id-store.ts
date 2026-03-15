/**
 * order-id-store.ts — In-memory store for placed order IDs per webchat session
 *
 * After a successful order_confirm_submit, the FnB MCP response includes an
 * order ID (e.g. "MM-A1B2"). This store maps sessionId → orderId so the AI
 * can look up order status without the guest needing to remember the ID.
 */

interface OrderIdSession {
  orderId: string;
  phone: string; // Phone or 'webchat-{sessionId}' (US-869: used for sending feedback)
  placedAt: number;
  lastAccess: number;
  feedbackRequested?: boolean; // US-869: Track if feedback was requested for this order
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
export function setSessionOrderId(sessionId: string, orderId: string, phone: string = 'webchat-' + sessionId): void {
  orderIdSessions.set(sessionId, {
    orderId,
    phone,
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

/** Find the session ID by order ID (reverse lookup for webhooks). Returns undefined if not found. */
export function getSessionIdByOrderId(orderId: string): string | undefined {
  const now = Date.now();
  for (const [sessionId, session] of orderIdSessions.entries()) {
    // Check if session is not expired
    if (now - session.lastAccess < ORDER_ID_TTL_MS && session.orderId === orderId) {
      session.lastAccess = now; // Update last access
      return sessionId;
    }
  }
  return undefined;
}

/** Mark feedback as requested for an order (US-869). */
export function markFeedbackRequested(orderId: string): boolean {
  for (const [, session] of orderIdSessions.entries()) {
    if (session.orderId === orderId) {
      session.feedbackRequested = true;
      return true;
    }
  }
  return false;
}

/** Check if feedback was already requested for an order. */
export function isFeedbackRequested(orderId: string): boolean {
  for (const [, session] of orderIdSessions.entries()) {
    if (session.orderId === orderId) {
      return session.feedbackRequested ?? false;
    }
  }
  return false;
}

/** Get the phone number (or webchat ID) for an order (US-869). */
export function getPhoneByOrderId(orderId: string): string | undefined {
  for (const [, session] of orderIdSessions.entries()) {
    if (session.orderId === orderId) {
      return session.phone;
    }
  }
  return undefined;
}
