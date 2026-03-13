/**
 * secrets.ts — AWS Secrets Manager integration (US-499)
 *
 * When USE_SECRETS_MANAGER=true, fetches sensitive credentials from AWS Secrets
 * Manager on startup and caches them in memory with a 1-hour TTL.  Falls back
 * to process.env (i.e. .env file) when USE_SECRETS_MANAGER is not set or false.
 *
 * Secrets are stored as a single JSON object in AWS Secrets Manager under a
 * configurable secret name (env: AWS_SECRET_NAME, default: "rainbow-ai/prod").
 *
 * Expected JSON shape in Secrets Manager:
 * {
 *   "DATABASE_URL": "postgresql://...",
 *   "DATABASE_DIRECT_URL": "postgresql://...",
 *   "GROQ_API_KEY": "gsk_...",
 *   "OPENROUTER_API_KEY": "sk-or-...",
 *   "GEMINI_API_KEY": "...",
 *   "MOONSHOT_API_KEY": "...",
 *   "NVIDIA_API_KEY": "...",
 *   "RAINBOW_FAILOVER_SECRET": "...",
 *   "RAINBOW_ADMIN_KEY": "...",
 *   "EVOLUTION_API_KEY": "..."
 * }
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// ── Types ──────────────────────────────────────────────────────────────
interface CachedSecrets {
  values: Record<string, string>;
  fetchedAt: number;
}

// ── Config ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SECRET_NAME = process.env.AWS_SECRET_NAME ?? 'rainbow-ai/prod';
const REGION = process.env.AWS_REGION ?? 'ap-southeast-1';

/** Keys that should be pulled from Secrets Manager and injected into process.env */
const MANAGED_KEYS = [
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'MOONSHOT_API_KEY',
  'NVIDIA_API_KEY',
  'RAINBOW_FAILOVER_SECRET',
  'RAINBOW_ADMIN_KEY',
  'EVOLUTION_API_KEY',
] as const;

// ── State ──────────────────────────────────────────────────────────────
let _cache: CachedSecrets | null = null;
let _client: SecretsManagerClient | null = null;

function isEnabled(): boolean {
  return process.env.USE_SECRETS_MANAGER === 'true';
}

function getClient(): SecretsManagerClient {
  if (!_client) {
    _client = new SecretsManagerClient({ region: REGION });
  }
  return _client;
}

// ── Core ───────────────────────────────────────────────────────────────

/**
 * Fetch secrets from AWS Secrets Manager.
 * Returns the parsed key/value pairs from the secret JSON string.
 */
async function fetchSecrets(): Promise<Record<string, string>> {
  const client = getClient();
  const command = new GetSecretValueCommand({ SecretId: SECRET_NAME });
  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret "${SECRET_NAME}" has no SecretString value`);
  }

  const parsed = JSON.parse(response.SecretString);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Secret "${SECRET_NAME}" is not a JSON object`);
  }

  return parsed as Record<string, string>;
}

/**
 * Get cached secrets, re-fetching if the cache has expired.
 * Called internally; does NOT inject into process.env (that only happens once at startup).
 */
async function getCachedSecrets(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.values;
  }

  const values = await fetchSecrets();
  _cache = { values, fetchedAt: now };
  return values;
}

/**
 * Initialize secrets.  Call once during startup BEFORE any module reads
 * process.env.DATABASE_URL etc.
 *
 * When USE_SECRETS_MANAGER=true:
 *   1. Fetches secrets from AWS Secrets Manager
 *   2. Injects managed keys into process.env (does NOT overwrite existing env values)
 *   3. Starts a background refresh timer
 *
 * When USE_SECRETS_MANAGER is not "true": no-op (uses .env file values).
 */
export async function initSecrets(): Promise<void> {
  if (!isEnabled()) {
    console.log('[Secrets] USE_SECRETS_MANAGER is not enabled — using .env file values');
    return;
  }

  console.log(`[Secrets] Fetching secrets from AWS Secrets Manager (${SECRET_NAME})...`);

  const secrets = await getCachedSecrets();
  let injected = 0;

  for (const key of MANAGED_KEYS) {
    const value = secrets[key];
    if (value !== undefined && value !== '') {
      // Only inject if not already set in environment (allows env overrides)
      if (!process.env[key]) {
        process.env[key] = value;
        injected++;
      }
    }
  }

  console.log(
    `[Secrets] Loaded ${Object.keys(secrets).length} secret(s), ` +
    `injected ${injected} into process.env`
  );

  // Start background refresh — re-fetches secrets and updates process.env
  // every TTL interval so rotated credentials take effect without restart.
  const refreshInterval = setInterval(async () => {
    try {
      const fresh = await fetchSecrets();
      _cache = { values: fresh, fetchedAt: Date.now() };

      // Update process.env with refreshed values
      for (const key of MANAGED_KEYS) {
        const value = fresh[key];
        if (value !== undefined && value !== '') {
          process.env[key] = value;
        }
      }
      console.log('[Secrets] Cache refreshed from AWS Secrets Manager');
    } catch (err: any) {
      console.error('[Secrets] Background refresh failed (using cached values):', err.message);
    }
  }, CACHE_TTL_MS);

  // Don't keep the process alive just for the refresh timer
  refreshInterval.unref();
}

/**
 * Health check — verifies Secrets Manager connectivity.
 * Returns true if secrets can be fetched, false otherwise.
 * Used by startup validation to fail loudly if SM is unreachable.
 */
export async function checkSecretsHealth(): Promise<{
  ok: boolean;
  detail: string;
}> {
  if (!isEnabled()) {
    return { ok: true, detail: 'Secrets Manager not enabled (using .env)' };
  }

  try {
    await getCachedSecrets();
    return { ok: true, detail: `Connected to ${SECRET_NAME}` };
  } catch (err: any) {
    return { ok: false, detail: `Cannot reach Secrets Manager: ${err.message}` };
  }
}

/** Returns the list of secret key names managed by this module. */
export function getManagedKeys(): readonly string[] {
  return MANAGED_KEYS;
}
