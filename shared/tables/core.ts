/**
 * core.ts — Core settings, feedback, and prediction tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index } from "drizzle-orm/pg-core";

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

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

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

export type IntentDetectionSettings = typeof intentDetectionSettings.$inferSelect;
export type InsertIntentDetectionSettings = typeof intentDetectionSettings.$inferInsert;

export const rainbowFeedback = pgTable("rainbow_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  messageId: text("message_id"),
  phoneNumber: text("phone_number").notNull(),
  intent: text("intent"),
  confidence: real("confidence"),
  rating: integer("rating").notNull(),
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

export type RainbowFeedback = typeof rainbowFeedback.$inferSelect;
export type InsertRainbowFeedback = typeof rainbowFeedback.$inferInsert;

export const intentPredictions = pgTable("intent_predictions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  phoneNumber: text("phone_number").notNull(),
  messageText: text("message_text").notNull(),
  predictedIntent: text("predicted_intent").notNull(),
  confidence: real("confidence").notNull(),
  tier: text("tier").notNull(),
  model: text("model"),
  profile: text("profile"),
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

export type IntentPrediction = typeof intentPredictions.$inferSelect;
export type InsertIntentPrediction = typeof intentPredictions.$inferInsert;
