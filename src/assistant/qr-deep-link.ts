/**
 * qr-deep-link.ts — QR Code Deep-Link Parser & Session Context
 *
 * US-919: Parses pre-filled messages from QR code scans to set session context.
 * Supported deep-link formats:
 *   ORDER:TABLE:<n>    — Table order flow (cafe)
 *   ROOM:<n>           — Room-specific context (hostel)
 *   CAMPAIGN:<label>   — Generic campaign entry point
 *
 * When a deep-link is detected, the message is intercepted before normal intent
 * classification so the AI can jump directly to the relevant flow.
 */

import { db } from '../lib/db.js';
import { qrCampaigns } from '../../shared/schema-tables.js';
import { eq, and, sql } from 'drizzle-orm';

// ─── Types ──────────────────────────────────────────────────────────

export interface DeepLinkContext {
  type: 'table' | 'room' | 'campaign';
  value: string;           // table number, room number, or campaign label
  campaignId?: string;     // QR campaign row ID (if matched)
  originalMessage: string; // the raw pre-filled message
}

// ─── In-memory session context ──────────────────────────────────────
// Stores deep-link context per JID so the AI can reference it during the session.

interface SessionEntry {
  context: DeepLinkContext;
  lastAccess: number;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

const sessionContextMap = new Map<string, SessionEntry>();

// Cleanup idle entries every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [jid, entry] of sessionContextMap) {
    if (now - entry.lastAccess > SESSION_TTL_MS) {
      sessionContextMap.delete(jid);
    }
  }
}, 15 * 60 * 1000).unref();

// ─── Deep-link parsing ──────────────────────────────────────────────

const DEEP_LINK_PATTERNS: Array<{
  regex: RegExp;
  type: DeepLinkContext['type'];
  valueGroup: number;
}> = [
  { regex: /^ORDER:TABLE:(\d+)$/i, type: 'table', valueGroup: 1 },
  { regex: /^ROOM:(\d+[A-Za-z]?)$/i, type: 'room', valueGroup: 1 },
  { regex: /^CAMPAIGN:([A-Za-z0-9_-]+)$/i, type: 'campaign', valueGroup: 1 },
];

/**
 * Parse a message to detect if it's a QR code deep-link.
 * Returns null if the message is not a recognized deep-link format.
 */
export function parseDeepLink(text: string): DeepLinkContext | null {
  const trimmed = text.trim();
  for (const pattern of DEEP_LINK_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      return {
        type: pattern.type,
        value: match[pattern.valueGroup],
        originalMessage: trimmed,
      };
    }
  }
  return null;
}

// ─── Session context management ─────────────────────────────────────

/** Store deep-link context for a JID session. */
export function setDeepLinkContext(jid: string, context: DeepLinkContext): void {
  sessionContextMap.set(jid, { context, lastAccess: Date.now() });
}

/** Retrieve deep-link context for a JID (if any). */
export function getDeepLinkContext(jid: string): DeepLinkContext | null {
  const entry = sessionContextMap.get(jid);
  if (!entry) return null;
  entry.lastAccess = Date.now();
  return entry.context;
}

/** Clear deep-link context (e.g., when session ends). */
export function clearDeepLinkContext(jid: string): void {
  sessionContextMap.delete(jid);
}

// ─── QR campaign matching ───────────────────────────────────────────

/**
 * Try to match a deep-link message to a QR campaign record in DB.
 * If matched, increments the scan count (fire-and-forget).
 */
export async function matchAndTrackQrCampaign(
  prefilledMessage: string,
  profileId: string
): Promise<string | null> {
  try {
    const rows = await db
      .select({ id: qrCampaigns.id })
      .from(qrCampaigns)
      .where(
        and(
          eq(qrCampaigns.prefilledMessage, prefilledMessage),
          eq(qrCampaigns.profileId, profileId),
          eq(qrCampaigns.active, true),
        )
      )
      .limit(1);

    if (rows.length === 0) return null;

    const campaignId = rows[0].id;

    // Increment scan count (fire-and-forget)
    db.update(qrCampaigns)
      .set({
        scanCount: sql`${qrCampaigns.scanCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(qrCampaigns.id, campaignId))
      .catch(() => { /* non-fatal */ });

    return campaignId;
  } catch {
    return null;
  }
}

// ─── Response generation for deep-links ─────────────────────────────

/**
 * Generate the initial response text for a QR code deep-link entry.
 * This replaces the normal greeting intent with a context-aware welcome.
 */
export function generateDeepLinkResponse(
  context: DeepLinkContext,
  lang: 'en' | 'ms' | 'zh' | 'ta'
): string {
  const responses: Record<DeepLinkContext['type'], Record<string, string>> = {
    table: {
      en: `Welcome! You're at Table ${context.value}. I'm your AI waiter — ready to take your order. What would you like?`,
      ms: `Selamat datang! Anda di Meja ${context.value}. Saya pelayan AI anda — sedia mengambil pesanan. Apa yang anda ingin pesan?`,
      zh: `欢迎！您在${context.value}号桌。我是您的AI服务员 — 准备好为您点餐了。您想要什么？`,
      ta: `வரவேற்கிறோம்! நீங்கள் மேசை ${context.value} இல் இருக்கிறீர்கள். நான் உங்கள் AI பணியாளர் — ஆர்டர் எடுக்க தயாராக இருக்கிறேன்.`,
    },
    room: {
      en: `Hello! You're contacting us from Room ${context.value}. How can I help you today?`,
      ms: `Hello! Anda menghubungi kami dari Bilik ${context.value}. Bagaimana saya boleh membantu?`,
      zh: `您好！您正从${context.value}号房联系我们。我能帮您什么？`,
      ta: `வணக்கம்! நீங்கள் அறை ${context.value} இலிருந்து தொடர்பு கொள்கிறீர்கள். நான் எப்படி உதவ முடியும்?`,
    },
    campaign: {
      en: `Welcome! How can I help you today?`,
      ms: `Selamat datang! Bagaimana saya boleh membantu hari ini?`,
      zh: `欢迎！今天我能帮您什么？`,
      ta: `வரவேற்கிறோம்! இன்று நான் எப்படி உதவ முடியும்?`,
    },
  };

  return responses[context.type][lang] || responses[context.type].en;
}
