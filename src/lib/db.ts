import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import dotenv from 'dotenv';
import * as schema from '../../shared/schema.js';
import { checkPoolerWarning } from './db-url.js';

// CRITICAL: Load .env before accessing process.env
// This module is imported early, before index.ts calls dotenv.config()
dotenv.config();

const { Pool } = pg;

// Log database configuration (without credentials)
const dbUrl = process.env.DATABASE_URL;
if (dbUrl) {
  const maskedUrl = dbUrl.replace(/:([^:@]+)@/, ':***@');
  console.log('[DB] Connection string loaded:', maskedUrl.substring(0, 60) + '...');

  // Warn if using a pooler URL without a direct URL for migrations
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

// Neon load-balancer forcibly closes idle connections at 300 s.
// idleTimeoutMillis must be < 300_000 ms to avoid client-side surprises.
const NEON_IDLE_LIMIT_MS = 300_000;
const POOL_IDLE_TIMEOUT_MS = 30_000;

if (POOL_IDLE_TIMEOUT_MS >= NEON_IDLE_LIMIT_MS) {
  console.warn(
    `[DB] ⚠️ idleTimeoutMillis (${POOL_IDLE_TIMEOUT_MS}ms) >= Neon idle limit ` +
    `(${NEON_IDLE_LIMIT_MS}ms). Connections may be closed by the load-balancer before ` +
    'the pool evicts them. Lower idleTimeoutMillis below 300 000.'
  );
}

// Database connection pool with improved configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('neon.tech')
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10, // Maximum pool size
  idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS, // Close idle clients after 30 s (well under Neon's 300 s limit)
  connectionTimeoutMillis: 15000, // Timeout after 15 seconds (Neon cold start can be slow)
  maxUses: 7500, // Recycle connections to prevent slow memory leaks
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('[DB] ⚠️ Unexpected pool error:', err.message);
});

/** Returns synchronous pool metrics without issuing any DB query. */
export function getPoolMetrics() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export { pool };
export const db = drizzle(pool, { schema });

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

// Export connection test as a promise that can be awaited
export const dbReady = testConnection();
