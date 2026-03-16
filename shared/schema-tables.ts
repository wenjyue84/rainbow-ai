/**
 * schema-tables.ts — Drizzle ORM table definitions for Rainbow AI
 *
 * Contains Rainbow-owned pgTable definitions and table-derived types.
 * Extracted from digiman/shared/schema-tables.ts during decomposition.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex } from "drizzle-orm/pg-core";

// ─── Settings ────────────────────────────────────────────────────────
// Rainbow stores its own settings with `rainbow_*` prefixed keys

export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_app_settings_key").on(table.key),
]));

// ─── Rainbow AI ──────────────────────────────────────────────────────

export const intentDetectionSettings = pgTable("intent_detection_settings", {
  id: serial("id").primaryKey(),
  tier1Enabled: boolean("tier1_enabled").default(true).notNull(),
  tier1ContextMessages: integer("tier1_context_messages").default(0).notNull(),
  tier2Enabled: boolean("tier2_enabled").default(true).notNull(),
  tier2ContextMessages: integer("tier2_context_messages").default(3).notNull(),
  tier2Threshold: real("tier2_threshold").default(0.80).notNull(),
  tier3Enabled: boolean("tier3_enabled").default(true).notNull(),
  tier3ContextMessages: integer("tier3_context_messages").default(5).notNull(),
  tier3Threshold: real("tier3_threshold").default(0.70).notNull(),
  tier4Enabled: boolean("tier4_enabled").default(true).notNull(),
  tier4ContextMessages: integer("tier4_context_messages").default(5).notNull(),
  trackLastIntent: boolean("track_last_intent").default(true).notNull(),
  trackSlots: boolean("track_slots").default(true).notNull(),
  maxHistoryMessages: integer("max_history_messages").default(20).notNull(),
  contextTTL: integer("context_ttl_minutes").default(30).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rainbowFeedback = pgTable("rainbow_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id"),
  phoneNumber: text("phone_number").notNull(),
  intent: text("intent"),
  confidence: real("confidence"),
  rating: integer("rating").notNull(), // 1 = thumbs up, -1 = thumbs down
  feedbackText: text("feedback_text"),
  responseModel: text("response_model"),
  responseTime: integer("response_time_ms"),
  tier: text("tier"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_rainbow_feedback_conversation_id").on(table.conversationId),
  index("idx_rainbow_feedback_phone_number").on(table.phoneNumber),
  index("idx_rainbow_feedback_intent").on(table.intent),
  index("idx_rainbow_feedback_rating").on(table.rating),
  index("idx_rainbow_feedback_created_at").on(table.createdAt),
  index("idx_rainbow_feedback_created_intent").on(table.createdAt, table.intent),
]));

export const intentPredictions = pgTable("intent_predictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  phoneNumber: text("phone_number").notNull(),
  messageText: text("message_text").notNull(),
  predictedIntent: text("predicted_intent").notNull(),
  confidence: real("confidence").notNull(),
  tier: text("tier").notNull(),
  model: text("model"),
  actualIntent: text("actual_intent"),
  wasCorrect: boolean("was_correct"),
  correctionSource: text("correction_source"),
  correctedAt: timestamp("corrected_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_intent_predictions_conversation_id").on(table.conversationId),
  index("idx_intent_predictions_phone_number").on(table.phoneNumber),
  index("idx_intent_predictions_predicted_intent").on(table.predictedIntent),
  index("idx_intent_predictions_tier").on(table.tier),
  index("idx_intent_predictions_was_correct").on(table.wasCorrect),
  index("idx_intent_predictions_created_at").on(table.createdAt),
  index("idx_intent_predictions_correct_created").on(table.wasCorrect, table.createdAt),
]));

export const rainbowConversationState = pgTable("rainbow_conversation_state", {
  phone: varchar("phone", { length: 32 }).primaryKey(),
  pushName: text("push_name").notNull(),
  language: varchar("language", { length: 2 }).notNull().default('en'),
  bookingStateJson: text("booking_state_json"),
  workflowStateJson: text("workflow_state_json"),
  activeFlowJson: text("active_flow_json"),  // US-408: Unified flow state for new flow types
  unknownCount: integer("unknown_count").notNull().default(0),
  lastIntent: text("last_intent"),
  lastIntentConfidence: real("last_intent_confidence"),
  lastIntentTimestamp: timestamp("last_intent_timestamp"),
  slotsJson: text("slots_json"),
  repeatCount: integer("repeat_count").notNull().default(0),
  profileId: text("profile_id").default('pelangi'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  lastUserMessageAt: timestamp("last_user_message_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Rainbow Conversations (Hybrid Storage: replaces JSON files) ─────

export const rainbowConversations = pgTable("rainbow_conversations", {
  phone: varchar("phone", { length: 64 }).primaryKey(),
  bsuid: varchar("bsuid", { length: 128 }),   // US-477: WhatsApp Business-Scoped User ID (format: CC.BSUID)
  pushName: text("push_name").notNull().default(''),
  instanceId: text("instance_id"),
  profileId: text("profile_id").default('pelangi'),
  pinned: boolean("pinned").notNull().default(false),
  favourite: boolean("favourite").notNull().default(false),
  lastReadAt: timestamp("last_read_at"),
  responseMode: text("response_mode"),
  status: varchar("status", { length: 16 }).notNull().default('active'),  // US-444: 'active' or 'ended'
  contactDetailsJson: text("contact_details_json"),
  contextSummary: text("context_summary"),                    // US-447: LLM-generated context summary
  contextSummaryAt: timestamp("context_summary_at"),          // US-447: when the summary was generated
  // US-910: Click-to-WhatsApp ad referral attribution
  referralCtwaClid: text("referral_ctwa_clid"),               // Meta Conversions API click ID
  referralSourceId: text("referral_source_id"),               // Campaign/source ID
  referralSourceType: text("referral_source_type"),           // 'ad' | 'post' | 'qr_code'
  referralHeadline: text("referral_headline"),                // Ad headline
  referralBody: text("referral_body"),                        // Ad body text
  referralJson: text("referral_json"),                        // Full referral object as JSON
  // US-979: WhatsApp marketing opt-in audit trail
  optInMethod: text("opt_in_method"),                         // 'inbound' | 'double_optin' | 'web_form' | 'ctwa_ad' | 'qr_code' | 'in_person'
  optInAt: timestamp("opt_in_at"),                            // Timestamp of confirmed opt-in
  optInChannel: text("opt_in_channel"),                       // Channel where opt-in occurred
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ([
  uniqueIndex("idx_rainbow_conversations_bsuid").on(table.bsuid),
]));

export const rainbowMessages = pgTable("rainbow_messages", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 64 }).notNull(),
  role: varchar("role", { length: 10 }).notNull(),
  content: text("content").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  intent: text("intent"),
  confidence: real("confidence"),
  action: text("action"),
  manual: boolean("manual"),
  source: text("source"),
  model: text("model"),
  responseTime: integer("response_time_ms"),
  kbFilesJson: text("kb_files_json"),
  messageType: text("message_type"),
  routedAction: text("routed_action"),
  workflowId: text("workflow_id"),
  stepId: text("step_id"),
  usageJson: text("usage_json"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  staffName: text("staff_name"),
  transcribed: boolean("transcribed"),  // US-438: true if voice note was transcribed
  mediaUrl: text("media_url"),          // US-840: ephemeral media URL (if available from Baileys)
  localMediaUrl: text("local_media_url"), // US-893: locally-saved media path after auto-download
  faithfulnessScore: real("faithfulness_score"), // US-899: 0.0-1.0 faithfulness check score (null = not checked)
  profileId: text("profile_id").default('pelangi'),
  deletedAt: timestamp("deleted_at"),
}, (table) => ([
  index("idx_rainbow_messages_phone").on(table.phone),
  index("idx_rainbow_messages_phone_timestamp").on(table.phone, table.timestamp),
  index("idx_rainbow_messages_role").on(table.role),
  index("idx_rainbow_messages_timestamp").on(table.timestamp),
  index("idx_rainbow_messages_phone_role_ts").on(table.phone, table.role, table.timestamp),
]));

// ─── Message Delivery Status (US-426) ────────────────────────────────

export const messageDeliveryStatus = pgTable("message_delivery_status", {
  id: serial("id").primaryKey(),
  baileysMessageId: varchar("baileys_message_id", { length: 128 }).notNull(),
  phone: varchar("phone", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(), // pending|sent|delivered|read|played|failed
  statusTimestamp: timestamp("status_timestamp").notNull().defaultNow(),
  instanceId: text("instance_id"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_msg_delivery_baileys_id").on(table.baileysMessageId),
  index("idx_msg_delivery_phone").on(table.phone),
  index("idx_msg_delivery_phone_ts").on(table.phone, table.statusTimestamp),
]));

// ─── Escalation Events (US-428) ──────────────────────────────────────

export const escalationEvents = pgTable("escalation_events", {
  id: serial("id").primaryKey(),
  jid: varchar("jid", { length: 64 }).notNull(),
  profileId: text("profile_id").default('pelangi'),
  trigger: varchar("trigger", { length: 64 }).notNull(), // consecutive_fallback, human_request, complaint, etc.
  count: integer("count"),
  metadata: text("metadata"), // JSON string for additional context
  summary: text("summary"), // US-429: AI-generated warm handoff summary
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // US-836: SLA timer fields
  slaBreachedAt: timestamp("sla_breached_at"),       // set when SLA window expires without human response
  humanRespondedAt: timestamp("human_responded_at"), // set when outbound message sent after escalation
}, (table) => ([
  index("idx_escalation_events_jid").on(table.jid),
  index("idx_escalation_events_trigger").on(table.trigger),
  index("idx_escalation_events_created_at").on(table.createdAt),
]));

// ─── Conversation Traces (US-427) ────────────────────────────────────

export const conversationTraces = pgTable("conversation_traces", {
  id: serial("id").primaryKey(),
  traceId: varchar("trace_id", { length: 64 }).notNull(),
  jid: varchar("jid", { length: 64 }).notNull(),
  profileId: text("profile_id").default('pelangi'),
  tier: varchar("tier", { length: 8 }).notNull(), // T1, T2, T3, T4
  intent: text("intent"),
  llmProvider: text("llm_provider"),
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  classificationMs: integer("classification_ms"),
  llmMs: integer("llm_ms"),
  totalMs: integer("total_ms"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_conv_traces_jid").on(table.jid),
  index("idx_conv_traces_created_at").on(table.createdAt),
  index("idx_conv_traces_tier").on(table.tier),
]));

// ─── Message Quality Metrics (US-431) ────────────────────────────────

export const messageQualityMetrics = pgTable("message_quality_metrics", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  date: timestamp("date").notNull(), // day bucket (start of day UTC)
  messagesSent: integer("messages_sent").notNull().default(0),
  optOutEvents: integer("opt_out_events").notNull().default(0),
  blockEvents: integer("block_events").notNull().default(0),
  optOutRate: real("opt_out_rate"), // opt_out_events / messages_sent
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_quality_metrics_profile_date").on(table.profileId, table.date),
  index("idx_quality_metrics_date").on(table.date),
]));

// ─── Opt-Out / STOP Compliance (US-403) ──────────────────────────────

export const optOuts = pgTable("opt_outs", {
  phone: varchar("phone", { length: 64 }).primaryKey(),
  optedOutAt: timestamp("opted_out_at").notNull().defaultNow(),
  optedInAt: timestamp("opted_in_at"),
  // US-812: compliance tracking — when was the opt-out enforced (messages blocked)
  processedAt: timestamp("processed_at"),
}, (table) => ([
  index("idx_opt_outs_opted_out_at").on(table.optedOutAt),
]));

// ─── LLM Cost Daily (US-433) ────────────────────────────────────────

export const llmCostDaily = pgTable("llm_cost_daily", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(), // YYYY-MM-DD (UTC)
  provider: text("provider").notNull(), // provider id (e.g. "groq-llama-70b")
  profileId: text("profile_id").notNull().default('pelangi'),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  budgetCapUsd: real("budget_cap_usd"), // null = unlimited
  budgetBreached: boolean("budget_breached").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_llm_cost_daily_date_provider_profile").on(table.date, table.provider, table.profileId),
  index("idx_llm_cost_daily_date").on(table.date),
  index("idx_llm_cost_daily_provider").on(table.provider),
]));

// ─── WhatsApp Message Cost Daily (US-495) ─────────────────────────────
// Tracks per-message WhatsApp template costs under July 2025 pricing model.
// Aggregated daily by template_type + country_code + profile.

export const whatsappCostDaily = pgTable("whatsapp_cost_daily", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(), // YYYY-MM-DD (UTC)
  profileId: text("profile_id").notNull().default('pelangi'),
  templateType: varchar("template_type", { length: 32 }).notNull(), // marketing, utility, authentication, service
  countryCode: varchar("country_code", { length: 4 }).notNull().default('MY'), // ISO 3166-1 alpha-2
  totalMessages: integer("total_messages").notNull().default(0),
  billableMessages: integer("billable_messages").notNull().default(0), // excludes CSW-free utility
  cswFreeMessages: integer("csw_free_messages").notNull().default(0), // utility sent within CSW
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_wa_cost_daily_date_profile_type_country").on(table.date, table.profileId, table.templateType, table.countryCode),
  index("idx_wa_cost_daily_date").on(table.date),
  index("idx_wa_cost_daily_profile").on(table.profileId),
]));

// ─── Baileys Auth State (US-480) ─────────────────────────────────────
// Replaces useMultiFileAuthState with DB-backed auth persistence.
// Each row stores a single credential or signal key, namespaced by profile + type + key id.

export const baileysAuthState = pgTable("baileys_auth_state", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull(),           // WhatsApp instance id (e.g. "default", "60103084289")
  keyType: varchar("key_type", { length: 64 }).notNull(),  // "creds" or signal type: "pre-key", "session", "sender-key", etc.
  keyId: varchar("key_id", { length: 256 }).notNull(),     // specific key identifier (or "creds" for credentials)
  value: text("value").notNull(),                     // JSON-serialized value (using BufferJSON)
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_baileys_auth_profile_type_id").on(table.profileId, table.keyType, table.keyId),
  index("idx_baileys_auth_profile").on(table.profileId),
]));

// ─── Utterance Gaps (US-432) ─────────────────────────────────────────

export const utteranceGaps = pgTable("utterance_gaps", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  utteranceSample: varchar("utterance_sample", { length: 120 }).notNull(),
  normalizedKey: varchar("normalized_key", { length: 120 }).notNull(), // lowercase, no punctuation
  tierReached: varchar("tier_reached", { length: 16 }).notNull(), // T4, layer2, default, etc.
  count: integer("count").notNull().default(1),
  lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_utterance_gaps_profile_id").on(table.profileId),
  index("idx_utterance_gaps_count").on(table.count),
  index("idx_utterance_gaps_last_seen").on(table.lastSeenAt),
  uniqueIndex("idx_utterance_gaps_profile_normalized").on(table.profileId, table.normalizedKey),
]));

// ─── Admin Users (US-514: TOTP 2FA, US-898: RBAC) ──────────────────

/** Valid admin roles — enforced at app layer (no PG enum migration needed). */
export const ADMIN_ROLES = ['viewer', 'operator', 'super-admin'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default('operator'),  // US-898: viewer | operator | super-admin
  allowedTenants: text("allowed_tenants"),   // US-908: JSON array of tenant_ids this admin can access (null = unrestricted / super-admin)
  totpSecret: text("totp_secret"),          // AES-256-GCM encrypted, null if 2FA not enrolled
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  failedTotpAttempts: integer("failed_totp_attempts").notNull().default(0),
  totpLockedUntil: timestamp("totp_locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_admin_users_username").on(table.username),
]));

// ─── Table-derived Types ─────────────────────────────────────────────

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;
export type IntentDetectionSettings = typeof intentDetectionSettings.$inferSelect;
export type InsertIntentDetectionSettings = typeof intentDetectionSettings.$inferInsert;
export type RainbowFeedback = typeof rainbowFeedback.$inferSelect;
export type InsertRainbowFeedback = typeof rainbowFeedback.$inferInsert;
export type IntentPrediction = typeof intentPredictions.$inferSelect;
export type InsertIntentPrediction = typeof intentPredictions.$inferInsert;
export type RainbowConversationState = typeof rainbowConversationState.$inferSelect;
export type InsertRainbowConversationState = typeof rainbowConversationState.$inferInsert;
export type RainbowConversation = typeof rainbowConversations.$inferSelect;
export type InsertRainbowConversation = typeof rainbowConversations.$inferInsert;
export type RainbowMessage = typeof rainbowMessages.$inferSelect;
export type InsertRainbowMessage = typeof rainbowMessages.$inferInsert;
export type OptOut = typeof optOuts.$inferSelect;
export type InsertOptOut = typeof optOuts.$inferInsert;
export type MessageDeliveryStatus = typeof messageDeliveryStatus.$inferSelect;
export type InsertMessageDeliveryStatus = typeof messageDeliveryStatus.$inferInsert;
export type EscalationEvent = typeof escalationEvents.$inferSelect;
export type InsertEscalationEvent = typeof escalationEvents.$inferInsert;
export type ConversationTrace = typeof conversationTraces.$inferSelect;
export type InsertConversationTrace = typeof conversationTraces.$inferInsert;
export type MessageQualityMetric = typeof messageQualityMetrics.$inferSelect;
export type InsertMessageQualityMetric = typeof messageQualityMetrics.$inferInsert;
export type UtteranceGap = typeof utteranceGaps.$inferSelect;
export type InsertUtteranceGap = typeof utteranceGaps.$inferInsert;
export type LlmCostDaily = typeof llmCostDaily.$inferSelect;
export type InsertLlmCostDaily = typeof llmCostDaily.$inferInsert;
export type BaileysAuthState = typeof baileysAuthState.$inferSelect;
export type InsertBaileysAuthState = typeof baileysAuthState.$inferInsert;
export type WhatsappCostDaily = typeof whatsappCostDaily.$inferSelect;
export type InsertWhatsappCostDaily = typeof whatsappCostDaily.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = typeof adminUsers.$inferInsert;

// ─── Template Quality Events (US-831) ─────────────────────────────────
// Tracks Meta Cloud API message_template_status_update webhook events.
// Records template status transitions (APPROVED → PAUSED → DISABLED etc.)
export const templateQualityEvents = pgTable("template_quality_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateName: text("template_name").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  reason: text("reason"),
  profileId: text("profile_id").default('pelangi'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_template_quality_events_name").on(table.templateName),
  index("idx_template_quality_events_created").on(table.createdAt),
]));

export type TemplateQualityEvent = typeof templateQualityEvents.$inferSelect;
export type InsertTemplateQualityEvent = typeof templateQualityEvents.$inferInsert;

// ─── Experiment Metrics (US-837) ─────────────────────────────────────
// Tracks per-variant metrics for A/B experiment framework.
// Aggregated daily by experiment + variant + phone hash.

export const experimentMetrics = pgTable("experiment_metrics", {
  id: serial("id").primaryKey(),
  experimentId: varchar("experiment_id", { length: 128 }).notNull(),
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  phoneHash: varchar("phone_hash", { length: 64 }).notNull(), // MD5 hash of phone for privacy
  messageCount: integer("message_count").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0),
  csatSum: integer("csat_sum").notNull().default(0),
  csatCount: integer("csat_count").notNull().default(0),
  windowDate: text("window_date").notNull(), // YYYY-MM-DD (UTC)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_experiment_metrics_exp_var_phone_date").on(table.experimentId, table.variantId, table.phoneHash, table.windowDate),
  index("idx_experiment_metrics_experiment").on(table.experimentId),
  index("idx_experiment_metrics_window_date").on(table.windowDate),
]));

export type ExperimentMetric = typeof experimentMetrics.$inferSelect;
export type InsertExperimentMetric = typeof experimentMetrics.$inferInsert;

// ─── Webchat Consent Log (US-841) ───────────────────────────────────
// Records timestamped opt-in consent from webchat widget visitors.
// Session IDs are truncated hashes for privacy; user agents are hashed.

export const webchatConsentLog = pgTable("webchat_consent_log", {
  id: serial("id").primaryKey(),
  sessionIdHash: varchar("session_id_hash", { length: 64 }).notNull(),
  acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
  profileId: text("profile_id").notNull().default('pelangi'),
  userAgentHash: varchar("user_agent_hash", { length: 64 }),
}, (table) => ([
  index("idx_webchat_consent_log_profile").on(table.profileId),
  index("idx_webchat_consent_log_accepted_at").on(table.acceptedAt),
]));

export type WebchatConsentLog = typeof webchatConsentLog.$inferSelect;
export type InsertWebchatConsentLog = typeof webchatConsentLog.$inferInsert;

// ─── Service Requests (US-875) ────────────────────────────────────────
// Tracks in-stay housekeeping and maintenance requests from WhatsApp guests.
// Scoped to Pelangi Capsule Hostel profile.

export const serviceRequests = pgTable("service_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jid: text("jid").notNull(),
  profile: text("profile").notNull().default('pelangi'),
  roomNumber: text("room_number"),
  requestType: text("request_type").notNull(), // extra_towel | extra_pillow | room_cleaning | maintenance_issue | wifi_password | amenity
  details: text("details"),
  status: text("status").notNull().default('pending'), // pending | resolved
  staffNotified: boolean("staff_notified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ([
  index("idx_service_requests_jid").on(table.jid),
  index("idx_service_requests_profile").on(table.profile),
  index("idx_service_requests_status").on(table.status),
  index("idx_service_requests_created_at").on(table.createdAt),
]));

export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type InsertServiceRequest = typeof serviceRequests.$inferInsert;

// ─── Order Webhook Queue (US-876) ─────────────────────────────────────
// Persistent fallback queue for KDS/POS webhook deliveries that failed
// in-memory retries. Allows manual retry via admin API.

export const orderWebhookQueue = pgTable("order_webhook_queue", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull(),
  payloadJson: text("payload_json").notNull(), // JSON-serialized KdsOrderPayload
  status: varchar("status", { length: 16 }).notNull().default('pending'), // pending | delivered | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  profileId: text("profile_id").notNull().default('makan-moments'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at"),
  deliveredAt: timestamp("delivered_at"),
}, (table) => ([
  index("idx_order_webhook_queue_status").on(table.status),
  index("idx_order_webhook_queue_order_id").on(table.orderId),
  index("idx_order_webhook_queue_created_at").on(table.createdAt),
]));

export type OrderWebhookQueue = typeof orderWebhookQueue.$inferSelect;
export type InsertOrderWebhookQueue = typeof orderWebhookQueue.$inferInsert;

// ─── Scheduled Messages (US-884) ──────────────────────────────────────
// DB-backed scheduler for pre-arrival booking sequences and future scheduled sends.
// Each row represents a single scheduled message with template interpolation.

export const scheduledMessagesDb = pgTable("scheduled_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jid: varchar("jid", { length: 64 }).notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  sendAt: timestamp("send_at").notNull(),
  templateKey: varchar("template_key", { length: 128 }).notNull(),
  variables: text("variables"), // JSON string for template interpolation
  status: varchar("status", { length: 16 }).notNull().default('pending'), // pending | sent | cancelled | skipped
  bookingId: varchar("booking_id", { length: 128 }),
  sequenceStep: varchar("sequence_step", { length: 32 }), // confirmation | directions | ready
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  error: text("error"),
}, (table) => ([
  index("idx_scheduled_messages_status_send_at").on(table.status, table.sendAt),
  index("idx_scheduled_messages_booking_id").on(table.bookingId),
  index("idx_scheduled_messages_jid").on(table.jid),
]));

export type ScheduledMessageDb = typeof scheduledMessagesDb.$inferSelect;
export type InsertScheduledMessageDb = typeof scheduledMessagesDb.$inferInsert;

// ─── Webhook Raw Events (US-895) ─────────────────────────────────────
// Persists every inbound webhook payload to durable storage before processing.
// Enables replay of lost/failed events and provides an audit trail.

export const webhookRawEvents = pgTable("webhook_raw_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  profileId: text("profile_id").notNull().default('pelangi'),
  payload: text("payload").notNull(), // JSON-serialized raw IncomingMessage
  processed: boolean("processed").notNull().default(false),
}, (table) => ([
  index("idx_webhook_raw_events_received_at").on(table.receivedAt),
  index("idx_webhook_raw_events_processed").on(table.processed),
  index("idx_webhook_raw_events_profile").on(table.profileId),
]));

export type WebhookRawEvent = typeof webhookRawEvents.$inferSelect;
export type InsertWebhookRawEvent = typeof webhookRawEvents.$inferInsert;

// ─── Order Accuracy Events (US-902) ──────────────────────────────────
// Tracks order_confirmed and order_corrected events for AI waiter accuracy KPI.
// A "correction" = cart modification after the AI showed order confirmation.

export const orderAccuracyEvents = pgTable("order_accuracy_events", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 128 }).notNull(),
  profileId: text("profile_id").notNull().default('makan-moments'),
  eventType: varchar("event_type", { length: 32 }).notNull(), // order_confirmed | order_corrected
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_order_accuracy_events_type").on(table.eventType),
  index("idx_order_accuracy_events_created_at").on(table.createdAt),
  index("idx_order_accuracy_events_session").on(table.sessionId),
  index("idx_order_accuracy_events_profile").on(table.profileId),
]));

export type OrderAccuracyEvent = typeof orderAccuracyEvents.$inferSelect;
export type InsertOrderAccuracyEvent = typeof orderAccuracyEvents.$inferInsert;

// ─── Festive Stickers (US-923) ───────────────────────────────────────
// WhatsApp sticker uploads for Malaysian festive season engagement.
// Stickers are webp format, 512×512px, ≤100KB with transparent background.

export const festiveStickers = pgTable("festive_stickers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: text("profile_id").notNull().default('pelangi'),
  stickerName: text("sticker_name").notNull(),
  mediaId: text("media_id"), // WhatsApp media_id after upload
  fileSize: integer("file_size").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default('image/webp'),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  isActive: boolean("is_active").notNull().default(true),
}, (table) => ([
  index("idx_festive_stickers_profile_active").on(table.profileId, table.isActive),
  index("idx_festive_stickers_profile_name").on(table.profileId, table.stickerName),
]));

export type FestiveSticker = typeof festiveStickers.$inferSelect;
export type InsertFestiveSticker = typeof festiveStickers.$inferInsert;

export const stickerIntents = pgTable("sticker_intents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: text("profile_id").notNull().default('pelangi'),
  intent: text("intent").notNull(),
  stickerId: varchar("sticker_id").notNull().references(() => festiveStickers.id, { onDelete: 'cascade' }),
  greetingText: text("greeting_text").notNull(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_sticker_intents_profile_intent").on(table.profileId, table.intent),
  index("idx_sticker_intents_enabled").on(table.isEnabled),
  index("idx_sticker_intents_sticker_id").on(table.stickerId),
]));

export type StickerIntent = typeof stickerIntents.$inferSelect;
export type InsertStickerIntent = typeof stickerIntents.$inferInsert;

// ─── Campaign Pacing Events (US-962) ─────────────────────────────────────────
// Tracks Meta portfolio pacing pause events per campaign batch.
// When error 131049 is returned with a batch context, the message is held
// (not permanently failed) and queued here for operator review/re-send.

export const campaignPacingEvents = pgTable("campaign_pacing_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  batchId: text("batch_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: varchar("phone", { length: 32 }).notNull(),
  templateName: text("template_name"),
  messageContent: text("message_content"),
  errorCode: integer("error_code").notNull().default(131049),
  // 'held' = pacing pause hold; 'hard_failure' = permanent delivery failure
  failureType: varchar("failure_type", { length: 16 }).notNull().default('held'),
  // operator review state: 'pending' | 'resent' | 'cancelled'
  reviewStatus: varchar("review_status", { length: 16 }).notNull().default('pending'),
  heldAt: timestamp("held_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"),
  instanceId: text("instance_id").notNull().default('default'),
}, (table) => ([
  index("idx_cpe_batch_id").on(table.batchId),
  index("idx_cpe_profile_held_at").on(table.profileId, table.heldAt),
  index("idx_cpe_review_status").on(table.reviewStatus),
  index("idx_cpe_phone").on(table.phone),
]));

export type CampaignPacingEvent = typeof campaignPacingEvents.$inferSelect;
export type InsertCampaignPacingEvent = typeof campaignPacingEvents.$inferInsert;

// ─── Vector Access Logs (US-966) ──────────────────────────────────────────────
// OWASP LLM06:2025 — Vector and Embedding Weaknesses.
// Logs every RAG retrieval call for 90-day audit trail.
// Enables cross-namespace contamination detection and similarity attack alerting.

export const vectorAccessLogs = pgTable("vector_access_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Property that made the query (e.g., "pelangi", "southern") */
  propertyId: text("property_id").notNull(),
  /** Hashed query text (SHA-256 truncated to 16 hex chars for privacy) */
  queryHash: varchar("query_hash", { length: 16 }).notNull(),
  /** Number of chunks returned */
  chunksReturned: integer("chunks_returned").notNull().default(0),
  /** Source filenames of returned chunks (JSON array) */
  retrievedSources: text("retrieved_sources").notNull().default('[]'),
  /** Top similarity score (0-1) of returned chunks */
  topScore: real("top_score"),
  /** Whether any returned chunk had a mismatched propertyId (cross-namespace leak) */
  crossNamespaceDetected: boolean("cross_namespace_detected").notNull().default(false),
  /** Whether a similarity attack was suspected (anomalously high score) */
  similarityAttackSuspected: boolean("similarity_attack_suspected").notNull().default(false),
  /** Retrieval latency in ms */
  latencyMs: integer("latency_ms"),
  /** Service identity that performed the retrieval */
  serviceIdentity: text("service_identity").notNull().default('rainbow-ai'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_val_property_created").on(table.propertyId, table.createdAt),
  index("idx_val_cross_namespace").on(table.crossNamespaceDetected),
  index("idx_val_attack_suspected").on(table.similarityAttackSuspected),
  index("idx_val_created_at").on(table.createdAt),
]));

export type VectorAccessLog = typeof vectorAccessLogs.$inferSelect;
export type InsertVectorAccessLog = typeof vectorAccessLogs.$inferInsert;

// ─── Marketing Subscriptions (US-969) ────────────────────────────────────────
// Double opt-in consent flow for WhatsApp marketing messages.
// Meta 2025 policy: opt-in must be documented before any proactive marketing send.
// Malaysia PDPA 2024: consent must be specific, informed, and revocable.
//
// Consent lifecycle:
//   pending   → opt-in template sent; awaiting keyword reply (48h window)
//   confirmed → guest replied with confirm keyword (YES)
//   revoked   → guest replied with revoke keyword (STOP) or admin-revoked
//   expired   → 48h passed without confirmation; excluded from campaigns

export const marketingSubscriptions = pgTable("marketing_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: varchar("phone", { length: 64 }).notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  /** 'pending' | 'confirmed' | 'revoked' | 'expired' */
  consentStatus: varchar("consent_status", { length: 16 }).notNull().default('pending'),
  /** How the contact was added: 'checkin' | 'web_form' | 'admin_add' | 'qr_code' */
  channel: varchar("channel", { length: 32 }).notNull().default('admin_add'),
  /** IP/source identifier where consent was initiated (for PDPA audit) */
  collectedVia: text("collected_via"),
  /** When the opt-in confirmation template was sent */
  optInSentAt: timestamp("opt_in_sent_at"),
  /** When consent was confirmed (keyword reply received) */
  confirmedAt: timestamp("confirmed_at"),
  /** When consent was revoked (STOP or admin action) */
  revokedAt: timestamp("revoked_at"),
  /** 48h deadline — if no confirmation by this time, status → expired */
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_marketing_sub_phone_profile").on(table.phone, table.profileId),
  index("idx_marketing_sub_status").on(table.consentStatus),
  index("idx_marketing_sub_expires_at").on(table.expiresAt),
  index("idx_marketing_sub_profile_status").on(table.profileId, table.consentStatus),
]));

export type MarketingSubscription = typeof marketingSubscriptions.$inferSelect;
export type InsertMarketingSubscription = typeof marketingSubscriptions.$inferInsert;

// ─── MM Lite Sends (US-1007) ──────────────────────────────────────────────────
// Tracks marketing template sends via Meta's Marketing Messages Lite (MM Lite) API.
// MM Lite provides AI-optimised delivery timing and TTL to avoid late delivery of
// time-sensitive promotions (flash sales, daily specials).
//
// sendApi: 'mm_lite' uses the Cloud API messages endpoint with ttl.seconds set;
//          'standard' is the normal Baileys/Cloud API send without TTL.
// deliveryStatus lifecycle: queued → sent → delivered | failed | expired
//   expired = message not delivered before ttlExpiresAt

export const mmLiteSends = pgTable("mm_lite_sends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Campaign identifier (admin-assigned, e.g. "makan-daily-2026-03-16") */
  campaignId: text("campaign_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: varchar("phone", { length: 64 }).notNull(),
  templateName: text("template_name").notNull(),
  /** 'mm_lite' | 'standard' — which send path was used */
  sendApi: varchar("send_api", { length: 16 }).notNull().default('mm_lite'),
  /** TTL in hours set at send time (default 720h = 30 days) */
  ttlHours: integer("ttl_hours").notNull().default(720),
  /** Computed expiry timestamp (sentAt + ttlHours) */
  ttlExpiresAt: timestamp("ttl_expires_at"),
  /** 'queued' | 'sent' | 'delivered' | 'failed' | 'expired' */
  deliveryStatus: varchar("delivery_status", { length: 16 }).notNull().default('queued'),
  /** Timestamp when MM Lite API accepted the send */
  sentAt: timestamp("sent_at"),
  /** Timestamp when delivery confirmation received via webhook */
  deliveredAt: timestamp("delivered_at"),
  /** Timestamp when TTL expiry was detected */
  expiredAt: timestamp("expired_at"),
  /** Meta message ID returned from Cloud API */
  metaMessageId: text("meta_message_id"),
  /** Error code/message if send failed */
  errorInfo: text("error_info"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_mm_lite_campaign").on(table.campaignId),
  index("idx_mm_lite_profile_status").on(table.profileId, table.deliveryStatus),
  index("idx_mm_lite_phone").on(table.phone),
  index("idx_mm_lite_expires_at").on(table.ttlExpiresAt),
  index("idx_mm_lite_send_api").on(table.sendApi),
  index("idx_mm_lite_created_at").on(table.createdAt),
]));

export type MmLiteSend = typeof mmLiteSends.$inferSelect;
export type InsertMmLiteSend = typeof mmLiteSends.$inferInsert;

// ─── DPIA and TIA (US-1009) ──────────────────────────────────────────────────
// Malaysia PDPA 2025 Data Protection Impact Assessment (DPIA) and
// Transfer Impact Assessment (TIA) for cross-border AI data transfers.
// DPIA is mandatory for processing >10,000 data subjects with AI decisions.
// TIA is required for each external AI provider per CBPDT Guidelines.

export const dpiaRecords = pgTable("dpia_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Profile this DPIA applies to ('pelangi', 'makan-moments', etc.) */
  profileId: text("profile_id").notNull(),
  /** DPIA title/description */
  title: text("title").notNull(),
  /** Structured DPIA document as JSON */
  documentJson: text("document_json").notNull(),
  /** Processing scope: high-level description of what data is processed */
  processingScope: text("processing_scope").notNull(),
  /** Risk assessment summary */
  riskSummary: text("risk_summary").notNull(),
  /** Mitigation measures documented */
  mitigations: text("mitigations").notNull(),
  /** Last review date */
  lastReviewedAt: timestamp("last_reviewed_at").notNull().defaultNow(),
  /** Next review due (must be within 3 years per CBPDT Guidelines) */
  nextReviewDue: timestamp("next_review_due").notNull(),
  /** Reviewer name/email */
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_dpia_profile_id").on(table.profileId),
  index("idx_dpia_next_review_due").on(table.nextReviewDue),
]));

export type DpiaRecord = typeof dpiaRecords.$inferSelect;
export type InsertDpiaRecord = typeof dpiaRecords.$inferInsert;

export const tiaRecords = pgTable("tia_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Profile this TIA applies to */
  profileId: text("profile_id").notNull(),
  /** AI provider name ('NVIDIA', 'OpenRouter', 'Ollama', etc.) */
  aiProvider: text("ai_provider").notNull(),
  /** Destination jurisdiction code (e.g. 'US', 'SG') */
  destinationJurisdiction: text("destination_jurisdiction").notNull(),
  /** Data protection equivalence assessment */
  equivalenceLevel: varchar("equivalence_level", { length: 16 }).notNull(), // 'adequate' | 'similar' | 'assessed'
  /** API endpoint URL for this provider */
  apiEndpoint: text("api_endpoint").notNull(),
  /** Transfer mechanism (e.g. 'standard_contractual_clauses', 'adequacy_decision') */
  transferMechanism: text("transfer_mechanism").notNull(),
  /** TIA document as JSON */
  documentJson: text("document_json").notNull(),
  /** Data transferred (e.g. 'guest_phone,name,conversation_context') */
  dataTransferred: text("data_transferred").notNull(),
  /** Risk assessment for this transfer */
  riskAssessment: text("risk_assessment").notNull(),
  /** Controls in place */
  controls: text("controls").notNull(),
  /** Last review date */
  lastReviewedAt: timestamp("last_reviewed_at").notNull().defaultNow(),
  /** Valid until (max 3 years per CBPDT) */
  validUntil: timestamp("valid_until").notNull(),
  /** Reviewed by */
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_tia_profile_provider").on(table.profileId, table.aiProvider),
  index("idx_tia_valid_until").on(table.validUntil),
  index("idx_tia_created_at").on(table.createdAt),
]));

export type TiaRecord = typeof tiaRecords.$inferSelect;
export type InsertTiaRecord = typeof tiaRecords.$inferInsert;

// ─── AI Decision Audit (US-1010) ─────────────────────────────────────────────
// Audit log for automated AI decisions under Malaysia PDPA 2025 (PCP 3/2025)
// Records decision type, confidence, human review requests, and outcomes.

export const aiDecisionAudit = pgTable("ai_decision_audit", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: varchar("phone", { length: 64 }).notNull(),
  /** Category of automated decision: booking | escalation | order_confirmation | menu_recommendation */
  decisionType: varchar("decision_type", { length: 64 }).notNull(),
  /** Intent that triggered this decision */
  intent: text("intent"),
  /** AI confidence score (0-1) at time of decision */
  confidenceScore: real("confidence_score"),
  /** AI provider that produced the decision */
  aiProvider: text("ai_provider"),
  /** Whether the guest requested human review */
  humanReviewRequested: boolean("human_review_requested").notNull().default(false),
  /** Final outcome: accepted | human_review | escalated | cancelled */
  outcome: varchar("outcome", { length: 64 }),
  /** When the disclosure message was sent to the guest */
  disclosureSentAt: timestamp("disclosure_sent_at"),
  /** When the guest requested human review (null if not requested) */
  reviewRequestedAt: timestamp("review_requested_at"),
  /** When the decision was resolved */
  resolvedAt: timestamp("resolved_at"),
  /** Additional context (JSON string) */
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_aidecision_profile_phone").on(table.profileId, table.phone),
  index("idx_aidecision_created_at").on(table.createdAt),
  index("idx_aidecision_human_review").on(table.humanReviewRequested),
]));

export type AiDecisionAuditRecord = typeof aiDecisionAudit.$inferSelect;
export type InsertAiDecisionAuditRecord = typeof aiDecisionAudit.$inferInsert;

// ─── Prompt Injection Events (US-998) ────────────────────────────────

export const promptInjectionEvents = pgTable("prompt_injection_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jid: text("jid").notNull(),
  profileId: text("profile_id").notNull().default("pelangi"),
  originalMessageText: text("original_message_text").notNull(),
  matchedPattern: text("matched_pattern").notNull(),
  actionTaken: varchar("action_taken", { length: 64 }).notNull().default("blocked"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_injection_events_jid").on(table.jid),
  index("idx_injection_events_profile").on(table.profileId),
  index("idx_injection_events_created_at").on(table.createdAt),
]));

export type PromptInjectionEvent = typeof promptInjectionEvents.$inferSelect;
export type InsertPromptInjectionEvent = typeof promptInjectionEvents.$inferInsert;

// ─── Vendor DPA Registry (US-958) ───────────────────────────────────

export const dpaRegistry = pgTable("dpa_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorName: text("vendor_name").notNull(),
  registeredAddress: text("registered_address").notNull().default(""),
  dataCategories: text("data_categories").notNull(),
  processingPurpose: text("processing_purpose").notNull(),
  retentionPeriod: text("retention_period").notNull().default(""),
  subProcessors: text("sub_processors").notNull().default("[]"),
  dpaStatus: varchar("dpa_status", { length: 32 }).notNull().default("pending"),
  dpaExpiryDate: timestamp("dpa_expiry_date"),
  dpaSigned: timestamp("dpa_signed"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_dpa_registry_vendor").on(table.vendorName),
  index("idx_dpa_registry_status").on(table.dpaStatus),
  index("idx_dpa_registry_expiry").on(table.dpaExpiryDate),
]));

export type DpaRegistryEntry = typeof dpaRegistry.$inferSelect;
export type InsertDpaRegistryEntry = typeof dpaRegistry.$inferInsert;
