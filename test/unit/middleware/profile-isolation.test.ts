/**
 * Profile Isolation Enforcement Middleware Tests (US-310)
 *
 * Asserts:
 *   AC1: Cross-profile guest query is blocked (403)
 *   AC2: Same-profile message fetch is allowed (passes through)
 *   AC3: Violation is logged with query details to the violations table
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ─── Mock DB ────────────────────────────────────────────────────────
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

vi.mock('../../../src/lib/db.js', () => ({
  db: {
    insert: (...args: any[]) => mockInsert(...args),
  },
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock('../../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import { enforceProfileIsolation, logViolation } from '../../../src/middleware/profile-isolation.js';
import { profileIsolationViolations } from '../../../shared/schema-tables.js';

// ─── Helpers ────────────────────────────────────────────────────────

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    method: 'GET',
    path: '/test',
    originalUrl: '/test',
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response & { _status: number; _json: any } {
  const res = {
    _status: 200,
    _json: null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: any) {
      res._json = data;
      return res;
    },
  } as unknown as Response & { _status: number; _json: any };
  return res;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('US-310: Profile Isolation Enforcement Middleware', () => {
  let middleware: (req: Request, res: Response, next: NextFunction) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    middleware = enforceProfileIsolation();
  });

  // ─── AC1: Cross-profile query blocked ──────────────────────────

  describe('cross-profile query blocked', () => {
    it('should block request when body profileId differs from query profile', async () => {
      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: { profileId: 'southern', phone: '+60123456789' },
        method: 'POST',
        originalUrl: '/admin/guests',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(res._status).toBe(403);
      expect(res._json).toHaveProperty('error', 'Profile isolation violation');
      expect(next).not.toHaveBeenCalled();
    });

    it('should block request when query profileId differs from params profileId', async () => {
      const req = createMockRequest({
        params: { profileId: 'pelangi' } as any,
        query: { profileId: 'southern' } as any,
        method: 'GET',
        originalUrl: '/admin/messages?profileId=southern',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(res._status).toBe(403);
      expect(res._json).toHaveProperty('error', 'Profile isolation violation');
      expect(next).not.toHaveBeenCalled();
    });

    it('should block when body profile_id (underscore) differs from active profile', async () => {
      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: { profile_id: 'southern' },
        method: 'POST',
        originalUrl: '/admin/conversations',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── AC2: Same-profile fetch allowed ───────────────────────────

  describe('same-profile message fetch allowed', () => {
    it('should call next() when body profile matches active profile', async () => {
      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: { profileId: 'pelangi', message: 'Hello' },
        method: 'POST',
        originalUrl: '/admin/messages',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res._status).toBe(200); // unchanged
    });

    it('should call next() when no profile context is present', async () => {
      const req = createMockRequest({
        query: {} as any,
        params: {} as any,
        body: {},
        method: 'GET',
        originalUrl: '/admin/health',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should call next() when query profile matches and no body profile', async () => {
      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: {},
        method: 'GET',
        originalUrl: '/admin/messages?profile=pelangi',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('should pass through when X-Profile-Id header matches body', async () => {
      const req = createMockRequest({
        headers: { 'x-profile-id': 'southern' } as any,
        body: { profileId: 'southern' },
        method: 'POST',
        originalUrl: '/admin/guests',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(next).toHaveBeenCalledOnce();
    });
  });

  // ─── AC3: Violation logged with query details ──────────────────

  describe('violation logged with query details', () => {
    it('should insert violation record into DB on cross-profile body mismatch', async () => {
      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: { profileId: 'southern', phone: '+60123456789' },
        method: 'POST',
        originalUrl: '/admin/guests',
        ip: '192.168.1.100',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(mockInsert).toHaveBeenCalledWith(profileIsolationViolations);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedProfile: 'southern',
          actualProfile: 'pelangi',
          queryText: expect.stringContaining('southern'),
          routePath: '/admin/guests',
          method: 'POST',
        }),
      );
    });

    it('should insert violation record on cross-profile query mismatch', async () => {
      const req = createMockRequest({
        params: { profileId: 'pelangi' } as any,
        query: { profileId: 'southern' } as any,
        method: 'GET',
        originalUrl: '/admin/analytics?profileId=southern',
        ip: '10.0.0.1',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(mockInsert).toHaveBeenCalledWith(profileIsolationViolations);
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedProfile: 'southern',
          actualProfile: 'pelangi',
          routePath: '/admin/analytics?profileId=southern',
          method: 'GET',
        }),
      );
    });

    it('should not call insert when profiles match (no violation)', async () => {
      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: { profileId: 'pelangi' },
        method: 'POST',
        originalUrl: '/admin/messages',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      expect(mockInsert).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    });

    it('should still respond 403 even if DB logging fails', async () => {
      // Make the insert fail
      mockInsertValues.mockRejectedValueOnce(new Error('DB connection error'));

      const req = createMockRequest({
        query: { profile: 'pelangi' } as any,
        body: { profileId: 'southern' },
        method: 'POST',
        originalUrl: '/admin/guests',
      });
      const res = createMockResponse();
      const next = vi.fn();

      await middleware(req, res as unknown as Response, next);

      // Should still block the request even though logging failed
      expect(res._status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ─── logViolation() direct tests ───────────────────────────────

  describe('logViolation()', () => {
    it('should insert a violation record with all fields', async () => {
      await logViolation({
        attemptedProfile: 'southern',
        actualProfile: 'pelangi',
        queryText: 'SELECT * FROM guests WHERE profile_id = southern',
        routePath: '/admin/guests',
        method: 'GET',
        ipAddress: '192.168.1.50',
      });

      expect(mockInsert).toHaveBeenCalledWith(profileIsolationViolations);
      expect(mockInsertValues).toHaveBeenCalledWith({
        attemptedProfile: 'southern',
        actualProfile: 'pelangi',
        queryText: 'SELECT * FROM guests WHERE profile_id = southern',
        routePath: '/admin/guests',
        method: 'GET',
        ipAddress: '192.168.1.50',
      });
    });

    it('should truncate queryText longer than 2000 characters', async () => {
      const longQuery = 'X'.repeat(3000);

      await logViolation({
        attemptedProfile: 'southern',
        actualProfile: 'pelangi',
        queryText: longQuery,
        routePath: '/admin/data',
        method: 'POST',
        ipAddress: undefined,
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          queryText: expect.any(String),
        }),
      );

      const insertedValues = mockInsertValues.mock.calls[0][0];
      expect(insertedValues.queryText.length).toBe(2000);
    });

    it('should not throw when DB insert fails', async () => {
      mockInsertValues.mockRejectedValueOnce(new Error('connection refused'));

      // Should not throw
      await expect(
        logViolation({
          attemptedProfile: 'a',
          actualProfile: 'b',
          queryText: 'test',
          routePath: '/test',
          method: 'GET',
          ipAddress: undefined,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
