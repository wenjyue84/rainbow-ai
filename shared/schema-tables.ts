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
