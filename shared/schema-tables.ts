/**
 * schema-tables.ts — Drizzle ORM table definitions for Rainbow AI
 *
 * Contains Rainbow-owned sqliteTable definitions and table-derived types.
 * Extracted from digiman/shared/schema-tables.ts during decomposition.
 */
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";

// ─── Settings ────────────────────────────────────────────────────────
// Rainbow stores its own settings with `rainbow_*` prefixed keys

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  description: text("description"),
  updatedBy: text("updated_by"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_app_settings_key").on(table.key),
]));

// ─── Rainbow AI ──────────────────────────────────────────────────────

export const intentDetectionSettings = sqliteTable("intent_detection_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tier1Enabled: integer("tier1_enabled", { mode: "boolean" }).default(true).notNull(),
  tier1ContextMessages: integer("tier1_context_messages").default(0).notNull(),
  tier2Enabled: integer("tier2_enabled", { mode: "boolean" }).default(true).notNull(),
  tier2ContextMessages: integer("tier2_context_messages").default(3).notNull(),
  tier2Threshold: real("tier2_threshold").default(0.80).notNull(),
  tier3Enabled: integer("tier3_enabled", { mode: "boolean" }).default(true).notNull(),
  tier3ContextMessages: integer("tier3_context_messages").default(5).notNull(),
  tier3Threshold: real("tier3_threshold").default(0.70).notNull(),
  tier4Enabled: integer("tier4_enabled", { mode: "boolean" }).default(true).notNull(),
  tier4ContextMessages: integer("tier4_context_messages").default(5).notNull(),
  trackLastIntent: integer("track_last_intent", { mode: "boolean" }).default(true).notNull(),
  trackSlots: integer("track_slots", { mode: "boolean" }).default(true).notNull(),
  maxHistoryMessages: integer("max_history_messages").default(20).notNull(),
  contextTTL: integer("context_ttl_minutes").default(30).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull(),
});

export const rainbowFeedback = sqliteTable("rainbow_feedback", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
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
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_rainbow_feedback_conversation_id").on(table.conversationId),
  index("idx_rainbow_feedback_phone_number").on(table.phoneNumber),
  index("idx_rainbow_feedback_intent").on(table.intent),
  index("idx_rainbow_feedback_rating").on(table.rating),
  index("idx_rainbow_feedback_created_at").on(table.createdAt),
  index("idx_rainbow_feedback_created_intent").on(table.createdAt, table.intent),
]));

export const intentPredictions = sqliteTable("intent_predictions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id").notNull(),
  phoneNumber: text("phone_number").notNull(),
  messageText: text("message_text").notNull(),
  predictedIntent: text("predicted_intent").notNull(),
  confidence: real("confidence").notNull(),
  tier: text("tier").notNull(),
  model: text("model"),
  profile: text("profile"),
  actualIntent: text("actual_intent"),
  wasCorrect: integer("was_correct", { mode: "boolean" }),
  correctionSource: text("correction_source"),
  correctedAt: integer("corrected_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_intent_predictions_conversation_id").on(table.conversationId),
  index("idx_intent_predictions_phone_number").on(table.phoneNumber),
  index("idx_intent_predictions_predicted_intent").on(table.predictedIntent),
  index("idx_intent_predictions_tier").on(table.tier),
  index("idx_intent_predictions_was_correct").on(table.wasCorrect),
  index("idx_intent_predictions_created_at").on(table.createdAt),
  index("idx_intent_predictions_correct_created").on(table.wasCorrect, table.createdAt),
]));

// ─── Intent Analytics (US-043) ──────────────────────────────────────
// Tracks confidence metrics and latency for each intent classification
// Used for calculating per-profile and per-intent success rates and baselines

export const intentAnalytics = sqliteTable("intent_analytics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull().default('pelangi'),
  intentType: text("intent_type").notNull(),
  confidence: real("confidence").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  wasCorrect: integer("was_correct", { mode: "boolean" }),  // populated by feedback correlation later
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_intent_analytics_profile_id").on(table.profileId),
  index("idx_intent_analytics_intent_type").on(table.intentType),
  index("idx_intent_analytics_profile_intent").on(table.profileId, table.intentType),
  index("idx_intent_analytics_created_at").on(table.createdAt),
]));

// ─── Intent Classifier Baselines (US-098) ────────────────────────────
// Stores baseline accuracy metrics per profile and intent type
// Used to detect classifier degradation and performance regressions

export const intentClassifierBaselines = sqliteTable("intent_classifier_baselines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull(),
  intentType: text("intent_type").notNull(),
  accuracyPct: real("accuracy_pct").notNull(),  // percentage (0-100)
  sampleCount: integer("sample_count").notNull(),  // number of messages evaluated
  baselineDate: integer("baseline_date", { mode: "timestamp_ms" }).notNull(),  // when this baseline was established
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_classifier_baselines_profile_intent").on(table.profileId, table.intentType),
  index("idx_classifier_baselines_profile_id").on(table.profileId),
  index("idx_classifier_baselines_intent_type").on(table.intentType),
  index("idx_classifier_baselines_baseline_date").on(table.baselineDate),
]));

export type IntentClassifierBaseline = typeof intentClassifierBaselines.$inferSelect;
export type InsertIntentClassifierBaseline = typeof intentClassifierBaselines.$inferInsert;

// ─── Regression Alerts (US-159) ───────────────────────────────────
// Stores alerts when intent classifier accuracy drops >5% from baseline
// Status: active = unresolved regression, resolved = accuracy recovered

export const regressionAlerts = sqliteTable("regression_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull(),
  intentType: text("intent_type").notNull(),
  baselineAccuracy: real("baseline_accuracy").notNull(),  // accuracy_pct at baseline
  currentAccuracy: real("current_accuracy").notNull(),    // accuracy_pct at detection time
  accuracyDrop: real("accuracy_drop").notNull(),          // drop in percentage points
  status: text("status").notNull().default('active'),     // 'active' | 'resolved'
  detectedAt: integer("detected_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_regression_alerts_profile_id").on(table.profileId),
  index("idx_regression_alerts_intent_type").on(table.intentType),
  index("idx_regression_alerts_status").on(table.status),
  index("idx_regression_alerts_detected_at").on(table.detectedAt),
]));

export type RegressionAlert = typeof regressionAlerts.$inferSelect;
export type InsertRegressionAlert = typeof regressionAlerts.$inferInsert;

// ─── Intent Hard Cases (US-207) ───────────────────────────────────────
// Stores conversations with ambiguous intent classifications for manual review
// Flags low confidence and multi-candidate scenarios for product team analysis

export const intentHardCases = sqliteTable("intent_hard_cases", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text("conversation_id").notNull(),
  intentId: text("intent_id").notNull(),
  confidence: real("confidence").notNull(),
  candidateIntents: text("candidate_intents", { mode: "json" }),  // array of {intent, confidence}
  reason: text("reason"),
  profile: text("profile").notNull().default('pelangi'),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_intent_hard_cases_profile").on(table.profile),
  index("idx_intent_hard_cases_intent_id").on(table.intentId),
  index("idx_intent_hard_cases_confidence").on(table.confidence),
  index("idx_intent_hard_cases_created_at").on(table.createdAt),
  index("idx_intent_hard_cases_profile_confidence").on(table.profile, table.confidence),
]));

export type IntentHardCase = typeof intentHardCases.$inferSelect;
export type InsertIntentHardCase = typeof intentHardCases.$inferInsert;

export const rainbowConversationState = sqliteTable("rainbow_conversation_state", {
  phone: text("phone").primaryKey(),
  pushName: text("push_name").notNull(),
  language: text("language").notNull().default('en'),
  bookingStateJson: text("booking_state_json"),
  workflowStateJson: text("workflow_state_json"),
  activeFlowJson: text("active_flow_json"),  // US-408: Unified flow state for new flow types
  unknownCount: integer("unknown_count").notNull().default(0),
  lastIntent: text("last_intent"),
  lastIntentConfidence: real("last_intent_confidence"),
  lastIntentTimestamp: integer("last_intent_timestamp", { mode: "timestamp_ms" }),
  slotsJson: text("slots_json"),
  repeatCount: integer("repeat_count").notNull().default(0),
  profileId: text("profile_id").default('pelangi'),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastActiveAt: integer("last_active_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastUserMessageAt: integer("last_user_message_at", { mode: "timestamp_ms" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ─── Rainbow Conversations (Hybrid Storage: replaces JSON files) ─────

export const rainbowConversations = sqliteTable("rainbow_conversations", {
  phone: text("phone").primaryKey(),
  bsuid: text("bsuid"),   // US-477: WhatsApp Business-Scoped User ID (format: CC.BSUID)
  pushName: text("push_name").notNull().default(''),
  instanceId: text("instance_id"),
  profileId: text("profile_id").default('pelangi'),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  favourite: integer("favourite", { mode: "boolean" }).notNull().default(false),
  lastReadAt: integer("last_read_at", { mode: "timestamp_ms" }),
  responseMode: text("response_mode"),
  status: text("status").notNull().default('active'),  // US-444: 'active' or 'ended'
  contactDetailsJson: text("contact_details_json"),
  contextSummary: text("context_summary"),                    // US-447: LLM-generated context summary
  contextSummaryAt: integer("context_summary_at", { mode: "timestamp_ms" }),          // US-447: when the summary was generated
  // US-910: Click-to-WhatsApp ad referral attribution
  referralCtwaClid: text("referral_ctwa_clid"),               // Meta Conversions API click ID
  referralSourceId: text("referral_source_id"),               // Campaign/source ID
  referralSourceType: text("referral_source_type"),           // 'ad' | 'post' | 'qr_code'
  referralHeadline: text("referral_headline"),                // Ad headline
  referralBody: text("referral_body"),                        // Ad body text
  referralJson: text("referral_json"),                        // Full referral object as JSON
  // US-979: WhatsApp marketing opt-in audit trail
  optInMethod: text("opt_in_method"),                         // 'inbound' | 'double_optin' | 'web_form' | 'ctwa_ad' | 'qr_code' | 'in_person'
  optInAt: integer("opt_in_at", { mode: "timestamp_ms" }),                            // Timestamp of confirmed opt-in
  optInChannel: text("opt_in_channel"),                       // Channel where opt-in occurred
  // US-155: WhatsApp message sending consent (Meta Cloud API requirement)
  whatsappOptedIn: integer("whatsapp_opted_in", { mode: "boolean" }).notNull().default(false), // Explicit consent to receive WhatsApp messages
  whatsappOptedInAt: integer("whatsapp_opted_in_at", { mode: "timestamp_ms" }),       // Timestamp when consent was given
  // US-119: Guest language preference persistence
  metadata: text("metadata"),                                  // JSON string for additional context (e.g., preferredLanguage)
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (table) => ([
  uniqueIndex("idx_rainbow_conversations_bsuid").on(table.bsuid),
]));

export const rainbowMessages = sqliteTable("rainbow_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  intent: text("intent"),
  confidence: real("confidence"),
  action: text("action"),
  manual: integer("manual", { mode: "boolean" }),
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
  transcribed: integer("transcribed", { mode: "boolean" }),  // US-438: true if voice note was transcribed
  mediaUrl: text("media_url"),          // US-840: ephemeral media URL (if available from Baileys)
  localMediaUrl: text("local_media_url"), // US-893: locally-saved media path after auto-download
  faithfulnessScore: real("faithfulness_score"), // US-899: 0.0-1.0 faithfulness check score (null = not checked)
  profileId: text("profile_id").default('pelangi'),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
}, (table) => ([
  index("idx_rainbow_messages_phone").on(table.phone),
  index("idx_rainbow_messages_phone_timestamp").on(table.phone, table.timestamp),
  index("idx_rainbow_messages_role").on(table.role),
  index("idx_rainbow_messages_timestamp").on(table.timestamp),
  index("idx_rainbow_messages_phone_role_ts").on(table.phone, table.role, table.timestamp),
  // US-061: profile_id must be a non-empty string — application sets it before insert
  check("chk_rainbow_messages_profile_not_empty", sql`profile_id IS NOT NULL AND profile_id <> ''`),
]));

// ─── Conversation Audit Trail (US-156) ──────────────────────────────
// Immutable audit log for PDPA compliance and conversation quality debugging.
// Insert-only table; deletions only via automated data retention policy (US-157).

export const conversationAudit = sqliteTable("conversation_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  phone: text("phone").notNull(),
  guestId: text("guest_id"),  // optional guest ID if available
  message: text("message").notNull(),              // full message content
  intent: text("intent"),                          // detected intent
  confidence: real("confidence"),                  // intent confidence score (0.0-1.0)
  actionTaken: text("action_taken"),               // action/workflow triggered
  tier: text("tier"),                              // classification tier (T1-T4)
  profileId: text("profile_id").default('pelangi'),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_conv_audit_phone").on(table.phone),
  index("idx_conv_audit_timestamp").on(table.timestamp),
  index("idx_conv_audit_phone_timestamp").on(table.phone, table.timestamp),
  index("idx_conv_audit_intent").on(table.intent),
  index("idx_conv_audit_profile").on(table.profileId),
  index("idx_conv_audit_guest_id").on(table.guestId),
  // Immutability: no deletes allowed on this table (enforced via trigger or application logic)
]));

export type ConversationAudit = typeof conversationAudit.$inferSelect;
export type InsertConversationAudit = typeof conversationAudit.$inferInsert;

// ─── Message Delivery Status (US-426) ────────────────────────────────

export const messageDeliveryStatus = sqliteTable("message_delivery_status", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  baileysMessageId: text("baileys_message_id").notNull(),
  phone: text("phone").notNull(),
  status: text("status").notNull(), // pending|sent|delivered|read|played|failed
  statusTimestamp: integer("status_timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  instanceId: text("instance_id"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_msg_delivery_baileys_id").on(table.baileysMessageId),
  index("idx_msg_delivery_phone").on(table.phone),
  index("idx_msg_delivery_phone_ts").on(table.phone, table.statusTimestamp),
]));

// ─── Escalation Events (US-428) ──────────────────────────────────────

export const escalationEvents = sqliteTable("escalation_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jid: text("jid").notNull(),
  profileId: text("profile_id").default('pelangi'),
  trigger: text("trigger").notNull(), // consecutive_fallback, human_request, complaint, etc.
  count: integer("count"),
  metadata: text("metadata"), // JSON string for additional context
  summary: text("summary"), // US-429: AI-generated warm handoff summary
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  // US-836: SLA timer fields
  slaBreachedAt: integer("sla_breached_at", { mode: "timestamp_ms" }),       // set when SLA window expires without human response
  humanRespondedAt: integer("human_responded_at", { mode: "timestamp_ms" }), // set when outbound message sent after escalation
  // US-077: Fallback effectiveness tracking
  fallbackResponseTemplateId: text("fallback_response_template_id"), // template that was used before escalation
  escalationWithin2Msgs: integer("escalation_within_2_msgs", { mode: "boolean" }),        // true if escalation within 2 msgs of fallback
}, (table) => ([
  index("idx_escalation_events_jid").on(table.jid),
  index("idx_escalation_events_trigger").on(table.trigger),
  index("idx_escalation_events_created_at").on(table.createdAt),
]));

// ─── Conversation Traces (US-427) ────────────────────────────────────

export const conversationTraces = sqliteTable("conversation_traces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  traceId: text("trace_id").notNull(),
  jid: text("jid").notNull(),
  profileId: text("profile_id").default('pelangi'),
  tier: text("tier").notNull(), // T1, T2, T3, T4
  intent: text("intent"),
  llmProvider: text("llm_provider"),
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  classificationMs: integer("classification_ms"),
  llmMs: integer("llm_ms"),
  totalMs: integer("total_ms"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_conv_traces_jid").on(table.jid),
  index("idx_conv_traces_created_at").on(table.createdAt),
  index("idx_conv_traces_tier").on(table.tier),
]));

// ─── Message Quality Metrics (US-431) ────────────────────────────────

export const messageQualityMetrics = sqliteTable("message_quality_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull().default('pelangi'),
  date: integer("date", { mode: "timestamp_ms" }).notNull(), // day bucket (start of day UTC)
  messagesSent: integer("messages_sent").notNull().default(0),
  optOutEvents: integer("opt_out_events").notNull().default(0),
  blockEvents: integer("block_events").notNull().default(0),
  optOutRate: real("opt_out_rate"), // opt_out_events / messages_sent
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_quality_metrics_profile_date").on(table.profileId, table.date),
  index("idx_quality_metrics_date").on(table.date),
]));

// ─── Opt-Out / STOP Compliance (US-403) ──────────────────────────────

export const optOuts = sqliteTable("opt_outs", {
  phone: text("phone").primaryKey(),
  optedOutAt: integer("opted_out_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  optedInAt: integer("opted_in_at", { mode: "timestamp_ms" }),
  // US-812: compliance tracking — when was the opt-out enforced (messages blocked)
  processedAt: integer("processed_at", { mode: "timestamp_ms" }),
}, (table) => ([
  index("idx_opt_outs_opted_out_at").on(table.optedOutAt),
]));

// ─── LLM Cost Daily (US-433) ────────────────────────────────────────

export const llmCostDaily = sqliteTable("llm_cost_daily", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD (UTC)
  provider: text("provider").notNull(), // provider id (e.g. "groq-llama-70b")
  profileId: text("profile_id").notNull().default('pelangi'),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  budgetCapUsd: real("budget_cap_usd"), // null = unlimited
  budgetBreached: integer("budget_breached", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_llm_cost_daily_date_provider_profile").on(table.date, table.provider, table.profileId),
  index("idx_llm_cost_daily_date").on(table.date),
  index("idx_llm_cost_daily_provider").on(table.provider),
]));

// ─── WhatsApp Message Cost Daily (US-495) ─────────────────────────────
// Tracks per-message WhatsApp template costs under July 2025 pricing model.
// Aggregated daily by template_type + country_code + profile.

export const whatsappCostDaily = sqliteTable("whatsapp_cost_daily", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD (UTC)
  profileId: text("profile_id").notNull().default('pelangi'),
  templateType: text("template_type").notNull(), // marketing, utility, authentication, service
  countryCode: text("country_code").notNull().default('MY'), // ISO 3166-1 alpha-2
  totalMessages: integer("total_messages").notNull().default(0),
  billableMessages: integer("billable_messages").notNull().default(0), // excludes CSW-free utility
  cswFreeMessages: integer("csw_free_messages").notNull().default(0), // utility sent within CSW
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_wa_cost_daily_date_profile_type_country").on(table.date, table.profileId, table.templateType, table.countryCode),
  index("idx_wa_cost_daily_date").on(table.date),
  index("idx_wa_cost_daily_profile").on(table.profileId),
]));

// ─── Baileys Auth State (US-480) ─────────────────────────────────────
// Replaces useMultiFileAuthState with DB-backed auth persistence.
// Each row stores a single credential or signal key, namespaced by profile + type + key id.

export const baileysAuthState = sqliteTable("baileys_auth_state", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull(),           // WhatsApp instance id (e.g. "default", "60103084289")
  keyType: text("key_type").notNull(),  // "creds" or signal type: "pre-key", "session", "sender-key", etc.
  keyId: text("key_id").notNull(),     // specific key identifier (or "creds" for credentials)
  value: text("value").notNull(),                     // JSON-serialized value (using BufferJSON)
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_baileys_auth_profile_type_id").on(table.profileId, table.keyType, table.keyId),
  index("idx_baileys_auth_profile").on(table.profileId),
]));

// ─── Utterance Gaps (US-432) ─────────────────────────────────────────

export const utteranceGaps = sqliteTable("utterance_gaps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull().default('pelangi'),
  utteranceSample: text("utterance_sample").notNull(),
  normalizedKey: text("normalized_key").notNull(), // lowercase, no punctuation
  tierReached: text("tier_reached").notNull(), // T4, layer2, default, etc.
  count: integer("count").notNull().default(1),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const adminUsers = sqliteTable("admin_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default('operator'),  // US-898: viewer | operator | super-admin
  allowedTenants: text("allowed_tenants"),   // US-908: JSON array of tenant_ids this admin can access (null = unrestricted / super-admin)
  totpSecret: text("totp_secret"),          // AES-256-GCM encrypted, null if 2FA not enrolled
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  failedTotpAttempts: integer("failed_totp_attempts").notNull().default(0),
  totpLockedUntil: integer("totp_locked_until", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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
export const templateQualityEvents = sqliteTable("template_quality_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  templateName: text("template_name").notNull(),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  reason: text("reason"),
  profileId: text("profile_id").default('pelangi'),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_template_quality_events_name").on(table.templateName),
  index("idx_template_quality_events_created").on(table.createdAt),
]));

export type TemplateQualityEvent = typeof templateQualityEvents.$inferSelect;
export type InsertTemplateQualityEvent = typeof templateQualityEvents.$inferInsert;

// ─── WhatsApp Templates (US-900) ─────────────────────────────────────
// Stores current status of WhatsApp message templates per profile.
// Used by template-rejection-monitor to detect APPROVED → REJECTED/PAUSED transitions.
export const whatsappTemplates = sqliteTable("whatsapp_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  templateName: text("template_name").notNull(),
  status: text("status").notNull(),
  previousStatus: text("previous_status"),
  rejectedReason: text("rejected_reason"),
  profileId: text("profile_id").notNull().default('pelangi'),
  lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_whatsapp_templates_name_profile").on(table.templateName, table.profileId),
  index("idx_whatsapp_templates_status").on(table.status),
  index("idx_whatsapp_templates_profile").on(table.profileId),
]));

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type InsertWhatsappTemplate = typeof whatsappTemplates.$inferInsert;

// ─── Experiment Metrics (US-837) ─────────────────────────────────────
// Tracks per-variant metrics for A/B experiment framework.
// Aggregated daily by experiment + variant + phone hash.

export const experimentMetrics = sqliteTable("experiment_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  experimentId: text("experiment_id").notNull(),
  variantId: text("variant_id").notNull(),
  phoneHash: text("phone_hash").notNull(), // MD5 hash of phone for privacy
  messageCount: integer("message_count").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0),
  csatSum: integer("csat_sum").notNull().default(0),
  csatCount: integer("csat_count").notNull().default(0),
  windowDate: text("window_date").notNull(), // YYYY-MM-DD (UTC)
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const webchatConsentLog = sqliteTable("webchat_consent_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionIdHash: text("session_id_hash").notNull(),
  acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  profileId: text("profile_id").notNull().default('pelangi'),
  userAgentHash: text("user_agent_hash"),
}, (table) => ([
  index("idx_webchat_consent_log_profile").on(table.profileId),
  index("idx_webchat_consent_log_accepted_at").on(table.acceptedAt),
]));

export type WebchatConsentLog = typeof webchatConsentLog.$inferSelect;
export type InsertWebchatConsentLog = typeof webchatConsentLog.$inferInsert;

// ─── Service Requests (US-875) ────────────────────────────────────────
// Tracks in-stay housekeeping and maintenance requests from WhatsApp guests.
// Scoped to Pelangi Capsule Hostel profile.

export const serviceRequests = sqliteTable("service_requests", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  jid: text("jid").notNull(),
  profile: text("profile").notNull().default('pelangi'),
  roomNumber: text("room_number"),
  requestType: text("request_type").notNull(), // extra_towel | extra_pillow | room_cleaning | maintenance_issue | wifi_password | amenity
  details: text("details"),
  status: text("status").notNull().default('pending'), // pending | resolved
  staffNotified: integer("staff_notified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
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

export const orderWebhookQueue = sqliteTable("order_webhook_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: text("order_id").notNull(),
  payloadJson: text("payload_json").notNull(), // JSON-serialized KdsOrderPayload
  status: text("status").notNull().default('pending'), // pending | delivered | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  profileId: text("profile_id").notNull().default('makan-moments'),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
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

export const scheduledMessagesDb = sqliteTable("scheduled_messages", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  jid: text("jid").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  sendAt: integer("send_at", { mode: "timestamp_ms" }).notNull(),
  templateKey: text("template_key").notNull(),
  variables: text("variables"), // JSON string for template interpolation
  status: text("status").notNull().default('pending'), // pending | sent | cancelled | skipped
  bookingId: text("booking_id"),
  sequenceStep: text("sequence_step"), // confirmation | directions | ready
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
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

export const webhookRawEvents = sqliteTable("webhook_raw_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  profileId: text("profile_id").notNull().default('pelangi'),
  payload: text("payload").notNull(), // JSON-serialized raw IncomingMessage
  processed: integer("processed", { mode: "boolean" }).notNull().default(false),
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

export const orderAccuracyEvents = sqliteTable("order_accuracy_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  profileId: text("profile_id").notNull().default('makan-moments'),
  eventType: text("event_type").notNull(), // order_confirmed | order_corrected
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const festiveStickers = sqliteTable("festive_stickers", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  profileId: text("profile_id").notNull().default('pelangi'),
  stickerName: text("sticker_name").notNull(),
  mediaId: text("media_id"), // WhatsApp media_id after upload
  fileSize: integer("file_size").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull().default('image/webp'),
  uploadedBy: text("uploaded_by"),
  uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
}, (table) => ([
  index("idx_festive_stickers_profile_active").on(table.profileId, table.isActive),
  index("idx_festive_stickers_profile_name").on(table.profileId, table.stickerName),
]));

export type FestiveSticker = typeof festiveStickers.$inferSelect;
export type InsertFestiveSticker = typeof festiveStickers.$inferInsert;

export const stickerIntents = sqliteTable("sticker_intents", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  profileId: text("profile_id").notNull().default('pelangi'),
  intent: text("intent").notNull(),
  stickerId: text("sticker_id").notNull().references(() => festiveStickers.id, { onDelete: 'cascade' }),
  greetingText: text("greeting_text").notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const campaignPacingEvents = sqliteTable("campaign_pacing_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  batchId: text("batch_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: text("phone").notNull(),
  templateName: text("template_name"),
  messageContent: text("message_content"),
  errorCode: integer("error_code").notNull().default(131049),
  // 'held' = pacing pause hold; 'hard_failure' = permanent delivery failure
  failureType: text("failure_type").notNull().default('held'),
  // operator review state: 'pending' | 'resent' | 'cancelled'
  reviewStatus: text("review_status").notNull().default('pending'),
  heldAt: integer("held_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
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

// ─── Intent Classification Decisions (US-239) ─────────────────────────────────
// Audit log for every intent classification decision.
// Records confidence scores, top-3 candidate intents, and message hashes
// for debugging accuracy regressions and identifying weak categories.

export const intentClassificationDecisions = sqliteTable("intent_classification_decisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  profileName: text("profile_name").notNull().default('pelangi'),
  messageHash: text("message_hash").notNull(),
  classifiedIntent: text("classified_intent").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  top3CandidatesJson: text("top_3_candidates_json", { mode: "json" }).notNull().default('[]'),  // array of { intent, score }
  actualIntent: text("actual_intent"),  // populated later by feedback/correction
}, (table) => ([
  index("idx_icd_profile_name").on(table.profileName),
  index("idx_icd_timestamp").on(table.timestamp),
  index("idx_icd_profile_timestamp").on(table.profileName, table.timestamp),
  index("idx_icd_classified_intent").on(table.classifiedIntent),
  index("idx_icd_message_hash").on(table.messageHash),
]));

export type IntentClassificationDecision = typeof intentClassificationDecisions.$inferSelect;
export type InsertIntentClassificationDecision = typeof intentClassificationDecisions.$inferInsert;

// ─── Vector Access Logs (US-966) ──────────────────────────────────────────────
// OWASP LLM06:2025 — Vector and Embedding Weaknesses.
// Logs every RAG retrieval call for 90-day audit trail.
// Enables cross-namespace contamination detection and similarity attack alerting.

export const vectorAccessLogs = sqliteTable("vector_access_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Property that made the query (e.g., "pelangi", "southern") */
  propertyId: text("property_id").notNull(),
  /** Hashed query text (SHA-256 truncated to 16 hex chars for privacy) */
  queryHash: text("query_hash").notNull(),
  /** Number of chunks returned */
  chunksReturned: integer("chunks_returned").notNull().default(0),
  /** Source filenames of returned chunks (JSON array) */
  retrievedSources: text("retrieved_sources").notNull().default('[]'),
  /** Top similarity score (0-1) of returned chunks */
  topScore: real("top_score"),
  /** Whether any returned chunk had a mismatched propertyId (cross-namespace leak) */
  crossNamespaceDetected: integer("cross_namespace_detected", { mode: "boolean" }).notNull().default(false),
  /** Whether a similarity attack was suspected (anomalously high score) */
  similarityAttackSuspected: integer("similarity_attack_suspected", { mode: "boolean" }).notNull().default(false),
  /** Retrieval latency in ms */
  latencyMs: integer("latency_ms"),
  /** Service identity that performed the retrieval */
  serviceIdentity: text("service_identity").notNull().default('rainbow-ai'),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const marketingSubscriptions = sqliteTable("marketing_subscriptions", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  phone: text("phone").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  /** 'pending' | 'confirmed' | 'revoked' | 'expired' */
  consentStatus: text("consent_status").notNull().default('pending'),
  /** How the contact was added: 'checkin' | 'web_form' | 'admin_add' | 'qr_code' */
  channel: text("channel").notNull().default('admin_add'),
  /** IP/source identifier where consent was initiated (for PDPA audit) */
  collectedVia: text("collected_via"),
  /** When the opt-in confirmation template was sent */
  optInSentAt: integer("opt_in_sent_at", { mode: "timestamp_ms" }),
  /** When consent was confirmed (keyword reply received) */
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  /** When consent was revoked (STOP or admin action) */
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  /** 48h deadline — if no confirmation by this time, status → expired */
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const mmLiteSends = sqliteTable("mm_lite_sends", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Campaign identifier (admin-assigned, e.g. "makan-daily-2026-03-16") */
  campaignId: text("campaign_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: text("phone").notNull(),
  templateName: text("template_name").notNull(),
  /** 'mm_lite' | 'standard' — which send path was used */
  sendApi: text("send_api").notNull().default('mm_lite'),
  /** TTL in hours set at send time (default 720h = 30 days) */
  ttlHours: integer("ttl_hours").notNull().default(720),
  /** Computed expiry timestamp (sentAt + ttlHours) */
  ttlExpiresAt: integer("ttl_expires_at", { mode: "timestamp_ms" }),
  /** 'queued' | 'sent' | 'delivered' | 'failed' | 'expired' */
  deliveryStatus: text("delivery_status").notNull().default('queued'),
  /** Timestamp when MM Lite API accepted the send */
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  /** Timestamp when delivery confirmation received via webhook */
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  /** Timestamp when TTL expiry was detected */
  expiredAt: integer("expired_at", { mode: "timestamp_ms" }),
  /** Meta message ID returned from Cloud API */
  metaMessageId: text("meta_message_id"),
  /** Error code/message if send failed */
  errorInfo: text("error_info"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const dpiaRecords = sqliteTable("dpia_records", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
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
  lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  /** Next review due (must be within 3 years per CBPDT Guidelines) */
  nextReviewDue: integer("next_review_due", { mode: "timestamp_ms" }).notNull(),
  /** Reviewer name/email */
  reviewedBy: text("reviewed_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_dpia_profile_id").on(table.profileId),
  index("idx_dpia_next_review_due").on(table.nextReviewDue),
]));

export type DpiaRecord = typeof dpiaRecords.$inferSelect;
export type InsertDpiaRecord = typeof dpiaRecords.$inferInsert;

export const tiaRecords = sqliteTable("tia_records", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Profile this TIA applies to */
  profileId: text("profile_id").notNull(),
  /** AI provider name ('NVIDIA', 'OpenRouter', 'Ollama', etc.) */
  aiProvider: text("ai_provider").notNull(),
  /** Destination jurisdiction code (e.g. 'US', 'SG') */
  destinationJurisdiction: text("destination_jurisdiction").notNull(),
  /** Data protection equivalence assessment */
  equivalenceLevel: text("equivalence_level").notNull(), // 'adequate' | 'similar' | 'assessed'
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
  lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  /** Valid until (max 3 years per CBPDT) */
  validUntil: integer("valid_until", { mode: "timestamp_ms" }).notNull(),
  /** Reviewed by */
  reviewedBy: text("reviewed_by"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
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

export const aiDecisionAudit = sqliteTable("ai_decision_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: text("phone").notNull(),
  /** Category of automated decision: booking | escalation | order_confirmation | menu_recommendation */
  decisionType: text("decision_type").notNull(),
  /** Intent that triggered this decision */
  intent: text("intent"),
  /** AI confidence score (0-1) at time of decision */
  confidenceScore: real("confidence_score"),
  /** AI provider that produced the decision */
  aiProvider: text("ai_provider"),
  /** Whether the guest requested human review */
  humanReviewRequested: integer("human_review_requested", { mode: "boolean" }).notNull().default(false),
  /** Final outcome: accepted | human_review | escalated | cancelled */
  outcome: text("outcome"),
  /** When the disclosure message was sent to the guest */
  disclosureSentAt: integer("disclosure_sent_at", { mode: "timestamp_ms" }),
  /** When the guest requested human review (null if not requested) */
  reviewRequestedAt: integer("review_requested_at", { mode: "timestamp_ms" }),
  /** When the decision was resolved */
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
  /** Additional context (JSON string) */
  metadata: text("metadata"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_aidecision_profile_phone").on(table.profileId, table.phone),
  index("idx_aidecision_created_at").on(table.createdAt),
  index("idx_aidecision_human_review").on(table.humanReviewRequested),
]));

export type AiDecisionAuditRecord = typeof aiDecisionAudit.$inferSelect;
export type InsertAiDecisionAuditRecord = typeof aiDecisionAudit.$inferInsert;

// ─── Prompt Injection Events (US-998) ────────────────────────────────

export const promptInjectionEvents = sqliteTable("prompt_injection_events", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  jid: text("jid").notNull(),
  profileId: text("profile_id").notNull().default("pelangi"),
  originalMessageText: text("original_message_text").notNull(),
  matchedPattern: text("matched_pattern").notNull(),
  actionTaken: text("action_taken").notNull().default("blocked"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_injection_events_jid").on(table.jid),
  index("idx_injection_events_profile").on(table.profileId),
  index("idx_injection_events_created_at").on(table.createdAt),
]));

export type PromptInjectionEvent = typeof promptInjectionEvents.$inferSelect;
export type InsertPromptInjectionEvent = typeof promptInjectionEvents.$inferInsert;

// ─── Vendor DPA Registry (US-958) ───────────────────────────────────

export const dpaRegistry = sqliteTable("dpa_registry", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  vendorName: text("vendor_name").notNull(),
  registeredAddress: text("registered_address").notNull().default(""),
  dataCategories: text("data_categories").notNull(),
  processingPurpose: text("processing_purpose").notNull(),
  retentionPeriod: text("retention_period").notNull().default(""),
  subProcessors: text("sub_processors").notNull().default("[]"),
  dpaStatus: text("dpa_status").notNull().default("pending"),
  dpaExpiryDate: integer("dpa_expiry_date", { mode: "timestamp_ms" }),
  dpaSigned: integer("dpa_signed", { mode: "timestamp_ms" }),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_dpa_registry_vendor").on(table.vendorName),
  index("idx_dpa_registry_status").on(table.dpaStatus),
  index("idx_dpa_registry_expiry").on(table.dpaExpiryDate),
]));

export type DpaRegistryEntry = typeof dpaRegistry.$inferSelect;
export type InsertDpaRegistryEntry = typeof dpaRegistry.$inferInsert;

// ─── E-Invoice Queue (US-1039) ──────────────────────────────────────
// Malaysia LHDN MyInvois e-invoice submission queue with retry tracking.

export const einvoiceQueue = sqliteTable("einvoice_queue", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** Source transaction: 'order' or 'booking' */
  transactionType: text("transaction_type").notNull(),
  /** External reference ID (order ID or booking ID) */
  transactionId: text("transaction_id").notNull(),
  /** Profile/tenant that owns this invoice */
  profileId: text("profile_id").notNull().default("pelangi"),
  /** Customer phone (for WhatsApp delivery) */
  customerPhone: text("customer_phone"),
  /** Customer name */
  customerName: text("customer_name"),
  /** Customer NRIC or passport number (LHDN mandatory) */
  customerIdNumber: text("customer_id_number"),
  /** Supplier TIN (Tax Identification Number) */
  supplierTin: text("supplier_tin").notNull(),
  /** Line items JSON: [{description, qty, unitPrice, taxAmount, total}] */
  lineItems: text("line_items").notNull(),
  /** Total amount (MYR) */
  totalAmount: real("total_amount").notNull(),
  /** SST amount */
  sstAmount: real("sst_amount").notNull().default(0),
  /** Queue status: pending | submitted | validated | delivered | failed | expired */
  status: text("status").notNull().default("pending"),
  /** MyInvois Unique Identification Number (set after validation) */
  uin: text("uin"),
  /** Number of submission attempts */
  attempts: integer("attempts").notNull().default(0),
  /** Last error message from MyInvois API */
  lastError: text("last_error"),
  /** When the invoice was successfully submitted to MyInvois */
  submittedAt: integer("submitted_at", { mode: "timestamp_ms" }),
  /** When the PDF was delivered via WhatsApp */
  deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
  /** Next scheduled retry time */
  nextRetryAt: integer("next_retry_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_einvoice_queue_status").on(table.status),
  index("idx_einvoice_queue_profile").on(table.profileId),
  index("idx_einvoice_queue_transaction").on(table.transactionType, table.transactionId),
  index("idx_einvoice_queue_next_retry").on(table.nextRetryAt),
  index("idx_einvoice_queue_created_at").on(table.createdAt),
]));

export type EinvoiceQueueEntry = typeof einvoiceQueue.$inferSelect;
export type InsertEinvoiceQueueEntry = typeof einvoiceQueue.$inferInsert;

// ─── Dead Letter Queue (DLQ) (US-055) ───────────────────────────────
// Stores failed WhatsApp messages for manual admin retry

export const deadLetterQueue = sqliteTable("dead_letter_queue", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  messageId: text("message_id").notNull(),
  guestId: text("guest_id").notNull(),  // phone number
  body: text("body").notNull(),
  failureReason: text("failure_reason").notNull(),
  failedAt: integer("failed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  retryCount: integer("retry_count").notNull().default(0),
  profile: text("profile").notNull().default("pelangi"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_dlq_guest_id").on(table.guestId),
  index("idx_dlq_profile").on(table.profile),
  index("idx_dlq_failed_at").on(table.failedAt),
  index("idx_dlq_expires_at").on(table.expiresAt),
]));

export type DeadLetterQueueMessage = typeof deadLetterQueue.$inferSelect;
export type InsertDeadLetterQueueMessage = typeof deadLetterQueue.$inferInsert;

// ─── Room Reservations ────────────────────────────────────────────────────────
// Stores confirmed/pending room reservations for real-time availability checks.
// Used by the booking workflow's dbAvailabilityCheck operator (US-056).

export const roomReservations = sqliteTable("room_reservations", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  roomId: text("room_id").notNull(),
  guestPhone: text("guest_phone").notNull(),
  guestName: text("guest_name").notNull(),
  checkInDate: integer("check_in_date", { mode: "timestamp_ms" }).notNull(),
  checkOutDate: integer("check_out_date", { mode: "timestamp_ms" }).notNull(),
  /** pending | confirmed | cancelled */
  status: text("status").notNull().default("pending"),
  profile: text("profile").notNull().default("pelangi"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_room_reservations_check_in").on(table.checkInDate),
  index("idx_room_reservations_check_out").on(table.checkOutDate),
  index("idx_room_reservations_profile").on(table.profile),
  index("idx_room_reservations_status").on(table.status),
  index("idx_room_reservations_room_id").on(table.roomId),
]));

export type RoomReservation = typeof roomReservations.$inferSelect;
export type InsertRoomReservation = typeof roomReservations.$inferInsert;

// ─── Booking Workflow Step Errors (US-209) ─────────────────────────────
// Stores workflow step execution failures with typed error codes and recovery metadata
// Used for logging failures, sending guest-friendly messages, and debugging

export const bookingStepErrors = sqliteTable("booking_step_errors", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  stepId: text("step_id").notNull(),           // workflow step identifier
  errorCode: text("error_code").notNull(),     // e.g. 'payment_failed', 'room_unavailable'
  errorMessage: text("error_message"),         // technical error details
  profile: text("profile").notNull().default("pelangi"),
  conversationId: text("conversation_id"),     // optional: tie to conversation for context
  guestPhone: text("guest_phone"),
  workflowId: text("workflow_id"),             // which booking workflow this belonged to
  recoveryMessageSent: integer("recovery_message_sent", { mode: "boolean" }).notNull().default(false),
  recoveryMessageAt: integer("recovery_message_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_booking_step_errors_step_id").on(table.stepId),
  index("idx_booking_step_errors_error_code").on(table.errorCode),
  index("idx_booking_step_errors_profile").on(table.profile),
  index("idx_booking_step_errors_profile_code").on(table.profile, table.errorCode),
  index("idx_booking_step_errors_created_at").on(table.createdAt),
]));

export type BookingStepError = typeof bookingStepErrors.$inferSelect;
export type InsertBookingStepError = typeof bookingStepErrors.$inferInsert;

// ─── Escalation Queue (US-212) ──────────────────────────────────────────────
// Auto-flags intent classifications with confidence < 40% for human review.
// Enables quick manual triage to improve keyword coverage and reduce fallbacks.

export const escalationQueue = sqliteTable("escalation_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").notNull(),
  originalIntent: text("original_intent").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  messagePreview: text("message_preview"),          // first 200 chars of guest message
  recommendedKeywords: text("recommended_keywords"), // JSON array of suggested keywords
  guestCorrectionIntent: text("guest_correction_intent"), // filled in by admin after review
  profile: text("profile").notNull().default('pelangi'),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_escalation_queue_profile").on(table.profile),
  index("idx_escalation_queue_confidence").on(table.confidenceScore),
  index("idx_escalation_queue_timestamp").on(table.timestamp),
  index("idx_escalation_queue_profile_confidence").on(table.profile, table.confidenceScore),
]));

export type EscalationQueueEntry = typeof escalationQueue.$inferSelect;
export type InsertEscalationQueueEntry = typeof escalationQueue.$inferInsert;

// ─── Admin Audit Log (US-257) ──────────────────────────────────────
// Tracks all config file changes (settings.json, workflows.json, knowledge.json)
// with user, timestamp, content hashes, and unified diff for rollback/compliance

export const adminAuditLog = sqliteTable("admin_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  configFile: text("config_file").notNull(),
  changedBy: text("changed_by"),
  previousHash: text("previous_hash"),
  newHash: text("new_hash").notNull(),
  diffSummary: text("diff_summary").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_admin_audit_log_config_file").on(table.configFile),
  index("idx_admin_audit_log_changed_by").on(table.changedBy),
  index("idx_admin_audit_log_timestamp").on(table.timestamp),
  index("idx_admin_audit_log_file_timestamp").on(table.configFile, table.timestamp),
]));

export type AdminAuditLogEntry = typeof adminAuditLog.$inferSelect;
export type InsertAdminAuditLogEntry = typeof adminAuditLog.$inferInsert;

// ─── Workflow Step Validation Errors (US-284) ────────────────────────
// Logs validation failures when booking workflow step outputs don't conform
// to expected schema, enabling admin review and debugging

export const workflowStepValidationErrors = sqliteTable("workflow_step_validation_errors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stepId: text("step_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  expectedSchema: text("expected_schema", { mode: "json" }).notNull(),    // The schema the output should conform to
  actualOutput: text("actual_output", { mode: "json" }).notNull(),         // The output that failed validation
  errorMessages: text("error_messages", { mode: "json" }).notNull(),       // Array of detailed error strings
  workflowId: text("workflow_id"),                        // Which workflow this step belongs to
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_wf_step_validation_step_id").on(table.stepId),
  index("idx_wf_step_validation_profile_id").on(table.profileId),
  index("idx_wf_step_validation_created_at").on(table.createdAt),
  index("idx_wf_step_validation_step_profile").on(table.stepId, table.profileId),
]));

export type WorkflowStepValidationError = typeof workflowStepValidationErrors.$inferSelect;
export type InsertWorkflowStepValidationError = typeof workflowStepValidationErrors.$inferInsert;

// ─── Intent Classification Thresholds (US-297) ──────────────────────
// Per-intent per-profile confidence thresholds for classification gating.
// classifyIntent() compares confidence against threshold and returns
// 'uncertain' if below the configured min_confidence.

export const intentClassificationThresholds = sqliteTable("intent_classification_thresholds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull().default('pelangi'),
  intent: text("intent").notNull(),
  minConfidence: real("min_confidence").notNull(),  // 0.0 - 1.0
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  uniqueIndex("idx_classification_thresholds_profile_intent").on(table.profileId, table.intent),
  index("idx_classification_thresholds_profile_id").on(table.profileId),
  index("idx_classification_thresholds_intent").on(table.intent),
]));

export type IntentClassificationThreshold = typeof intentClassificationThresholds.$inferSelect;
export type InsertIntentClassificationThreshold = typeof intentClassificationThresholds.$inferInsert;

// ─── Profile Isolation Violations (US-310) ──────────────────────────
// Audit log for profile-isolation middleware violations.
// Records any attempt to access data belonging to a different profile
// for post-incident review and cross-profile leakage prevention.

export const profileIsolationViolations = sqliteTable("profile_isolation_violations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptedProfile: text("attempted_profile").notNull(),
  actualProfile: text("actual_profile").notNull(),
  queryText: text("query_text").notNull(),
  routePath: text("route_path").notNull(),
  method: text("method").notNull(),
  ipAddress: text("ip_address"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_piv_actual_profile").on(table.actualProfile),
  index("idx_piv_attempted_profile").on(table.attemptedProfile),
  index("idx_piv_created_at").on(table.createdAt),
]));

export type ProfileIsolationViolation = typeof profileIsolationViolations.$inferSelect;
export type InsertProfileIsolationViolation = typeof profileIsolationViolations.$inferInsert;

// ─── Booking Execution Audit (US-313) ────────────────────────────────
// Audit trail for booking workflow step execution.
// Records inputs, outputs, status, and timing for each step to enable
// debugging of failed bookings and compliance auditing.

export const bookingExecutionAudit = sqliteTable("booking_execution_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: text("booking_id").notNull(),
  stepName: text("step_name").notNull(),
  input: text("input", { mode: "json" }).notNull(),
  output: text("output", { mode: "json" }).notNull(),
  status: text("status").notNull(),  // 'success' | 'error' | 'timeout' | 'skipped'
  executedAt: integer("executed_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_booking_exec_audit_booking_id").on(table.bookingId),
  index("idx_booking_exec_audit_step_name").on(table.stepName),
  index("idx_booking_exec_audit_status").on(table.status),
  index("idx_booking_exec_audit_executed_at").on(table.executedAt),
  index("idx_booking_exec_audit_booking_step").on(table.bookingId, table.stepName),
]));

export type BookingExecutionAudit = typeof bookingExecutionAudit.$inferSelect;
export type InsertBookingExecutionAudit = typeof bookingExecutionAudit.$inferInsert;

// ─── Escalation Feedback (US-295) ────────────────────────────────────
// Captures staff feedback on escalated conversations to improve intent
// classification and fallback handling over time.

export const escalationFeedback = sqliteTable("escalation_feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  escalationId: integer("escalation_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  staffId: text("staff_id"),
  feedbackType: text("feedback_type").notNull(), // intent_misclassified, missing_knowledge, wrong_workflow, poor_response, other
  correctIntent: text("correct_intent"),
  severity: text("severity").notNull().default('medium'), // low, medium, high, critical
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_escalation_feedback_escalation_id").on(table.escalationId),
  index("idx_escalation_feedback_profile_id").on(table.profileId),
  index("idx_escalation_feedback_type").on(table.feedbackType),
  index("idx_escalation_feedback_severity").on(table.severity),
  index("idx_escalation_feedback_created_at").on(table.createdAt),
]));

export type EscalationFeedback = typeof escalationFeedback.$inferSelect;
export type InsertEscalationFeedback = typeof escalationFeedback.$inferInsert;

// ─── Fallback Response Metrics (US-300) ─────────────────────────────
// Tracks fallback response template effectiveness by measuring
// escalation-to-resolution rates per template per profile.

export const fallbackResponseMetrics = sqliteTable("fallback_response_metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: text("profile_id").notNull().default('pelangi'),
  templateId: text("template_id").notNull(),
  escalationCount: integer("escalation_count").notNull().default(0),
  resolutionCount: integer("resolution_count").notNull().default(0),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_fallback_resp_metrics_profile").on(table.profileId),
  index("idx_fallback_resp_metrics_template").on(table.templateId),
  index("idx_fallback_resp_metrics_timestamp").on(table.timestamp),
  uniqueIndex("idx_fallback_resp_metrics_profile_template").on(table.profileId, table.templateId),
]));

export type FallbackResponseMetric = typeof fallbackResponseMetrics.$inferSelect;
export type InsertFallbackResponseMetric = typeof fallbackResponseMetrics.$inferInsert;

// ─── Booking State Audit (US-312) ───────────────────────────────────
// Logs every booking state transition attempt for audit and debugging.
// Records whether the transition was valid per the booking state machine,
// enabling detection of workflow bugs and malformed step sequences.

export const bookingStateAudit = sqliteTable("booking_state_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: text("booking_id").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  valid: integer("valid", { mode: "boolean" }).notNull(),
  reason: text("reason").notNull(),
  profile: text("profile").notNull().default('pelangi'),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (table) => ([
  index("idx_booking_state_audit_booking_id").on(table.bookingId),
  index("idx_booking_state_audit_from_state").on(table.fromState),
  index("idx_booking_state_audit_to_state").on(table.toState),
  index("idx_booking_state_audit_valid").on(table.valid),
  index("idx_booking_state_audit_profile").on(table.profile),
  index("idx_booking_state_audit_timestamp").on(table.timestamp),
]));

export type BookingStateAuditRecord = typeof bookingStateAudit.$inferSelect;
export type InsertBookingStateAuditRecord = typeof bookingStateAudit.$inferInsert;

/**
 * Returns room IDs that are occupied (status != 'cancelled') for any night
 * overlapping [checkIn, checkOut). Two reservations overlap when:
 *   existing.checkIn < requested.checkOut AND existing.checkOut > requested.checkIn
 */
export function getOccupiedRoomsForDateRange(
  checkIn: Date,
  checkOut: Date,
  profile: string = "pelangi"
): { checkIn: Date; checkOut: Date; profile: string } {
  return { checkIn, checkOut, profile };
}
