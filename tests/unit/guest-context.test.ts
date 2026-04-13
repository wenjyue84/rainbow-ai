/**
 * US-550: Guest Context Quick-Lookup Tests
 *
 * Tests for guest data injection with TTL caching
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadGuestContext, clearGuestContextCache, invalidateGuestContext } from '../../src/tools/guest-data-injector.js';
import { pool } from '../../src/lib/db.js';

// Mock database
vi.mock('../../src/lib/db.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

describe('GuestDataInjector', () => {
  beforeEach(() => {
    clearGuestContextCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearGuestContextCache();
  });

  describe('loadGuestContext', () => {
    it('should return guest context from database', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);

      const context = await loadGuestContext('pelangi', '60123456789');

      expect(context).toEqual({
        id: '60123456789',
        name: 'John Doe',
        unit: 'Capsule-A2',
        arrival_date: '2026-04-15',
        departure_date: '2026-04-18',
        nights: 3,
      });
    });

    it('should calculate correct number of nights', async () => {
      const mockData = {
        rows: [
          {
            id: '60987654321',
            name: 'Jane Smith',
            unit: 'Capsule-B1',
            check_in_date: new Date('2026-04-10'),
            check_out_date: new Date('2026-04-17'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);

      const context = await loadGuestContext('pelangi', '60987654321');

      expect(context.nights).toBe(7);
    });

    it('should cache results for 5 minutes', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);

      // First call - hits database
      const context1 = await loadGuestContext('pelangi', '60123456789');

      // Reset mock to ensure it's not called again
      vi.mocked(pool.query).mockClear();

      // Second call - should hit cache
      const context2 = await loadGuestContext('pelangi', '60123456789');

      expect(context1).toEqual(context2);
      expect(pool.query).not.toHaveBeenCalled(); // Cache hit, no DB query
    });

    it('should use profile in cache key', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      // Call for profile 'pelangi'
      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);
      await loadGuestContext('pelangi', '60123456789');

      // Call for profile 'southern' should query database again (different cache key)
      const mockData2 = {
        rows: [
          {
            id: '60123456789',
            name: 'Jane Smith',
            unit: 'Room-101',
            check_in_date: new Date('2026-04-20'),
            check_out_date: new Date('2026-04-23'),
            status: 'confirmed',
          },
        ],
      };
      vi.mocked(pool.query).mockResolvedValueOnce(mockData2 as any);
      const context2 = await loadGuestContext('southern', '60123456789');

      expect(context2.name).toBe('Jane Smith');
      expect(pool.query).toHaveBeenCalledTimes(2);
    });

    it('should throw error if guest not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      await expect(loadGuestContext('pelangi', '60123456789')).rejects.toThrow(
        'Guest not found: 60123456789 for profile pelangi'
      );
    });

    it('should only match confirmed reservations', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);

      await loadGuestContext('pelangi', '60123456789');

      const call = vi.mocked(pool.query).mock.calls[0];
      const query = call[0] as string;
      const params = call[1] as any[];

      expect(query).toContain('status = $3');
      expect(params).toContain('confirmed');
    });

    it('should format dates as ISO YYYY-MM-DD', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15T10:30:00Z'),
            check_out_date: new Date('2026-04-18T14:00:00Z'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);

      const context = await loadGuestContext('pelangi', '60123456789');

      expect(context.arrival_date).toBe('2026-04-15');
      expect(context.departure_date).toBe('2026-04-18');
      expect(/^\d{4}-\d{2}-\d{2}$/.test(context.arrival_date)).toBe(true);
    });
  });

  describe('invalidateGuestContext', () => {
    it('should remove specific cache entry', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);

      // Cache the entry
      await loadGuestContext('pelangi', '60123456789');

      // Invalidate it
      invalidateGuestContext('pelangi', '60123456789');

      // Next call should query DB again
      vi.mocked(pool.query).mockResolvedValueOnce(mockData as any);
      await loadGuestContext('pelangi', '60123456789');

      expect(pool.query).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearGuestContextCache', () => {
    it('should clear all cached entries', async () => {
      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValue(mockData as any);

      // Cache multiple entries
      await loadGuestContext('pelangi', '60123456789');
      await loadGuestContext('southern', '60987654321');

      // Clear all
      clearGuestContextCache();

      // Both should query DB again
      await loadGuestContext('pelangi', '60123456789');
      await loadGuestContext('southern', '60987654321');

      expect(pool.query).toHaveBeenCalledTimes(4); // 2 original + 2 after clear
    });
  });

  describe('cache expiration', () => {
    it('should expire cache entries after TTL', async () => {
      vi.useFakeTimers();

      const mockData = {
        rows: [
          {
            id: '60123456789',
            name: 'John Doe',
            unit: 'Capsule-A2',
            check_in_date: new Date('2026-04-15'),
            check_out_date: new Date('2026-04-18'),
            status: 'confirmed',
          },
        ],
      };

      vi.mocked(pool.query).mockResolvedValue(mockData as any);

      // Cache entry
      await loadGuestContext('pelangi', '60123456789');

      // Advance time past TTL (5 minutes = 300000 ms)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Next call should query DB again
      await loadGuestContext('pelangi', '60123456789');

      expect(pool.query).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });
});
