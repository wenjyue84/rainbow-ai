/**
 * compliance.ts — PDPA/GDPR, DPIA, TIA, profile isolation, and security audit tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, real, serial, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";

export const experimentMetrics = pgTable("experiment_metrics", {
  id: serial("id").primaryKey(),
  experimentId: varchar("experiment_id", { length: 128 }).notNull(),
  variantId: varchar("variant_id", { length: 128 }).notNull(),
  phoneHash: varchar("phone_hash", { length: 64 }).notNull(), // MD5 hash of phone for privacy
  messageCount: integer("message_count").notNull().default(0),
  fallbackCount: integer("fallback_count").notNull().default(0),
  csatSum: integer("csat_sum").notNull().default(0),
  csatCount: integer("csat_count").notNull().default(0),
  windowDate: text("window_date").notNull(), // YYYY-MM-DD (UTC)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_experiment_metrics_exp_var_phone_date").on(table.experimentId, table.variantId, table.phoneHash, table.windowDate),
  index("idx_experiment_metrics_experiment").on(table.experimentId),
  index("idx_experiment_metrics_window_date").on(table.windowDate),
]));

export type ExperimentMetric = typeof experimentMetrics.$inferSelect;
export type InsertExperimentMetric = typeof experimentMetrics.$inferInsert;

export const webchatConsentLog = pgTable("webchat_consent_log", {
  id: serial("id").primaryKey(),
  sessionIdHash: varchar("session_id_hash", { length: 64 }).notNull(),
  acceptedAt: timestamp("accepted_at").notNull().defaultNow(),
  profileId: text("profile_id").notNull().default('pelangi'),
  userAgentHash: varchar("user_agent_hash", { length: 64 }),
}, (table) => ([
  index("idx_webchat_consent_log_profile").on(table.profileId),
  index("idx_webchat_consent_log_accepted_at").on(table.acceptedAt),
]));

export type WebchatConsentLog = typeof webchatConsentLog.$inferSelect;
export type InsertWebchatConsentLog = typeof webchatConsentLog.$inferInsert;

export const vectorAccessLogs = pgTable("vector_access_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Property that made the query (e.g., "pelangi", "southern") */
  propertyId: text("property_id").notNull(),
  /** Hashed query text (SHA-256 truncated to 16 hex chars for privacy) */
  queryHash: varchar("query_hash", { length: 16 }).notNull(),
  /** Number of chunks returned */
  chunksReturned: integer("chunks_returned").notNull().default(0),
  /** Source filenames of returned chunks (JSON array) */
  retrievedSources: text("retrieved_sources").notNull().default('[]'),
  /** Top similarity score (0-1) of returned chunks */
  topScore: real("top_score"),
  /** Whether any returned chunk had a mismatched propertyId (cross-namespace leak) */
  crossNamespaceDetected: boolean("cross_namespace_detected").notNull().default(false),
  /** Whether a similarity attack was suspected (anomalously high score) */
  similarityAttackSuspected: boolean("similarity_attack_suspected").notNull().default(false),
  /** Retrieval latency in ms */
  latencyMs: integer("latency_ms"),
  /** Service identity that performed the retrieval */
  serviceIdentity: text("service_identity").notNull().default('rainbow-ai'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_val_property_created").on(table.propertyId, table.createdAt),
  index("idx_val_cross_namespace").on(table.crossNamespaceDetected),
  index("idx_val_attack_suspected").on(table.similarityAttackSuspected),
  index("idx_val_created_at").on(table.createdAt),
]));

export type VectorAccessLog = typeof vectorAccessLogs.$inferSelect;
export type InsertVectorAccessLog = typeof vectorAccessLogs.$inferInsert;

export const marketingSubscriptions = pgTable("marketing_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phone: varchar("phone", { length: 64 }).notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  /** 'pending' | 'confirmed' | 'revoked' | 'expired' */
  consentStatus: varchar("consent_status", { length: 16 }).notNull().default('pending'),
  /** How the contact was added: 'checkin' | 'web_form' | 'admin_add' | 'qr_code' */
  channel: varchar("channel", { length: 32 }).notNull().default('admin_add'),
  /** IP/source identifier where consent was initiated (for PDPA audit) */
  collectedVia: text("collected_via"),
  /** When the opt-in confirmation template was sent */
  optInSentAt: timestamp("opt_in_sent_at"),
  /** When consent was confirmed (keyword reply received) */
  confirmedAt: timestamp("confirmed_at"),
  /** When consent was revoked (STOP or admin action) */
  revokedAt: timestamp("revoked_at"),
  /** 48h deadline — if no confirmation by this time, status → expired */
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_marketing_sub_phone_profile").on(table.phone, table.profileId),
  index("idx_marketing_sub_status").on(table.consentStatus),
  index("idx_marketing_sub_expires_at").on(table.expiresAt),
  index("idx_marketing_sub_profile_status").on(table.profileId, table.consentStatus),
]));

export type MarketingSubscription = typeof marketingSubscriptions.$inferSelect;
export type InsertMarketingSubscription = typeof marketingSubscriptions.$inferInsert;

export const mmLiteSends = pgTable("mm_lite_sends", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Campaign identifier (admin-assigned, e.g. "makan-daily-2026-03-16") */
  campaignId: text("campaign_id").notNull(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: varchar("phone", { length: 64 }).notNull(),
  templateName: text("template_name").notNull(),
  /** 'mm_lite' | 'standard' — which send path was used */
  sendApi: varchar("send_api", { length: 16 }).notNull().default('mm_lite'),
  /** TTL in hours set at send time (default 720h = 30 days) */
  ttlHours: integer("ttl_hours").notNull().default(720),
  /** Computed expiry timestamp (sentAt + ttlHours) */
  ttlExpiresAt: timestamp("ttl_expires_at"),
  /** 'queued' | 'sent' | 'delivered' | 'failed' | 'expired' */
  deliveryStatus: varchar("delivery_status", { length: 16 }).notNull().default('queued'),
  /** Timestamp when MM Lite API accepted the send */
  sentAt: timestamp("sent_at"),
  /** Timestamp when delivery confirmation received via webhook */
  deliveredAt: timestamp("delivered_at"),
  /** Timestamp when TTL expiry was detected */
  expiredAt: timestamp("expired_at"),
  /** Meta message ID returned from Cloud API */
  metaMessageId: text("meta_message_id"),
  /** Error code/message if send failed */
  errorInfo: text("error_info"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_mm_lite_campaign").on(table.campaignId),
  index("idx_mm_lite_profile_status").on(table.profileId, table.deliveryStatus),
  index("idx_mm_lite_phone").on(table.phone),
  index("idx_mm_lite_expires_at").on(table.ttlExpiresAt),
  index("idx_mm_lite_send_api").on(table.sendApi),
  index("idx_mm_lite_created_at").on(table.createdAt),
]));

export type MmLiteSend = typeof mmLiteSends.$inferSelect;
export type InsertMmLiteSend = typeof mmLiteSends.$inferInsert;

export const dpiaRecords = pgTable("dpia_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Profile this DPIA applies to ('pelangi', 'makan-moments', etc.) */
  profileId: text("profile_id").notNull(),
  /** DPIA title/description */
  title: text("title").notNull(),
  /** Structured DPIA document as JSON */
  documentJson: text("document_json").notNull(),
  /** Processing scope: high-level description of what data is processed */
  processingScope: text("processing_scope").notNull(),
  /** Risk assessment summary */
  riskSummary: text("risk_summary").notNull(),
  /** Mitigation measures documented */
  mitigations: text("mitigations").notNull(),
  /** Last review date */
  lastReviewedAt: timestamp("last_reviewed_at").notNull().defaultNow(),
  /** Next review due (must be within 3 years per CBPDT Guidelines) */
  nextReviewDue: timestamp("next_review_due").notNull(),
  /** Reviewer name/email */
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  uniqueIndex("idx_dpia_profile_id").on(table.profileId),
  index("idx_dpia_next_review_due").on(table.nextReviewDue),
]));

export type DpiaRecord = typeof dpiaRecords.$inferSelect;
export type InsertDpiaRecord = typeof dpiaRecords.$inferInsert;

export const tiaRecords = pgTable("tia_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Profile this TIA applies to */
  profileId: text("profile_id").notNull(),
  /** AI provider name ('NVIDIA', 'OpenRouter', 'Ollama', etc.) */
  aiProvider: text("ai_provider").notNull(),
  /** Destination jurisdiction code (e.g. 'US', 'SG') */
  destinationJurisdiction: text("destination_jurisdiction").notNull(),
  /** Data protection equivalence assessment */
  equivalenceLevel: varchar("equivalence_level", { length: 16 }).notNull(), // 'adequate' | 'similar' | 'assessed'
  /** API endpoint URL for this provider */
  apiEndpoint: text("api_endpoint").notNull(),
  /** Transfer mechanism (e.g. 'standard_contractual_clauses', 'adequacy_decision') */
  transferMechanism: text("transfer_mechanism").notNull(),
  /** TIA document as JSON */
  documentJson: text("document_json").notNull(),
  /** Data transferred (e.g. 'guest_phone,name,conversation_context') */
  dataTransferred: text("data_transferred").notNull(),
  /** Risk assessment for this transfer */
  riskAssessment: text("risk_assessment").notNull(),
  /** Controls in place */
  controls: text("controls").notNull(),
  /** Last review date */
  lastReviewedAt: timestamp("last_reviewed_at").notNull().defaultNow(),
  /** Valid until (max 3 years per CBPDT) */
  validUntil: timestamp("valid_until").notNull(),
  /** Reviewed by */
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_tia_profile_provider").on(table.profileId, table.aiProvider),
  index("idx_tia_valid_until").on(table.validUntil),
  index("idx_tia_created_at").on(table.createdAt),
]));

export type TiaRecord = typeof tiaRecords.$inferSelect;
export type InsertTiaRecord = typeof tiaRecords.$inferInsert;

export const aiDecisionAudit = pgTable("ai_decision_audit", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull().default('pelangi'),
  phone: varchar("phone", { length: 64 }).notNull(),
  /** Category of automated decision: booking | escalation | order_confirmation | menu_recommendation */
  decisionType: varchar("decision_type", { length: 64 }).notNull(),
  /** Intent that triggered this decision */
  intent: text("intent"),
  /** AI confidence score (0-1) at time of decision */
  confidenceScore: real("confidence_score"),
  /** AI provider that produced the decision */
  aiProvider: text("ai_provider"),
  /** Whether the guest requested human review */
  humanReviewRequested: boolean("human_review_requested").notNull().default(false),
  /** Final outcome: accepted | human_review | escalated | cancelled */
  outcome: varchar("outcome", { length: 64 }),
  /** When the disclosure message was sent to the guest */
  disclosureSentAt: timestamp("disclosure_sent_at"),
  /** When the guest requested human review (null if not requested) */
  reviewRequestedAt: timestamp("review_requested_at"),
  /** When the decision was resolved */
  resolvedAt: timestamp("resolved_at"),
  /** Additional context (JSON string) */
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_aidecision_profile_phone").on(table.profileId, table.phone),
  index("idx_aidecision_created_at").on(table.createdAt),
  index("idx_aidecision_human_review").on(table.humanReviewRequested),
]));

export type AiDecisionAuditRecord = typeof aiDecisionAudit.$inferSelect;
export type InsertAiDecisionAuditRecord = typeof aiDecisionAudit.$inferInsert;

export const promptInjectionEvents = pgTable("prompt_injection_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jid: text("jid").notNull(),
  profileId: text("profile_id").notNull().default("pelangi"),
  originalMessageText: text("original_message_text").notNull(),
  matchedPattern: text("matched_pattern").notNull(),
  actionTaken: varchar("action_taken", { length: 64 }).notNull().default("blocked"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_injection_events_jid").on(table.jid),
  index("idx_injection_events_profile").on(table.profileId),
  index("idx_injection_events_created_at").on(table.createdAt),
]));

export type PromptInjectionEvent = typeof promptInjectionEvents.$inferSelect;
export type InsertPromptInjectionEvent = typeof promptInjectionEvents.$inferInsert;

export const dpaRegistry = pgTable("dpa_registry", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  vendorName: text("vendor_name").notNull(),
  registeredAddress: text("registered_address").notNull().default(""),
  dataCategories: text("data_categories").notNull(),
  processingPurpose: text("processing_purpose").notNull(),
  retentionPeriod: text("retention_period").notNull().default(""),
  subProcessors: text("sub_processors").notNull().default("[]"),
  dpaStatus: varchar("dpa_status", { length: 32 }).notNull().default("pending"),
  dpaExpiryDate: timestamp("dpa_expiry_date"),
  dpaSigned: timestamp("dpa_signed"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_dpa_registry_vendor").on(table.vendorName),
  index("idx_dpa_registry_status").on(table.dpaStatus),
  index("idx_dpa_registry_expiry").on(table.dpaExpiryDate),
]));

export type DpaRegistryEntry = typeof dpaRegistry.$inferSelect;
export type InsertDpaRegistryEntry = typeof dpaRegistry.$inferInsert;

export const einvoiceQueue = pgTable("einvoice_queue", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Source transaction: 'order' or 'booking' */
  transactionType: varchar("transaction_type", { length: 32 }).notNull(),
  /** External reference ID (order ID or booking ID) */
  transactionId: text("transaction_id").notNull(),
  /** Profile/tenant that owns this invoice */
  profileId: text("profile_id").notNull().default("pelangi"),
  /** Customer phone (for WhatsApp delivery) */
  customerPhone: text("customer_phone"),
  /** Customer name */
  customerName: text("customer_name"),
  /** Customer NRIC or passport number (LHDN mandatory) */
  customerIdNumber: text("customer_id_number"),
  /** Supplier TIN (Tax Identification Number) */
  supplierTin: text("supplier_tin").notNull(),
  /** Line items JSON: [{description, qty, unitPrice, taxAmount, total}] */
  lineItems: text("line_items").notNull(),
  /** Total amount (MYR) */
  totalAmount: real("total_amount").notNull(),
  /** SST amount */
  sstAmount: real("sst_amount").notNull().default(0),
  /** Queue status: pending | submitted | validated | delivered | failed | expired */
  status: varchar("status", { length: 32 }).notNull().default("pending"),
  /** MyInvois Unique Identification Number (set after validation) */
  uin: text("uin"),
  /** Number of submission attempts */
  attempts: integer("attempts").notNull().default(0),
  /** Last error message from MyInvois API */
  lastError: text("last_error"),
  /** When the invoice was successfully submitted to MyInvois */
  submittedAt: timestamp("submitted_at"),
  /** When the PDF was delivered via WhatsApp */
  deliveredAt: timestamp("delivered_at"),
  /** Next scheduled retry time */
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_einvoice_queue_status").on(table.status),
  index("idx_einvoice_queue_profile").on(table.profileId),
  index("idx_einvoice_queue_transaction").on(table.transactionType, table.transactionId),
  index("idx_einvoice_queue_next_retry").on(table.nextRetryAt),
  index("idx_einvoice_queue_created_at").on(table.createdAt),
]));

export type EinvoiceQueueEntry = typeof einvoiceQueue.$inferSelect;
export type InsertEinvoiceQueueEntry = typeof einvoiceQueue.$inferInsert;

export const profileIsolationViolations = pgTable("profile_isolation_violations", {
  id: serial("id").primaryKey(),
  attemptedProfile: text("attempted_profile").notNull(),
  actualProfile: text("actual_profile").notNull(),
  queryText: text("query_text").notNull(),
  routePath: text("route_path").notNull(),
  method: varchar("method", { length: 10 }).notNull(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_piv_actual_profile").on(table.actualProfile),
  index("idx_piv_attempted_profile").on(table.attemptedProfile),
  index("idx_piv_created_at").on(table.createdAt),
]));

export type ProfileIsolationViolation = typeof profileIsolationViolations.$inferSelect;
export type InsertProfileIsolationViolation = typeof profileIsolationViolations.$inferInsert;

export const profileIsolationRepairs = pgTable("profile_isolation_repairs", {
  id: serial("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  violationType: text("violation_type").notNull(),  // 'guest_multi_profile' | 'keyword_cross_profile' | 'workflow_foreign_route'
  violationDetails: jsonb("violation_details").notNull(),  // object with violation context
  repairAction: text("repair_action").notNull(),  // 'delete' | 'reassign' | 'flag_for_review'
  repairDetails: jsonb("repair_details").notNull(),  // what was changed
  status: text("status").notNull().default('applied'),  // 'applied' | 'flagged' | 'pending_review'
  appliedAt: timestamp("applied_at").notNull().defaultNow(),
}, (table) => ([
  index("idx_profile_isolation_repairs_profile").on(table.profileId),
  index("idx_profile_isolation_repairs_type").on(table.violationType),
  index("idx_profile_isolation_repairs_status").on(table.status),
  index("idx_profile_isolation_repairs_applied_at").on(table.appliedAt),
]));

export type ProfileIsolationRepair = typeof profileIsolationRepairs.$inferSelect;
export type InsertProfileIsolationRepair = typeof profileIsolationRepairs.$inferInsert;

