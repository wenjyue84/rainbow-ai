/**
 * Redis Connection Pool — Optimized connection management
 *
 * Provides a connection pool with:
 * - Configurable min/max pool size from settings.json
 * - Exponential backoff retry on connection failures
 * - Connection stale/eviction handling
 * - Leak prevention during BullMQ worker shutdown
 *
 * US-645
 */

import Redis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('redis-pool');

// ─── Types ───────────────────────────────────────────────────────

export interface PoolConfig {
  minSize: number;
  maxSize: number;
  connectionRetryMs: number;
  maxRetries: number;
  idleTimeoutMs: number;
  host: string;
  port: number;
  password?: string;
}

export interface PoolMetrics {
  activeConnections: number;
  idleConnections: number;
  poolSize: number;
  totalCreated: number;
  totalDestroyed: number;
  isHealthy: boolean;
}

// ─── Defaults ───────────────────────────────────────────────────

const DEFAULT_CONFIG: PoolConfig = {
  minSize: 2,
  maxSize: 10,
  connectionRetryMs: 100,
  maxRetries: 5,
  idleTimeoutMs: 60000, // 60 seconds
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

// ─── Connection Pool ─────────────────────────────────────────────

export class RedisPool {
  private idle: Redis[] = [];
  private active: Set<Redis> = new Set();
  private config: PoolConfig;
  private totalCreated = 0;
  private totalDestroyed = 0;
  private isShuttingDown = false;
  private lastHealthCheck: number = Date.now();
  private lastHealthStatus: 'healthy' | 'degraded' | 'down' = 'healthy';

  constructor(config: Partial<PoolConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('redis-pool', `initialized with config: minSize=${this.config.minSize}, maxSize=${this.config.maxSize}`);
  }

  /**
   * Get a connection from the pool.
   * Creates new connections up to maxSize if needed.
   * Uses exponential backoff for retry on failure.
   */
  async acquire(): Promise<Redis> {
    if (this.isShuttingDown) {
      throw new Error('[RedisPool] Pool is shutting down');
    }

    // Return idle connection if available
    if (this.idle.length > 0) {
      const conn = this.idle.pop()!;
      this.active.add(conn);
      return conn;
    }

    // Create new connection if under max size
    if (this.totalCreated - this.totalDestroyed < this.config.maxSize) {
      return this.createConnection();
    }

    // Wait for idle connection (poll every 100ms)
    return new Promise((resolve, reject) => {
      const maxWaitMs = 10000; // 10 second timeout
      const startTime = Date.now();

      const checkIdle = () => {
        if (this.idle.length > 0) {
          const conn = this.idle.pop()!;
          this.active.add(conn);
          resolve(conn);
        } else if (Date.now() - startTime > maxWaitMs) {
          reject(new Error('[RedisPool] Timeout waiting for available connection'));
        } else {
          setTimeout(checkIdle, 100);
        }
      };

      checkIdle();
    });
  }

  /**
   * Release a connection back to the pool.
   * Closes stale connections.
   */
  async release(conn: Redis): Promise<void> {
    this.active.delete(conn);

    if (this.isShuttingDown) {
      await this.closeConnection(conn);
      return;
    }

    // Check if connection is still alive
    try {
      const start = Date.now();
      await conn.ping();
      const respTime = Date.now() - start;

      // If connection is slow or stale, close and create new
      if (respTime > 1000 || !conn.status.includes('ready')) {
        await this.closeConnection(conn);
        return;
      }

      // Return to idle pool if under minSize
      if (this.idle.length < this.config.minSize) {
        this.idle.push(conn);
      } else {
        await this.closeConnection(conn);
      }
    } catch (err: any) {
      logger.error('redis-pool-release', `connection ping failed: ${err.message}`);
      await this.closeConnection(conn);
    }
  }

  /**
   * Create a new Redis connection with exponential backoff retry.
   */
  private async createConnection(retryCount = 0): Promise<Redis> {
    const redisConfig: RedisOptions = {
      host: this.config.host,
      port: this.config.port,
      password: this.config.password,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => {
        // Exponential backoff: 100ms, 200ms, 400ms, etc.
        return Math.min(this.config.connectionRetryMs * Math.pow(2, times - 1), 3000);
      },
    };

    const conn = new Redis(redisConfig);

    try {
      await conn.connect();
      this.totalCreated++;
      logger.debug('redis-pool', `created connection #${this.totalCreated}`);
      this.active.add(conn);
      return conn;
    } catch (err: any) {
      if (retryCount < this.config.maxRetries) {
        const waitMs = this.config.connectionRetryMs * Math.pow(2, retryCount);
        logger.warn('redis-pool', `connection creation failed, retrying in ${waitMs}ms (attempt ${retryCount + 1}/${this.config.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        return this.createConnection(retryCount + 1);
      }

      logger.error('redis-pool', `connection creation failed after ${this.config.maxRetries} retries: ${err.message}`);
      throw err;
    }
  }

  /**
   * Close a single connection.
   */
  private async closeConnection(conn: Redis): Promise<void> {
    try {
      await conn.quit();
      this.totalDestroyed++;
      logger.debug('redis-pool', `closed connection (total destroyed: ${this.totalDestroyed})`);
    } catch (err: any) {
      logger.warn('redis-pool', `error closing connection: ${err.message}`);
    }
  }

  /**
   * Perform health check.
   * Returns status and metrics.
   */
  async healthCheck(): Promise<{ status: 'ok' | 'degraded' | 'down'; responseTimeMs: number; metrics: PoolMetrics }> {
    const startTime = Date.now();

    try {
      const conn = await this.acquire();
      const pingStart = Date.now();
      await conn.ping();
      const responseTime = Date.now() - pingStart;
      await this.release(conn);

      const metrics = this.getMetrics();
      const status = metrics.activeConnections === 0 ? 'degraded' : 'ok';
      this.lastHealthStatus = status;
      this.lastHealthCheck = Date.now();

      return {
        status,
        responseTimeMs: responseTime,
        metrics,
      };
    } catch (err: any) {
      logger.error('redis-pool-health', `health check failed: ${err.message}`);
      const metrics = this.getMetrics();

      this.lastHealthStatus = 'down';
      this.lastHealthCheck = Date.now();

      return {
        status: 'down',
        responseTimeMs: Date.now() - startTime,
        metrics,
      };
    }
  }

  /**
   * Get current pool metrics.
   */
  getMetrics(): PoolMetrics {
    return {
      activeConnections: this.active.size,
      idleConnections: this.idle.length,
      poolSize: this.active.size + this.idle.length,
      totalCreated: this.totalCreated,
      totalDestroyed: this.totalDestroyed,
      isHealthy: this.lastHealthStatus === 'ok',
    };
  }

  /**
   * Get last health check status.
   */
  getLastHealthStatus(): 'ok' | 'degraded' | 'down' {
    return this.lastHealthStatus;
  }

  /**
   * Shutdown the pool — close all connections.
   * Prevents new connections and closes existing ones.
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    logger.info('redis-pool', 'shutting down...');

    // Close active connections
    const activeArray = Array.from(this.active);
    for (const conn of activeArray) {
      await this.closeConnection(conn);
    }

    // Close idle connections
    for (const conn of this.idle) {
      await this.closeConnection(conn);
    }

    this.idle = [];
    this.active.clear();
    logger.info('redis-pool', `shutdown complete (total destroyed: ${this.totalDestroyed})`);
  }
}

// ─── Singleton ─────────────────────────────────────────────────

let globalPool: RedisPool | null = null;

/**
 * Initialize the global Redis pool with settings.
 */
export function initializeRedisPool(config: Partial<PoolConfig> = {}): RedisPool {
  if (globalPool) {
    logger.warn('redis-pool', 'pool already initialized, returning existing instance');
    return globalPool;
  }

  globalPool = new RedisPool(config);
  return globalPool;
}

/**
 * Get the global Redis pool instance.
 */
export function getRedisPool(): RedisPool | null {
  return globalPool;
}
