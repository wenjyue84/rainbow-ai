/**
 * Redis Pool Tests
 *
 * Tests connection pooling, health checks, and pool lifecycle.
 * US-645
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RedisPool, initializeRedisPool, getRedisPool } from '../../src/lib/redis-pool.js';
import type { PoolConfig } from '../../src/lib/redis-pool.js';

describe('RedisPool', () => {
  let pool: RedisPool;

  beforeEach(() => {
    // Reset global pool
    vi.resetModules();
  });

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  describe('initialization', () => {
    it('should create a pool with default config', () => {
      pool = new RedisPool();
      const metrics = pool.getMetrics();
      expect(metrics.poolSize).toBe(0);
      expect(metrics.totalCreated).toBe(0);
      expect(metrics.isHealthy).toBe(false);
    });

    it('should create a pool with custom config', () => {
      const config: Partial<PoolConfig> = {
        minSize: 3,
        maxSize: 15,
        connectionRetryMs: 50,
      };
      pool = new RedisPool(config);
      const metrics = pool.getMetrics();
      expect(metrics.poolSize).toBe(0);
    });

    it('should initialize global singleton pool', () => {
      const pool1 = initializeRedisPool({ minSize: 1, maxSize: 5 });
      const pool2 = getRedisPool();
      expect(pool1).toBe(pool2);
      pool = pool1;
    });

    it('should not reinitialize if pool already exists', () => {
      const pool1 = initializeRedisPool({ minSize: 1, maxSize: 5 });
      const pool2 = initializeRedisPool({ minSize: 10, maxSize: 20 });
      expect(pool1).toBe(pool2);
      pool = pool1;
    });
  });

  describe('pool metrics', () => {
    beforeEach(() => {
      pool = new RedisPool({ minSize: 2, maxSize: 5 });
    });

    it('should track active and idle connections', () => {
      const metrics = pool.getMetrics();
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.idleConnections).toBe(0);
      expect(metrics.poolSize).toBe(0);
    });

    it('should track total created connections', () => {
      let metrics = pool.getMetrics();
      expect(metrics.totalCreated).toBe(0);
      metrics = pool.getMetrics();
      expect(metrics.totalCreated).toBe(0);
    });

    it('should reflect health status', () => {
      const metrics = pool.getMetrics();
      expect(typeof metrics.isHealthy).toBe('boolean');
    });
  });

  describe('health check', () => {
    beforeEach(() => {
      pool = new RedisPool({
        host: 'invalid-redis-host',
        port: 6379,
        maxRetries: 1,
        connectionRetryMs: 10,
      });
    });

    it('should return health status', async () => {
      const health = await pool.healthCheck();
      expect(['ok', 'degraded', 'down']).toContain(health.status);
      expect(typeof health.responseTimeMs).toBe('number');
      expect(health.responseTimeMs >= 0).toBe(true);
    });

    it('should update last health status on check', async () => {
      const status1 = pool.getLastHealthStatus();
      expect(status1).toBeDefined();
      const health = await pool.healthCheck();
      const status2 = pool.getLastHealthStatus();
      expect(status2).toBeDefined();
    });

    it('should include metrics in health check result', async () => {
      const health = await pool.healthCheck();
      expect(health.metrics).toBeDefined();
      expect(typeof health.metrics.activeConnections).toBe('number');
      expect(typeof health.metrics.idleConnections).toBe('number');
      expect(typeof health.metrics.poolSize).toBe('number');
    });
  });

  describe('shutdown', () => {
    beforeEach(() => {
      pool = new RedisPool({ minSize: 1, maxSize: 3 });
    });

    it('should prevent new connections during shutdown', async () => {
      await pool.shutdown();
      await expect(pool.acquire()).rejects.toThrow();
    });

    it('should close all connections', async () => {
      await pool.shutdown();
      const metrics = pool.getMetrics();
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.idleConnections).toBe(0);
    });

    it('should handle multiple shutdown calls', async () => {
      await pool.shutdown();
      await expect(pool.shutdown()).resolves.not.toThrow();
    });
  });

  describe('configuration', () => {
    it('should accept custom pool size configuration', () => {
      pool = new RedisPool({ minSize: 5, maxSize: 20 });
      const metrics = pool.getMetrics();
      expect(metrics.poolSize).toBe(0);
      expect(metrics.totalCreated).toBe(0);
    });

    it('should expose pool metrics', () => {
      pool = new RedisPool();
      const metrics = pool.getMetrics();
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('idleConnections');
      expect(metrics).toHaveProperty('poolSize');
      expect(metrics).toHaveProperty('totalCreated');
      expect(metrics).toHaveProperty('totalDestroyed');
      expect(metrics).toHaveProperty('isHealthy');
    });
  });

  describe('singleton management', () => {
    it('should initialize global pool instance', () => {
      const pool1 = initializeRedisPool({ minSize: 1, maxSize: 5 });
      expect(pool1).toBeInstanceOf(RedisPool);
      pool = pool1;
    });

    it('should return same instance on subsequent init calls', () => {
      const pool1 = initializeRedisPool({ minSize: 1, maxSize: 5 });
      const pool2 = initializeRedisPool({ minSize: 10, maxSize: 20 });
      expect(pool1).toBe(pool2);
      pool = pool1;
    });

    it('should retrieve global pool instance', () => {
      const pool1 = initializeRedisPool({ minSize: 1, maxSize: 5 });
      const retrieved = getRedisPool();
      expect(retrieved).toBe(pool1);
      pool = pool1;
    });
  });
});
