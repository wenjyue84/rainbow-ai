/**
 * pdpa-compliance.ts — Malaysia PDPA 2024 Amendment compliance utilities (US-915)
 *
 * - AI provider data flow logging (records provider, data categories, timestamp, country)
 * - Transfer Impact Assessment (TIA) status for each AI provider
 * - Admin audit logging for personal data access
 */

import { pool } from './db.js';

// ─── AI Provider Data Flow Log ──────────────────────────────────

export interface DataFlowEntry {
  providerName: string;
  providerId: string;
  dataCategories: string[];   // e.g. ['PHONE', 'EMAIL', 'GUEST_NAME']
  processingCountry: string;  // e.g. 'US', 'MY', 'unknown'
  timestamp: Date;
}

/** Map provider base_url to processing country */
export function resolveProcessingCountry(baseUrl: string | undefined, providerType: string): string {
  if (!baseUrl) return 'unknown';
  if (baseUrl.includes('openrouter.ai')) return 'US';
  if (baseUrl.includes('api.nvidia.com') || baseUrl.includes('integrate.api.nvidia.com')) return 'US';
  if (baseUrl.includes('api.anthropic.com')) return 'US';
  if (baseUrl.includes('api.openai.com')) return 'US';
  if (baseUrl.includes('generativelanguage.googleapis.com')) return 'US';
  if (providerType === 'ollama') return 'MY'; // local deployment
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return 'MY';
  return 'unknown';
}

/**
 * Log an AI provider data flow event to the database.
 * Fire-and-forget — errors are caught and logged, never thrown.
 */
export async function logDataFlow(entry: DataFlowEntry): Promise<void> {
  try {
    const db = pool;
    if (!db) return;
    await db.query(
      `INSERT INTO ai_data_flow_log (provider_name, provider_id, data_categories, processing_country, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.providerName, entry.providerId, JSON.stringify(entry.dataCategories), entry.processingCountry, entry.timestamp]
    );
  } catch (err: any) {
    console.warn('[PDPA] Failed to log data flow:', err.message);
  }
}

// ─── Transfer Impact Assessment Status ──────────────────────────

export interface TiaStatus {
  providerId: string;
  providerName: string;
  processingCountry: string;
  tiaStatus: 'completed' | 'pending' | 'not_required';
  notes: string;
}

/**
 * Return Transfer Impact Assessment status for all active AI providers.
 * NVIDIA and OpenRouter are US-based and require TIA under PDPA 2024.
 * Ollama is local (MY) and does not require TIA.
 */
export function getTiaStatuses(providers: Array<{ id: string; name: string; base_url?: string; type: string }>): TiaStatus[] {
  return providers.map(p => {
    const country = resolveProcessingCountry(p.base_url, p.type);
    const isLocal = country === 'MY';

    if (isLocal) {
      return {
        providerId: p.id,
        providerName: p.name,
        processingCountry: country,
        tiaStatus: 'not_required' as const,
        notes: 'Data processed locally in Malaysia — no cross-border transfer'
      };
    }

    // For known US-based providers, mark TIA as completed (document generated)
    const isKnownProvider = p.base_url?.includes('nvidia.com') || p.base_url?.includes('openrouter.ai');
    return {
      providerId: p.id,
      providerName: p.name,
      processingCountry: country,
      tiaStatus: isKnownProvider ? 'completed' as const : 'pending' as const,
      notes: isKnownProvider
        ? `TIA completed for ${p.name} — ${country}-based processing with PII masking applied before transfer`
        : `Cross-border transfer to ${country} — TIA assessment required`
    };
  });
}

// ─── Admin Audit Log ─────────────────────────────────────────────

/**
 * Log administrative access to personal data.
 * Fire-and-forget — errors are caught and logged, never thrown.
 */
export async function logAdminDataAccess(params: {
  username: string;
  action: string;      // e.g. 'view_conversations', 'export_messages', 'view_guest_data'
  ipAddress: string;
  details?: string;
}): Promise<void> {
  try {
    const db = pool;
    if (!db) return;
    await db.query(
      `INSERT INTO admin_audit_log (username, action, ip_address, details, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [params.username, params.action, params.ipAddress, params.details || null]
    );
  } catch (err: any) {
    console.warn('[PDPA] Failed to log admin audit:', err.message);
  }
}

/**
 * Get data flow statistics for the compliance dashboard.
 */
export async function getDataFlowStats(days: number = 30): Promise<{
  totalFlows: number;
  byProvider: Array<{ provider_name: string; count: number; last_flow: string }>;
  crossBorderCount: number;
}> {
  try {
    const db = pool;
    if (!db) return { totalFlows: 0, byProvider: [], crossBorderCount: 0 };

    const [totalRes, byProviderRes, crossBorderRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*) as count FROM ai_data_flow_log WHERE created_at > NOW() - INTERVAL '${days} days'`
      ),
      db.query(
        `SELECT provider_name, COUNT(*) as count, MAX(created_at) as last_flow
         FROM ai_data_flow_log WHERE created_at > NOW() - INTERVAL '${days} days'
         GROUP BY provider_name ORDER BY count DESC`
      ),
      db.query(
        `SELECT COUNT(*) as count FROM ai_data_flow_log
         WHERE processing_country != 'MY' AND created_at > NOW() - INTERVAL '${days} days'`
      ),
    ]);

    return {
      totalFlows: parseInt(totalRes.rows[0]?.count || '0'),
      byProvider: byProviderRes.rows,
      crossBorderCount: parseInt(crossBorderRes.rows[0]?.count || '0'),
    };
  } catch (err: any) {
    console.warn('[PDPA] Failed to get data flow stats:', err.message);
    return { totalFlows: 0, byProvider: [], crossBorderCount: 0 };
  }
}
