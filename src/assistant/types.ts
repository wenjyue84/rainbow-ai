import type { WorkflowState } from './workflow-executor.js';
import type { FlowState } from './pipeline/types.js';

// ─── Incoming Message ────────────────────────────────────────────────
export type MessageType = 'text' | 'image' | 'audio' | 'video' | 'sticker' | 'document' | 'contact' | 'location';

export interface MediaMetadata {
  mimeType: string;
  fileSize?: number;
  fileName?: string;
}

/** US-910: Referral data from Click-to-WhatsApp (CTWA) ad campaigns */
export interface ReferralData {
  ctwaClid?: string;    // Click ID for Meta Conversions API matching
  sourceId?: string;    // Campaign/source ID
  sourceType?: string;  // 'ad' | 'post' | 'qr_code'
  sourceUrl?: string;   // Source URL
  headline?: string;    // Ad headline (externalAdReply.title)
  body?: string;        // Ad body text
  mediaType?: string;   // Media type ('IMAGE' | 'VIDEO' | 'NONE')
  thumbnailUrl?: string; // Ad thumbnail URL
}

export interface IncomingMessage {
  from: string;        // Phone number (no @s.whatsapp.net) or BSUID if phone hidden
  text: string;
  pushName: string;    // WhatsApp display name
  messageId: string;
  isGroup: boolean;
  timestamp: number;   // Unix seconds
  messageType: MessageType;
  instanceId?: string; // Which WhatsApp instance received this message
  rawMessage?: any;    // Raw Baileys message for media download (US-438, US-448)
  transcribed?: boolean; // True if text was transcribed from voice note (US-438)
  bsuid?: string;      // US-477: WhatsApp Business-Scoped User ID (format: CC.BSUID)
  mediaMetadata?: MediaMetadata; // US-448: Media file metadata for images, videos, documents
  referralData?: ReferralData;   // US-910: Click-to-WhatsApp ad referral attribution
}

// ─── Intent Classification ──────────────────────────────────────────
export type IntentCategory =
  | 'greeting'
  | 'thanks'
  | 'wifi'
  | 'directions'
  | 'checkin_info'
  | 'checkout_info'
  | 'checkout_procedure'
  | 'pricing'
  | 'availability'
  | 'booking'
  | 'complaint'
  | 'theft'
  | 'theft_report'
  | 'card_locked'
  | 'contact_staff'
  | 'facilities'
  | 'facilities_info'
  | 'facility_orientation'
  | 'facility_malfunction'
  | 'rules'
  | 'rules_policy'
  | 'payment'
  | 'payment_info'
  | 'payment_made'
  | 'general'
  | 'general_complaint_in_stay'
  | 'check_in_arrival'
  | 'lower_deck_preference'
  | 'climate_control_complaint'
  | 'noise_complaint'
  | 'cleanliness_complaint'
  | 'extra_amenity_request'
  | 'upsell_suggest'
  | 'tourist_guide'
  | 'late_checkout_request'
  | 'luggage_storage'
  | 'billing_dispute'
  | 'billing_inquiry'
  | 'forgot_item_post_checkout'
  | 'post_checkout_complaint'
  | 'review_feedback'
  | 'checkin'
  | 'checkout'
  | 'unknown';

export interface IntentResult {
  category: IntentCategory;
  confidence: number;  // 0-1
  entities: Record<string, string>;  // extracted entities (dates, counts, etc.)
  source: 'regex' | 'fuzzy' | 'semantic' | 'llm';
  matchedKeyword?: string;  // For fuzzy matches
  matchedExample?: string;  // For semantic matches (Phase 3)
  detectedLanguage?: 'en' | 'ms' | 'zh' | 'ta' | 'unknown';  // Phase 2: Language detection
  usage?: {  // Token usage for LLM tier (US-019)
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

// ─── Conversation ───────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ConversationState {
  phone: string;
  profileId?: string;  // US-160: Profile associated with this conversation for routing validation
  pushName: string;
  messages: ChatMessage[];
  language: 'en' | 'ms' | 'zh' | 'ta';
  bookingState: BookingState | null;
  workflowState: WorkflowState | null;  // NEW: Workflow execution state
  activeFlow: FlowState | null;         // US-408: Unified flow state for new flow types
  unknownCount: number;  // consecutive unknown intents
  createdAt: number;
  lastActiveAt: number;
  // NEW: Context-aware intent tracking
  lastIntent: string | null;              // e.g., "booking", "wifi"
  lastIntentConfidence: number | null;    // e.g., 0.95
  lastIntentTimestamp: number | null;     // When intent was detected (ms)
  slots: Record<string, any>;             // { checkInDate: "tomorrow", guests: 2 }
  repeatCount: number;                     // consecutive times same intent classified
  lastUserMessageAt: number | null;        // Timestamp (ms) of last inbound user message (US-407: 24h window)
}

// ─── Booking State Machine ──────────────────────────────────────────
export type BookingStage = 'inquiry' | 'dates' | 'guests' | 'confirm' | 'done' | 'cancelled' | 'save_sale';

export interface BookingState {
  stage: BookingStage;
  checkIn?: string;     // ISO date
  checkOut?: string;    // ISO date
  guests?: number;
  priceBreakdown?: PriceBreakdown;
  guestName?: string;
  guestPhone?: string;
  cancelReason?: string;
}

export interface BookingStepResult {
  response: string;
  newState: BookingState;
}

// ─── Pricing ────────────────────────────────────────────────────────
export interface PricingConfig {
  currency: string;
  daily: number;
  weekly: number;
  monthly: number;
  deposit: number;
  depositNote: string;
  latecheckout_per_hour: number;
  keycard_deposit: number;
  laundry_per_load: number;
  discounts: {
    weekly_savings: number;
    monthly_vs_daily: string;
  };
}

export interface Holiday {
  date: string;  // ISO date
  name: string;
}

export interface HolidaysData {
  year: number;
  country: string;
  holidays: Holiday[];
}

export interface PriceBreakdown {
  nights: number;
  rateType: 'daily' | 'weekly' | 'monthly';
  baseRate: number;
  totalBase: number;
  deposit: number;
  total: number;
  savings?: string;
  currency: string;
}

// ─── Rate Limiting ──────────────────────────────────────────────────
export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;  // seconds
  reason?: string;
}

// ─── Escalation ─────────────────────────────────────────────────────
export type EscalationReason = 'human_request' | 'complaint' | 'unknown_repeated' | 'group_booking' | 'error' | 'config_error' | 'high_stakes_keyword' | 'consecutive_low_confidence' | 'sentiment';

export interface EscalationContext {
  phone: string;
  pushName: string;
  reason: EscalationReason;
  recentMessages: string[];
  originalMessage: string;
  instanceId?: string; // Reply via the same WhatsApp instance
  profileId?: string; // Profile that triggered escalation (for admin deep-link)
  triggerDetail?: string; // Intent/keyword that triggered escalation
  metadata?: Record<string, any>; // Additional context (e.g., configError, workflowId)
}

// ─── Escalation Tracker (Tiered) ────────────────────────────────────
export interface EscalationTracker {
  guestPhone: string;
  guestName: string;
  reason: EscalationReason;
  primaryNotifiedAt: number;  // Unix ms when Alston was notified
  secondaryNotified: boolean; // Whether Jay was notified
  timer: ReturnType<typeof setTimeout> | null;
  originalMessage: string;
}

// ─── Dependencies (Injected from mcp-server) ───────────────────────
export type SendMessageFn = (phone: string, text: string, instanceId?: string) => Promise<any>;
export type CallAPIFn = <T>(method: string, path: string, data?: any) => Promise<T>;
export type GetWhatsAppStatusFn = () => { state: string; user: any; authDir: string; qr: string | null };
export type RegisterMessageHandlerFn = (handler: (msg: IncomingMessage) => Promise<void>) => void;

export interface AssistantDependencies {
  registerMessageHandler: RegisterMessageHandlerFn;
  sendMessage: SendMessageFn;
  callAPI: CallAPIFn;
  getWhatsAppStatus: GetWhatsAppStatusFn;
}

// ─── AI Client ──────────────────────────────────────────────────────
export interface AIClassifyResult {
  category: IntentCategory;
  confidence: number;
  entities: Record<string, string>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /** US-245: True when confidence < 0.6 threshold — indicates fallback was used */
  fallback_used?: boolean;
}

export interface AIClientConfig {
  model: string;
  maxTokens: number;
  temperature: number;
}

// ─── Knowledge Base ─────────────────────────────────────────────────
export interface KnowledgeEntry {
  intent: IntentCategory;
  response: Partial<Record<'en' | 'ms' | 'zh' | 'ta', string>> & { en: string };
}
