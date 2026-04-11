/**
 * US-470: Booking Unit Availability Validation Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fetch from 'node-fetch';

describe('US-470: Booking Unit Availability Validation', () => {
  const BASE_URL = 'http://localhost:3002';
  const API_KEY = process.env.RAINBOW_ADMIN_KEY || 'test-key';

  beforeAll(async () => {
    // Wait for server to be ready
    let retries = 0;
    while (retries < 10) {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) break;
      } catch (e) {
        retries++;
        await new Promise(r => setTimeout(r, 100));
      }
    }
  });

  describe('POST /admin/validation/booking-units', () => {
    it('should validate a booking unit request', async () => {
      const response = await fetch(`${BASE_URL}/api/rainbow/validation/booking-units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': API_KEY,
        },
        body: JSON.stringify({
          unit_id: 'capsule-01',
          profile: 'pelangi',
          check_in_date: '2026-04-15',
          check_out_date: '2026-04-17',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('valid');
      expect(data).toHaveProperty('issues');
      expect(Array.isArray(data.issues)).toBe(true);
    });

    it('should reject invalid dates', async () => {
      const response = await fetch(`${BASE_URL}/api/rainbow/validation/booking-units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': API_KEY,
        },
        body: JSON.stringify({
          unit_id: 'capsule-01',
          profile: 'pelangi',
          check_in_date: 'invalid-date',
          check_out_date: '2026-04-17',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valid).toBe(false);
      expect(data.issues.length).toBeGreaterThan(0);
    });

    it('should reject when check_out is before check_in', async () => {
      const response = await fetch(`${BASE_URL}/api/rainbow/validation/booking-units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': API_KEY,
        },
        body: JSON.stringify({
          unit_id: 'capsule-01',
          profile: 'pelangi',
          check_in_date: '2026-04-17',
          check_out_date: '2026-04-15',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valid).toBe(false);
      expect(data.issues).toContain(expect.stringContaining('must be after'));
    });

    it('should reject invalid unit for profile', async () => {
      const response = await fetch(`${BASE_URL}/api/rainbow/validation/booking-units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': API_KEY,
        },
        body: JSON.stringify({
          unit_id: 'nonexistent-unit',
          profile: 'pelangi',
          check_in_date: '2026-04-15',
          check_out_date: '2026-04-17',
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.valid).toBe(false);
      expect(data.issues).toContain(expect.stringContaining('not found'));
    });

    it('should require unit_id', async () => {
      const response = await fetch(`${BASE_URL}/api/rainbow/validation/booking-units`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': API_KEY,
        },
        body: JSON.stringify({
          profile: 'pelangi',
          check_in_date: '2026-04-15',
          check_out_date: '2026-04-17',
        }),
      });

      expect(response.status).toBe(400);
    });
  });
});
