/**
 * rls-status.ts — US-1001: Row-Level Security admin status endpoint
 *
 * GET /rls-status — returns RLS enablement info for all tenant-scoped tables.
 * Used by the admin dashboard to verify that RLS is active after applying
 * migrations/rls-enable.sql.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getRlsStatus } from '../../lib/tenant-context.js';
import { ok, serverError } from './http-utils.js';

const router = Router();

/**
 * GET /rls-status
 * Returns the RLS configuration for the four tenant-scoped tables.
 * Uses the admin pool (BYPASSRLS) so it can read pg_tables regardless of tenant context.
 */
router.get('/rls-status', async (_req: Request, res: Response) => {
  try {
    const tables = await getRlsStatus();

    const allEnabled = tables.length > 0 && tables.every((t) => t.rls_enabled);
    const allForced  = tables.length > 0 && tables.every((t) => t.rls_forced);
    const allPolicied = tables.length > 0 && tables.every((t) => t.policy_count > 0);

    ok(res, {
      rls_active: allEnabled && allForced && allPolicied,
      tables,
      migration_required: tables.some((t) => !t.rls_enabled || !t.rls_forced || t.policy_count === 0),
      migration_file: 'migrations/rls-enable.sql',
      bypassrls_note:
        'Set DATABASE_ADMIN_URL to a connection string for a PostgreSQL role with BYPASSRLS ' +
        'so admin dashboard queries are not subject to per-tenant filtering.',
    });
  } catch (err: any) {
    serverError(res, err);
  }
});

export default router;
