export function resolveMigrationUrl(env) {
  const warnings = [];
  if (env.DATABASE_DIRECT_URL) {
    return { url: env.DATABASE_DIRECT_URL, warnings };
  }
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL or DATABASE_DIRECT_URL is required \u2014 ensure the database is provisioned"
    );
  }
  if (isPoolerUrl(env.DATABASE_URL)) {
    warnings.push(
      "DATABASE_DIRECT_URL is not set and DATABASE_URL appears to be a pooled connection. Schema migrations may fail through PgBouncer in transaction mode. Set DATABASE_DIRECT_URL to the direct (non-pooler) Neon connection string."
    );
  } else {
    warnings.push(
      "DATABASE_DIRECT_URL is not set \u2014 falling back to DATABASE_URL. For reliability, set DATABASE_DIRECT_URL to the direct Neon connection string."
    );
  }
  return { url: env.DATABASE_URL, warnings };
}

export function checkPoolerWarning(env) {
  if (!env.DATABASE_URL) return null;
  if (env.DATABASE_DIRECT_URL) return null;
  if (!isPoolerUrl(env.DATABASE_URL)) return null;
  return 'DATABASE_URL appears to be a pooled connection (contains "-pooler.") but DATABASE_DIRECT_URL is not set. Schema migrations (db:push, db:migrate) may fail through PgBouncer. Set DATABASE_DIRECT_URL to the direct Neon connection string.';
}

function isPoolerUrl(url) {
  return url.includes("-pooler.") || url.includes("pgbouncer");
}
