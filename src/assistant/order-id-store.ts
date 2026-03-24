/**
 * order-id-store.ts — In-memory store for placed order IDs per webchat session
 *
 * After a successful order_confirm_submit, the FnB MCP response includes an
 * order ID (e.g. "MM-A1B2"). This store maps sessionId → orderId so the AI
 * can look up order status without the guest needing to remember the ID.
 *
 * All functions accept `profileId` as the first argument to ensure
 * cross-profile isolation via composite keys.
 */

import { sessionKey } from './session-key.js';

interface OrderIdSession {
  orderId: string;
  profileId: string;
  phone: string; // Phone or 'webchat-{profileId}-{sessionId}' (US-869: used for sending feedback)
  placedAt: number;
  lastAccess: number;
  feedbackRequested?: boolean; // US-869: Track if feedback was requested for this order
}

const ORDER_ID_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (longer than cart TTL — guest may check status later)

const orderIdSessions = new Map<string, OrderIdSession>();

// Cleanup expired sessions every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of orderIdSessions) {
    if (now - session.lastAccess > ORDER_ID_TTL_MS) {
      orderIdSessions.delete(key);
    }
  }
}, 15 * 60 * 1000);

/** Store the placed order ID for a session. */
export function setSessionOrderId(profileId: string, sessionId: string, orderId: string, phone: string = `webchat-${profileId}-${sessionId}`): void {
  orderIdSessions.set(sessionKey(profileId, sessionId), {
    orderId,
    profileId,
    phone,
    placedAt: Date.now(),
    lastAccess: Date.now(),
  });
}

/** Get the stored order ID for a session. Returns undefined if no order placed. */
export function getSessionOrderId(profileId: string, sessionId: string): string | undefined {
  const session = orderIdSessions.get(sessionKey(profileId, sessionId));
  if (session) {
    session.lastAccess = Date.now();
    return session.orderId;
  }
  return undefined;
}

/** Clear the stored order ID (e.g. on session reset). */
export function clearSessionOrderId(profileId: string, sessionId: string): void {
  orderIdSessions.delete(sessionKey(profileId, sessionId));
}

/** Find the session by order ID (reverse lookup for webhooks). Returns undefined if not found. */
export function getSessionIdByOrderId(orderId: string): { profileId: string; sessionId: string } | undefined {
  const now = Date.now();
  for (const [key, session] of orderIdSessions.entries()) {
    if (now - session.lastAccess < ORDER_ID_TTL_MS && session.orderId === orderId) {
      session.lastAccess = now;
      // Key format is "profileId:sessionId"
      const colonIdx = key.indexOf(':');
      return {
        profileId: key.slice(0, colonIdx),
        sessionId: key.slice(colonIdx + 1),
      };
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
