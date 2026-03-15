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
  tenantId: text("tenant_id").notNull().default('pelangi'),
  key: text("key").notNull(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: varchar("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_app_settings_key").on(table.key),
  uniqueIndex("idx_app_settings_tenant_key").on(table.tenantId, table.key),
]));

// ─── Rainbow AI ──────────────────────────────────────────────────────

export const intentDetectionSettings = pgTable("intent_detection_settings", {
  id: serial("id").primaryKey(),
  tenantId: text("tenant_id").notNull().default('pelangi'),
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
  profileId: text("profile_id").notNull().default('pelangi'),
  pinned: boolean("pinned").notNull().default(false),
  favourite: boolean("favourite").notNull().default(false),
  lastReadAt: timestamp("last_read_at"),
  responseMode: text("response_mode"),
  status: varchar("status", { length: 16 }).notNull().default('active'),  // US-444: 'active' or 'ended'
  contactDetailsJson: text("contact_details_json"),
  contextSummary: text("context_summary"),                    // US-447: LLM-generated context summary
  contextSummaryAt: timestamp("context_summary_at"),          // US-447: when the summary was generated
  // US-910: Click-to-WhatsApp ad referral attribution
  referralSourceType: text("referral_source_type"),           // ad | post | qr_code
  referralCtwaClid: text("referral_ctwa_clid"),               // Click ID for Meta Conversions API matching
  referralSourceId: text("referral_source_id"),               // Campaign/ad ID
  referralHeadline: text("referral_headline"),                // Ad headline text
  referralBody: text("referral_body"),                        // Ad body text
  referralMediaType: text("referral_media_type"),             // image | video
  referralSourceUrl: text("referral_source_url"),             // Source URL of the ad/post
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ([
  uniqueIndex("idx_rainbow_conversations_bsuid").on(table.bsuid),
  index("idx_rainbow_conversations_referral_source_type").on(table.referralSourceType),
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
  hallucinationAction: text("hallucination_action"), // US-913: action taken (block/body/header/none, null = not checked)
  hallucinationSeverity: integer("hallucination_severity"), // US-913: contradiction count (null = not checked)
  profileId: text("profile_id").notNull().default('pelangi'),
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
  tenantId: text("tenant_id").notNull().default('pelangi'),  // US-908: tenant scope for RBAC isolation
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

// ─── Payment Sessions (US-911) ─────────────────────────────────────
// Tracks WhatsApp in-chat webview payment sessions.
// Created when a "Pay Now" CTA is sent; updated on payment gateway callback.

export const paymentSessions = pgTable("payment_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profileId: text("profile_id").notNull().default('pelangi'),
  jid: varchar("jid", { length: 64 }).notNull(),             // WhatsApp JID of the payer
  phone: varchar("phone", { length: 64 }).notNull(),          // Phone number (for confirmation message)
  orderSummaryJson: text("order_summary_json").notNull(),     // JSON: { items, totalMyr, currency, description }
  amountMyr: real("amount_myr").notNull(),                    // Total amount in MYR
  paymentMethod: varchar("payment_method", { length: 32 }),   // duitnow_qr | fpx | tng | null (not yet selected)
  gatewayRef: text("gateway_ref"),                            // External payment gateway reference ID
  gatewayProvider: varchar("gateway_provider", { length: 32 }), // hitpay | curlec | manual
  status: varchar("status", { length: 16 }).notNull().default('pending'), // pending | paid | failed | expired
  tokenHash: varchar("token_hash", { length: 64 }).notNull(), // SHA-256 hash of JWT token (for revocation check)
  expiresAt: timestamp("expires_at").notNull(),               // Token/session expiry (default: 30 min)
  paidAt: timestamp("paid_at"),
  failedAt: timestamp("failed_at"),
  callbackPayloadJson: text("callback_payload_json"),         // Raw gateway callback payload for audit
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_payment_sessions_jid").on(table.jid),
  index("idx_payment_sessions_status").on(table.status),
  index("idx_payment_sessions_profile").on(table.profileId),
  index("idx_payment_sessions_expires_at").on(table.expiresAt),
  index("idx_payment_sessions_token_hash").on(table.tokenHash),
]));

export type PaymentSession = typeof paymentSessions.$inferSelect;
export type InsertPaymentSession = typeof paymentSessions.$inferInsert;
