/**
 * Types for the Conversation Logger subsystem.
 *
 * Extracted from conversation-logger.ts to keep the main file under 800 lines.
 * All callers still import these from conversation-logger.ts (re-exported there).
 */

export interface LoggedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;       // Unix ms
  intent?: string;
  confidence?: number;
  action?: string;
  manual?: boolean;
  source?: string;
  model?: string;
  responseTime?: number;
  kbFiles?: string[];
  messageType?: string;
  routedAction?: string;
  workflowId?: string;
  stepId?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  staffName?: string;        // US-011: Staff display name for manual message attribution
  faithfulnessScore?: number; // US-899: 0.0-1.0 faithfulness check score
}

export interface ContactDetails {
  name?: string;
  email?: string;
  country?: string;
  language?: string;
  languageLocked?: boolean;
  checkIn?: string;
  checkOut?: string;
  unit?: string;
  notes?: string;
  contactStatus?: string;
  paymentStatus?: string;
  tags?: string[];
}

// US-910: Referral attribution data for ad-initiated conversations
export interface ConversationReferral {
  sourceType: string;       // ad | post | qr_code
  ctwaClid?: string;        // Click ID for Meta Conversions API
  sourceId?: string;        // Campaign/ad ID
  headline?: string;        // Ad headline text
  body?: string;            // Ad body text
  mediaType?: string;       // image | video
  sourceUrl?: string;       // Source URL
}

export interface ConversationLog {
  phone: string;
  pushName: string;
  instanceId?: string;
  /** US-908: tenant identifier — matches profileId, enforces cross-property isolation */
  tenantId?: string;
  messages: LoggedMessage[];
  contactDetails?: ContactDetails;
  pinned?: boolean;
  favourite?: boolean;
  lastReadAt?: number;
  responseMode?: string;
  referral?: ConversationReferral; // US-910: ad referral attribution
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  phone: string;
  pushName: string;
  instanceId?: string;
  /** US-908: tenant identifier — matches profileId, enforces cross-property isolation */
  tenantId?: string;
  lastMessage: string;
  lastMessageRole: 'user' | 'assistant';
  lastMessageAt: number;
  messageCount: number;
  unreadCount: number;
  pinned?: boolean;
  favourite?: boolean;
  createdAt: number;
  sessionActive?: boolean;  // US-815: true if within 24h session window
  leadSource?: string;      // US-910: ad | post | qr_code | organic (null = organic)
}
