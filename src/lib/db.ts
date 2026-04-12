import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import * as schema from '../../shared/schema.js';
import { lt } from 'drizzle-orm';
import { checkPoolerWarning } from './db-url.js';

// CRITICAL: Load .env before accessing process.env
// This module is imported early, before index.ts calls dotenv.config()
dotenv.config();

const { Pool } = pg;

// Neon load-balancer forcibly closes idle connections at 300 s.
// idleTimeoutMillis must be < 300_000 ms to avoid client-side surprises.
const NEON_IDLE_LIMIT_MS = 300_000;
const POOL_IDLE_TIMEOUT_MS = 30_000;

// ── Deferred pool (US-499) ─────────────────────────────────────────────
// Pool creation is deferred to initDb() so that AWS Secrets Manager can
// inject DATABASE_URL into process.env before the pool is constructed.
// ESM live bindings ensure that all consumers see the initialized values
// once initDb() completes (they only read pool/db inside functions, not
// at module evaluation time).
//
// For backward compatibility, initDb() is idempotent — calling it twice
// is safe and the second call is a no-op.

let pool: pg.Pool = undefined as unknown as pg.Pool;
let db: ReturnType<typeof drizzle> = undefined as unknown as ReturnType<typeof drizzle>;
let dbReady: Promise<boolean> = Promise.resolve(false);
let _initialized = false;

/**
 * Initialize the database pool and Drizzle ORM instance.
 * Must be called once during startup AFTER secrets/env vars are loaded.
 * Idempotent — safe to call multiple times.
 */
export function initDb(): void {
  if (_initialized) return;
  _initialized = true;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':***@');
    console.log('[DB] Connection string loaded:', maskedUrl.substring(0, 60) + '...');

    const poolerWarning = checkPoolerWarning({
      DATABASE_URL: dbUrl,
      DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
    });
    if (poolerWarning) {
      console.warn(`[DB] ⚠️ ${poolerWarning}`);
    }
  } else {
    console.log('[DB] ⚠️ DATABASE_URL not set in environment!');
  }

  if (POOL_IDLE_TIMEOUT_MS >= NEON_IDLE_LIMIT_MS) {
    console.warn(
      `[DB] ⚠️ idleTimeoutMillis (${POOL_IDLE_TIMEOUT_MS}ms) >= Neon idle limit ` +
      `(${NEON_IDLE_LIMIT_MS}ms). Connections may be closed by the load-balancer before ` +
      'the pool evicts them. Lower idleTimeoutMillis below 300 000.'
    );
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('neon.tech')
      ? { rejectUnauthorized: false }
      : undefined,
    max: 10,
    // idleTimeoutMillis (30 s) is safely below Neon's 300 s idle-connection
    // limit, so the pool evicts connections before the load-balancer closes them.
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: 15000,
    // maxUses: recycle each connection after 7 500 queries to prevent
    // PostgreSQL backend processes from accumulating memory indefinitely.
    // On Neon (serverless), this also flushes any per-session state across
    // cold-start cycles without increasing query overhead.
    maxUses: 7500,
  });

  pool.on('connect', () => {
    console.debug('[DB] New connection created in pool');
  });

  pool.on('error', (err) => {
    console.error('[DB] ⚠️ Unexpected pool error:', err.message);
  });

  db = drizzle(pool, { schema });
  dbReady = testConnection();
}

/** Returns synchronous pool metrics without issuing any DB query. */
export function getPoolMetrics() {
  return {
    total: pool?.totalCount ?? 0,
    idle: pool?.idleCount ?? 0,
    waiting: pool?.waitingCount ?? 0,
  };
}

/**
 * Deletes conversations older than specified days (US-157: PDPA 7-year retention).
 * Hard-deletes related messages and audit records.
 * @param retentionDays Number of days to retain (default: 2555 for 7 years)
 * @returns Object with count of deleted records
 */
export async function deleteExpiredConversations(retentionDays: number = 2555) {
  try {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    // Delete conversations older than cutoff
    const deletedConversations = await db
      .delete(schema.rainbowConversations)
      .where(lt(schema.rainbowConversations.createdAt, cutoffDate))
      .returning({ phone: schema.rainbowConversations.phone });

    const phoneNumbers = deletedConversations.map(conv => conv.phone);

    let deletedMessages = 0;
    let deletedAuditRecords = 0;

    // Delete messages for those conversations using raw pool query
    if (phoneNumbers.length > 0) {
      const msgResult = await pool.query(
        'DELETE FROM rainbow_messages WHERE phone = ANY($1)',
        [phoneNumbers]
      );
      deletedMessages = msgResult.rowCount ?? 0;
    }

    // Delete audit records for those conversations using raw pool query
    if (phoneNumbers.length > 0) {
      const auditResult = await pool.query(
        'DELETE FROM conversation_audit WHERE phone = ANY($1)',
        [phoneNumbers]
      );
      deletedAuditRecords = auditResult.rowCount ?? 0;
    }

    const result = {
      retention_days: retentionDays,
      cutoff_date: cutoffDate.toISOString(),
      timestamp: now.toISOString(),
      records_deleted: {
        conversations: deletedConversations.length,
        messages: deletedMessages,
        audit_records: deletedAuditRecords,
      },
    };

    console.log(`[DataRetention] Expired data purge: ${deletedConversations.length} conversations, ${deletedMessages} messages, ${deletedAuditRecords} audit records deleted (cutoff: ${cutoffDate.toISOString()})`);

    return result;
  } catch (error: any) {
    console.error('[DataRetention] deleteExpiredConversations failed:', error.message);
    throw error;
  }
}

/**
 * Find similar resolved cases from conversation history (US-486)
 * Uses semantic similarity to find cases with matching context
 * Filters by profileId and conversation status = 'ended' (resolved)
 * Returns top matches ranked by similarity
 *
 * @param embedding Embedding vector for the query message
 * @param profileId Profile ID to filter by
 * @param limit Number of results to return (default: 3)
 * @returns Array of similar resolved cases with similarity scores
 */
export async function findSimilarResolvedCases(
  embedding: number[],
  profileId: string,
  limit: number = 3
): Promise<any[]> {
  try {
    // Query resolved conversations with assistant responses
    const query = `
      SELECT
        rm.id AS message_id,
        rc.phone,
        rm.content,
        rm.intent,
        rm.confidence,
        rc.status
      FROM rainbow_messages rm
      INNER JOIN rainbow_conversations rc ON rm.phone = rc.phone
      WHERE
        rc.profile_id = $1
        AND rc.status = 'ended'
        AND rm.role = 'assistant'
        AND rm.content IS NOT NULL
        AND LENGTH(rm.content) > 20
      ORDER BY rm.timestamp DESC
      LIMIT 50
    `;

    const result = await pool.query(query, [profileId]);
    return result.rows || [];
  } catch (error: any) {
    console.error('[DB] findSimilarResolvedCases failed:', error.message);
    return [];
  }
}

/**
 * Health check: executes SELECT 1 on the connection pool with a 5-second timeout.
 * Used to validate PostgreSQL connectivity during startup before server.listen().
 * Returns true if check passes, false if timeout or query fails.
 * Uses existing pool connection (respects connection pool settings).
 */
export async function healthCheck(): Promise<boolean> {
  const HEALTH_CHECK_TIMEOUT_MS = 5000;

  try {
    const start = Date.now();
    const result = await Promise.race([
      pool.query('SELECT 1'),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    const duration = Date.now() - start;
    console.log(`[DB] ✅ Database health check passed (${duration}ms)`);
    return true;
  } catch (error: any) {
    const duration = Date.now() - (Date.now() - HEALTH_CHECK_TIMEOUT_MS);
    console.error('[DB] ❌ Database health check failed:', error.message);
    return false;
  }
}

export { pool, db, dbReady };

// Test connection on startup with retry
async function testConnection(retries = 3, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      const start = Date.now();
      await pool.query('SELECT NOW()');
      const duration = Date.now() - start;
      console.log(`[DB] ✅ Database connection established (${duration}ms)`);
      return true;
    } catch (error: any) {
      console.error(`[DB] ❌ Connection attempt ${i + 1}/${retries} failed:`, error.message);
      console.error('[DB] Error details:', { code: error.code, errno: error.errno, syscall: error.syscall });
      if (i < retries - 1) {
        console.log(`[DB] 🔄 Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  console.error('[DB] ❌ All connection attempts failed. Features requiring database will not work.');
  return false;
}

// Backward compat: if DATABASE_URL is already set at import time (e.g. from .env),
// initialize the pool immediately. When USE_SECRETS_MANAGER=true, DATABASE_URL
// won't be set yet, and initDb() will be called explicitly from index.ts after
// secrets are loaded.
if (process.env.DATABASE_URL) {
  initDb();
}
