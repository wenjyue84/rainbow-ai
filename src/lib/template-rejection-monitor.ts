/**
 * Template Rejection Monitor (US-900)
 *
 * Scheduled job (every 4 hours) that polls Meta Graph API for template statuses.
 * Detects transitions from APPROVED to REJECTED or PAUSED and sends admin
 * notification via WhatsApp. Stores template statuses in whatsapp_templates table.
 *
 * Meta Graph API: GET /{waba-id}/message_templates?fields=name,status,rejected_reason
 */

import { pool, db, dbReady } from './db.js';
import { eq, and } from 'drizzle-orm';
import { whatsappTemplates } from '../../shared/schema.js';
import { notifyAdminTemplatePaused } from './admin-notifier.js';
import { createModuleLogger } from './logger.js';
import { metaGraphUrl } from './meta-graph-api.js';

const logger = createModuleLogger('template-rejection-monitor');

const POLL_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const INITIAL_DELAY_MS = 60_000; // 1 minute after startup

// ─── Table Ensure ────────────────────────────────────────────────────

export async function ensureWhatsappTemplatesTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id SERIAL PRIMARY KEY,
        template_name TEXT NOT NULL,
        status TEXT NOT NULL,
        previous_status TEXT,
        rejected_reason TEXT,
        profile_id TEXT NOT NULL DEFAULT 'pelangi',
        last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT idx_whatsapp_templates_name_profile UNIQUE (template_name, profile_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_status ON whatsapp_templates(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_profile ON whatsapp_templates(profile_id)`);
    logger.info('whatsapp_templates table ready');
  } catch (err: any) {
    logger.warn('Table ensure failed (non-fatal)', { error: err.message });
  }
}

// ─── Meta API Types ──────────────────────────────────────────────────

interface MetaTemplate {
  name: string;
  status: string; // APPROVED, REJECTED, PAUSED, PENDING, etc.
  rejected_reason?: string;
}

interface MetaTemplateResponse {
  data: MetaTemplate[];
  paging?: { next?: string };
}

// ─── Meta API Fetch ──────────────────────────────────────────────────

/**
 * Fetch templates from Meta Graph API for a given WABA ID.
 * Returns empty array if WABA credentials are not configured.
 */
export async function fetchMetaTemplates(
  wabaId: string,
  accessToken: string,
): Promise<MetaTemplate[]> {
  const templates: MetaTemplate[] = [];
  let url: string | null =
    metaGraphUrl(`${wabaId}/message_templates?fields=name,status,rejected_reason&limit=100`);

  while (url) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error('Meta API error fetching templates', {
        status: response.status,
        body: body.substring(0, 500),
      });
      throw new Error(`Meta API error: ${response.status}`);
    }

    const data: MetaTemplateResponse = await response.json();
    templates.push(...data.data);
    url = data.paging?.next ?? null;
  }

  return templates;
}

// ─── Status Sync & Transition Detection ──────────────────────────────

export interface TemplateTransition {
  templateName: string;
  oldStatus: string;
  newStatus: string;
  rejectedReason?: string;
  profileId: string;
}

/**
 * Sync fetched templates into whatsapp_templates table.
 * Returns list of templates that transitioned to REJECTED or PAUSED.
 */
export async function syncTemplateStatuses(
  templates: MetaTemplate[],
  profileId: string,
): Promise<TemplateTransition[]> {
  const transitions: TemplateTransition[] = [];

  for (const tpl of templates) {
    // Check existing record
    const [existing] = await db
      .select()
      .from(whatsappTemplates)
      .where(
        and(
          eq(whatsappTemplates.templateName, tpl.name),
          eq(whatsappTemplates.profileId, profileId),
        ),
      )
      .limit(1);

    const now = new Date();

    if (existing) {
      // Status changed?
      if (existing.status !== tpl.status) {
        const isRejectionTransition =
          (tpl.status === 'REJECTED' || tpl.status === 'PAUSED') &&
          existing.status === 'APPROVED';

        if (isRejectionTransition) {
          transitions.push({
            templateName: tpl.name,
            oldStatus: existing.status,
            newStatus: tpl.status,
            rejectedReason: tpl.rejected_reason,
            profileId,
          });
        }

        await db
          .update(whatsappTemplates)
          .set({
            previousStatus: existing.status,
            status: tpl.status,
            rejectedReason: tpl.rejected_reason ?? null,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(whatsappTemplates.id, existing.id));
      } else {
        // Same status — just update lastCheckedAt
        await db
          .update(whatsappTemplates)
          .set({ lastCheckedAt: now })
          .where(eq(whatsappTemplates.id, existing.id));
      }
    } else {
      // New template — insert
      await db.insert(whatsappTemplates).values({
        templateName: tpl.name,
        status: tpl.status,
        previousStatus: null,
        rejectedReason: tpl.rejected_reason ?? null,
        profileId,
        lastCheckedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return transitions;
}

// ─── Core Check ──────────────────────────────────────────────────────

/**
 * Load WABA credentials from environment or settings and poll templates.
 */
export async function runTemplateRejectionCheck(): Promise<TemplateTransition[]> {
  const isConnected = await dbReady;
  if (!isConnected) {
    logger.warn('Database not available — skipping template rejection check');
    return [];
  }

  // Load WABA credentials from environment
  const wabaId = process.env.WHATSAPP_WABA_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;

  if (!wabaId || !accessToken) {
    logger.info('WABA credentials not configured — skipping template poll');
    return [];
  }

  try {
    const profiles = await getProfileIds();
    const allTransitions: TemplateTransition[] = [];

    for (const profileId of profiles) {
      const templates = await fetchMetaTemplates(wabaId, accessToken);
      const transitions = await syncTemplateStatuses(templates, profileId);

      // Send notifications for each transition
      for (const t of transitions) {
        logger.warn('Template status transition detected', {
          template: t.templateName,
          from: t.oldStatus,
          to: t.newStatus,
          reason: t.rejectedReason,
        });

        // Also log to template_quality_events for timeline consistency
        try {
          await pool.query(
            `INSERT INTO template_quality_events (id, template_name, old_status, new_status, reason, profile_id)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
            [t.templateName, t.oldStatus, t.newStatus, t.rejectedReason ?? null, t.profileId],
          );
        } catch (err: any) {
          logger.warn('Failed to log quality event', { error: err.message });
        }

        // Reuse existing admin notifier
        await notifyAdminTemplatePaused(t.templateName, t.newStatus, t.rejectedReason);
      }

      allTransitions.push(...transitions);
    }

    logger.info('Template rejection check complete', {
      totalTransitions: allTransitions.length,
    });

    return allTransitions;
  } catch (err: any) {
    logger.error('Template rejection check failed', { error: err.message });
    return [];
  }
}

async function getProfileIds(): Promise<string[]> {
  try {
    const { profileRegistry } = await import('../assistant/profile-registry.js');
    if (profileRegistry.isInitialized()) {
      return profileRegistry.listProfiles().map((p: any) => p.id);
    }
  } catch {
    // fallthrough
  }
  return ['pelangi'];
}

// ─── Scheduler ───────────────────────────────────────────────────────

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let initialTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function startTemplateRejectionMonitor(): void {
  if (pollIntervalId || initialTimeoutId) return;

  // Ensure table exists (fire and forget)
  ensureWhatsappTemplatesTable().catch(() => {});

  logger.info(`Template rejection monitor: first run in ${INITIAL_DELAY_MS / 1000}s, then every ${POLL_INTERVAL_MS / 3600000}h`);

  // Initial run after a short delay to let other systems initialize
  initialTimeoutId = setTimeout(() => {
    initialTimeoutId = null;
    runTemplateRejectionCheck().catch(err =>
      logger.error('Scheduled template rejection check failed', { error: err.message }),
    );

    // Then every 4 hours
    pollIntervalId = setInterval(() => {
      runTemplateRejectionCheck().catch(err =>
        logger.error('Scheduled template rejection check failed', { error: err.message }),
      );
    }, POLL_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
}

export function stopTemplateRejectionMonitor(): void {
  if (initialTimeoutId) { clearTimeout(initialTimeoutId); initialTimeoutId = null; }
  if (pollIntervalId) { clearInterval(pollIntervalId); pollIntervalId = null; }
}
