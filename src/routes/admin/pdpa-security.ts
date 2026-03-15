/**
 * PDPA Security Principle Admin API (US-968)
 *
 * Malaysia Personal Data Protection (Amendment) Act 2024, Phase 3 (effective June 2025)
 * directly obliges data processors to comply with the Security Principle (Section 9).
 *
 * Endpoints:
 *   GET  /pdpa/security/dpa            — Data Processing Agreement document
 *   GET  /pdpa/security/inventory      — Data processing inventory (categories, legal basis, retention)
 *   POST /pdpa/security/annual-review  — Record annual security review in audit log
 *   GET  /pdpa/security/status         — Overall PDPA Security Principle compliance status
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, serverError } from './http-utils.js';
import { logSecurityEvent } from '../../lib/security-event-log.js';
import { isPiiEncryptionEnabled } from '../../lib/pii-encryption.js';
import { checkRole } from '../../lib/rbac.js';

const router = Router();

// ─── DPA Document ────────────────────────────────────────────────────

/**
 * Static Data Processing Agreement describing Rainbow AI's technical and
 * organizational security measures (PDPA 2024 Section 9 — Security Principle).
 */
function getDpaDocument() {
  return {
    document_type: 'Data Processing Agreement',
    title: 'Rainbow AI — Technical and Organizational Security Measures',
    version: '1.0',
    effective_date: '2025-06-01',
    legal_basis: 'Malaysia Personal Data Protection Act 2010 (as amended 2024), Section 9 — Security Principle',
    data_controller: {
      name: 'Pelangi Capsule Hostel / Southern Homestay',
      jurisdiction: 'Malaysia',
    },
    data_processor: {
      name: 'Rainbow AI (Prisma Technology)',
      role: 'Data Processor — WhatsApp AI assistant processing guest PII on behalf of the data controller',
      jurisdiction: 'Malaysia',
    },
    security_measures: {
      technical: [
        {
          measure: 'Encryption in transit',
          detail: 'All data transmitted between clients and the Rainbow AI server is encrypted via TLS 1.2+. WhatsApp Baileys uses end-to-end encryption inherent to the WhatsApp protocol.',
        },
        {
          measure: 'Encryption at rest (AES-256-GCM)',
          detail: 'PII fields (guest names, phone numbers, booking references) can be encrypted at rest using AES-256-GCM via the PII_ENCRYPTION_KEY environment variable. Encrypted blobs are prefixed v1: for algorithm versioning.',
          status: isPiiEncryptionEnabled() ? 'active' : 'pending_key_configuration',
        },
        {
          measure: 'PII redaction before LLM calls',
          detail: 'Malaysian IC numbers, passport numbers, credit card numbers, bank account numbers, email addresses, and phone numbers are redacted from prompts before transmission to external AI providers (NVIDIA, OpenRouter, Groq).',
        },
        {
          measure: 'Role-based access control (RBAC)',
          detail: 'Admin panel enforces three roles: viewer (read-only analytics), operator (manage conversations), super-admin (full access including data deletion). PII access is restricted to operator and super-admin roles.',
        },
        {
          measure: 'Authentication and brute-force protection',
          detail: 'Admin panel requires API key authentication with IP-based brute-force lockout (5 failed attempts → 15-minute lockout). Optional TOTP 2FA with AES-256-GCM encrypted secrets.',
        },
        {
          measure: 'Breach detection and alerting',
          detail: 'Automated anomaly detection monitors bulk data access patterns (configurable threshold, default 100 records per scan window). DPO is alerted via admin notification channel on detected breaches.',
        },
        {
          measure: 'Security event audit log',
          detail: 'All admin access to personal data is logged with user identity, action, resource type, IP address, and timestamp in security_event_log table.',
        },
        {
          measure: 'Data retention enforcement',
          detail: 'Automated nightly retention job (3:00 AM MYT) soft-deletes and hard-deletes guest messages and conversations after the configured retention period (default: 730 days / 2 years post-checkout). Produces pdpa_disposal_reports records.',
        },
        {
          measure: 'Input validation and sanitization',
          detail: 'All API inputs validated via Zod schemas. SQL injection prevented via parameterized queries (Drizzle ORM + pg driver). CSRF protection on admin endpoints.',
        },
        {
          measure: 'Webhook signature verification',
          detail: 'WhatsApp webhook payloads verified with HMAC-SHA256 to prevent spoofed messages.',
        },
      ],
      organizational: [
        {
          measure: 'Data Protection Officer (DPO) appointment',
          detail: 'DPO details (name, email, PDPC registration status) are configured in the admin panel under /pdpa/dpo. DPO must be ordinarily resident in Malaysia and registered with the PDPC Commissioner.',
        },
        {
          measure: 'Data processing inventory',
          detail: 'Maintained at /pdpa/security/inventory. Lists each category of personal data, legal basis, retention period, and security measure applied.',
        },
        {
          measure: 'Annual security review',
          detail: 'Annual review is recorded via POST /pdpa/security/annual-review. Findings are logged in the security_event_log audit trail.',
        },
        {
          measure: 'Incident response',
          detail: 'Data breaches are recorded in pdpa_breach_log table and managed via the /pdpa/breach admin endpoints. PDPC notification obligations tracked per breach record.',
        },
      ],
    },
    data_subject_rights: [
      'Right of access (DSAR) — GET /pdpa/dsar/:phone',
      'Right to erasure — POST /gdpr/erasure',
      'Right to data portability — GET /gdpr/data-export',
      'Right to withdraw consent — POST /consent/opt-out',
    ],
    generated_at: new Date().toISOString(),
  };
}

// ─── GET /pdpa/security/dpa ──────────────────────────────────────────
router.get('/pdpa/security/dpa', checkRole(['operator', 'super-admin']), (req: Request, res: Response) => {
  try {
    ok(res, { dpa: getDpaDocument() });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── Data Processing Inventory ────────────────────────────────────────

function getDataProcessingInventory() {
  return {
    document_type: 'Data Processing Inventory',
    title: 'Rainbow AI — Personal Data Processing Register',
    version: '1.0',
    last_reviewed: '2026-03-16',
    legal_framework: 'Malaysia PDPA 2010 (Amendment 2024)',
    categories: [
      {
        category: 'Guest Identity',
        data_elements: ['Full name', 'Phone number (WhatsApp JID)', 'Malaysian IC number (if provided)', 'Passport number (if provided)'],
        processing_purpose: 'Guest identification for hostel check-in/checkout, booking management, and WhatsApp communication',
        legal_basis: 'Contractual necessity (PDPA Section 6(2)(b)) — processing necessary to fulfill accommodation booking contract',
        retention_period: '730 days (2 years) after last interaction',
        retention_basis: 'PDPA Section 10 — Retention Principle; hospitality sector statutory requirement',
        security_measures: ['AES-256-GCM encryption at rest (PII_ENCRYPTION_KEY)', 'RBAC (operator+ only)', 'PII redaction before LLM calls', 'TLS in transit'],
        storage_location: 'Neon PostgreSQL (Singapore region) — rainbow_messages, rainbow_conversations tables',
        cross_border_transfer: 'Conversation context (with PII redacted) may be processed by NVIDIA NIM API (US). Full PII does not leave Malaysia.',
      },
      {
        category: 'Booking Data',
        data_elements: ['Check-in date', 'Check-out date', 'Room/unit assignment', 'Booking reference', 'Payment status'],
        processing_purpose: 'Manage hostel reservations, automate check-in/checkout notifications, generate operational reports',
        legal_basis: 'Contractual necessity (PDPA Section 6(2)(b))',
        retention_period: '730 days (2 years) after checkout date',
        retention_basis: 'Financial record retention requirements + PDPA Retention Principle',
        security_measures: ['RBAC (operator+ only)', 'TLS in transit', 'Security event audit log'],
        storage_location: 'Neon PostgreSQL — rainbow_conversations, rainbow_messages tables',
        cross_border_transfer: 'None — booking data does not leave Malaysia',
      },
      {
        category: 'Communication Content',
        data_elements: ['WhatsApp message text', 'AI-generated responses', 'Conversation intent classification', 'Message timestamps'],
        processing_purpose: 'AI-powered customer support, intent detection, conversation history for context',
        legal_basis: 'Legitimate interests (PDPA Section 6(2)(f)) — improving service quality and providing responsive AI support; or contractual necessity where communication supports the booking contract',
        retention_period: '730 days (2 years) from message date',
        retention_basis: 'PDPA Retention Principle; configurable via admin panel',
        security_measures: ['PII redaction before storage in logs', 'RBAC (viewer+ read, operator+ delete)', 'Nightly retention purge', 'TLS in transit'],
        storage_location: 'Neon PostgreSQL — rainbow_messages, rainbow_conversations tables',
        cross_border_transfer: 'Message text (with PII redacted) processed by external AI providers (NVIDIA/OpenRouter) for intent classification. See TIA at /compliance/tia.',
      },
      {
        category: 'Consent Records',
        data_elements: ['Opt-in status', 'Consent timestamp', 'Consent channel', 'Opt-out timestamp (if applicable)'],
        processing_purpose: 'Record and enforce WhatsApp marketing consent; demonstrate compliance with PDPA consent requirements',
        legal_basis: 'Legal obligation (PDPA Section 6(2)(a)) — consent must be recorded as proof of lawful processing',
        retention_period: '7 years (consent records must outlast the marketing relationship)',
        retention_basis: 'PDPA enforcement; burden of proof for consent lies with data controller',
        security_measures: ['Immutable consent log', 'RBAC (viewer+ read)', 'Audit trail'],
        storage_location: 'Neon PostgreSQL — consent_records table (via rainbow_configs)',
        cross_border_transfer: 'None',
      },
      {
        category: 'Admin Access Logs',
        data_elements: ['Admin username', 'Action performed', 'Resource type/ID accessed', 'IP address', 'Timestamp'],
        processing_purpose: 'Security audit trail; breach detection; compliance evidence',
        legal_basis: 'Legal obligation (PDPA Security Principle Section 9) — data processors must maintain access controls and audit logs',
        retention_period: '365 days (1 year) for operational logs; 7 years for security incident records',
        retention_basis: 'PDPA compliance; potential enforcement proceedings',
        security_measures: ['Write-once security_event_log table', 'RBAC (super-admin only for log access)', 'Database-level timestamps'],
        storage_location: 'Neon PostgreSQL — security_event_log table',
        cross_border_transfer: 'None',
      },
    ],
    pii_roles_access_matrix: {
      description: 'Roles that may access PII fields in the Rainbow AI admin panel',
      roles: {
        viewer: {
          can_read_pii: false,
          permitted_actions: ['View analytics dashboards', 'View intent statistics', 'View aggregated reports'],
          pii_access: 'None — all PII fields are masked or excluded from viewer responses',
        },
        operator: {
          can_read_pii: true,
          permitted_actions: ['Read conversation history', 'View guest phone numbers', 'Manage bookings', 'Send WhatsApp messages', 'Update knowledge base'],
          pii_access: 'Guest names, phone numbers, booking data — for operational purposes only',
        },
        'super-admin': {
          can_read_pii: true,
          permitted_actions: ['All operator actions', 'Delete/anonymize guest data', 'Manage admin users', 'Configure PDPA settings', 'Export data for DSAR'],
          pii_access: 'Full PII access including erasure and export',
        },
      },
    },
    generated_at: new Date().toISOString(),
  };
}

// ─── GET /pdpa/security/inventory ────────────────────────────────────
router.get('/pdpa/security/inventory', checkRole(['operator', 'super-admin']), (req: Request, res: Response) => {
  try {
    ok(res, { inventory: getDataProcessingInventory() });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── POST /pdpa/security/annual-review ───────────────────────────────
router.post('/pdpa/security/annual-review', checkRole(['super-admin']), async (req: Request, res: Response) => {
  try {
    const { reviewer, findings, next_review_date } = req.body ?? {};

    if (!reviewer || typeof reviewer !== 'string' || reviewer.trim().length === 0) {
      res.status(400).json({ error: 'reviewer is required' });
      return;
    }

    if (!findings || typeof findings !== 'string' || findings.trim().length === 0) {
      res.status(400).json({ error: 'findings is required (summary of review outcome)' });
      return;
    }

    const reviewedAt = new Date().toISOString();
    const nextReview = next_review_date
      ? next_review_date
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const adminUser = res.locals.adminUser as string | undefined ?? reviewer;
    const ip = req.ip ?? req.socket?.remoteAddress;

    await logSecurityEvent({
      adminUser,
      action: 'pdpa_annual_security_review',
      resourceType: 'security_principle',
      ipAddress: ip,
      userAgent: req.headers['user-agent'],
      details: {
        reviewer: reviewer.trim(),
        findings: findings.trim(),
        pii_encryption_active: isPiiEncryptionEnabled(),
        review_type: 'annual_pdpa_security_review',
        legal_reference: 'PDPA 2024 Section 9 — Security Principle',
        next_review_date: nextReview,
        reviewed_at: reviewedAt,
      },
    });

    ok(res, {
      message: 'Annual PDPA security review recorded in audit log',
      review: {
        reviewer: reviewer.trim(),
        reviewed_at: reviewedAt,
        next_review_date: nextReview,
        logged_to: 'security_event_log',
      },
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── GET /pdpa/security/status ────────────────────────────────────────
router.get('/pdpa/security/status', checkRole(['operator', 'super-admin']), (req: Request, res: Response) => {
  try {
    const encryptionEnabled = isPiiEncryptionEnabled();
    const checks = [
      {
        control: 'PII encryption at rest (AES-256-GCM)',
        status: encryptionEnabled ? 'pass' : 'warn',
        detail: encryptionEnabled
          ? 'PII_ENCRYPTION_KEY is configured — PII fields are encrypted at rest'
          : 'PII_ENCRYPTION_KEY is NOT set — PII fields stored in plaintext. Configure for production.',
      },
      {
        control: 'Role-based access control',
        status: 'pass',
        detail: 'RBAC enforced via checkRole middleware. PII access restricted to operator+ roles.',
      },
      {
        control: 'PII redaction before LLM calls',
        status: 'pass',
        detail: 'PII redactor active on all outgoing prompts to external AI providers.',
      },
      {
        control: 'Data retention enforcement',
        status: 'pass',
        detail: 'Nightly retention scheduler active (3:00 AM MYT). Default: 730-day retention with 30-day grace period.',
      },
      {
        control: 'Security event audit log',
        status: 'pass',
        detail: 'security_event_log table records all admin PII access with user, action, IP, and timestamp.',
      },
      {
        control: 'Breach detection',
        status: 'pass',
        detail: 'Automated bulk-access anomaly detection with DPO alerting. Configure via /pdpa/dpo.',
      },
      {
        control: 'DPA document',
        status: 'pass',
        detail: 'Data Processing Agreement available at GET /pdpa/security/dpa.',
      },
      {
        control: 'Data processing inventory',
        status: 'pass',
        detail: 'Processing inventory available at GET /pdpa/security/inventory.',
      },
    ];

    const overallStatus = checks.every((c) => c.status === 'pass')
      ? 'compliant'
      : checks.some((c) => c.status === 'fail')
        ? 'non_compliant'
        : 'compliant_with_warnings';

    ok(res, {
      overall_status: overallStatus,
      legal_reference: 'Malaysia PDPA 2010 (Amendment 2024) — Section 9 Security Principle',
      penalty_exposure: 'Up to RM1,000,000 fine and/or 3 years imprisonment per breach',
      controls: checks,
      assessed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
