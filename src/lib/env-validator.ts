/**
 * Environment variable validation for Rainbow AI startup.
 *
 * Checks required vars (DATABASE_URL, MCP_SERVER_PORT, NODE_ENV) and optional vars.
 * Validates format (postgres:// for DB URL, numeric port in range 1024-65535).
 * Throws with all failures listed if any required var is missing or invalid.
 */

import { z } from 'zod';

// ─── Validation Schemas ──────────────────────────────────────────

const postgresUrlSchema = z
  .string()
  .refine(
    (val) => val.startsWith('postgres://') || val.startsWith('postgresql://'),
    { message: 'must start with postgres:// or postgresql://' }
  );

const portSchema = z
  .number()
  .int()
  .min(1024, { message: 'must be >= 1024' })
  .max(65535, { message: 'must be <= 65535' });

const nodeEnvSchema = z.enum(['development', 'production']);

// ─── Validation Function ────────────────────────────────────────

/**
 * Validate all required and optional environment variables.
 * Throws descriptive error if any required var is missing or invalid.
 * Logs warnings for missing optional vars.
 */
export function validateEnvironment(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required: DATABASE_URL (postgres connection string)
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    errors.push('DATABASE_URL: required environment variable not set');
  } else {
    const dbResult = postgresUrlSchema.safeParse(dbUrl);
    if (!dbResult.success) {
      errors.push(`DATABASE_URL: ${dbResult.error.issues[0]?.message || 'invalid postgres:// URL'}`);
    }
  }

  // Required: MCP_SERVER_PORT (numeric, 1024-65535)
  const portStr = process.env.MCP_SERVER_PORT;
  if (!portStr) {
    errors.push('MCP_SERVER_PORT: required environment variable not set');
  } else {
    const port = parseInt(portStr, 10);
    if (isNaN(port)) {
      errors.push(`MCP_SERVER_PORT: must be a number, got "${portStr}"`);
    } else {
      const portResult = portSchema.safeParse(port);
      if (!portResult.success) {
        errors.push(`MCP_SERVER_PORT: ${portResult.error.issues[0]?.message || 'must be between 1024-65535'}`);
      }
    }
  }

  // Required: NODE_ENV (development or production)
  const nodeEnv = process.env.NODE_ENV;
  if (!nodeEnv) {
    errors.push('NODE_ENV: required environment variable not set (must be "development" or "production")');
  } else {
    const envResult = nodeEnvSchema.safeParse(nodeEnv);
    if (!envResult.success) {
      errors.push(`NODE_ENV: must be "development" or "production", got "${nodeEnv}"`);
    }
  }

  // Optional: DIGIMAN_API_URL (warn if missing)
  if (!process.env.DIGIMAN_API_URL) {
    warnings.push('  DIGIMAN_API_URL: not set (admin API integration disabled)');
  }

  // Optional: DIGIMAN_API_TOKEN (warn if missing)
  if (!process.env.DIGIMAN_API_TOKEN) {
    warnings.push('  DIGIMAN_API_TOKEN: not set (admin API integration disabled)');
  }

  // Log warnings for optional vars
  if (warnings.length > 0) {
    console.warn('[Startup] Environment warnings:');
    warnings.forEach(w => console.warn(w));
  }

  // Throw consolidated error if any required var is missing/invalid
  if (errors.length > 0) {
    const message = [
      '[Startup] FATAL: Environment validation failed:',
      ...errors.map(e => `  ${e}`),
    ].join('\n');
    throw new Error(message);
  }
}
