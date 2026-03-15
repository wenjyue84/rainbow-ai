/**
 * Tenant Context Middleware (US-908)
 *
 * Enforces tenant_id isolation at the API layer for multi-property deployment.
 * Rainbow AI serves three distinct properties (Pelangi, Southern, Makan Moments)
 * sharing one backend. This middleware:
 *
 * 1. Reads the resolved profileId from res.locals.profileId (set by profile
 *    resolution middleware from x-profile-id header).
 * 2. Sets res.locals.tenantId as a canonical, middleware-enforced tenant
 *    identifier — never trusted from AI model output.
 * 3. For admin users with a tenantId scoping, validates the requested profile
 *    is within the admin user's allowed tenant scope.
 *
 * AWS Bedrock guidance: "securely pass tenant and user context between
 * deterministic components without relying on an AI model."
 */

import type { Request, Response, NextFunction } from 'express';

/** Tenant IDs that are valid in this deployment. */
export const KNOWN_TENANTS = ['pelangi', 'southern', 'makan-moments'] as const;
export type TenantId = typeof KNOWN_TENANTS[number];

/**
 * Middleware: inject res.locals.tenantId from the resolved profileId.
 *
 * Must be mounted AFTER profile resolution middleware (which sets
 * res.locals.profileId from x-profile-id header).
 *
 * For admin users with a scoped tenantId (adminUser.tenantId != null),
 * returns 403 if the requested profileId is outside their scope.
 */
export function tenantContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // profileId is set by profile resolution middleware
  const profileId = res.locals.profileId as string | undefined;

  // If no specific profile requested, tenantId remains undefined — callers
  // that require tenant context will use their own defaults (e.g. 'pelangi').
  if (!profileId) {
    next();
    return;
  }

  // Validate the requested tenant is known
  if (!(KNOWN_TENANTS as readonly string[]).includes(profileId)) {
    // Unknown tenant requested — log and proceed without setting tenantId
    // (rather than 400, to avoid breaking legacy clients sending unknown profileIds)
    console.warn(`[TenantContext] Unknown profileId requested: ${profileId}`);
    next();
    return;
  }

  // US-908: Admin RBAC scoping — if the authenticated admin is scoped to a
  // specific tenant, they must not access data from another tenant.
  const adminTenantId = res.locals.adminTenantId as string | undefined;
  if (
    adminTenantId &&
    adminTenantId !== profileId &&
    res.locals.adminRole !== 'super-admin'
  ) {
    res.status(403).json({
      error: 'Forbidden: admin account is not authorized for this tenant',
      requestedTenant: profileId,
      authorizedTenant: adminTenantId,
    });
    return;
  }

  // Set tenantId — downstream handlers must use this, never raw user input
  res.locals.tenantId = profileId;
  next();
}

/**
 * Extract tenantId from res.locals, defaulting to 'pelangi'.
 * Use this helper in route handlers to get the enforced tenant identifier.
 */
export function getTenantId(res: Response, fallback: string = 'pelangi'): string {
  return (res.locals.tenantId as string | undefined) ?? fallback;
}
