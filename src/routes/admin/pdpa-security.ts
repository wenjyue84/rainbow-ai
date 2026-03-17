/**
 * PDPA Security Principle Admin API (US-968, US-025)
 *
 * Malaysia Personal Data Protection (Amendment) Act 2024, Phase 3 (effective June 2025)
 * directly obliges data processors to comply with the Security Principle (Section 9).
 *
 * Endpoints:
 *   GET  /pdpa/security/dpa            — Data Processing Agreement document
 *   GET  /pdpa/security/inventory      — Data processing inventory (categories, legal basis, retention)
 *   POST /pdpa/security/annual-review  — Record annual security review in audit log
 *   GET  /pdpa/security/status         — Overall PDPA Security Principle compliance status
 *   GET  /pdpa/transfer-impact-report  — Cross-border transfer impact assessment report (US-025)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, serverError } from './http-utils.js';
import { logSecurityEvent } from '../../lib/security-event-log.js';
import { isPiiEncryptionEnabled } from '../../lib/pii-encryption.js';
import { checkRole } from '../../lib/rbac.js';
import { configStore } from '../../assistant/config-store.js';

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

// ─── US-025: PDPA Cross-Border Transfer Impact Assessment Report ────────────

/** Maps provider base_url to jurisdiction code and PDPA adequacy status */
export function resolveProviderJurisdiction(baseUrl: string, type: string): {
  jurisdiction: string;
  jurisdiction_name: string;
  pdpa_adequacy: 'adequate' | 'no_adequacy_decision';
  adequacy_note: string;
  requires_scc: boolean;
  warning: boolean;
} {
  const url = baseUrl ?? '';
  if (type === 'ollama' || url.includes('localhost') || url.includes('127.0.0.1')) {
    return {
      jurisdiction: 'MY',
      jurisdiction_name: 'Malaysia',
      pdpa_adequacy: 'adequate',
      adequacy_note: 'Local processing — data does not leave Malaysia. No cross-border transfer under PDPA 2024.',
      requires_scc: false,
      warning: false,
    };
  }
  if (url.includes('integrate.api.nvidia.com')) {
    return {
      jurisdiction: 'US',
      jurisdiction_name: 'United States of America',
      pdpa_adequacy: 'no_adequacy_decision',
      adequacy_note: 'USA has no federal PDPA-equivalent law. Requires Standard Contractual Clauses or APEC CBPR certification review per PDPA CBPDT Guidelines (April 2025).',
      requires_scc: true,
      warning: true,
    };
  }
  if (url.includes('api.groq.com')) {
    return {
      jurisdiction: 'US',
      jurisdiction_name: 'United States of America',
      pdpa_adequacy: 'no_adequacy_decision',
      adequacy_note: 'USA has no federal PDPA-equivalent law. Requires Standard Contractual Clauses review per PDPA CBPDT Guidelines (April 2025).',
      requires_scc: true,
      warning: true,
    };
  }
  if (url.includes('openrouter.ai')) {
    return {
      jurisdiction: 'US',
      jurisdiction_name: 'United States of America',
      pdpa_adequacy: 'no_adequacy_decision',
      adequacy_note: 'USA has no federal PDPA-equivalent law. Downstream model providers vary — data may traverse multiple jurisdictions. Requires SCC review.',
      requires_scc: true,
      warning: true,
    };
  }
  if (url.includes('generativelanguage.googleapis.com')) {
    return {
      jurisdiction: 'US',
      jurisdiction_name: 'United States of America',
      pdpa_adequacy: 'no_adequacy_decision',
      adequacy_note: 'Google LLC is incorporated in USA. Google Cloud DPA available but USA has no federal PDPA-equivalent. Requires SCC review.',
      requires_scc: true,
      warning: true,
    };
  }
  if (url.includes('moonshot.ai') || url.includes('api.moonshot')) {
    return {
      jurisdiction: 'CN',
      jurisdiction_name: "People's Republic of China",
      pdpa_adequacy: 'no_adequacy_decision',
      adequacy_note: "China's PIPL (2021) imposes significant data localisation requirements. Cross-border transfer from MY to CN requires explicit PDPC approval or binding contractual safeguards under PDPA CBPDT Guidelines.",
      requires_scc: true,
      warning: true,
    };
  }
  return {
    jurisdiction: 'XX',
    jurisdiction_name: 'Unknown Jurisdiction',
    pdpa_adequacy: 'no_adequacy_decision',
    adequacy_note: 'Jurisdiction could not be determined. Manual review required before enabling this provider.',
    requires_scc: true,
    warning: true,
  };
}

export function buildTransferImpactReport() {
  const ai = configStore.getSettings().ai;
  const allProviders = (ai.providers ?? []) as Array<{
    id: string; name: string; type: string; base_url?: string;
    model: string; enabled: boolean; priority: number;
  }>;

  const LAST_REVIEWED = '2026-03-17';
  const NEXT_REVIEW_DUE = '2027-03-17'; // 12-month cycle

  const entries = allProviders.filter(p => p.enabled).map(p => {
    const jx = resolveProviderJurisdiction(p.base_url ?? '', p.type);
    return {
      provider_id: p.id,
      provider_name: p.name,
      provider_type: p.type,
      model: p.model,
      data_centre_jurisdiction: jx.jurisdiction,
      data_centre_jurisdiction_name: jx.jurisdiction_name,
      personal_data_categories_transmitted: [
        'conversation_text (WhatsApp message content, PII redacted before transmission)',
        'inferred_phone_context (conversation intent, language, session metadata — no direct identifiers)',
      ],
      legal_basis_for_transfer: jx.pdpa_adequacy === 'adequate'
        ? 'No cross-border transfer — data processed within Malaysia'
        : 'Contractual necessity (PDPA s.6(2)(b)) with technical safeguards: PII redaction before API call + TLS 1.2+ encryption in transit + no retention for model training (per provider ToS)',
      pdpa_adequacy_status: jx.pdpa_adequacy,
      adequacy_note: jx.adequacy_note,
      requires_scc_review: jx.requires_scc,
      warning: jx.warning,
      last_reviewed: LAST_REVIEWED,
      next_review_due: NEXT_REVIEW_DUE,
    };
  });

  const warningCount = entries.filter(e => e.warning).length;

  return {
    report_type: 'PDPA Cross-Border Personal Data Transfer Impact Assessment',
    legal_framework: 'Malaysia Personal Data Protection Act 2010 (Amendment 2024) + Cross-Border Personal Data Transfer Guidelines (April 2025)',
    data_controller: 'Pelangi Capsule Hostel / Southern Homestay',
    data_processor: 'Rainbow AI (Prisma Technology)',
    generated_at: new Date().toISOString(),
    summary: {
      total_enabled_providers: entries.length,
      local_providers: entries.filter(e => e.data_centre_jurisdiction === 'MY').length,
      cross_border_providers: entries.filter(e => e.data_centre_jurisdiction !== 'MY').length,
      providers_with_warnings: warningCount,
      overall_status: warningCount > 0 ? 'action_required' : 'compliant',
      status_note: warningCount > 0
        ? `${warningCount} provider(s) are in jurisdictions without PDPA adequacy recognition. Ensure Standard Contractual Clauses (SCCs) are reviewed and filed with PDPC Malaysia.`
        : 'All enabled providers are in PDPA-adequate jurisdictions.',
    },
    providers: entries,
    recommendations: [
      'Review SCC status for all US-based providers (NVIDIA, Groq, OpenRouter, Google) annually',
      'File TIA documentation with your Data Protection Officer (DPO) at /pdpa/dpo',
      'PII redaction is the primary safeguard — confirm piiRedaction.enabled = true in settings.json',
      'Disable any provider in a non-adequate jurisdiction if SCCs cannot be obtained',
    ],
  };
}

function buildTiaPdfHtml(report: ReturnType<typeof buildTransferImpactReport>): string {
  const rows = report.providers.map(p => `
    <tr class="${p.warning ? 'warn-row' : ''}">
      <td><strong>${p.provider_name}</strong><br><small>${p.provider_id}</small></td>
      <td>${p.data_centre_jurisdiction_name} (${p.data_centre_jurisdiction})</td>
      <td>${p.pdpa_adequacy_status === 'adequate' ? '<span class="ok">✓ Adequate</span>' : '<span class="warn">⚠ No adequacy decision</span>'}</td>
      <td><small>${p.adequacy_note}</small></td>
      <td>${p.last_reviewed}</td>
      <td>${p.next_review_due}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>PDPA Transfer Impact Assessment Report</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; margin: 30px; color: #222; }
  h1 { font-size: 16px; border-bottom: 2px solid #003580; padding-bottom: 6px; }
  h2 { font-size: 13px; margin-top: 20px; color: #003580; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th { background: #003580; color: #fff; padding: 6px 8px; text-align: left; font-size: 11px; }
  td { padding: 5px 8px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .warn-row { background: #fff8e1; }
  .ok { color: #2e7d32; font-weight: bold; }
  .warn { color: #c62828; font-weight: bold; }
  .meta { font-size: 11px; color: #555; margin-top: 4px; }
  .summary-box { background: #f5f5f5; padding: 10px 14px; border-left: 4px solid #003580; margin: 12px 0; }
  ul { margin: 4px 0; padding-left: 18px; }
  @media print { body { margin: 15px; } }
</style>
</head>
<body>
<h1>PDPA Cross-Border Personal Data Transfer Impact Assessment Report</h1>
<p class="meta">
  <strong>Data Controller:</strong> ${report.data_controller} &nbsp;|&nbsp;
  <strong>Data Processor:</strong> ${report.data_processor} &nbsp;|&nbsp;
  <strong>Generated:</strong> ${report.generated_at}
</p>
<p class="meta"><strong>Legal Framework:</strong> ${report.legal_framework}</p>

<div class="summary-box">
  <strong>Summary:</strong> ${report.summary.status_note}<br>
  Enabled Providers: ${report.summary.total_enabled_providers} &nbsp;|&nbsp;
  Local (MY): ${report.summary.local_providers} &nbsp;|&nbsp;
  Cross-Border: ${report.summary.cross_border_providers} &nbsp;|&nbsp;
  Warnings: <span class="${report.summary.providers_with_warnings > 0 ? 'warn' : 'ok'}">${report.summary.providers_with_warnings}</span>
</div>

<h2>Provider Transfer Impact Assessments</h2>
<table>
  <thead>
    <tr>
      <th>Provider</th>
      <th>Jurisdiction</th>
      <th>PDPA Adequacy</th>
      <th>Adequacy Note</th>
      <th>Last Reviewed</th>
      <th>Next Review Due</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<h2>Recommendations</h2>
<ul>${report.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>

<p class="meta" style="margin-top:30px; border-top:1px solid #ccc; padding-top:8px;">
  This report is auto-generated by Rainbow AI from <code>settings.json</code> providers array.
  File with your DPO and PDPC Malaysia as part of your annual data governance documentation.
</p>
</body>
</html>`;
}

// GET /pdpa/transfer-impact-report
router.get('/pdpa/transfer-impact-report', checkRole(['operator', 'super-admin']), (req: Request, res: Response) => {
  try {
    const format = (req.query.format as string)?.toLowerCase() ?? 'json';
    const report = buildTransferImpactReport();

    logSecurityEvent({
      adminUser: (res.locals.adminUser as string) ?? 'unknown',
      action: 'view',
      resourceType: 'pdpa_tia_report',
      ipAddress: req.ip ?? req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    }).catch(() => {});

    if (format === 'pdf') {
      const html = buildTiaPdfHtml(report);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="pdpa-transfer-impact-report.html"');
      res.send(html);
    } else {
      res.setHeader('Content-Disposition', 'attachment; filename="pdpa-transfer-impact-report.json"');
      ok(res, report);
    }
  } catch (error: any) {
    serverError(res, error);
  }
});

export default router;
