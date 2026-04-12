import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('startup-healthcheck', () => {
  let pool: any;
  let healthCheck: any;
  let originalPoolQuery: any;

  beforeEach(async () => {
    // Re-import to get fresh module state
    const dbModule = await import('../../src/lib/db.js');
    pool = dbModule.pool;
    healthCheck = dbModule.healthCheck;
    originalPoolQuery = pool.query;
  });

  afterEach(() => {
    // Restore the original implementation
    if (pool && originalPoolQuery) {
      pool.query = originalPoolQuery;
    }
  });

  it('should return true when database is healthy', async () => {
    pool.query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });

    const result = await healthCheck();
    expect(result).toBe(true);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('should return false when query fails', async () => {
    pool.query = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const result = await healthCheck();
    expect(result).toBe(false);
  });

  it(
    'should return false on timeout (5 seconds)',
    async () => {
      // Mock query to never resolve (simulating a hang)
      pool.query = vi.fn().mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      const startTime = Date.now();
      const result = await healthCheck();
      const duration = Date.now() - startTime;

      expect(result).toBe(false);
      // Should timeout around 5 seconds (allow 500ms margin for test overhead)
      expect(duration).toBeGreaterThanOrEqual(5000);
      expect(duration).toBeLessThan(6000);
    },
    10000 // Increase timeout to 10 seconds for this test
  );

  it('should use existing pool connection (not create new one)', async () => {
    pool.query = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });

    await healthCheck();

    // Verify pool.query was called (using pool connection, not new connection)
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('should handle database errors gracefully', async () => {
    pool.query = vi.fn().mockRejectedValue(new Error('Authentication failed'));

    const result = await healthCheck();
    expect(result).toBe(false);
  });
});
