/**
 * bookings.ts — Booking workflows, reservations, execution audits,
 * escalation queue, and workflow error tracking tables
 */
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

// ─── Room Reservations ────────────────────────────────────────────────────────
// Stores confirmed/pending room reservations for real-time availability checks.
// Used by the booking workflow's dbAvailabilityCheck operator (US-056).

export const roomReservations = pgTable("room_reservations", {
  id: varchar("id", { length: 36 }).primaryKey().default('gen_random_uuid()'),
  roomId: varchar("room_id", { length: 64 }).notNull(),
  guestPhone: varchar("guest_phone", { length: 32 }).notNull(),
  guestName: text("guest_name").notNull(),
  checkInDate: timestamp("check_in_date").notNull(),
  checkOutDate: timestamp("check_out_date").notNull(),
  /** pending | confirmed | cancelled */
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  profile: varchar("profile", { length: 64 }).notNull().default("pelangi"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
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

export const bookingStepErrors = pgTable("booking_step_errors", {
  id: varchar("id", { length: 36 }).primaryKey().default('gen_random_uuid()'),
  stepId: text("step_id").notNull(),           // workflow step identifier
  errorCode: text("error_code").notNull(),     // e.g. 'payment_failed', 'room_unavailable'
  errorMessage: text("error_message"),         // technical error details
  profile: text("profile").notNull().default("pelangi"),
  conversationId: text("conversation_id"),     // optional: tie to conversation for context
  guestPhone: varchar("guest_phone", { length: 32 }),
  workflowId: text("workflow_id"),             // which booking workflow this belonged to
  recoveryMessageSent: boolean("recovery_message_sent").notNull().default(false),
  recoveryMessageAt: timestamp("recovery_message_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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

export const escalationQueue = pgTable("escalation_queue", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  originalIntent: text("original_intent").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  messagePreview: text("message_preview"),          // first 200 chars of guest message
  recommendedKeywords: text("recommended_keywords"), // JSON array of suggested keywords
  guestCorrectionIntent: text("guest_correction_intent"), // filled in by admin after review
  profile: text("profile").notNull().default('pelangi'),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ([
  index("idx_escalation_queue_profile").on(table.profile),
  index("idx_escalation_queue_confidence").on(table.confidenceScore),
  index("idx_escalation_queue_timestamp").on(table.timestamp),
  index("idx_escalation_queue_profile_confidence").on(table.profile, table.confidenceScore),
]));

export type EscalationQueueEntry = typeof escalationQueue.$inferSelect;
export type InsertEscalationQueueEntry = typeof escalationQueue.$inferInsert;

// ─── Booking Execution Audit (US-313) ────────────────────────────────
// Audit trail for booking workflow step execution.
// Records inputs, outputs, status, and timing for each step to enable
// debugging of failed bookings and compliance auditing.

export const bookingExecutionAudit = pgTable("booking_execution_audit", {
  id: serial("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  stepName: text("step_name").notNull(),
  input: jsonb("input").notNull(),
  output: jsonb("output").notNull(),
  status: text("status").notNull(),  // 'success' | 'error' | 'timeout' | 'skipped'
  executedAt: timestamp("executed_at").notNull().defaultNow(),
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

export const escalationFeedback = pgTable("escalation_feedback", {
  id: serial("id").primaryKey(),
  escalationId: integer("escalation_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  staffId: text("staff_id"),
  feedbackType: varchar("feedback_type", { length: 64 }).notNull(), // intent_misclassified, missing_knowledge, wrong_workflow, poor_response, other
  correctIntent: varchar("correct_intent", { length: 64 }),
  severity: varchar("severity", { length: 16 }).notNull().default('medium'), // low, medium, high, critical
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_escalation_feedback_escalation_id").on(table.escalationId),
  index("idx_escalation_feedback_profile_id").on(table.profileId),
  index("idx_escalation_feedback_type").on(table.feedbackType),
  index("idx_escalation_feedback_severity").on(table.severity),
  index("idx_escalation_feedback_created_at").on(table.createdAt),
]));

export type EscalationFeedback = typeof escalationFeedback.$inferSelect;
export type InsertEscalationFeedback = typeof escalationFeedback.$inferInsert;

// ─── Booking State Audit (US-312) ───────────────────────────────────
// Logs every booking state transition attempt for audit and debugging.

export const bookingStateAudit = pgTable("booking_state_audit", {
  id: serial("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  valid: boolean("valid").notNull(),
  reason: text("reason").notNull(),
  profile: text("profile").notNull().default('pelangi'),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
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

// ─── Booking Classification Failures (US-226) ────────────────────────
// Logs booking intent classification failures where confidence < 0.65.

export const bookingClassificationFailures = pgTable("booking_classification_failures", {
  id: serial("id").primaryKey(),
  messageId: text("message_id"),                     // optional message correlation id
  rawInput: text("raw_input").notNull(),              // the original user message
  profileId: text("profile_id").notNull().default('pelangi'),
  top3Candidates: jsonb("top_3_candidates").notNull().default([]), // [{intent, confidence}]
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ([
  index("idx_bcf_profile_id").on(table.profileId),
  index("idx_bcf_timestamp").on(table.timestamp),
  index("idx_bcf_profile_timestamp").on(table.profileId, table.timestamp),
]));

export type BookingClassificationFailure = typeof bookingClassificationFailures.$inferSelect;
export type InsertBookingClassificationFailure = typeof bookingClassificationFailures.$inferInsert;

// ─── Model Accuracy History (US-236) ────────────────────────────────────────
// Tracks intent classification accuracy metrics over time for model rollback decisions.

export const modelAccuracyHistory = pgTable("model_accuracy_history", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  modelVersion: text("model_version").notNull(),
  accuracyScore: real("accuracy_score").notNull(),  // 0.0-1.0 classification accuracy
  messagesTested: integer("messages_tested").notNull(), // sample size for this accuracy score
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ([
  index("idx_model_accuracy_history_profile").on(table.profileId),
  index("idx_model_accuracy_history_model_version").on(table.modelVersion),
  index("idx_model_accuracy_history_timestamp").on(table.timestamp),
  index("idx_model_accuracy_history_profile_timestamp").on(table.profileId, table.timestamp),
]));

export type ModelAccuracyRecord = typeof modelAccuracyHistory.$inferSelect;
export type InsertModelAccuracyRecord = typeof modelAccuracyHistory.$inferInsert;

// ─── Booking Workflow Traces (US-309) ─────────────────────────────────
// Logs each booking workflow step's input, output, error, and duration
// for post-mortem debugging of multi-step failures.

export const bookingWorkflowTraces = pgTable("booking_workflow_traces", {
  id: serial("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  stepName: text("step_name").notNull(),
  inputJson: jsonb("input_json"),
  outputJson: jsonb("output_json"),
  errorMsg: text("error_msg"),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_bwt_booking_id").on(table.bookingId),
  index("idx_bwt_step_name").on(table.stepName),
  index("idx_bwt_created_at").on(table.createdAt),
]));

export type BookingWorkflowTrace = typeof bookingWorkflowTraces.$inferSelect;
export type InsertBookingWorkflowTrace = typeof bookingWorkflowTraces.$inferInsert;

// ─── Booking Workflow Timeout Events (US-324) ──────────────────────────────
// Logs each timeout event per workflow step for per-step timeout frequency metrics.

export const bookingWorkflowEvents = pgTable("booking_workflow_events", {
  id: serial("id").primaryKey(),
  stepName: text("step_name").notNull(),
  workflowId: text("workflow_id"),
  profileId: text("profile_id"),
  elapsedMs: integer("elapsed_ms").notNull(),
  timedOutAt: timestamp("timed_out_at").notNull().defaultNow(),
  fallbackUsed: boolean("fallback_used").default(false).notNull(),
}, (table) => ([
  index("idx_bwe_step_name").on(table.stepName),
  index("idx_bwe_workflow_id").on(table.workflowId),
  index("idx_bwe_timed_out_at").on(table.timedOutAt),
]));

export type BookingWorkflowEvent = typeof bookingWorkflowEvents.$inferSelect;
export type InsertBookingWorkflowEvent = typeof bookingWorkflowEvents.$inferInsert;

// ─── Workflow Error Queue (US-333) ────────────────────────────────────────
// Captures booking workflow step failures with full context for staff review.

export const workflowErrorQueue = pgTable("workflow_error_queue", {
  id: serial("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  intentId: text("intent_id"),
  stepName: text("step_name").notNull(),
  errorMessage: text("error_message").notNull(),
  workflowState: jsonb("workflow_state"),  // Full workflow state at point of failure
  status: text("status").notNull().default('pending'),  // 'pending' | 'resolved' | 'escalated'
  reviewedBy: text("reviewed_by"),  // Staff member who reviewed
  resolution: text("resolution"),  // 'retry' | 'skip' | 'escalate'
  resolutionNotes: text("resolution_notes"),  // Reason for resolution
  profile: text("profile").notNull().default('pelangi'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ([
  index("idx_workflow_error_queue_status").on(table.status),
  index("idx_workflow_error_queue_profile").on(table.profile),
  index("idx_workflow_error_queue_conversation_id").on(table.conversationId),
  index("idx_workflow_error_queue_created_at").on(table.createdAt),
  index("idx_workflow_error_queue_profile_status").on(table.profile, table.status),
]));

export type WorkflowErrorQueueEntry = typeof workflowErrorQueue.$inferSelect;
export type InsertWorkflowErrorQueueEntry = typeof workflowErrorQueue.$inferInsert;

// ─── Verification Codes (US-436) ────────────────────────────────────────────────
// Stores booking verification codes sent via SMS with expiry and usage tracking.
// Enables booking confirmation via code verification.

export const verificationCodes = pgTable("verification_codes", {
  id: varchar("id", { length: 36 }).primaryKey().default('gen_random_uuid()'),
  bookingId: varchar("booking_id", { length: 36 }).notNull(),
  code: varchar("code", { length: 6 }).notNull(),  // 6-digit verification code
  guestPhone: varchar("guest_phone", { length: 32 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),    // 15 minutes from creation
  usedAt: timestamp("used_at"),                    // When code was used
  profile: varchar("profile", { length: 64 }).notNull().default("pelangi"),
}, (table) => ([
  index("idx_verification_codes_booking_id").on(table.bookingId),
  index("idx_verification_codes_guest_phone").on(table.guestPhone),
  index("idx_verification_codes_profile").on(table.profile),
  index("idx_verification_codes_expires_at").on(table.expiresAt),
  index("idx_verification_codes_booking_profile").on(table.bookingId, table.profile),
]));

export type VerificationCode = typeof verificationCodes.$inferSelect;
export type InsertVerificationCode = typeof verificationCodes.$inferInsert;

// ─── Booking Workflow Audit (US-558) ────────────────────────────────
// Logs automatic timeout and reset events for booking workflows stuck in
// intermediate states. After 60 minutes in same state, workflow resets to
// initial step and this audit entry is created.

export const bookingWorkflowAudit = pgTable("booking_workflow_audit", {
  id: serial("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  reason: text("reason").notNull(),  // e.g., 'timeout', 'manual_reset'
  resetAt: timestamp("reset_at").notNull().defaultNow(),
  profile: text("profile").notNull().default('pelangi'),
}, (table) => ([
  index("idx_booking_workflow_audit_booking_id").on(table.bookingId),
  index("idx_booking_workflow_audit_reason").on(table.reason),
  index("idx_booking_workflow_audit_reset_at").on(table.resetAt),
  index("idx_booking_workflow_audit_profile").on(table.profile),
]));

export type BookingWorkflowAudit = typeof bookingWorkflowAudit.$inferSelect;
export type InsertBookingWorkflowAudit = typeof bookingWorkflowAudit.$inferInsert;
