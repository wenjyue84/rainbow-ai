/**
 * messaging.ts — Costs, scheduling, templates, stickers, campaigns, and DLQ tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const optOuts = pgTable("opt_outs", {
  phone: varchar("phone", { length: 64 }).primaryKey(),
  optedOutAt: timestamp("opted_out_at").notNull().defaultNow(),
  optedInAt: timestamp("opted_in_at"),
  // US-812: compliance tracking — when was the opt-out enforced (messages blocked)
  processedAt: timestamp("processed_at"),
}, (table) => ([
  index("idx_opt_outs_opted_out_at").on(table.optedOutAt),
]));

export type OptOut = typeof optOuts.$inferSelect;
export type InsertOptOut = typeof optOuts.$inferInsert;

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

export type LlmCostDaily = typeof llmCostDaily.$inferSelect;
export type InsertLlmCostDaily = typeof llmCostDaily.$inferInsert;

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

export type WhatsappCostDaily = typeof whatsappCostDaily.$inferSelect;
export type InsertWhatsappCostDaily = typeof whatsappCostDaily.$inferInsert;

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

export type BaileysAuthState = typeof baileysAuthState.$inferSelect;
export type InsertBaileysAuthState = typeof baileysAuthState.$inferInsert;

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

export type UtteranceGap = typeof utteranceGaps.$inferSelect;
export type InsertUtteranceGap = typeof utteranceGaps.$inferInsert;

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

export const whatsappTemplates = pgTable("whatsapp_templates", {
  id: serial("id").primaryKey(),
  templateName: text("template_name").notNull(),
  status: text("status").notNull(),
  previousStatus: text("previous_status"),
  rejectedReason: text("rejected_reason"),
  profileId: text("profile_id").notNull().default('pelangi'),
  lastCheckedAt: timestamp("last_checked_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_whatsapp_templates_name_profile").on(table.templateName, table.profileId),
  index("idx_whatsapp_templates_status").on(table.status),
  index("idx_whatsapp_templates_profile").on(table.profileId),
]));

export type WhatsappTemplate = typeof whatsappTemplates.$inferSelect;
export type InsertWhatsappTemplate = typeof whatsappTemplates.$inferInsert;

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

export const deadLetterQueue = pgTable("dead_letter_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: text("message_id").notNull(),
  guestId: varchar("guest_id", { length: 64 }).notNull(),  // phone number
  body: text("body").notNull(),
  failureReason: text("failure_reason").notNull(),
  failedAt: timestamp("failed_at").notNull().defaultNow(),
  retryCount: integer("retry_count").notNull().default(0),
  profile: text("profile").notNull().default("pelangi"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_dlq_guest_id").on(table.guestId),
  index("idx_dlq_profile").on(table.profile),
  index("idx_dlq_failed_at").on(table.failedAt),
  index("idx_dlq_expires_at").on(table.expiresAt),
]));

export type DeadLetterQueueMessage = typeof deadLetterQueue.$inferSelect;
export type InsertDeadLetterQueueMessage = typeof deadLetterQueue.$inferInsert;

