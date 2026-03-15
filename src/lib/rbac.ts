/**
 * Role-Based Access Control middleware (US-898).
 *
 * Roles (highest → lowest privilege):
 *   super-admin  — full access including user management and data deletion
 *   operator     — manage conversations, send messages, update knowledge base
 *   viewer       — read-only access to analytics and conversations
 *
 * Usage:
 *   router.put('/config', checkRole(['operator', 'super-admin']), handler);
 *
 * The middleware reads `res.locals.adminRole` (set during auth) and returns
 * 403 if the user's role is not in the allowed list.
 */
import type { Request, Response, NextFunction } from 'express';
import type { AdminRole } from '../../shared/schema-tables.js';

/**
 * Express middleware factory that enforces role-based access.
 * @param allowed — array of roles permitted to access the route
 */
export function checkRole(allowed: readonly AdminRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = res.locals.adminRole as AdminRole | undefined;

    // If no role is set (legacy / local bypass), default to operator
    // to avoid breaking existing sessions during migration.
    const effectiveRole = role ?? 'operator';

    if (allowed.includes(effectiveRole)) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Forbidden: insufficient role',
      requiredRoles: allowed,
      currentRole: effectiveRole,
    });
  };
}
