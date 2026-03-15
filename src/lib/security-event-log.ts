/**
 * Security Event Log (US-915)
 *
 * Captures administrative access to personal data with user, action,
 * timestamp, and IP address per PDPA 2024 requirements.
 */
import { pool } from './db.js';

let _tableEnsured = false;

async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS security_event_log (
        id SERIAL PRIMARY KEY,
        admin_user TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        profile_id TEXT,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_security_event_created ON security_event_log (created_at DESC)
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[SecurityLog] Table ensure failed (non-fatal):', err.message);
  }
}

export interface SecurityEvent {
  adminUser: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  profileId?: string;
  details?: Record<string, unknown>;
}

/** Log a security event (fire-and-forget) */
export async function logSecurityEvent(event: SecurityEvent): Promise<void> {
  try {
    await ensureTable();
    await pool.query(
      `INSERT INTO security_event_log
        (admin_user, action, resource_type, resource_id, ip_address, user_agent, profile_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.adminUser,
        event.action,
        event.resourceType,
        event.resourceId ?? null,
        event.ipAddress ?? null,
        event.userAgent ?? null,
        event.profileId ?? null,
        event.details ? JSON.stringify(event.details) : null,
      ]
    );
  } catch (err: any) {
    console.warn('[SecurityLog] Failed to log event (non-fatal):', err.message);
  }
}

/** Get recent security events for audit */
export async function getSecurityEvents(
  limit: number = 100,
  offset: number = 0,
  filters?: { adminUser?: string; action?: string; resourceType?: string }
): Promise<any[]> {
  try {
    await ensureTable();
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (filters?.adminUser) {
      conditions.push(`admin_user = $${paramIdx++}`);
      params.push(filters.adminUser);
    }
    if (filters?.action) {
      conditions.push(`action = $${paramIdx++}`);
      params.push(filters.action);
    }
    if (filters?.resourceType) {
      conditions.push(`resource_type = $${paramIdx++}`);
      params.push(filters.resourceType);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit, offset);

    const result = await pool.query(
      `SELECT * FROM security_event_log ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );
    return result.rows;
  } catch (err: any) {
    console.warn('[SecurityLog] Query failed:', err.message);
    return [];
  }
}
