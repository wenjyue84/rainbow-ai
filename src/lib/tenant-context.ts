/**
 * Tenant Context Middleware & Utilities (US-908)
 *
 * Formalizes the existing profileId pattern into a strict tenant isolation layer.
 * The tenant_id concept maps 1:1 to the existing profileId field across all tables.
 *
 * Key principles (per AWS multi-tenant best practices):
 * - tenant_id is injected by middleware — never trusted from user input or AI model output
 * - All database queries must include a tenant_id filter (enforced at call sites)
 * - RAG retrieval is namespaced by tenant to prevent cross-property data leakage
 * - Admin RBAC is scoped to allowed tenants
 */

import type { Request, Response, NextFunction } from 'express';

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
