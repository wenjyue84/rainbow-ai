/**
 * config-audit-log.ts — Admin Configuration Audit Log API (US-257)
 *
 * Provides:
 *   GET /api/admin/audit-log          — list all config changes (20+ recent)
 *   GET /api/admin/audit-log?file=settings.json — filter by config file
 *
 * Also exports configAuditMiddleware() — Express middleware that intercepts
 * config mutation endpoints (POST/PUT/PATCH/DELETE on /settings, /workflows,
 * /knowledge, /routing) and logs changes with unified diff output.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { logConfigChange, getAuditLog } from '../../lib/config-audit.js';
import { createModuleLogger } from '../../lib/logger.js';

const logger = createModuleLogger('ConfigAuditLog');
const router = Router();

// ─── Config file mapping ─────────────────────────────────────────────
// Maps URL path segments to config file names for audit trail tracking
const CONFIG_PATH_MAP: Record<string, string> = {
  settings: 'settings.json',
  workflows: 'workflows.json',
  knowledge: 'knowledge.json',
  routing: 'routing.json',
  intents: 'intents.json',
  templates: 'templates.json',
};

// ─── GET /api/admin/audit-log ────────────────────────────────────────

/**
 * Retrieve configuration audit log entries.
 *
 * Query params:
 *   - file: config file name filter (e.g., "settings.json")
 *   - limit: max results (default 50, minimum 20 per AC)
 *
 * Returns 20+ recent changes with diffs per US-257 AC3.
 */
router.get('/audit-log', async (req: Request, res: Response) => {
  try {
    const file = req.query.file as string | undefined;
    const limitParam = parseInt(String(req.query.limit || '50'), 10);
    const limit = Math.max(isNaN(limitParam) ? 50 : limitParam, 20);

    const entries = await getAuditLog(file, limit);

    logger.info('Audit log queried', {
      file: file || 'all',
      count: entries.length,
      limit,
    });

    res.json({
      success: true,
      file: file || null,
      count: entries.length,
      entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Audit log query failed', { error: message });
    res.status(500).json({
      error: 'Failed to retrieve audit log',
      details: message,
    });
  }
});

// ─── Config Audit Middleware ─────────────────────────────────────────

/**
 * Express middleware that captures before/after state for config mutations.
 *
 * Intercepts POST/PUT/PATCH/DELETE requests to config endpoints and records
 * the change with unified diff in the admin_audit_log table.
 *
 * Works by monkey-patching res.json() to capture the response body,
 * then logging the change asynchronously after the response is sent.
 */
export function configAuditMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only intercept mutation methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      next();
      return;
    }

    // Determine which config file this request targets
    const configFile = resolveConfigFile(req.path);
    if (!configFile) {
      next();
      return;
    }

    // Capture the request body as the "after" state
    const requestBody = req.body;
    const adminUser = (req.headers['x-admin-role'] as string) || 'admin';

    // Monkey-patch res.json to capture the response and log the change
    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      // Log the config change asynchronously (don't block response)
      setImmediate(() => {
        try {
          // Extract before/after from the response if available
          const before = body?.before ?? null;
          const after = body?.after ?? requestBody;

          logConfigChange(configFile, adminUser, before, after).catch((err) => {
            logger.error('Async audit log failed', { error: String(err) });
          });
        } catch (err) {
          logger.error('Audit middleware error', { error: String(err) });
        }
      });

      return originalJson(body);
    } as typeof res.json;

    next();
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Resolve a request path to a config file name.
 * Returns null if the path doesn't match a known config endpoint.
 */
function resolveConfigFile(path: string): string | null {
  // Remove leading slash and split
  const segments = path.replace(/^\/+/, '').split('/');
  const firstSegment = segments[0];

  if (firstSegment && CONFIG_PATH_MAP[firstSegment]) {
    return CONFIG_PATH_MAP[firstSegment];
  }

  return null;
}

export default router;
