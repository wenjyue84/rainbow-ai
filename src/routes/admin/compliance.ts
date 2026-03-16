/**
 * Admin API: PDPA Compliance (US-915, US-1009, US-1010)
 *
 * GET /compliance/dpia                     — Get DPIA for a profile
 * POST /compliance/dpia                    — Create/update DPIA
 * GET /compliance/dpia-status-widget       — DPIA status widget for admin dashboard
 * GET /compliance/tia                      — Transfer Impact Assessment status per provider
 * GET /compliance/tia-records              — Get TIA records from database
 * POST /compliance/tia-records             — Create/update TIA in database
 * GET /compliance/data-flows               — AI provider data flow summary
 * GET /compliance/security-events          — Security event audit log
 * GET /compliance/ai-decision-disclosure   — Get AI decision disclosure template (US-1010)
 * PUT /compliance/ai-decision-disclosure   — Update AI decision disclosure template (US-1010)
 * GET /compliance/ai-decision-audit        — Get AI decision audit log (US-1010)
 * GET /compliance/ai-decision-stats        — Get AI decision stats widget (US-1010)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getProviders } from '../../assistant/ai-provider-manager.js';
import { getDataFlowSummary } from '../../lib/ai-data-flow-log.js';
import { getSecurityEvents, logSecurityEvent } from '../../lib/security-event-log.js';
import { db } from '../../lib/db.js';
import { dpiaRecords, tiaRecords } from '../../../shared/schema-tables.js';
import { eq } from 'drizzle-orm';
import {
  getDisclosureTemplate,
  saveDisclosureTemplate,
  getAiDecisionAuditLog,
  getAiDecisionStats,
  DEFAULT_DISCLOSURE_TEMPLATE,
  MATERIAL_DECISION_TYPES,
} from '../../lib/ai-decision-disclosure.js';

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

// ─── DPIA Routes ────────────────────────────────────────────────────────

// GET /compliance/dpia — Get DPIA for a profile (US-1009)
router.get('/compliance/dpia', async (req: Request, res: Response) => {
  const profileId = res.locals.tenantId || 'pelangi';

  try {
    const dpia = await db.select().from(dpiaRecords).where(eq(dpiaRecords.profileId, profileId));

    if (dpia.length === 0) {
      return res.status(404).json({ error: 'DPIA not found for this profile' });
    }

    logSecurityEvent({
      adminUser: (req as any).user?.username || 'unknown',
      action: 'view',
      resourceType: 'dpia_record',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      profileId,
    }).catch(() => {});

    res.json(dpia[0]);
  } catch (error) {
    console.error('Error fetching DPIA:', error);
    res.status(500).json({ error: 'Failed to fetch DPIA' });
  }
});

// POST /compliance/dpia — Create or update DPIA (US-1009)
router.post('/compliance/dpia', async (req: Request, res: Response) => {
  const profileId = res.locals.tenantId || 'pelangi';
  const { title, documentJson, processingScope, riskSummary, mitigations, reviewedBy } = req.body;

  if (!title || !documentJson || !processingScope || !riskSummary || !mitigations) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if DPIA already exists
    const existing = await db.select().from(dpiaRecords).where(eq(dpiaRecords.profileId, profileId));

    const nextReviewDue = new Date();
    nextReviewDue.setFullYear(nextReviewDue.getFullYear() + 3); // 3-year review cycle per CBPDT

    if (existing.length > 0) {
      // Update existing
      await db.update(dpiaRecords)
        .set({
          title,
          documentJson: typeof documentJson === 'string' ? documentJson : JSON.stringify(documentJson),
          processingScope,
          riskSummary,
          mitigations,
          lastReviewedAt: new Date(),
          nextReviewDue,
          reviewedBy: reviewedBy || (req as any).user?.username || 'unknown',
          updatedAt: new Date(),
        })
        .where(eq(dpiaRecords.profileId, profileId));
    } else {
      // Create new
      await db.insert(dpiaRecords).values({
        profileId,
        title,
        documentJson: typeof documentJson === 'string' ? documentJson : JSON.stringify(documentJson),
        processingScope,
        riskSummary,
        mitigations,
        lastReviewedAt: new Date(),
        nextReviewDue,
        reviewedBy: reviewedBy || (req as any).user?.username || 'unknown',
      });
    }

    logSecurityEvent({
      adminUser: (req as any).user?.username || 'unknown',
      action: 'update',
      resourceType: 'dpia_record',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      profileId,
    }).catch(() => {});

    res.json({ success: true, profileId });
  } catch (error) {
    console.error('Error saving DPIA:', error);
    res.status(500).json({ error: 'Failed to save DPIA' });
  }
});

// GET /compliance/dpia-status-widget — DPIA status for admin dashboard widget (US-1009)
router.get('/compliance/dpia-status-widget', async (req: Request, res: Response) => {
  const profileId = res.locals.tenantId || 'pelangi';

  try {
    const dpia = await db.select().from(dpiaRecords).where(eq(dpiaRecords.profileId, profileId));

    if (dpia.length === 0) {
      return res.json({
        status: 'not_started',
        profileId,
        message: 'DPIA not yet created for this profile',
      });
    }

    const record = dpia[0];
    const now = new Date();
    const isOverdue = record.nextReviewDue < now;

    res.json({
      status: isOverdue ? 'overdue' : 'active',
      profileId,
      lastReviewedAt: record.lastReviewedAt,
      nextReviewDue: record.nextReviewDue,
      reviewedBy: record.reviewedBy,
      daysUntilReview: Math.ceil((record.nextReviewDue.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    });
  } catch (error) {
    console.error('Error fetching DPIA status:', error);
    res.status(500).json({ error: 'Failed to fetch DPIA status' });
  }
});

// ─── Routes ─────────────────────────────────────────────────────────

// GET /compliance/tia-records — Get TIA records from database (US-1009)
router.get('/compliance/tia-records', async (req: Request, res: Response) => {
  const profileId = res.locals.tenantId || 'pelangi';

  try {
    const records = await db.select().from(tiaRecords).where(eq(tiaRecords.profileId, profileId));

    logSecurityEvent({
      adminUser: (req as any).user?.username || 'unknown',
      action: 'view',
      resourceType: 'tia_record',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      profileId,
    }).catch(() => {});

    res.json({ profileId, records });
  } catch (error) {
    console.error('Error fetching TIA records:', error);
    res.status(500).json({ error: 'Failed to fetch TIA records' });
  }
});

// POST /compliance/tia-records — Create/update TIA (US-1009)
router.post('/compliance/tia-records', async (req: Request, res: Response) => {
  const profileId = res.locals.tenantId || 'pelangi';
  const {
    aiProvider,
    destinationJurisdiction,
    equivalenceLevel,
    apiEndpoint,
    transferMechanism,
    documentJson,
    dataTransferred,
    riskAssessment,
    controls,
    reviewedBy,
  } = req.body;

  if (!aiProvider || !destinationJurisdiction || !equivalenceLevel || !apiEndpoint) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Check if TIA already exists for this provider
    const existing = await db.select()
      .from(tiaRecords)
      .where(
        (row: any) => row.profileId === profileId && row.aiProvider === aiProvider,
      );

    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 3); // 3-year validity per CBPDT

    if (existing.length > 0) {
      // Update existing
      await db.update(tiaRecords)
        .set({
          destinationJurisdiction,
          equivalenceLevel,
          apiEndpoint,
          transferMechanism,
          documentJson: typeof documentJson === 'string' ? documentJson : JSON.stringify(documentJson),
          dataTransferred,
          riskAssessment,
          controls,
          lastReviewedAt: new Date(),
          validUntil,
          reviewedBy: reviewedBy || (req as any).user?.username || 'unknown',
          updatedAt: new Date(),
        })
        .where((row: any) => row.profileId === profileId && row.aiProvider === aiProvider);
    } else {
      // Create new
      await db.insert(tiaRecords).values({
        profileId,
        aiProvider,
        destinationJurisdiction,
        equivalenceLevel,
        apiEndpoint,
        transferMechanism,
        documentJson: typeof documentJson === 'string' ? documentJson : JSON.stringify(documentJson),
        dataTransferred,
        riskAssessment,
        controls,
        lastReviewedAt: new Date(),
        validUntil,
        reviewedBy: reviewedBy || (req as any).user?.username || 'unknown',
      });
    }

    logSecurityEvent({
      adminUser: (req as any).user?.username || 'unknown',
      action: 'update',
      resourceType: 'tia_record',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      profileId,
    }).catch(() => {});

    res.json({ success: true, profileId, aiProvider });
  } catch (error) {
    console.error('Error saving TIA:', error);
    res.status(500).json({ error: 'Failed to save TIA' });
  }
});

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

// ─── US-1010: AI Decision Disclosure (PDPA 2025 PCP 3/2025) ─────────────────

// GET /compliance/ai-decision-disclosure — Retrieve disclosure template for a profile
router.get('/compliance/ai-decision-disclosure', async (req: Request, res: Response) => {
  const profileId = (res.locals.tenantId as string) || 'pelangi';
  const template = await getDisclosureTemplate(profileId);
  res.json({
    profileId,
    template,
    defaultTemplate: DEFAULT_DISCLOSURE_TEMPLATE,
    materialDecisionTypes: [...MATERIAL_DECISION_TYPES],
    description: 'PDPA 2025 PCP 3/2025 — Disclosure message shown to guests when Rainbow AI makes a material automated decision.',
  });
});

// PUT /compliance/ai-decision-disclosure — Update disclosure template for a profile
router.put('/compliance/ai-decision-disclosure', async (req: Request, res: Response) => {
  const profileId = (res.locals.tenantId as string) || 'pelangi';
  const { template } = req.body as { template?: string };

  if (!template || typeof template !== 'string' || template.trim().length === 0) {
    res.status(400).json({ error: 'template is required and must be a non-empty string' });
    return;
  }
  if (template.length > 1000) {
    res.status(400).json({ error: 'template must not exceed 1000 characters' });
    return;
  }

  await saveDisclosureTemplate(profileId, template.trim());

  logSecurityEvent({
    adminUser: (req as any).user?.username || 'unknown',
    action: 'update',
    resourceType: 'ai_disclosure_template',
    resourceId: profileId,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    profileId,
    details: { templateLength: template.length },
  }).catch(() => {});

  res.json({ ok: true, profileId, template: template.trim() });
});

// GET /compliance/ai-decision-audit — AI decision audit log
router.get('/compliance/ai-decision-audit', async (req: Request, res: Response) => {
  const profileId = (res.locals.tenantId as string) || undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const humanReviewOnly = req.query.human_review === 'true';
  const decisionType = req.query.decision_type as string | undefined;
  const phone = req.query.phone as string | undefined;

  const records = await getAiDecisionAuditLog({
    profileId,
    phone,
    decisionType,
    humanReviewOnly,
    limit,
    offset,
  });

  res.json({ records, limit, offset, total: records.length });
});

// GET /compliance/ai-decision-stats — AI decision audit stats widget
router.get('/compliance/ai-decision-stats', async (req: Request, res: Response) => {
  const profileId = (res.locals.tenantId as string) || 'pelangi';
  const stats = await getAiDecisionStats(profileId);
  res.json({ profileId, ...stats });
});

// ─── US-1026: Business Scope Compliance Mode ─────────────────────────────────

// GET /compliance/business-scope — Get business scope policy status
router.get('/compliance/business-scope', async (req: Request, res: Response) => {
  const profileId = (res.locals.tenantId as string) || 'pelangi';

  // Load profile config to get current settings
  const { profileRegistry } = await import('../../assistant/profile-registry.js');
  const profile = profileRegistry.isInitialized()
    ? profileRegistry.getProfile(profileId)
    : null;
  const settings = profile?.configStore?.getSettings() ?? {};
  const scopePolicy = (settings as any).business_scope_policy ?? { enabled: true };

  // Query off-scope rejection count from intent_predictions
  const { sql: sqlTag } = await import('drizzle-orm');
  const offScopeCount = await db.execute(
    sqlTag`SELECT COUNT(*) as count FROM intent_predictions WHERE predicted_intent = 'off_scope' AND created_at > NOW() - INTERVAL '30 days'`
  );

  res.json({
    profileId,
    complianceMode: scopePolicy.enabled !== false,
    allowedIntents: scopePolicy.allowedIntents ?? [],
    offScopeBlocksLast30Days: Number((offScopeCount as any).rows?.[0]?.count ?? 0),
    description: 'Meta WhatsApp Business Platform policy enforcement. When enabled, off-scope queries are blocked and redirected to business topics.',
  });
});

// PUT /compliance/business-scope — Toggle business scope compliance mode
router.put('/compliance/business-scope', async (req: Request, res: Response) => {
  const profileId = (res.locals.tenantId as string) || 'pelangi';
  const { enabled } = req.body as { enabled?: boolean };

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  // Load profile config and update
  const { profileRegistry } = await import('../../assistant/profile-registry.js');
  const profile = profileRegistry.isInitialized()
    ? profileRegistry.getProfile(profileId)
    : null;

  if (profile?.configStore) {
    const settings = profile.configStore.getSettings() as any;
    if (!settings.business_scope_policy) {
      settings.business_scope_policy = { enabled };
    } else {
      settings.business_scope_policy.enabled = enabled;
    }
    // Persist via config store's save mechanism
    profile.configStore.setSettings(settings);
  }

  logSecurityEvent({
    adminUser: (req as any).user?.username || 'unknown',
    action: enabled ? 'enable' : 'disable',
    resourceType: 'business_scope_policy',
    resourceId: profileId,
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers['user-agent'],
    profileId,
    details: { enabled, overrideBy: (req as any).user?.username || 'unknown' },
  }).catch(() => {});

  console.log(`[Compliance] Business scope policy ${enabled ? 'ENABLED' : 'DISABLED'} for ${profileId} by ${(req as any).user?.username || 'unknown'}`);

  res.json({ ok: true, profileId, complianceMode: enabled });
});

export default router;
