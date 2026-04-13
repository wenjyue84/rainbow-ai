/**
 * conversations.ts — Conversation state, messages, delivery, and escalation tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";

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

export type RainbowConversationState = typeof rainbowConversationState.$inferSelect;
export type InsertRainbowConversationState = typeof rainbowConversationState.$inferInsert;

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
  // US-581: Language preference inferred from first message
  languagePreference: varchar("language_preference", { length: 2 }),  // 'en', 'ms', 'zh', 'ta', null if not yet inferred
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
  // US-155: WhatsApp message sending consent (Meta Cloud API requirement)
  whatsappOptedIn: boolean("whatsapp_opted_in").notNull().default(false), // Explicit consent to receive WhatsApp messages
  whatsappOptedInAt: timestamp("whatsapp_opted_in_at"),       // Timestamp when consent was given
  // US-119: Guest language preference persistence
  metadata: text("metadata"),                                  // JSON string for additional context (e.g., preferredLanguage)
  // US-237: Multi-Turn Booking Clarification Dialog state
  clarificationState: text("clarification_state"),             // Current dialog state: need_dates | need_room_type | need_guest_count | ready_confirm
  clarificationData: text("clarification_data"),               // JSON blob of collected clarification data
  // US-245: Turn-by-turn confidence scoring metadata
  turnMetadata: jsonb("turn_metadata"),                        // [{turn_num, intent, confidence, fallback_used, tokens}] array updated on each message
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"),
}, (table) => ([
  uniqueIndex("idx_rainbow_conversations_bsuid").on(table.bsuid),
]));

export type RainbowConversation = typeof rainbowConversations.$inferSelect;
export type InsertRainbowConversation = typeof rainbowConversations.$inferInsert;

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
  bookingSubtype: varchar("booking_subtype", { length: 20 }), // US-535: booking intent subtype (check_in|check_out|modification|general_inquiry)
  profileId: text("profile_id").default('pelangi'),
  deletedAt: timestamp("deleted_at"),
}, (table) => ([
  index("idx_rainbow_messages_phone").on(table.phone),
  index("idx_rainbow_messages_phone_timestamp").on(table.phone, table.timestamp),
  index("idx_rainbow_messages_role").on(table.role),
  index("idx_rainbow_messages_timestamp").on(table.timestamp),
  index("idx_rainbow_messages_phone_role_ts").on(table.phone, table.role, table.timestamp),
  // US-061: profile_id must be a non-empty string — application sets it before insert
  check("chk_rainbow_messages_profile_not_empty", sql`profile_id IS NOT NULL AND profile_id <> ''`),
]));

export type RainbowMessage = typeof rainbowMessages.$inferSelect;
export type InsertRainbowMessage = typeof rainbowMessages.$inferInsert;

export const conversationAudit = pgTable("conversation_audit", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 64 }).notNull(),
  guestId: varchar("guest_id", { length: 128 }),  // optional guest ID if available
  message: text("message").notNull(),              // full message content
  intent: text("intent"),                          // detected intent
  confidence: real("confidence"),                  // intent confidence score (0.0-1.0)
  actionTaken: text("action_taken"),               // action/workflow triggered
  tier: text("tier"),                              // classification tier (T1-T4)
  profileId: text("profile_id").default('pelangi'),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
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

export type MessageDeliveryStatus = typeof messageDeliveryStatus.$inferSelect;
export type InsertMessageDeliveryStatus = typeof messageDeliveryStatus.$inferInsert;

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
  // US-077: Fallback effectiveness tracking
  fallbackResponseTemplateId: text("fallback_response_template_id"), // template that was used before escalation
  escalationWithin2Msgs: boolean("escalation_within_2_msgs"),        // true if escalation within 2 msgs of fallback
  // US-342: Context-aware fallback response generation
  intentId: text("intent_id"), // the intent that triggered escalation (booking, check_in, pricing, etc.)
  staffResolution: text("staff_resolution"), // successful resolution provided by staff member
  guestFeedback: text("guest_feedback"), // feedback from guest about resolution
  similarityScore: real("similarity_score"), // pre-calculated similarity score (0-1)
}, (table) => ([
  index("idx_escalation_events_jid").on(table.jid),
  index("idx_escalation_events_trigger").on(table.trigger),
  index("idx_escalation_events_created_at").on(table.createdAt),
  index("idx_escalation_events_profile_intent").on(table.profileId, table.intentId, table.createdAt),
]));

export type EscalationEvent = typeof escalationEvents.$inferSelect;
export type InsertEscalationEvent = typeof escalationEvents.$inferInsert;

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

export type ConversationTrace = typeof conversationTraces.$inferSelect;
export type InsertConversationTrace = typeof conversationTraces.$inferInsert;

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

export type MessageQualityMetric = typeof messageQualityMetrics.$inferSelect;
export type InsertMessageQualityMetric = typeof messageQualityMetrics.$inferInsert;

