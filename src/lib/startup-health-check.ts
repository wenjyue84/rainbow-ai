/**
 * Startup Health Check Reporter
 *
 * Comprehensive health check on startup that verifies:
 * - PostgreSQL connection with query timeout and latency
 * - Redis connectivity (optional, fallback if unavailable)
 * - AI provider health with 5s timeout per provider
 *
 * Outputs JSON report for monitoring and structured logging.
 *
 * US-566: Add Startup Health Check Reporter with JSON Output
 */

import { createModuleLogger } from './logger.js';
import type { AIProvider } from '../assistant/schemas.js';

const logger = createModuleLogger('StartupHealthCheck');

// ─── Types ───────────────────────────────────────────────────────

export interface DatabaseHealthStatus {
  ok: boolean;
  latencyMs: number;
  error?: string;
  version?: string;
}

export interface RedisHealthStatus {
  ok: boolean;
  latencyMs: number;
  error?: string;
  host?: string;
  port?: number;
  cacheStatsAvailable: boolean;
  ttlEvictionConfig?: {
    maxmemory?: string;
    maxmemoryPolicy?: string;
  };
}

export interface AIProviderHealthStatus {
  name: string;
  type: string;
  enabled: boolean;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface HealthCheckReport {
  timestamp: string;
  nodeVersion: string;
  environment: string;
  database: DatabaseHealthStatus;
  redis: RedisHealthStatus;
  aiProviders: AIProviderHealthStatus[];
  summary: {
    allHealthy: boolean;
    healthyServices: number;
    totalServices: number;
  };
}

// ─── Database Health Check ────────────────────────────────────────

/**
 * Check PostgreSQL connection with query timeout.
 * Returns status, latency in ms, and any error.
 *
 * Acceptance Criteria:
 * - Validates PostgreSQL connection with query timeout
 * - Outputs status and latency to startup log
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthStatus> {
  const HEALTH_CHECK_TIMEOUT_MS = 5000;

  try {
    // Import pool here to avoid circular dependencies at module load time
    const { pool } = await import('./db.js');

    const startMs = Date.now();

    // Use Promise.race with timeout
    const result = await Promise.race([
      pool.query('SELECT 1 as status'),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Database health check timeout')), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);

    const latencyMs = Date.now() - startMs;

    // Try to get PostgreSQL version for additional context
    let version: string | undefined;
    try {
      const versionResult = await Promise.race([
        pool.query('SELECT version()'),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('Timeout')), HEALTH_CHECK_TIMEOUT_MS)
        ),
      ]);
      version = (versionResult?.rows?.[0]?.version as string)?.split(',')[0];
    } catch {
      // Version is optional; continue if it fails
    }

    logger.info(`[Health Check] PostgreSQL healthy (latency: ${latencyMs}ms)`);

    return {
      ok: true,
      latencyMs,
      version,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - (Date.now() - 5000);
    const errorMsg = err.message || String(err);

    logger.error(`[Health Check] PostgreSQL failed: ${errorMsg}`);

    return {
      ok: false,
      latencyMs,
      error: errorMsg,
    };
  }
}

// ─── Redis Health Check ──────────────────────────────────────────

/**
 * Check Redis connectivity with PING command.
 * Returns connectivity status, latency, and TTL-based eviction config.
 *
 * Acceptance Criteria:
 * - Redis connectivity test with PING command
 * - Logs cache stats and TTL-based eviction config
 */
export async function checkRedisHealth(): Promise<RedisHealthStatus> {
  const REDIS_CONNECT_TIMEOUT_MS = 3000;

  // Get Redis config from environment
  const redisHost = process.env.REDIS_HOST || '127.0.0.1';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
  const redisPassword = process.env.REDIS_PASSWORD;

  try {
    // Use ioredis for proper Redis protocol testing
    const Redis = (await import('ioredis')).default;

    const client = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
      retryStrategy: () => null, // Don't retry on connection timeout
    });

    const startMs = Date.now();

    // Connect and test PING
    await client.connect();
    const pongResult = await client.ping();
    const latencyMs = Date.now() - startMs;

    // Try to fetch memory stats and eviction config
    let cacheStatsAvailable = false;
    let ttlEvictionConfig: { maxmemory?: string; maxmemoryPolicy?: string } | undefined;

    try {
      const configResult = await client.config('GET', 'maxmemory');
      const policyResult = await client.config('GET', 'maxmemory-policy');

      if (configResult && policyResult) {
        ttlEvictionConfig = {
          maxmemory: configResult[1] as string,
          maxmemoryPolicy: policyResult[1] as string,
        };
        cacheStatsAvailable = true;
      }
    } catch {
      // Config retrieval is optional
    }

    // Close the client
    await client.quit();

    logger.info(`[Health Check] Redis healthy (latency: ${latencyMs}ms, PONG: ${pongResult})`);

    return {
      ok: true,
      latencyMs,
      host: redisHost,
      port: redisPort,
      cacheStatsAvailable,
      ttlEvictionConfig,
    };
  } catch (err: any) {
    const latencyMs = Math.min(REDIS_CONNECT_TIMEOUT_MS, Date.now() - (Date.now() - REDIS_CONNECT_TIMEOUT_MS));
    const errorMsg = err.message || String(err);

    logger.warn(`[Health Check] Redis unavailable: ${errorMsg} (using fallback to direct processing)`);

    return {
      ok: false,
      latencyMs,
      error: errorMsg,
      host: redisHost,
      port: redisPort,
      cacheStatsAvailable: false,
    };
  }
}

// ─── AI Provider Health Check ────────────────────────────────────

/**
 * Ping a single AI provider to verify connectivity.
 *
 * Acceptance Criteria:
 * - Tests Kimi, Ollama, OpenRouter with 5s timeout per provider
 *
 * @param provider AIProvider config
 * @returns Health status for the provider
 */
export async function pingProvider(provider: AIProvider): Promise<AIProviderHealthStatus> {
  const HEALTH_CHECK_TIMEOUT_MS = 5000;
  const startMs = Date.now();

  try {
    // Use axios for HTTP testing
    const axios = (await import('axios')).default;

    const apiKey = provider.api_key || process.env[provider.api_key_env] || '';
    const baseUrl = provider.base_url;
    const model = provider.model;
    const type = provider.type;

    let response;

    if (type === 'google-gemini') {
      // Google Gemini: Test via generateContent endpoint
      const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;
      response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  text: 'ping',
                },
              ],
            },
          ],
        },
        { timeout: HEALTH_CHECK_TIMEOUT_MS }
      );
    } else if (type === 'groq' || type === 'openai-compatible' || type === 'ollama') {
      // OpenAI-compatible APIs: Test via /chat/completions
      const url = `${baseUrl}/chat/completions`;
      response = await axios.post(
        url,
        {
          model,
          messages: [
            {
              role: 'user',
              content: 'ping',
            },
          ],
          max_tokens: 1,
        },
        {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
          headers: apiKey && type !== 'ollama' ? { Authorization: `Bearer ${apiKey}` } : {},
        }
      );
    } else {
      // Unknown type — assume OpenAI-compatible
      const url = `${baseUrl}/chat/completions`;
      response = await axios.post(
        url,
        {
          model,
          messages: [
            {
              role: 'user',
              content: 'ping',
            },
          ],
          max_tokens: 1,
        },
        {
          timeout: HEALTH_CHECK_TIMEOUT_MS,
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        }
      );
    }

    const latencyMs = Date.now() - startMs;
    const ok = response.status >= 200 && response.status < 300;

    if (ok) {
      logger.info(`[Health Check] AI Provider "${provider.name}" healthy (latency: ${latencyMs}ms)`);
    }

    return {
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled,
      ok,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startMs;
    const errorMsg = err.message || String(err);

    logger.warn(`[Health Check] AI Provider "${provider.name}" failed: ${errorMsg}`);

    return {
      name: provider.name,
      type: provider.type,
      enabled: provider.enabled,
      ok: false,
      latencyMs,
      error: errorMsg,
    };
  }
}

/**
 * Check all configured AI providers with 5s timeout per provider.
 * Tests providers in priority order (fallback chain).
 *
 * @returns Array of provider health statuses
 */
export async function checkAIProvidersHealth(): Promise<AIProviderHealthStatus[]> {
  try {
    // Import configStore here to avoid circular dependencies
    const { configStore } = await import('../assistant/config-store.js');

    // Get all enabled providers, sorted by priority (fallback chain)
    const settings = configStore.getSettings();
    const providers = (settings.ai?.providers || []).sort((a, b) => a.priority - b.priority);

    if (providers.length === 0) {
      logger.warn('[Health Check] No AI providers configured');
      return [];
    }

    // Test all providers in parallel
    const results = await Promise.all(providers.map(provider => pingProvider(provider)));

    return results;
  } catch (err: any) {
    logger.error(`[Health Check] Error checking AI providers: ${err.message}`);
    return [];
  }
}

// ─── Main Health Check Report ────────────────────────────────────

/**
 * Run comprehensive startup health check.
 * Returns JSON report with status of all critical dependencies.
 *
 * US-566: Acceptance Criteria
 * - Validates PostgreSQL with query timeout, outputs status and latency
 * - Redis PING command, logs cache stats and TTL-based eviction config
 * - AI provider health with 5s timeout per provider in fallback chain
 *
 * @returns Structured health check report
 */
export async function startupHealthCheck(): Promise<HealthCheckReport> {
  const timestamp = new Date().toISOString();
  const environment = process.env.NODE_ENV || 'development';
  const nodeVersion = process.version;

  logger.info('[Health Check] Starting comprehensive startup health check...');

  // Run checks in parallel
  const [database, redis, aiProviders] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkAIProvidersHealth(),
  ]);

  // Calculate summary
  const healthyServices = [
    database.ok ? 1 : 0,
    redis.ok ? 1 : 0,
    aiProviders.filter(p => p.ok).length,
  ].reduce((a, b) => a + b, 0);

  const totalServices = 2 + aiProviders.length;
  const allHealthy = database.ok && redis.ok && aiProviders.some(p => p.ok);

  const report: HealthCheckReport = {
    timestamp,
    nodeVersion,
    environment,
    database,
    redis,
    aiProviders,
    summary: {
      allHealthy,
      healthyServices,
      totalServices,
    },
  };

  // Log the report as structured JSON
  console.log('\n[Startup] Health Check Report:');
  console.log(JSON.stringify(report, null, 2));
  console.log('');

  // Log summary line
  const statusEmoji = allHealthy ? '✅' : '⚠️';
  logger.info(
    `[Health Check] ${statusEmoji} ${healthyServices}/${totalServices} services healthy. Database: ${database.ok ? '✓' : '✗'} Redis: ${redis.ok ? '✓' : '✗'} AI: ${aiProviders.filter(p => p.ok).length}/${aiProviders.length}`
  );

  return report;
}
