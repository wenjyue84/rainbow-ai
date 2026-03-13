/**
 * schema-tables.ts — Drizzle ORM table definitions for Rainbow AI
 *
 * Contains Rainbow-owned pgTable definitions and table-derived types.
 * Extracted from digiman/shared/schema-tables.ts during decomposition.
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index } from "drizzle-orm/pg-core";

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
  pushName: text("push_name").notNull().default(''),
  instanceId: text("instance_id"),
  profileId: text("profile_id").default('pelangi'),
  pinned: boolean("pinned").notNull().default(false),
  favourite: boolean("favourite").notNull().default(false),
  lastReadAt: timestamp("last_read_at"),
  responseMode: text("response_mode"),
  contactDetailsJson: text("contact_details_json"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
});

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

// ─── Opt-Out / STOP Compliance (US-403) ──────────────────────────────

export const optOuts = pgTable("opt_outs", {
  phone: varchar("phone", { length: 64 }).primaryKey(),
  optedOutAt: timestamp("opted_out_at").notNull().defaultNow(),
  optedInAt: timestamp("opted_in_at"),
}, (table) => ([
  index("idx_opt_outs_opted_out_at").on(table.optedOutAt),
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
