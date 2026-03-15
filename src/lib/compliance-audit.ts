/**
 * compliance-audit.ts — US-942: WhatsApp task-specific chatbot compliance audit log
 *
 * Records which intent categories handled each conversation for WABA policy review.
 * Fire-and-forget logging — errors are caught and logged, never thrown.
 */
import { db } from './db.js';
import { desc, eq, gte } from 'drizzle-orm';
import { complianceAuditLog } from '../../shared/schema-tables.js';

/** Intent categories for compliance classification */
const OFF_TOPIC_INTENTS = new Set(['off_topic']);
const ESCALATION_INTENTS = new Set(['contact_staff', 'billing_dispute']);
const ESCALATION_ACTIONS = new Set(['escalate', 'workflow']);

/**
 * Classify an intent into a compliance category.
 * Returns 'off_topic' for out-of-scope requests,
 * 'escalation' for human handoff paths,
 * 'in_scope' for allowed business functions.
 */
export function classifyIntentCategory(
  intent: string,
  routedAction?: string
): 'in_scope' | 'off_topic' | 'escalation' {
  if (OFF_TOPIC_INTENTS.has(intent)) return 'off_topic';
  if (ESCALATION_INTENTS.has(intent)) return 'escalation';
  if (routedAction && ESCALATION_ACTIONS.has(routedAction) && intent.includes('complaint')) return 'in_scope';
  return 'in_scope';
}

export interface ComplianceAuditInput {
  jid: string;
  profileId: string;
  intent: string;
  routedAction?: string;
  confidence?: number;
  userMessage?: string;
}

export interface ComplianceAuditQuery {
  profileId?: string;
  intentCategory?: 'in_scope' | 'off_topic' | 'escalation';
  since?: Date;
  limit?: number;
}

export interface ComplianceSummary {
  total: number;
  in_scope: number;
  off_topic: number;
  escalation: number;
  offTopicRate: number;
}

/**
 * Query the compliance audit log for admin review.
 */
export async function queryComplianceAuditLog(opts: ComplianceAuditQuery = {}) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const query = db
    .select()
    .from(complianceAuditLog)
    .orderBy(desc(complianceAuditLog.createdAt))
    .limit(limit);

  const rows = await query;
  return rows.filter(r => {
    if (opts.profileId && r.profileId !== opts.profileId) return false;
    if (opts.intentCategory && r.intentCategory !== opts.intentCategory) return false;
    if (opts.since && new Date(r.createdAt) < opts.since) return false;
    return true;
  });
}

/**
 * Get aggregate compliance stats for a profileId over a time window.
 */
export async function getComplianceSummary(profileId?: string, since?: Date): Promise<ComplianceSummary> {
  const rows = await queryComplianceAuditLog({ profileId, since, limit: 500 });
  const total = rows.length;
  const counts = { in_scope: 0, off_topic: 0, escalation: 0 };
  for (const r of rows) {
    const cat = r.intentCategory as 'in_scope' | 'off_topic' | 'escalation';
    if (cat in counts) counts[cat]++;
  }
  return {
    total,
    ...counts,
    offTopicRate: total > 0 ? +(counts.off_topic / total).toFixed(4) : 0,
  };
}

/**
 * Log a compliance audit entry (fire-and-forget).
 * Errors are caught and logged but never thrown.
 */
export function logComplianceAudit(input: ComplianceAuditInput): void {
  const intentCategory = classifyIntentCategory(input.intent, input.routedAction);

  db.insert(complianceAuditLog)
    .values({
      jid: input.jid,
      profileId: input.profileId,
      intent: input.intent,
      intentCategory,
      routedAction: input.routedAction ?? null,
      confidence: input.confidence ?? null,
      userMessage: input.userMessage ? input.userMessage.slice(0, 200) : null,
    })
    .then(() => {
      if (intentCategory === 'off_topic') {
        console.log(`[ComplianceAudit] Off-topic request logged: jid=${input.jid} intent=${input.intent}`);
      }
    })
    .catch((err: any) => {
      console.error(`[ComplianceAudit] Failed to log:`, err.message);
    });
}
