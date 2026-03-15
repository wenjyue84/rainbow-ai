/**
 * Unit tests for US-898: Admin RBAC (viewer / operator / super-admin).
 *
 * Tests the checkRole middleware in isolation — no DB or Express needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRole } from '../../lib/rbac.js';
import type { Request, Response, NextFunction } from 'express';

// ─── Helpers ────────────────────────────────────────────────────────

function mockReqRes(role?: string) {
  const req = {} as Request;
  const res = {
    locals: { adminRole: role } as Record<string, any>,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('checkRole middleware (US-898)', () => {
  describe('viewer role', () => {
    it('allows viewer when viewer is in allowed list', () => {
      const { req, res, next } = mockReqRes('viewer');
      checkRole(['viewer', 'operator', 'super-admin'])(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks viewer from operator-only routes with 403', () => {
      const { req, res, next } = mockReqRes('viewer');
      checkRole(['operator', 'super-admin'])(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Forbidden: insufficient role',
          currentRole: 'viewer',
        }),
      );
    });

    it('blocks viewer from super-admin-only routes with 403', () => {
      const { req, res, next } = mockReqRes('viewer');
      checkRole(['super-admin'])(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('operator role', () => {
    it('allows operator when operator is in allowed list', () => {
      const { req, res, next } = mockReqRes('operator');
      checkRole(['operator', 'super-admin'])(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('blocks operator from super-admin-only routes', () => {
      const { req, res, next } = mockReqRes('operator');
      checkRole(['super-admin'])(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          currentRole: 'operator',
        }),
      );
    });
  });

  describe('super-admin role', () => {
    it('allows super-admin access to all routes', () => {
      const { req, res, next } = mockReqRes('super-admin');
      checkRole(['super-admin'])(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows super-admin on operator routes', () => {
      const { req, res, next } = mockReqRes('super-admin');
      checkRole(['operator', 'super-admin'])(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('missing role (backwards compat)', () => {
    it('defaults to operator when role is undefined', () => {
      const { req, res, next } = mockReqRes(undefined);
      checkRole(['operator', 'super-admin'])(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it('defaults to operator — blocked from super-admin-only', () => {
      const { req, res, next } = mockReqRes(undefined);
      checkRole(['super-admin'])(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ currentRole: 'operator' }),
      );
    });
  });

  describe('acceptance criterion: viewer PUT on config returns 403', () => {
    it('viewer attempting a mutation gets 403', () => {
      const { req, res, next } = mockReqRes('viewer');
      // Simulates the middleware guarding PUT /config
      checkRole(['operator', 'super-admin'])(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });
});
