/**
 * compliance.ts — PDPA/GDPR, DPIA, TIA, profile isolation, and security audit tables
 */
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, serial, index } from "drizzle-orm/pg-core";

export const pdpaConsents = pgTable("pdpa_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull().unique(),
  consentLevel: varchar("consent_level").notNull(),
  dataCategory: varchar("data_category").notNull(),
  consentedAt: timestamp("consented_at").notNull(),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_pdpa_consents_phone").on(table.phoneNumber),
]));

export type PDPAConsent = typeof pdpaConsents.$inferSelect;
export type InsertPDPAConsent = typeof pdpaConsents.$inferInsert;

export const gdprDataRequests = pgTable("gdpr_data_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull(),
  requestType: varchar("request_type").notNull(),
  status: varchar("status").notNull(),
  responseFile: varchar("response_file"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ([
  index("idx_gdpr_data_requests_phone").on(table.phoneNumber),
  index("idx_gdpr_data_requests_status").on(table.status),
]));

export type GDPRDataRequest = typeof gdprDataRequests.$inferSelect;
export type InsertGDPRDataRequest = typeof gdprDataRequests.$inferInsert;

export const dpia = pgTable("data_protection_impact_assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assessmentName: varchar("assessment_name").notNull().unique(),
  risks: text("risks").notNull(),
  mitigations: text("mitigations").notNull(),
  status: varchar("status").notNull(),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_dpia_status").on(table.status),
]));

export type DPIA = typeof dpia.$inferSelect;
export type InsertDPIA = typeof dpia.$inferInsert;

export const thirdPartyIntegrationAssessments = pgTable("third_party_integration_assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  integrationName: varchar("integration_name").notNull().unique(),
  dataShared: text("data_shared").notNull(),
  riskLevel: varchar("risk_level").notNull(),
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_tia_risk_level").on(table.riskLevel),
]));

export type ThirdPartyIntegrationAssessment = typeof thirdPartyIntegrationAssessments.$inferSelect;
export type InsertThirdPartyIntegrationAssessment = typeof thirdPartyIntegrationAssessments.$inferInsert;

export const profileIsolationAudit = pgTable("profile_isolation_audit", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  profile: varchar("profile").notNull(),
  checkType: varchar("check_type").notNull(),
  passed: boolean("passed").notNull(),
  violations: text("violations"),
  auditedAt: timestamp("audited_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_profile_isolation_audit_profile").on(table.profile),
  index("idx_profile_isolation_audit_passed").on(table.passed),
]));

export type ProfileIsolationAudit = typeof profileIsolationAudit.$inferSelect;
export type InsertProfileIsolationAudit = typeof profileIsolationAudit.$inferInsert;

export const securityAuditLog = pgTable("security_audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: varchar("event_type").notNull(),
  actor: varchar("actor"),
  resource: varchar("resource"),
  action: varchar("action").notNull(),
  status: varchar("status").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_security_audit_log_event_type").on(table.eventType),
  index("idx_security_audit_log_created_at").on(table.createdAt),
]));

export type SecurityAuditLog = typeof securityAuditLog.$inferSelect;
export type InsertSecurityAuditLog = typeof securityAuditLog.$inferInsert;

export const optOuts = pgTable("opt_outs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  phoneNumber: text("phone_number").notNull().unique(),
  category: varchar("category").notNull(),
  optedOutAt: timestamp("opted_out_at").defaultNow().notNull(),
  reason: varchar("reason"),
}, (table) => ([
  index("idx_opt_outs_phone").on(table.phoneNumber),
  index("idx_opt_outs_category").on(table.category),
]));

export type OptOut = typeof optOuts.$inferSelect;
export type InsertOptOut = typeof optOuts.$inferInsert;

export const promptInjectionEvents = pgTable("prompt_injection_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: text("conversation_id"),
  detectionMethod: varchar("detection_method").notNull(),
  payload: text("payload").notNull(),
  severity: varchar("severity").notNull(),
  blocked: boolean("blocked").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ([
  index("idx_prompt_injection_events_severity").on(table.severity),
  index("idx_prompt_injection_events_created_at").on(table.createdAt),
]));

export type PromptInjectionEvent = typeof promptInjectionEvents.$inferSelect;
export type InsertPromptInjectionEvent = typeof promptInjectionEvents.$inferInsert;
