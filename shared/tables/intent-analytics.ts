/**
 * intent-analytics.ts — Intent classification analytics and ML monitoring tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const intentAnalytics = pgTable("intent_analytics", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  intentType: text("intent_type").notNull(),
  confidence: real("confidence").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  wasCorrect: boolean("was_correct"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_intent_analytics_profile_id").on(table.profileId),
  index("idx_intent_analytics_intent_type").on(table.intentType),
  index("idx_intent_analytics_profile_intent").on(table.profileId, table.intentType),
  index("idx_intent_analytics_created_at").on(table.createdAt),
]));

export type IntentAnalytics = typeof intentAnalytics.$inferSelect;
export type InsertIntentAnalytics = typeof intentAnalytics.$inferInsert;

export const intentClassifierBaselines = pgTable("intent_classifier_baselines", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  intentType: text("intent_type").notNull(),
  accuracyPct: real("accuracy_pct").notNull(),
  sampleCount: integer("sample_count").notNull(),
  baselineDate: timestamp("baseline_date").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_classifier_baselines_profile_intent").on(table.profileId, table.intentType),
  index("idx_classifier_baselines_profile_id").on(table.profileId),
  index("idx_classifier_baselines_intent_type").on(table.intentType),
  index("idx_classifier_baselines_baseline_date").on(table.baselineDate),
]));

export type IntentClassifierBaseline = typeof intentClassifierBaselines.$inferSelect;
export type InsertIntentClassifierBaseline = typeof intentClassifierBaselines.$inferInsert;

export const regressionAlerts = pgTable("regression_alerts", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  intentType: text("intent_type").notNull(),
  baselineAccuracy: real("baseline_accuracy").notNull(),
  currentAccuracy: real("current_accuracy").notNull(),
  accuracyDrop: real("accuracy_drop").notNull(),
  status: text("status").notNull().default('active'),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_regression_alerts_profile_id").on(table.profileId),
  index("idx_regression_alerts_intent_type").on(table.intentType),
  index("idx_regression_alerts_status").on(table.status),
  index("idx_regression_alerts_detected_at").on(table.detectedAt),
]));

export type RegressionAlert = typeof regressionAlerts.$inferSelect;
export type InsertRegressionAlert = typeof regressionAlerts.$inferInsert;

export const intentHardCases = pgTable("intent_hard_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id").notNull(),
  intentId: text("intent_id").notNull(),
  confidence: real("confidence").notNull(),
  candidateIntents: jsonb("candidate_intents"),
  reason: text("reason"),
  profile: text("profile").notNull().default('pelangi'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_intent_hard_cases_profile").on(table.profile),
  index("idx_intent_hard_cases_intent_id").on(table.intentId),
  index("idx_intent_hard_cases_confidence").on(table.confidence),
  index("idx_intent_hard_cases_created_at").on(table.createdAt),
  index("idx_intent_hard_cases_profile_confidence").on(table.profile, table.confidence),
]));

export type IntentHardCase = typeof intentHardCases.$inferSelect;
export type InsertIntentHardCase = typeof intentHardCases.$inferInsert;

export const intentAccuracyBaselines = pgTable("intent_accuracy_baseline", {
  id: serial("id").primaryKey(),
  profile: text("profile").notNull(),
  intent: text("intent").notNull(),
  meanConfidence: real("mean_confidence").notNull(),
  minConfidence: real("min_confidence").notNull(),
  threshold: real("threshold").notNull().default(0.70),
  sampleCount: integer("sample_count").notNull().default(0),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_intent_accuracy_baseline_profile_intent").on(table.profile, table.intent),
  index("idx_intent_accuracy_baseline_profile").on(table.profile),
  index("idx_intent_accuracy_baseline_intent").on(table.intent),
  index("idx_intent_accuracy_baseline_last_updated").on(table.lastUpdated),
]));

export type IntentAccuracyBaseline = typeof intentAccuracyBaselines.$inferSelect;
export type InsertIntentAccuracyBaseline = typeof intentAccuracyBaselines.$inferInsert;

export const intentClassificationDecisions = pgTable("intent_classification_decisions", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  profileName: text("profile_name").notNull().default('pelangi'),
  messageHash: varchar("message_hash", { length: 64 }).notNull(),
  classifiedIntent: text("classified_intent").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  top3CandidatesJson: jsonb("top_3_candidates_json").notNull().default('[]'),
  actualIntent: text("actual_intent"),
}, (table) => ([
  index("idx_icd_profile_name").on(table.profileName),
  index("idx_icd_timestamp").on(table.timestamp),
  index("idx_icd_profile_timestamp").on(table.profileName, table.timestamp),
  index("idx_icd_classified_intent").on(table.classifiedIntent),
  index("idx_icd_message_hash").on(table.messageHash),
]));

export type IntentClassificationDecision = typeof intentClassificationDecisions.$inferSelect;
export type InsertIntentClassificationDecision = typeof intentClassificationDecisions.$inferInsert;

export const intentClassificationThresholds = pgTable("intent_classification_thresholds", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  intent: text("intent").notNull(),
  minConfidence: real("min_confidence").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_classification_thresholds_profile_intent").on(table.profileId, table.intent),
  index("idx_classification_thresholds_profile_id").on(table.profileId),
  index("idx_classification_thresholds_intent").on(table.intent),
]));

export type IntentClassificationThreshold = typeof intentClassificationThresholds.$inferSelect;
export type InsertIntentClassificationThreshold = typeof intentClassificationThresholds.$inferInsert;

// ─── US-376: Hard-Case Review Queue ─────────────────────────────────
// Captures predictions where confidence is 50-70% for admin labeling + retraining.
export const hardCaseQueue = pgTable("hard_case_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageText: text("message_text").notNull(),
  profile: text("profile").notNull().default('pelangi'),
  predictedIntent: text("predicted_intent").notNull(),
  confidence: real("confidence").notNull(),
  top3Candidates: jsonb("top_3_candidates").default('[]'),
  adminLabel: text("admin_label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_hard_case_queue_profile").on(table.profile),
  index("idx_hard_case_queue_predicted_intent").on(table.predictedIntent),
  index("idx_hard_case_queue_confidence").on(table.confidence),
  index("idx_hard_case_queue_admin_label").on(table.adminLabel),
  index("idx_hard_case_queue_created_at").on(table.createdAt),
]));

export type HardCaseQueue = typeof hardCaseQueue.$inferSelect;
export type InsertHardCaseQueue = typeof hardCaseQueue.$inferInsert;

