/**
 * Admin API: PDPA Compliance (US-915)
 *
 * GET /compliance/tia              — Transfer Impact Assessment status per provider
 * GET /compliance/data-flows       — AI provider data flow summary
 * GET /compliance/security-events  — Security event audit log
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getProviders } from '../../assistant/ai-provider-manager.js';
import { getDataFlowSummary } from '../../lib/ai-data-flow-log.js';
import { getSecurityEvents, logSecurityEvent } from '../../lib/security-event-log.js';

const router = Router();

// ─── Transfer Impact Assessment Data ────────────────────────────────

interface TIARecord {
  providerId: string;
  providerName: string;
  providerType: string;
  model: string;
  processingCountry: string;
  adequacyStatus: 'adequate' | 'conditional' | 'requires_assessment';
  dataCategories: string[];
  safeguards: string[];
  assessmentDate: string;
  assessmentNotes: string;
}

/** Static TIA records for known providers (generated per PDPA 2024 cross-border requirements) */
function getTransferImpactAssessments(): TIARecord[] {
  const providers = getProviders();
  const tiaRecords: TIARecord[] = [];

  for (const p of providers) {
    const baseUrl = p.base_url ?? '';
    let country = 'unknown';
    let adequacy: TIARecord['adequacyStatus'] = 'requires_assessment';
    let safeguards: string[] = [];
    let notes = '';

    if (p.type === 'ollama' || baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
      country = 'MY';
      adequacy = 'adequate';
      safeguards = ['Local processing — no cross-border transfer'];
      notes = 'Data processed locally on-premises. No Transfer Impact Assessment required under PDPA 2024.';
    } else if (baseUrl.includes('integrate.api.nvidia.com')) {
      country = 'US';
      adequacy = 'conditional';
      safeguards = [
        'PII masked before API call (phone, IC, email, passport, bank account redacted)',
        'NVIDIA DPA/Terms of Service reviewed',
        'Data not stored by NVIDIA for model training (API inference only)',
        'TLS 1.2+ encryption in transit',
        'Prompt content excluded from NVIDIA logs (per API ToS)',
      ];
      notes = 'NVIDIA NIM API processes inference requests in US data centers. PII is masked client-side before transmission. NVIDIA does not retain prompt data for training. Assessment: conditionally adequate with PII masking safeguards.';
    } else if (baseUrl.includes('openrouter.ai')) {
      country = 'US';
      adequacy = 'conditional';
      safeguards = [
        'PII masked before API call (phone, IC, email, passport, bank account redacted)',
        'OpenRouter privacy policy reviewed — no training on user data',
        'Downstream model provider varies (data may traverse multiple jurisdictions)',
        'TLS 1.2+ encryption in transit',
        'Request logs retained for 30 days (OpenRouter policy)',
      ];
      notes = 'OpenRouter routes to various model providers (Anthropic, Meta, Google). PII is masked client-side. OpenRouter does not train on user data. Assessment: conditionally adequate with PII masking; downstream provider data flow documented.';
    } else if (baseUrl.includes('api.groq.com')) {
      country = 'US';
      adequacy = 'conditional';
      safeguards = [
        'PII masked before API call',
        'Groq does not use API data for model training',
        'TLS 1.2+ encryption in transit',
      ];
      notes = 'Groq Cloud API processes inference in US data centers. PII masked client-side. Assessment: conditionally adequate.';
    } else if (baseUrl.includes('generativelanguage.googleapis.com')) {
      country = 'US';
      adequacy = 'conditional';
      safeguards = [
        'PII masked before API call',
        'Google Cloud DPA available',
        'TLS 1.2+ encryption in transit',
      ];
      notes = 'Google Gemini API. PII masked client-side. Assessment: conditionally adequate with Google Cloud DPA.';
    }

    tiaRecords.push({
      providerId: p.id,
      providerName: p.name,
      providerType: p.type,
      model: p.model,
      processingCountry: country,
      adequacyStatus: adequacy,
      dataCategories: ['conversation_context', 'guest_identity', 'booking_data'],
      safeguards,
      assessmentDate: '2026-03-15',
      assessmentNotes: notes,
    });
  }

  return tiaRecords;
}

// ─── Routes ─────────────────────────────────────────────────────────

// GET /compliance/tia — Transfer Impact Assessment status
router.get('/compliance/tia', async (req: Request, res: Response) => {
  // Log admin access to compliance data
  logSecurityEvent({
    adminUser: (req as any).user?.username || 'unknown',
    action: 'view',
    resourceType: 'transfer_impact_assessment',
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    profileId: res.locals.tenantId,
  }).catch(() => {});

  const assessments = getTransferImpactAssessments();

  res.json({
    pdpa_version: 'PDPA 2024 Amendment',
    assessment_date: '2026-03-15',
    data_controller: 'Pelangi Capsule Hostel Sdn Bhd',
    dpo_email: 'dpo@pelangicapsule.com',
    providers: assessments,
    summary: {
      total_providers: assessments.length,
      local_providers: assessments.filter(a => a.processingCountry === 'MY').length,
      cross_border_providers: assessments.filter(a => a.processingCountry !== 'MY').length,
      adequate: assessments.filter(a => a.adequacyStatus === 'adequate').length,
      conditional: assessments.filter(a => a.adequacyStatus === 'conditional').length,
      requires_assessment: assessments.filter(a => a.adequacyStatus === 'requires_assessment').length,
    },
  });
});

// GET /compliance/data-flows — AI data flow summary
router.get('/compliance/data-flows', async (req: Request, res: Response) => {
  logSecurityEvent({
    adminUser: (req as any).user?.username || 'unknown',
    action: 'view',
    resourceType: 'ai_data_flow_log',
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    profileId: res.locals.tenantId,
  }).catch(() => {});

  const days = Math.min(parseInt(req.query.days as string) || 30, 90);
  const flows = await getDataFlowSummary(days);

  res.json({ period_days: days, flows });
});

// GET /compliance/security-events — Security event audit log
router.get('/compliance/security-events', async (req: Request, res: Response) => {
  logSecurityEvent({
    adminUser: (req as any).user?.username || 'unknown',
    action: 'view',
    resourceType: 'security_event_log',
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    profileId: res.locals.tenantId,
  }).catch(() => {});

  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const events = await getSecurityEvents(limit, offset, {
    adminUser: req.query.admin_user as string,
    action: req.query.action as string,
    resourceType: req.query.resource_type as string,
  });

  res.json({ events, limit, offset });
});

export default router;
