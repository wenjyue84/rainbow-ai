/**
 * AI Provider Data Flow Log (US-915)
 *
 * Records cross-border data flows to AI providers for PDPA 2024 compliance.
 * Logs: provider name, data categories sent, timestamp, processing country.
 */
import { pool } from './db.js';

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_data_flow_log (
        id SERIAL PRIMARY KEY,
        provider_id TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        model TEXT NOT NULL,
        data_categories TEXT[] NOT NULL DEFAULT '{}',
        processing_country TEXT NOT NULL DEFAULT 'unknown',
        pii_masked BOOLEAN NOT NULL DEFAULT true,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        profile_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[AIDataFlowLog] Table ensure failed (non-fatal):', err.message);
  }
}

/** Country mapping for known AI provider base URLs */
function resolveProcessingCountry(baseUrl: string, providerType: string): string {
  if (providerType === 'ollama') return 'MY'; // Local deployment
  if (baseUrl.includes('integrate.api.nvidia.com')) return 'US';
  if (baseUrl.includes('openrouter.ai')) return 'US'; // OpenRouter routes through US
  if (baseUrl.includes('api.groq.com')) return 'US';
  if (baseUrl.includes('generativelanguage.googleapis.com')) return 'US';
  if (baseUrl.includes('api.anthropic.com')) return 'US';
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) return 'MY';
  return 'unknown';
}

/** Determine data categories present in messages */
function classifyDataCategories(messages: Array<{ role: string; content: string }>): string[] {
  const categories = new Set<string>();
  const allText = messages.map(m => m.content).join(' ');

  categories.add('conversation_context');

  if (/\b(name|nama|push_name|guest)\b/i.test(allText)) categories.add('guest_identity');
  if (/\b(check.?in|check.?out|book|reservation|tempahan)\b/i.test(allText)) categories.add('booking_data');
  if (/\b(room|unit|bilik|katil|bed|dorm)\b/i.test(allText)) categories.add('accommodation_data');
  if (/\b(order|menu|makanan|food|drink|minuman)\b/i.test(allText)) categories.add('order_data');
  if (/\b(pay|price|harga|rm\s?\d|ringgit|bayar)\b/i.test(allText)) categories.add('financial_data');

  return Array.from(categories);
}

export interface DataFlowLogEntry {
  providerId: string;
  providerName: string;
  providerType: string;
  model: string;
  baseUrl: string;
  messages: Array<{ role: string; content: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  profileId?: string;
}

/** Log an AI provider data flow event (fire-and-forget) */
export async function logDataFlow(entry: DataFlowLogEntry): Promise<void> {
  try {
    await ensureTable();
    const country = resolveProcessingCountry(entry.baseUrl, entry.providerType);
    const categories = classifyDataCategories(entry.messages);

    await pool.query(
      `INSERT INTO ai_data_flow_log
        (provider_id, provider_name, provider_type, model, data_categories, processing_country, pii_masked, prompt_tokens, completion_tokens, profile_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.providerId,
        entry.providerName,
        entry.providerType,
        entry.model,
        categories,
        country,
        true, // PII is always masked before provider calls (enforced by pipeline)
        entry.usage?.prompt_tokens ?? null,
        entry.usage?.completion_tokens ?? null,
        entry.profileId ?? null,
      ]
    );
  } catch (err: any) {
    console.warn('[AIDataFlowLog] Failed to log data flow (non-fatal):', err.message);
  }
}

/** Get data flow summary for compliance reporting */
export async function getDataFlowSummary(days: number = 30): Promise<any> {
  try {
    await ensureTable();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await pool.query(
      `SELECT
        provider_name,
        provider_type,
        model,
        processing_country,
        COUNT(*) AS total_calls,
        array_agg(DISTINCT unnested_cat) AS data_categories_sent
       FROM ai_data_flow_log,
            LATERAL unnest(data_categories) AS unnested_cat
       WHERE created_at >= $1
       GROUP BY provider_name, provider_type, model, processing_country
       ORDER BY total_calls DESC`,
      [since]
    );

    return result.rows;
  } catch (err: any) {
    console.warn('[AIDataFlowLog] Summary query failed:', err.message);
    return [];
  }
}
