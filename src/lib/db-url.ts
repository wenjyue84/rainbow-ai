/**
 * db-url.ts — Database URL resolution utilities
 *
 * Separates the pooler URL (for application connections) from the direct URL
 * (for schema migrations). Neon's PgBouncer in transaction mode cannot handle
 * the multi-statement DDL sessions that Drizzle Kit migrations require.
 */

export interface DbUrlResolution {
  /** URL to use for the operation */
  url: string;
  /** Warnings generated during resolution */
  warnings: string[];
}

/**
 * Resolve the correct database URL for schema migrations.
 * Prefers DATABASE_DIRECT_URL; falls back to DATABASE_URL with warnings.
 */
export function resolveMigrationUrl(env: {
  DATABASE_URL?: string;
  DATABASE_DIRECT_URL?: string;
}): DbUrlResolution {
  const warnings: string[] = [];

  if (env.DATABASE_DIRECT_URL) {
    return { url: env.DATABASE_DIRECT_URL, warnings };
  }

  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL or DATABASE_DIRECT_URL is required — ensure the database is provisioned'
    );
  }

  // Falling back to DATABASE_URL — check if it's a pooler connection
  if (isPoolerUrl(env.DATABASE_URL)) {
    warnings.push(
      'DATABASE_DIRECT_URL is not set and DATABASE_URL appears to be a pooled connection. ' +
      'Schema migrations may fail through PgBouncer in transaction mode. ' +
      'Set DATABASE_DIRECT_URL to the direct (non-pooler) Neon connection string.'
    );
  } else {
    warnings.push(
      'DATABASE_DIRECT_URL is not set — falling back to DATABASE_URL. ' +
      'For reliability, set DATABASE_DIRECT_URL to the direct Neon connection string.'
    );
  }

  return { url: env.DATABASE_URL, warnings };
}

/**
 * Check if a DATABASE_URL appears to be a pooler connection and warn if
 * DATABASE_DIRECT_URL is not set.
 */
export function checkPoolerWarning(env: {
  DATABASE_URL?: string;
  DATABASE_DIRECT_URL?: string;
}): string | null {
  if (!env.DATABASE_URL) return null;
  if (env.DATABASE_DIRECT_URL) return null;
  if (!isPoolerUrl(env.DATABASE_URL)) return null;

  return (
    'DATABASE_URL appears to be a pooled connection (contains "-pooler.") ' +
    'but DATABASE_DIRECT_URL is not set. Schema migrations (db:push, db:migrate) may fail ' +
    'through PgBouncer. Set DATABASE_DIRECT_URL to the direct Neon connection string.'
  );
}

/** Detect pooler URLs by common patterns */
function isPoolerUrl(url: string): boolean {
  return url.includes('-pooler.') || url.includes('pgbouncer');
}
