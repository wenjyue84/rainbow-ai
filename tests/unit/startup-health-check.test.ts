/**
 * Tests for startup health check module
 *
 * US-566: Add Startup Health Check Reporter with JSON Output
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  checkDatabaseHealth,
  checkRedisHealth,
  checkAIProvidersHealth,
  startupHealthCheck,
  type HealthCheckReport,
  type DatabaseHealthStatus,
  type RedisHealthStatus,
  type AIProviderHealthStatus,
} from '../../src/lib/startup-health-check.js';

describe('Startup Health Check', () => {
  describe('checkDatabaseHealth', () => {
    it('returns a status object with required fields', async () => {
      const result = await checkDatabaseHealth();

      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('latencyMs');
      expect(typeof result.ok).toBe('boolean');
      expect(typeof result.latencyMs).toBe('number');
    });

    it('includes latency in milliseconds', async () => {
      const result = await checkDatabaseHealth();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.latencyMs).toBeLessThan(10000); // Should complete in < 10s
    });

    it('includes optional version on success', async () => {
      const result = await checkDatabaseHealth();
      if (result.ok) {
        // Version is optional
        if (result.version !== undefined) {
          expect(typeof result.version).toBe('string');
        }
      }
    });

    it('includes error message on failure', async () => {
      const result = await checkDatabaseHealth();
      if (!result.ok) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('checkRedisHealth', () => {
    it('returns a status object with required fields', async () => {
      const result = await checkRedisHealth();

      expect(result).toHaveProperty('ok');
      expect(result).toHaveProperty('latencyMs');
      expect(result).toHaveProperty('cacheStatsAvailable');
      expect(typeof result.ok).toBe('boolean');
      expect(typeof result.latencyMs).toBe('number');
      expect(typeof result.cacheStatsAvailable).toBe('boolean');
    });

    it('includes host and port from environment', async () => {
      const result = await checkRedisHealth();
      expect(result).toHaveProperty('host');
      expect(result).toHaveProperty('port');
      expect(typeof result.host).toBe('string');
      expect(typeof result.port).toBe('number');
    });

    it('includes optional TTL eviction config', async () => {
      const result = await checkRedisHealth();
      if (result.cacheStatsAvailable && result.ttlEvictionConfig) {
        expect(result.ttlEvictionConfig).toHaveProperty('maxmemory');
        expect(result.ttlEvictionConfig).toHaveProperty('maxmemoryPolicy');
      }
    });

    it('includes error on connection failure', async () => {
      const result = await checkRedisHealth();
      if (!result.ok) {
        expect(result).toHaveProperty('error');
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('checkAIProvidersHealth', () => {
    it('returns an array', async () => {
      const result = await checkAIProvidersHealth();
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns provider objects with required fields', async () => {
      const result = await checkAIProvidersHealth();

      result.forEach((provider: AIProviderHealthStatus) => {
        expect(provider).toHaveProperty('name');
        expect(provider).toHaveProperty('type');
        expect(provider).toHaveProperty('enabled');
        expect(provider).toHaveProperty('ok');
        expect(provider).toHaveProperty('latencyMs');

        expect(typeof provider.name).toBe('string');
        expect(typeof provider.type).toBe('string');
        expect(typeof provider.enabled).toBe('boolean');
        expect(typeof provider.ok).toBe('boolean');
        expect(typeof provider.latencyMs).toBe('number');
      });
    });

    it('includes error on provider failure', async () => {
      const result = await checkAIProvidersHealth();

      result.forEach((provider: AIProviderHealthStatus) => {
        if (!provider.ok) {
          expect(provider).toHaveProperty('error');
          expect(typeof provider.error).toBe('string');
        }
      });
    });
  });

  describe('startupHealthCheck', () => {
    it('returns a complete health check report', async () => {
      const report = await startupHealthCheck();

      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('nodeVersion');
      expect(report).toHaveProperty('environment');
      expect(report).toHaveProperty('database');
      expect(report).toHaveProperty('redis');
      expect(report).toHaveProperty('aiProviders');
      expect(report).toHaveProperty('summary');
    });

    it('includes timestamp in ISO format', async () => {
      const report = await startupHealthCheck();
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      expect(report.timestamp).toMatch(iso8601Regex);
    });

    it('includes node version', async () => {
      const report = await startupHealthCheck();
      expect(typeof report.nodeVersion).toBe('string');
      expect(report.nodeVersion).toContain('v');
    });

    it('includes environment (production or development)', async () => {
      const report = await startupHealthCheck();
      expect(['production', 'development', 'test']).toContain(report.environment);
    });

    it('includes database health status', async () => {
      const report = await startupHealthCheck();
      const db = report.database;

      expect(db).toHaveProperty('ok');
      expect(db).toHaveProperty('latencyMs');
      expect(typeof db.ok).toBe('boolean');
      expect(typeof db.latencyMs).toBe('number');
    });

    it('includes redis health status', async () => {
      const report = await startupHealthCheck();
      const redis = report.redis;

      expect(redis).toHaveProperty('ok');
      expect(redis).toHaveProperty('latencyMs');
      expect(redis).toHaveProperty('cacheStatsAvailable');
      expect(typeof redis.ok).toBe('boolean');
      expect(typeof redis.latencyMs).toBe('number');
      expect(typeof redis.cacheStatsAvailable).toBe('boolean');
    });

    it('includes AI providers health status', async () => {
      const report = await startupHealthCheck();
      expect(Array.isArray(report.aiProviders)).toBe(true);
    });

    it('includes summary with health counters', async () => {
      const report = await startupHealthCheck();
      const summary = report.summary;

      expect(summary).toHaveProperty('allHealthy');
      expect(summary).toHaveProperty('healthyServices');
      expect(summary).toHaveProperty('totalServices');

      expect(typeof summary.allHealthy).toBe('boolean');
      expect(typeof summary.healthyServices).toBe('number');
      expect(typeof summary.totalServices).toBe('number');

      // Basic validation
      expect(summary.healthyServices).toBeLessThanOrEqual(summary.totalServices);
      expect(summary.healthyServices).toBeGreaterThanOrEqual(0);
    });

    it('JSON serializable report', async () => {
      const report = await startupHealthCheck();

      // Should be able to serialize to JSON without errors
      const jsonString = JSON.stringify(report);
      expect(typeof jsonString).toBe('string');

      // Should be able to parse back
      const parsed = JSON.parse(jsonString);
      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('summary');
    });
  });
});
