/**
 * messaging.ts — Message costs, scheduling, templates, stickers, campaigns, and DLQ
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, serial, real, index } from "drizzle-orm/pg-core";

export const messageCosts = pgTable("message_costs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: text("message_id").notNull(),
  provider: varchar("provider").notNull(),
  costInCents: integer("cost_in_cents").notNull(),
  tokensUsed: integer("tokens_used"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_message_costs_message_id").on(table.messageId),
  index("idx_message_costs_provider").on(table.provider),
]));

export type MessageCost = typeof messageCosts.$inferSelect;
export type InsertMessageCost = typeof messageCosts.$inferInsert;

export const scheduledMessages = pgTable("scheduled_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  content: text("content").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  sent: boolean("sent").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_scheduled_messages_conversation_id").on(table.conversationId),
  index("idx_scheduled_messages_scheduled_for").on(table.scheduledFor),
]));

export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type InsertScheduledMessage = typeof scheduledMessages.$inferInsert;

export const messageTemplates = pgTable("message_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  content: text("content").notNull(),
  variables: text("variables"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_message_templates_name").on(table.name),
]));

export type MessageTemplate = typeof messageTemplates.$inferSelect;
export type InsertMessageTemplate = typeof messageTemplates.$inferInsert;

export const messageStickers = pgTable("message_stickers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  emojiCode: varchar("emoji_code").notNull(),
  category: varchar("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_message_stickers_category").on(table.category),
]));

export type MessageSticker = typeof messageStickers.$inferSelect;
export type InsertMessageSticker = typeof messageStickers.$inferInsert;

export const campaigns = pgTable("campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  content: text("content").notNull(),
  status: varchar("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_campaigns_status").on(table.status),
]));

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  originalMessageId: text("original_message_id"),
  reason: text("reason").notNull(),
  payload: text("payload").notNull(),
  retries: integer("retries").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_dlq_created_at").on(table.createdAt),
]));

export type DeadLetterQueueEntry = typeof deadLetterQueue.$inferSelect;
export type InsertDeadLetterQueueEntry = typeof deadLetterQueue.$inferInsert;

export const llmCostDaily = pgTable("llm_cost_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: varchar("date").notNull(),
  provider: varchar("provider").notNull(),
  totalCostInCents: integer("total_cost_in_cents").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_llm_cost_daily_date").on(table.date),
  index("idx_llm_cost_daily_provider").on(table.provider),
]));

export type LLMCostDaily = typeof llmCostDaily.$inferSelect;
export type InsertLLMCostDaily = typeof llmCostDaily.$inferInsert;

export const messageQualityMetrics = pgTable("message_quality_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: text("message_id").notNull(),
  relevanceScore: real("relevance_score"),
  sentimentScore: real("sentiment_score"),
  readability: integer("readability"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_message_quality_metrics_message_id").on(table.messageId),
]));

export type MessageQualityMetrics = typeof messageQualityMetrics.$inferSelect;
export type InsertMessageQualityMetrics = typeof messageQualityMetrics.$inferInsert;

export const serviceRequests = pgTable("service_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  category: varchar("category").notNull(),
  status: varchar("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ([
  index("idx_service_requests_conversation_id").on(table.conversationId),
  index("idx_service_requests_status").on(table.status),
]));

export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type InsertServiceRequest = typeof serviceRequests.$inferInsert;

export const whatsappCostDaily = pgTable("whatsapp_cost_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: varchar("date").notNull(),
  totalCostInCents: integer("total_cost_in_cents").notNull().default(0),
  messageCount: integer("message_count").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_whatsapp_cost_daily_date").on(table.date),
]));

export type WhatsappCostDaily = typeof whatsappCostDaily.$inferSelect;
export type InsertWhatsappCostDaily = typeof whatsappCostDaily.$inferInsert;

export const festiveStickers = pgTable("festive_stickers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(),
  emojiCode: varchar("emoji_code").notNull(),
  holiday: varchar("holiday").notNull(),
  season: varchar("season"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_festive_stickers_holiday").on(table.holiday),
]));

export type FestiveSticker = typeof festiveStickers.$inferSelect;
export type InsertFestiveSticker = typeof festiveStickers.$inferInsert;

export const stickerIntents = pgTable("sticker_intents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  stickerId: varchar("sticker_id").notNull(),
  intent: varchar("intent").notNull(),
  triggerKeywords: text("trigger_keywords"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_sticker_intents_intent").on(table.intent),
]));

export type StickerIntent = typeof stickerIntents.$inferSelect;
export type InsertStickerIntent = typeof stickerIntents.$inferInsert;
