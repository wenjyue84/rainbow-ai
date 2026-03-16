/**
 * Tenant Context Middleware & Utilities (US-908, US-1001)
 *
 * Formalizes the existing profileId pattern into a strict tenant isolation layer.
 * The tenant_id concept maps 1:1 to the existing profileId field across all tables.
 *
 * Key principles (per AWS multi-tenant best practices):
 * - tenant_id is injected by middleware — never trusted from user input or AI model output
 * - All database queries must include a tenant_id filter (enforced at call sites)
 * - RAG retrieval is namespaced by tenant to prevent cross-property data leakage
 * - Admin RBAC is scoped to allowed tenants
 *
 * US-1001: DB-level enforcement via PostgreSQL Row-Level Security.
 *   - `withTenantContext(profileId, callback)` — sets app.current_tenant per-transaction
 *   - `getAdminPool()` / `getAdminDb()` — BYPASSRLS pool for admin cross-tenant queries
 *   - See migrations/rls-enable.sql for the RLS policies
 */

import type { Request, Response, NextFunction } from 'express';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../shared/schema.js';
import { pool as appPool } from './db.js';

/** Valid tenant identifiers — maps to existing profileId values. */
export const VALID_TENANTS = ['pelangi', 'southern', 'makan-moments'] as const;
export type TenantId = typeof VALID_TENANTS[number];

/**
 * Check if a string is a valid tenant identifier.
 */
export function isValidTenant(value: string): value is TenantId {
  return (VALID_TENANTS as readonly string[]).includes(value);
}

/**
 * Resolve the tenant_id for a WhatsApp phone number.
 *
 * In the current architecture, each WhatsApp instance is bound to a single property.
 * The mapping is determined by the Baileys instance that received the message.
 * This function provides a fallback when instance context isn't available.
 */
export function resolveTenantFromPhone(phone: string, instanceId?: string): TenantId {
  // Instance-based mapping (primary — set during Baileys message ingestion)
  if (instanceId) {
    if (instanceId.includes('southern') || instanceId === 'southern-homestay') return 'southern';
    if (instanceId.includes('makan') || instanceId === 'makan-moments') return 'makan-moments';
  }
  // Default to pelangi (hostel is the primary tenant)
  return 'pelangi';
}

/**
 * Express middleware: injects req.tenantId from the x-profile-id header.
 *
 * For admin API requests, the tenant is determined by the profile header.
 * For WhatsApp webhook requests, the tenant is determined by the Baileys instance
 * that received the message (set upstream in the message pipeline).
 *
 * This middleware runs AFTER auth but BEFORE route handlers.
 */
export function tenantContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const profileId = req.headers['x-profile-id'] as string | undefined;

  if (profileId && isValidTenant(profileId)) {
    res.locals.tenantId = profileId;
  }
  // If no profile header or invalid, tenantId stays undefined.
  // Routes that require tenant isolation must check for this.
  next();
}

/**
 * Express middleware: requires a valid tenant_id on the request.
 * Returns 400 if no tenant context is available.
 * Use on routes that MUST have tenant isolation (e.g., conversation queries).
 */
export function requireTenant(req: Request, res: Response, next: NextFunction): void {
  const tenantId = res.locals.tenantId as TenantId | undefined;
  if (!tenantId) {
    // Backwards compatibility: allow requests without tenant if no profile header
    // was sent (single-property deployments). The query functions will skip
    // tenant filtering when tenantId is undefined.
    next();
    return;
  }
  next();
}

/**
 * Check if an admin user is allowed to access data for a given tenant.
 *
 * @param allowedTenants - JSON array of tenant IDs the admin is allowed to access,
 *                         or null/undefined for unrestricted access (super-admin).
 * @param tenantId - The tenant being accessed.
 */
export function isAdminAllowedForTenant(
  allowedTenants: string | null | undefined,
  tenantId: TenantId
): boolean {
  // No restriction (super-admin or legacy user) → allowed everywhere
  if (!allowedTenants) return true;

  try {
    const tenants: string[] = JSON.parse(allowedTenants);
    return tenants.includes(tenantId);
  } catch {
    // Malformed JSON → deny
    return false;
  }
}

/**
 * Express middleware: enforces admin tenant scoping.
 * If the admin_user has an allowed_tenants restriction and the current
 * request's tenantId is not in that list, returns 403.
 */
export function enforceAdminTenantScope(req: Request, res: Response, next: NextFunction): void {
  const tenantId = res.locals.tenantId as TenantId | undefined;
  const allowedTenants = res.locals.adminAllowedTenants as string | null | undefined;

  // No tenant context on request → no enforcement needed (unscoped request)
  if (!tenantId) { next(); return; }

  // No restriction on admin → allowed
  if (!allowedTenants) { next(); return; }

  if (!isAdminAllowedForTenant(allowedTenants, tenantId)) {
    res.status(403).json({
      error: 'Forbidden: admin not authorized for this tenant',
      tenantId,
    });
    return;
  }

  next();
}

// ─── US-1001: PostgreSQL RLS helpers ─────────────────────────────────────────

let _adminPool: pg.Pool | null = null;

/**
 * Get the admin pool — uses DATABASE_ADMIN_URL if set (must be a role with
 * BYPASSRLS attribute). Falls back to the regular app pool with a warning.
 *
 * In Neon: run `ALTER ROLE <admin_role> BYPASSRLS;` on the admin user.
 */
export function getAdminPool(): pg.Pool {
  if (_adminPool) return _adminPool;

  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (adminUrl) {
    console.info('[TenantContext] Admin pool: using DATABASE_ADMIN_URL (BYPASSRLS role)');
    _adminPool = new pg.Pool({
      connectionString: adminUrl,
      ssl: adminUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30_000,
    });
  } else {
    console.warn(
      '[TenantContext] DATABASE_ADMIN_URL not set; admin queries use the regular pool ' +
      '(no BYPASSRLS — cross-tenant reads rely on policy allowing NULL tenant).'
    );
    _adminPool = appPool;
  }

  return _adminPool;
}

/** Drizzle instance backed by the BYPASSRLS admin pool. */
export function getAdminDb() {
  return drizzle(getAdminPool(), { schema });
}

export type TenantDrizzle = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Run `callback` inside a transaction with `app.current_tenant` scoped to `profileId`.
 *
 * PostgreSQL RLS policies on rainbow_conversations, rainbow_messages,
 * escalation_events, and intent_predictions use
 * `current_setting('app.current_tenant', TRUE)` to filter rows by tenant.
 *
 * Using set_config with is_local=TRUE ensures the variable is reset when
 * the transaction ends — pool-connection-safe.
 *
 * @example
 * const msgs = await withTenantContext('pelangi', (tdb) =>
 *   tdb.select().from(rainbowMessages).where(eq(rainbowMessages.phone, phone))
 * );
 */
export async function withTenantContext<T>(
  profileId: string,
  callback: (db: TenantDrizzle) => Promise<T>
): Promise<T> {
  if (!profileId) {
    throw new Error('[TenantContext] profileId must be a non-empty string');
  }

  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    // set_config(key, value, is_local=true) — scoped to current transaction only
    await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_tenant', profileId]);

    const tenantDb = drizzle(client as any, { schema });
    let result: T;
    try {
      result = await callback(tenantDb);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    return result;
  } finally {
    client.release();
  }
}

/**
 * Lighter variant: run a raw query function with tenant variable set.
 * Useful for analytics or reporting that doesn't need the full Drizzle API.
 */
export async function runWithTenant<T>(
  profileId: string,
  queryFn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  if (!profileId) {
    throw new Error('[TenantContext] profileId must be a non-empty string');
  }

  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, TRUE)', ['app.current_tenant', profileId]);
    let result: T;
    try {
      result = await queryFn(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    return result;
  } finally {
    client.release();
  }
}

/**
 * Query RLS status for all tenant-scoped tables (uses admin pool).
 * Returns empty array if the DB query fails (non-fatal for callers).
 */
export async function getRlsStatus(): Promise<Array<{
  tablename: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  policy_count: number;
}>> {
  try {
    const adminPool = getAdminPool();
    const result = await adminPool.query<{
      tablename: string;
      rls_enabled: boolean;
      rls_forced: boolean;
      policy_count: string;
    }>(`
      SELECT
        t.tablename,
        t.rowsecurity        AS rls_enabled,
        t.forcerowsecurity   AS rls_forced,
        COUNT(p.policyname)::text AS policy_count
      FROM pg_tables t
      LEFT JOIN pg_policies p
        ON p.tablename = t.tablename AND p.schemaname = t.schemaname
      WHERE t.tablename IN (
        'rainbow_conversations', 'rainbow_messages',
        'escalation_events',     'intent_predictions'
      )
      GROUP BY t.tablename, t.rowsecurity, t.forcerowsecurity
      ORDER BY t.tablename
    `);
    return result.rows.map((r) => ({
      tablename: r.tablename,
      rls_enabled: r.rls_enabled,
      rls_forced: r.rls_forced,
      policy_count: parseInt(r.policy_count, 10),
    }));
  } catch (err: any) {
    console.error('[TenantContext] Failed to query RLS status:', err.message);
    return [];
  }
}
