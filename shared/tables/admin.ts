/**
 * admin.ts — Admin users, RBAC, audit logs, and operational monitoring tables
 */
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

// ─── Admin Users (US-514: TOTP 2FA, US-898: RBAC) ──────────────────

/** Valid admin roles — enforced at app layer (no PG enum migration needed). */
export const ADMIN_ROLES = ['viewer', 'operator', 'super-admin'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export const adminUsers = pgTable("admin_users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default('operator'),  // US-898: viewer | operator | super-admin
  allowedTenants: text("allowed_tenants"),   // US-908: JSON array of tenant_ids this admin can access (null = unrestricted / super-admin)
  totpSecret: text("totp_secret"),          // AES-256-GCM encrypted, null if 2FA not enrolled
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  failedTotpAttempts: integer("failed_totp_attempts").notNull().default(0),
  totpLockedUntil: timestamp("totp_locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_admin_users_username").on(table.username),
]));

export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = typeof adminUsers.$inferInsert;

// ─── Admin Audit Log (US-257) ──────────────────────────────────────
// Tracks all config file changes (settings.json, workflows.json, knowledge.json)
// with user, timestamp, content hashes, and unified diff for rollback/compliance

export const adminAuditLog = pgTable("admin_audit_log", {
  id: serial("id").primaryKey(),
  configFile: text("config_file").notNull(),
  changedBy: text("changed_by"),
  previousHash: text("previous_hash"),
  newHash: text("new_hash").notNull(),
  diffSummary: text("diff_summary").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
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

export const workflowStepValidationErrors = pgTable("workflow_step_validation_errors", {
  id: serial("id").primaryKey(),
  stepId: text("step_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  expectedSchema: jsonb("expected_schema").notNull(),    // The schema the output should conform to
  actualOutput: jsonb("actual_output").notNull(),         // The output that failed validation
  errorMessages: jsonb("error_messages").notNull(),       // Array of detailed error strings
  workflowId: text("workflow_id"),                        // Which workflow this step belongs to
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_wf_step_validation_step_id").on(table.stepId),
  index("idx_wf_step_validation_profile_id").on(table.profileId),
  index("idx_wf_step_validation_created_at").on(table.createdAt),
  index("idx_wf_step_validation_step_profile").on(table.stepId, table.profileId),
]));

export type WorkflowStepValidationError = typeof workflowStepValidationErrors.$inferSelect;
export type InsertWorkflowStepValidationError = typeof workflowStepValidationErrors.$inferInsert;

// ─── Fallback Response Metrics (US-300) ─────────────────────────────
// Tracks fallback response template effectiveness by measuring
// escalation-to-resolution rates per template per profile.

export const fallbackResponseMetrics = pgTable("fallback_response_metrics", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  templateId: text("template_id").notNull(),
  escalationCount: integer("escalation_count").notNull().default(0),
  resolutionCount: integer("resolution_count").notNull().default(0),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ([
  index("idx_fallback_resp_metrics_profile").on(table.profileId),
  index("idx_fallback_resp_metrics_template").on(table.templateId),
  index("idx_fallback_resp_metrics_timestamp").on(table.timestamp),
  uniqueIndex("idx_fallback_resp_metrics_profile_template").on(table.profileId, table.templateId),
]));

export type FallbackResponseMetric = typeof fallbackResponseMetrics.$inferSelect;
export type InsertFallbackResponseMetric = typeof fallbackResponseMetrics.$inferInsert;

// ─── Low-Confidence Message Archival (US-280) ──────────────────────────────
// Stores messages where intent confidence < 0.5 for QA review and retraining.
// QA team can submit correct_intent via admin API to build a correction dataset.

export const rainbowLowconfMessages = pgTable("rainbow_lowconf_messages", {
  id: serial("id").primaryKey(),
  profile: text("profile").notNull().default('pelangi'),
  messageId: text("message_id"),
  originalText: text("original_text").notNull(),
  predictedIntent: text("predicted_intent").notNull(),
  confidence: real("confidence").notNull(),
  correctIntent: text("correct_intent"),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_lowconf_messages_profile").on(table.profile),
  index("idx_lowconf_messages_reviewed_at").on(table.reviewedAt),
  index("idx_lowconf_messages_created_at").on(table.createdAt),
  index("idx_lowconf_messages_confidence").on(table.confidence),
]));

export type LowconfMessage = typeof rainbowLowconfMessages.$inferSelect;
export type InsertLowconfMessage = typeof rainbowLowconfMessages.$inferInsert;

// ─── Routing Audit Logs (US-343) ─────────────────────────────────────
// Records every message routing decision for cross-profile integrity auditing.

export const routingAuditLogs = pgTable("routing_audit_logs", {
  id: serial("id").primaryKey(),
  messageId: varchar("message_id", { length: 128 }).notNull(),
  phone: varchar("phone", { length: 64 }).notNull(),
  sourceProfile: text("source_profile").notNull(),
  targetProfile: text("target_profile").notNull(),
  classifierMatchResult: text("classifier_match_result"),  // intent matched, e.g. 'check_availability'
  classifierConfidence: real("classifier_confidence"),      // 0.0-1.0
  isViolation: boolean("is_violation").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_ral_source_profile").on(table.sourceProfile),
  index("idx_ral_target_profile").on(table.targetProfile),
  index("idx_ral_is_violation").on(table.isViolation),
  index("idx_ral_created_at").on(table.createdAt),
  index("idx_ral_phone").on(table.phone),
]));

export type RoutingAuditLog = typeof routingAuditLogs.$inferSelect;
export type InsertRoutingAuditLog = typeof routingAuditLogs.$inferInsert;

// ─── Guest Blacklist (US-346) ──────────────────────────────────────────────
// Stores phones and names of guests who should be blocked from booking.
// checkBlacklist() in src/lib/guest-validator.ts queries this table.

export const guestBlacklist = pgTable("guest_blacklist", {
  id: serial("id").primaryKey(),
  phone: varchar("phone", { length: 64 }),      // optional — match by phone
  name: text("name"),                            // optional — fuzzy-matched name
  reason: text("reason").notNull(),              // why they were blacklisted
  addedBy: varchar("added_by", { length: 128 }), // staff member who added entry
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_guest_blacklist_phone").on(table.phone),
  index("idx_guest_blacklist_created_at").on(table.createdAt),
]));

export type GuestBlacklistEntry = typeof guestBlacklist.$inferSelect;
export type InsertGuestBlacklistEntry = typeof guestBlacklist.$inferInsert;
