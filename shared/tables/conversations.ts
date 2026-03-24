/**
 * conversations.ts — Conversation state, messages, delivery, and escalation tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, serial, index } from "drizzle-orm/pg-core";

export const conversationStates = pgTable("conversation_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  phoneNumber: text("phone_number").notNull(),
  profile: varchar("profile").notNull(),
  state: varchar("state").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_conversation_states_conversation_id").on(table.conversationId),
  index("idx_conversation_states_phone").on(table.phoneNumber),
]));

export type ConversationState = typeof conversationStates.$inferSelect;
export type InsertConversationState = typeof conversationStates.$inferInsert;

export const messageDelivery = pgTable("message_delivery", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: text("message_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  status: varchar("status").notNull(),
  retries: integer("retries").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_message_delivery_message_id").on(table.messageId),
  index("idx_message_delivery_conversation_id").on(table.conversationId),
]));

export type MessageDelivery = typeof messageDelivery.$inferSelect;
export type InsertMessageDelivery = typeof messageDelivery.$inferInsert;

export const escalationEvents = pgTable("escalation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  reason: varchar("reason").notNull(),
  confidence: integer("confidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_escalation_events_conversation_id").on(table.conversationId),
]));

export type EscalationEvent = typeof escalationEvents.$inferSelect;
export type InsertEscalationEvent = typeof escalationEvents.$inferInsert;

export const rainbowConversations = pgTable("rainbow_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull().unique(),
  phoneNumber: text("phone_number").notNull(),
  profile: varchar("profile").notNull(),
  status: varchar("status").notNull(),
  lastActivity: timestamp("last_activity").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_rainbow_conversations_phone").on(table.phoneNumber),
  index("idx_rainbow_conversations_profile").on(table.profile),
]));

export type RainbowConversation = typeof rainbowConversations.$inferSelect;
export type InsertRainbowConversation = typeof rainbowConversations.$inferInsert;

export const rainbowMessages = pgTable("rainbow_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  phoneNumber: text("phone_number").notNull(),
  content: text("content").notNull(),
  role: varchar("role").notNull(),
  intent: varchar("intent"),
  confidence: integer("confidence"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_rainbow_messages_conversation_id").on(table.conversationId),
  index("idx_rainbow_messages_phone").on(table.phoneNumber),
]));

export type RainbowMessage = typeof rainbowMessages.$inferSelect;
export type InsertRainbowMessage = typeof rainbowMessages.$inferInsert;

export const rainbowConversationState = pgTable("rainbow_conversation_state", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull().unique(),
  phoneNumber: text("phone_number").notNull(),
  currentState: varchar("current_state").notNull(),
  stateData: text("state_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_rainbow_conversation_state_conversation_id").on(table.conversationId),
]));

export type RainbowConversationState = typeof rainbowConversationState.$inferSelect;
export type InsertRainbowConversationState = typeof rainbowConversationState.$inferInsert;

export const conversationTraces = pgTable("conversation_traces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  traceData: text("trace_data").notNull(),
  level: varchar("level").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_conversation_traces_conversation_id").on(table.conversationId),
  index("idx_conversation_traces_level").on(table.level),
]));

export type ConversationTrace = typeof conversationTraces.$inferSelect;
export type InsertConversationTrace = typeof conversationTraces.$inferInsert;
