/**
 * Profile Isolation Enforcement Middleware (US-310)
 *
 * Validates that all route parameters and query parameters referencing a profile
 * match the active profile (req.query.profile or req.params.profile).
 * Logs violations to the `profile_isolation_violations` table for post-incident
 * review and prevents cross-profile data leakage.
 */
import type { Request, Response, NextFunction } from 'express';
import { db } from '../lib/db.js';
import { profileIsolationViolations } from '../../shared/schema-tables.js';

/** Violation record returned by the middleware for external consumption. */
export interface ProfileViolation {
  attemptedProfile: string;
  actualProfile: string;
  queryText: string;
  routePath: string;
  method: string;
  ipAddress: string | undefined;
}

/**
 * Extracts the "active profile" from the request.
 * Checks (in order): req.params.profileId, req.query.profile, header X-Profile-Id.
 * Returns undefined if no profile context is present (middleware becomes a no-op).
 */
function getActiveProfile(req: Request): string | undefined {
  return (
    (req.params?.profileId as string) ||
    (req.query?.profile as string) ||
    (req.headers?.['x-profile-id'] as string) ||
    undefined
  );
}

/**
 * Scans request body (JSON) for profileId / profile_id fields that differ
 * from the active profile. Returns the mismatched profile or null.
 */
function findBodyProfileMismatch(
  body: Record<string, unknown> | undefined,
  activeProfile: string,
): string | null {
  if (!body || typeof body !== 'object') return null;

  const bodyProfile =
    (body.profileId as string) ||
    (body.profile_id as string) ||
    (body.profile as string);

  if (bodyProfile && bodyProfile !== activeProfile) {
    return bodyProfile;
  }

  return null;
}

/**
 * Scans query-string parameters for a profile mismatch.
 * Looks at common alternative keys: profileId, profile_id.
 */
function findQueryProfileMismatch(
  query: Record<string, unknown>,
  activeProfile: string,
): string | null {
  const candidates = [query.profileId, query.profile_id] as (string | undefined)[];
  for (const candidate of candidates) {
    if (candidate && candidate !== activeProfile) {
      return candidate;
    }
  }
  return null;
}

/**
 * Logs a violation record to the database.
 * Failures are silently caught to avoid blocking request processing.
 */
export async function logViolation(violation: ProfileViolation): Promise<void> {
  try {
    await db.insert(profileIsolationViolations).values({
      attemptedProfile: violation.attemptedProfile,
      actualProfile: violation.actualProfile,
      queryText: violation.queryText.substring(0, 2000), // truncate for safety
      routePath: violation.routePath,
      method: violation.method,
      ipAddress: violation.ipAddress ?? null,
    });
  } catch (err: any) {
    // Logging failure must never block the request pipeline
    console.error('[ProfileIsolation] Failed to log violation:', err.message);
  }
}

/**
 * Express middleware factory that enforces profile isolation.
 *
 * Usage:
 * ```ts
 * router.use(enforceProfileIsolation());
 * ```
 *
 * When a cross-profile access is detected, the request is blocked with 403
 * and the violation is persisted to `profile_isolation_violations`.
 */
export function enforceProfileIsolation() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const activeProfile = getActiveProfile(req);

    // No profile context on request — skip validation (route doesn't use profiles)
    if (!activeProfile) {
      next();
      return;
    }

    // Check body for mismatched profile
    const bodyMismatch = findBodyProfileMismatch(
      req.body as Record<string, unknown>,
      activeProfile,
    );

    if (bodyMismatch) {
      const violation: ProfileViolation = {
        attemptedProfile: bodyMismatch,
        actualProfile: activeProfile,
        queryText: `Body contains profile=${bodyMismatch}`,
        routePath: req.originalUrl || req.path,
        method: req.method,
        ipAddress: req.ip || req.socket?.remoteAddress,
      };

      await logViolation(violation);

      res.status(403).json({
        error: 'Profile isolation violation',
        message: 'Request body references a different profile than the active context',
      });
      return;
    }

    // Check query-string for mismatched profile
    const queryMismatch = findQueryProfileMismatch(
      req.query as Record<string, unknown>,
      activeProfile,
    );

    if (queryMismatch) {
      const violation: ProfileViolation = {
        attemptedProfile: queryMismatch,
        actualProfile: activeProfile,
        queryText: `Query contains profileId=${queryMismatch}`,
        routePath: req.originalUrl || req.path,
        method: req.method,
        ipAddress: req.ip || req.socket?.remoteAddress,
      };

      await logViolation(violation);

      res.status(403).json({
        error: 'Profile isolation violation',
        message: 'Query parameter references a different profile than the active context',
      });
      return;
    }

    next();
  };
}

export default enforceProfileIsolation;
