/**
 * US-263: Cross-Profile Message Routing Validator Middleware Tests
 *
 * Validates:
 * AC1: Middleware validates message.businessProfile matches currently-loaded
 *      profile; rejects mismatches with detailed 400 error
 * AC2: Message with profile='data-southern' rejected if handler initialized
 *      with profile='data-makan' (error includes profile mismatch details)
 * AC3: Routing validator prevents Southern Homestay guest messages from being
 *      processed by Makan Moments knowledge.json and intent classifiers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateCrossProfile,
  crossProfileValidator,
} from '../../routes/webhooks/cross-profile-validator.js';
import type { Request, Response, NextFunction } from 'express';

// ─── Helper to build mock Express objects ──────────────────────────────────

function mockReq(body: Record<string, unknown> = {}): Request {
  return { body } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: Record<string, unknown> | null } {
  const res = {
    _status: 0,
    _json: null as Record<string, unknown> | null,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(data: Record<string, unknown>) {
      res._json = data;
      return res;
    },
  } as unknown as Response & { _status: number; _json: Record<string, unknown> | null };
  return res;
}

// ─── Unit Tests: validateCrossProfile() ─────────────────────────────────────

describe('US-263: validateCrossProfile()', () => {
  it('should return valid when messageProfile is undefined (no businessProfile in payload)', () => {
    const result = validateCrossProfile(undefined, 'pelangi');
    expect(result.valid).toBe(true);
    expect(result.handlerProfile).toBe('pelangi');
  });

  it('should return valid when profiles match exactly', () => {
    const result = validateCrossProfile('pelangi', 'pelangi');
    expect(result.valid).toBe(true);
  });

  it('should return valid when profiles match case-insensitively', () => {
    const result = validateCrossProfile('Pelangi', 'pelangi');
    expect(result.valid).toBe(true);
  });

  it('should return invalid when profiles mismatch', () => {
    const result = validateCrossProfile('southern', 'pelangi');
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.messageProfile).toBe('southern');
    expect(result.handlerProfile).toBe('pelangi');
  });

  it('should return valid when profiles match with whitespace trimming', () => {
    const result = validateCrossProfile('  pelangi  ', 'pelangi');
    expect(result.valid).toBe(true);
  });

  it('should return invalid for makan-moments vs pelangi', () => {
    const result = validateCrossProfile('makan-moments', 'pelangi');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('makan-moments');
    expect(result.error).toContain('pelangi');
  });

  // ── AC2: message with profile='data-southern' rejected if handler profile='data-makan' ──

  it('AC2: should reject message with profile="data-southern" when handler is "data-makan"', () => {
    const result = validateCrossProfile('data-southern', 'data-makan');
    expect(result.valid).toBe(false);
    expect(result.messageProfile).toBe('data-southern');
    expect(result.handlerProfile).toBe('data-makan');
    // Error must include profile mismatch details
    expect(result.error).toContain('data-southern');
    expect(result.error).toContain('data-makan');
    expect(result.error).toContain('mismatch');
  });

  it('AC2: error message includes detailed mismatch information', () => {
    const result = validateCrossProfile('data-southern', 'data-makan');
    expect(result.error).toContain('Cross-profile routing mismatch');
    expect(result.error).toContain('message.businessProfile="data-southern"');
    expect(result.error).toContain('handler profile="data-makan"');
    expect(result.error).toContain('rejected');
    expect(result.error).toContain('cross-contamination');
  });
});

// ─── Unit Tests: crossProfileValidator() Express middleware ──────────────────

describe('US-263: crossProfileValidator() middleware', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  // ── AC1: Middleware validates businessProfile matches loaded profile ──

  it('AC1: should call next() when businessProfile matches handler profile', () => {
    const middleware = crossProfileValidator('pelangi');
    const req = mockReq({ businessProfile: 'pelangi' });
    const res = mockRes();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res._status).toBe(0); // No status set
  });

  it('AC1: should reject with 400 when businessProfile mismatches handler profile', () => {
    const middleware = crossProfileValidator('pelangi');
    const req = mockReq({ businessProfile: 'makan-moments' });
    const res = mockRes();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json?.error).toBe('cross_profile_mismatch');
    expect(res._json?.detail).toContain('mismatch');
    expect(res._json?.messageProfile).toBe('makan-moments');
    expect(res._json?.handlerProfile).toBe('pelangi');
  });

  it('AC1: should call next() when no businessProfile in payload (backwards compatibility)', () => {
    const middleware = crossProfileValidator('pelangi');
    const req = mockReq({ someOtherField: 'value' });
    const res = mockRes();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('AC1: should support snake_case business_profile field', () => {
    const middleware = crossProfileValidator('pelangi');
    const req = mockReq({ business_profile: 'southern' });
    const res = mockRes();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json?.error).toBe('cross_profile_mismatch');
  });

  it('AC1: should reject with detailed error including both profile identifiers', () => {
    const middleware = crossProfileValidator('makan-moments');
    const req = mockReq({ businessProfile: 'southern' });
    const res = mockRes();

    middleware(req, res, next);

    expect(res._status).toBe(400);
    const detail = res._json?.detail as string;
    expect(detail).toContain('southern');
    expect(detail).toContain('makan-moments');
    expect(detail).toContain('cross-contamination');
  });

  // ── AC2: profile='data-southern' rejected if handler initialized with 'data-makan' ──

  it('AC2: should reject data-southern messages on data-makan handler', () => {
    const middleware = crossProfileValidator('data-makan');
    const req = mockReq({ businessProfile: 'data-southern' });
    const res = mockRes();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json?.error).toBe('cross_profile_mismatch');
    expect(res._json?.messageProfile).toBe('data-southern');
    expect(res._json?.handlerProfile).toBe('data-makan');
    // Verify error includes profile mismatch details
    const detail = res._json?.detail as string;
    expect(detail).toContain('data-southern');
    expect(detail).toContain('data-makan');
  });

  it('AC2: should allow data-makan messages on data-makan handler', () => {
    const middleware = crossProfileValidator('data-makan');
    const req = mockReq({ businessProfile: 'data-makan' });
    const res = mockRes();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

// ─── Integration Test: Cross-Profile Routing Prevention ──────────────────────

describe('US-263 AC3: Integration — routing validator prevents cross-profile processing', () => {
  it('should prevent Southern Homestay messages from reaching Makan Moments pipeline', () => {
    // Simulate a Southern Homestay guest message arriving at a handler
    // that is initialized for makan-moments
    const middleware = crossProfileValidator('makan-moments');
    const southernGuestMessage = mockReq({
      businessProfile: 'southern',
      from: '+60-guest-southern-123',
      text: 'What time is checkout?',
      type: 'message',
    });
    const res = mockRes();
    const nextFn: NextFunction = vi.fn();

    middleware(southernGuestMessage, res, nextFn);

    // Middleware should reject BEFORE the message reaches the AI pipeline.
    // This means knowledge.json and intent classifiers for makan-moments
    // will never process this message.
    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json?.error).toBe('cross_profile_mismatch');
  });

  it('should prevent Makan Moments messages from reaching Southern pipeline', () => {
    const middleware = crossProfileValidator('southern');
    const makanMessage = mockReq({
      businessProfile: 'makan-moments',
      from: '+60-cafe-customer-456',
      text: 'Can I see the menu?',
      type: 'message',
    });
    const res = mockRes();
    const nextFn: NextFunction = vi.fn();

    middleware(makanMessage, res, nextFn);

    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
  });

  it('should allow Southern Homestay messages on Southern handler', () => {
    const middleware = crossProfileValidator('southern');
    const southernMessage = mockReq({
      businessProfile: 'southern',
      from: '+60-guest-789',
      text: 'Where is the parking?',
      type: 'message',
    });
    const res = mockRes();
    const nextFn: NextFunction = vi.fn();

    middleware(southernMessage, res, nextFn);

    expect(nextFn).toHaveBeenCalled();
  });

  it('should allow Pelangi messages on Pelangi handler', () => {
    const middleware = crossProfileValidator('pelangi');
    const pelangiMessage = mockReq({
      businessProfile: 'pelangi',
      from: '+60-guest-abc',
      text: 'What is the wifi password?',
      type: 'message',
    });
    const res = mockRes();
    const nextFn: NextFunction = vi.fn();

    middleware(pelangiMessage, res, nextFn);

    expect(nextFn).toHaveBeenCalled();
  });

  it('should prevent Pelangi guest messages from reaching Makan Moments intent classifiers', () => {
    // This simulates the exact scenario from AC3:
    // A hostel guest message must NOT be processed by the cafe's classifiers
    const middleware = crossProfileValidator('makan-moments');

    // Hostel-specific message that should only be processed by hostel profiles
    const hostelMessage = mockReq({
      businessProfile: 'pelangi',
      from: '+60-hostel-guest-001',
      text: 'I need to check in now',
      type: 'message',
    });
    const res = mockRes();
    const nextFn: NextFunction = vi.fn();

    middleware(hostelMessage, res, nextFn);

    // The middleware blocks this BEFORE the makan-moments intent classifier
    // or knowledge.json would process it — preventing cross-contamination
    expect(nextFn).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._json?.error).toBe('cross_profile_mismatch');
    expect(res._json?.messageProfile).toBe('pelangi');
    expect(res._json?.handlerProfile).toBe('makan-moments');
  });

  it('should return all required fields in the rejection response', () => {
    const middleware = crossProfileValidator('makan-moments');
    const req = mockReq({ businessProfile: 'southern' });
    const res = mockRes();
    const nextFn: NextFunction = vi.fn();

    middleware(req, res, nextFn);

    expect(res._status).toBe(400);
    expect(res._json).toHaveProperty('error', 'cross_profile_mismatch');
    expect(res._json).toHaveProperty('detail');
    expect(res._json).toHaveProperty('messageProfile', 'southern');
    expect(res._json).toHaveProperty('handlerProfile', 'makan-moments');
  });
});
