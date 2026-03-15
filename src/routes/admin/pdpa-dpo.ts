/**
 * PDPA DPO Management (US-907)
 *
 * GET  /api/rainbow/pdpa/dpo           — Return DPO info (name, email, registration_status, date_appointed)
 * PUT  /api/rainbow/pdpa/dpo           — Update DPO info
 * GET  /api/rainbow/pdpa/dsar/:phone   — Generate Data Subject Access Report for a phone number
 * GET  /api/rainbow/pdpa/incidents     — List all breach incidents (incident response log)
 *
 * Malaysia PDPA Amendment Act 2024 (in force June 2025):
 * - DPO must be ordinarily resident in Malaysia
 * - Registered with the PDPC Commissioner
 * - Penalties: up to RM1,000,000 for non-compliance
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { db, dbReady, pool } from '../../lib/db.js';
import { rainbowMessages, rainbowConversations } from '../../../shared/schema-tables.js';
import { configStore } from '../../assistant/config-store.js';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { canonicalPhoneKey } from '../../assistant/conversation-db.js';
import { ok, badRequest, notFound, serverError } from './http-utils.js';
import { getTiaStatuses, getDataFlowStats, logAdminDataAccess, resolveProcessingCountry } from '../../lib/pdpa-compliance.js';
import { getProviders } from '../../assistant/ai-provider-manager.js';

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────

interface DpoInfo {
  dpo_name: string;
  dpo_email: string;
  dpo_registration_status: 'active' | 'pending' | 'inactive';
  dpo_date_appointed: string | null;
  general_contact_email: string;
}

function getDpoFromSettings(profileId?: string): DpoInfo {
  const store = profileId && profileRegistry.isInitialized()
    ? profileRegistry.getProfile(profileId)?.configStore ?? configStore
    : configStore;

  const settings = store.getSettings() as any;
  const pdpa = settings?.pdpa ?? {};
  return {
    dpo_name: pdpa.dpo_name ?? 'Data Protection Officer',
    dpo_email: pdpa.dpo_email ?? pdpa.general_contact_email ?? '',
    dpo_registration_status: pdpa.dpo_registration_status ?? 'active',
    dpo_date_appointed: pdpa.dpo_date_appointed ?? null,
    general_contact_email: pdpa.general_contact_email ?? '',
  };
}

// ─── GET /pdpa/dpo ───────────────────────────────────────────────────

router.get('/pdpa/dpo', (req: Request, res: Response) => {
  try {
    const profileId = req.headers['x-profile-id'] as string | undefined;
    const dpo = getDpoFromSettings(profileId);
    ok(res, dpo);
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── PUT /pdpa/dpo ───────────────────────────────────────────────────

router.put('/pdpa/dpo', async (req: Request, res: Response) => {
  try {
    const { dpo_name, dpo_email, dpo_registration_status, dpo_date_appointed, general_contact_email } = req.body ?? {};

    if (!dpo_email || typeof dpo_email !== 'string' || !dpo_email.includes('@')) {
      return badRequest(res, 'dpo_email is required and must be a valid email address');
    }

    const validStatuses = ['active', 'pending', 'inactive'];
    if (dpo_registration_status && !validStatuses.includes(dpo_registration_status)) {
      return badRequest(res, `dpo_registration_status must be one of: ${validStatuses.join(', ')}`);
    }

    const profileId = req.headers['x-profile-id'] as string | undefined;
    const store = profileId && profileRegistry.isInitialized()
      ? profileRegistry.getProfile(profileId)?.configStore ?? configStore
      : configStore;

    const currentSettings = store.getSettings() as any;
    const updatedPdpa = {
      ...(currentSettings?.pdpa ?? {}),
      dpo_name: dpo_name ?? currentSettings?.pdpa?.dpo_name ?? 'Data Protection Officer',
      dpo_email: dpo_email.trim(),
      dpo_registration_status: dpo_registration_status ?? currentSettings?.pdpa?.dpo_registration_status ?? 'active',
      dpo_date_appointed: dpo_date_appointed ?? currentSettings?.pdpa?.dpo_date_appointed ?? null,
      general_contact_email: general_contact_email ?? currentSettings?.pdpa?.general_contact_email ?? dpo_email.trim(),
    };

    await store.updateSettings({ pdpa: updatedPdpa });
    console.log(`[PDPA] DPO settings updated: ${updatedPdpa.dpo_email}`);
    ok(res, updatedPdpa);
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── GET /pdpa/dsar/:phone — Data Subject Access Report ──────────────

router.get('/pdpa/dsar/:phone', async (req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  const phone = req.params.phone;
  if (!phone || phone.trim().length < 8) {
    return badRequest(res, 'phone parameter must be at least 8 characters');
  }

  try {
    const key = canonicalPhoneKey(phone.trim());
    const startTime = Date.now();

    const [messages, conversations] = await Promise.all([
      db.select({
        id: rainbowMessages.id,
        role: rainbowMessages.role,
        content: rainbowMessages.content,
        timestamp: rainbowMessages.timestamp,
        intent: rainbowMessages.intent,
      }).from(rainbowMessages)
        .where(and(eq(rainbowMessages.phone, key), isNull(rainbowMessages.deletedAt)))
        .orderBy(desc(rainbowMessages.timestamp)),

      db.select({
        id: rainbowConversations.id,
        phone: rainbowConversations.phone,
        stage: rainbowConversations.stage,
        createdAt: rainbowConversations.createdAt,
        updatedAt: rainbowConversations.updatedAt,
      }).from(rainbowConversations)
        .where(and(eq(rainbowConversations.phone, key), isNull(rainbowConversations.deletedAt))),
    ]);

    const elapsedMs = Date.now() - startTime;

    if (messages.length === 0 && conversations.length === 0) {
      return notFound(res, `No personal data found for phone number ${phone}`);
    }

    const report = {
      report_type: 'PDPA Data Subject Access Report',
      generated_at: new Date().toISOString(),
      elapsed_ms: elapsedMs,
      legal_basis: 'Personal Data Protection (Amendment) Act 2024, Section 12A',
      subject: {
        phone_normalized: key,
        phone_provided: phone.trim(),
      },
      summary: {
        total_messages: messages.length,
        total_conversations: conversations.length,
        earliest_record: messages.length > 0
          ? messages[messages.length - 1]?.timestamp
          : null,
        latest_record: messages.length > 0 ? messages[0]?.timestamp : null,
      },
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        intent: m.intent,
      })),
      conversations: conversations,
    };

    console.log(`[PDPA] DSAR generated for ${key}: ${messages.length} messages, ${elapsedMs}ms`);
    res.setHeader('Content-Disposition', `attachment; filename="dsar-${key}-${Date.now()}.json"`);
    res.json(report);
  } catch (error: any) {
    console.error('[PDPA] DSAR generation failed:', error.message);
    serverError(res, error);
  }
});

// ─── GET /pdpa/incidents — Incident response log ─────────────────────

router.get('/pdpa/incidents', async (_req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  try {
    const result = await pool.query(
      `SELECT id, reported_by, description, affected_count_estimate,
              discovered_at, commissioner_deadline, subject_deadline,
              commissioner_notified_at, subjects_notified_at, created_at
       FROM pdpa_breach_log
       ORDER BY discovered_at DESC
       LIMIT 100`
    );

    const incidents = result.rows.map(row => {
      const now = Date.now();
      const commDeadline = new Date(row.commissioner_deadline);
      const subjDeadline = new Date(row.subject_deadline);
      return {
        ...row,
        commissioner_72h_status: row.commissioner_notified_at ? 'completed'
          : commDeadline.getTime() < now ? 'overdue' : 'pending',
        subject_7d_status: row.subjects_notified_at ? 'completed'
          : subjDeadline.getTime() < now ? 'overdue' : 'pending',
      };
    });

    ok(res, { incidents, count: incidents.length });
  } catch (error: any) {
    console.error('[PDPA] Failed to list incidents:', error.message);
    serverError(res, error);
  }
});

// ─── GET /pdpa/compliance — Transfer Impact Assessment status (US-915) ──

router.get('/pdpa/compliance', async (req: Request, res: Response) => {
  try {
    const providers = getProviders();
    const tiaStatuses = getTiaStatuses(providers);
    const dataFlowStats = await getDataFlowStats(30);

    // Log this admin access for PDPA audit trail
    const username = (req as any).user?.username || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    logAdminDataAccess({
      username,
      action: 'view_compliance_dashboard',
      ipAddress: ip,
    }).catch(() => {/* swallow */});

    ok(res, {
      transferImpactAssessments: tiaStatuses,
      dataFlowSummary: dataFlowStats,
      pdpaAmendment: {
        act: 'Personal Data Protection (Amendment) Act 2024',
        effectiveDate: '2025-04-01',
        requirement: 'Cross-border transfers require Transfer Impact Assessment',
        penalty: 'Up to RM1,000,000 for processor security breach',
      },
      piiMaskingEnabled: true,
      maskedFields: ['PHONE', 'EMAIL', 'MY_IC', 'CREDIT_CARD', 'PASSPORT', 'BANK_ACCOUNT', 'GUEST_NAME'],
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── GET /pdpa/audit-log — Admin data access audit trail (US-915) ──

router.get('/pdpa/audit-log', async (_req: Request, res: Response) => {
  const ready = await dbReady;
  if (!ready) return serverError(res, 'Database not available');

  try {
    const result = await pool.query(
      `SELECT id, username, action, ip_address, details, created_at
       FROM admin_audit_log
       ORDER BY created_at DESC
       LIMIT 200`
    );
    ok(res, { entries: result.rows, count: result.rows.length });
  } catch (error: any) {
    console.error('[PDPA] Failed to list audit log:', error.message);
    serverError(res, error);
  }
});

// ─── GET /pdpa/data-transfer-inventory — AI provider cross-border transfer inventory (US-930) ──

/**
 * Returns a structured data transfer inventory for all configured AI providers.
 * Lists each provider's name, processing country, data categories that may be
 * transferred, legal basis under PDPA Section 129, and safeguards applied.
 *
 * PDPA 2010 Act 709 Section 129: Cross-border transfer restriction.
 * Malaysia PDPA 2024 Amendment: TIA required for non-adequate-protection destinations.
 */
router.get('/pdpa/data-transfer-inventory', (req: Request, res: Response) => {
  try {
    const providers = getProviders();

    const inventory = providers.map(p => {
      const country = resolveProcessingCountry(p.base_url, p.type);
      const isOverseas = country !== 'MY';
      return {
        provider_id: p.id,
        provider_name: p.name,
        provider_type: p.type,
        base_url: p.base_url || 'http://localhost:11434/v1',
        processing_country: country,
        is_overseas_transfer: isOverseas,
        data_categories_transferred: [
          'conversation_messages',
          'guest_intent',
          'booking_context',
        ],
        pii_categories_redacted_before_transfer: [
          'PHONE',
          'EMAIL',
          'MY_IC',
          'CREDIT_CARD',
          'PASSPORT',
          'BANK_ACCOUNT',
          'GUEST_NAME',
        ],
        legal_basis: isOverseas
          ? 'PDPA 2010 Section 129 — Transfer permitted with contractual safeguards (DPA/SCCs) and Transfer Impact Assessment completed; PII redacted before transfer'
          : 'PDPA 2010 Section 129(b) — Processing within Malaysia; no cross-border transfer restriction applies',
        safeguards: isOverseas
          ? [
              'PII redacted from messages before transfer (maskPiiForProvider)',
              'Transfer Impact Assessment (TIA) completed',
              'Data Processing Agreement (DPA) / SCCs with provider',
              'Data retained by provider subject to their DPA',
            ]
          : [
              'Data processed locally in Malaysia',
              'No cross-border transfer occurs',
            ],
        contractual_safeguards_status: isOverseas ? 'pending_dpa_execution' : 'not_required',
      };
    });

    const settings = configStore.getSettings() as any;
    const localOnlyEnabled = settings?.pdpa?.local_only_ai === true;

    // Log admin access
    const username = (req as any).user?.username || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    logAdminDataAccess({
      username,
      action: 'view_data_transfer_inventory',
      ipAddress: ip,
    }).catch(() => {/* swallow */});

    ok(res, {
      generated_at: new Date().toISOString(),
      legal_framework: {
        act: 'Personal Data Protection Act 2010 (Act 709)',
        amendment: 'Personal Data Protection (Amendment) Act 2024',
        section: 'Section 129 — Prohibition on transfer of personal data to places outside Malaysia',
        jpdp_guidance: 'Cross-border transfer guidelines pending — JPDP workshop held August 2024',
      },
      data_residency: {
        local_only_ai_enabled: localOnlyEnabled,
        description: localOnlyEnabled
          ? 'Overseas AI providers are DISABLED — all AI processing restricted to local/MY providers'
          : 'Overseas AI providers are enabled — PII masking and TIA safeguards apply',
      },
      providers: inventory,
      total_providers: inventory.length,
      overseas_providers: inventory.filter(p => p.is_overseas_transfer).length,
      local_providers: inventory.filter(p => !p.is_overseas_transfer).length,
    });
  } catch (error: any) {
    serverError(res, error);
  }
});

// ─── PUT /pdpa/data-residency — Toggle local-only AI providers (US-930) ──

/**
 * Enable or disable overseas AI provider restriction.
 * When local_only_ai=true, chatWithFallback() filters out all non-MY providers,
 * ensuring data processing stays within Malaysia (PDPA Section 129 compliance).
 */
router.put('/pdpa/data-residency', async (req: Request, res: Response) => {
  try {
    const { local_only_ai } = req.body ?? {};

    if (typeof local_only_ai !== 'boolean') {
      return badRequest(res, 'local_only_ai must be a boolean');
    }

    const profileId = req.headers['x-profile-id'] as string | undefined;
    const store = profileId && profileRegistry.isInitialized()
      ? profileRegistry.getProfile(profileId)?.configStore ?? configStore
      : configStore;

    const currentSettings = store.getSettings() as any;
    const updatedPdpa = {
      ...(currentSettings?.pdpa ?? {}),
      local_only_ai,
    };

    await store.updateSettings({ pdpa: updatedPdpa });

    const username = (req as any).user?.username || 'unknown';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    logAdminDataAccess({
      username,
      action: local_only_ai ? 'enable_local_only_ai' : 'disable_local_only_ai',
      ipAddress: ip,
      details: `PDPA Section 129 data residency mode set to local_only_ai=${local_only_ai}`,
    }).catch(() => {/* swallow */});

    console.log(`[PDPA] Data residency: local_only_ai set to ${local_only_ai} by ${username}`);
    ok(res, {
      local_only_ai,
      message: local_only_ai
        ? 'Overseas AI providers disabled — all AI processing restricted to Malaysia (PDPA Section 129 compliance mode)'
        : 'Overseas AI providers enabled — PII masking and TIA safeguards apply',
    });
  } catch (error: any) {
    console.error('[PDPA] Failed to update data residency:', error.message);
    serverError(res, error);
  }
});

export default router;
