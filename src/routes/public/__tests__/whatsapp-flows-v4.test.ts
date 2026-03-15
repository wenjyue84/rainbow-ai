/**
 * Unit tests for US-927: WhatsApp Flows Data API v4.0 two-signature auth
 *
 * Verifies:
 * - verifyFlowPlatformSignature: valid signature passes
 * - verifyFlowPlatformSignature: tampered body is rejected
 * - verifyFlowPlatformSignature: missing signature is rejected
 * - verifyFlowPlatformSignature: missing secret returns invalid
 * - verifyFlowTokenSignature: valid token signature passes
 * - verifyFlowTokenSignature: mismatched token is rejected
 * - verifyFlowTokenSignature: missing header is rejected
 */

import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  verifyFlowPlatformSignature,
  verifyFlowTokenSignature,
} from '../../../lib/whatsapp/flow-crypto.js';

const APP_SECRET = 'test_app_secret_1234';
const TOKEN_SECRET = 'test_token_secret_5678';

function makePlatformSig(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeTokenSig(token: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(token).digest('hex');
}

// ─── Platform signature tests ────────────────────────────────────────────────

describe('verifyFlowPlatformSignature', () => {
  it('returns valid=true for a correct signature', () => {
    const body = Buffer.from(JSON.stringify({ encrypted_flow_data: 'abc', encrypted_aes_key: 'def', initial_vector: 'ghi' }));
    const sig = makePlatformSig(body, APP_SECRET);
    const result = verifyFlowPlatformSignature(body, sig, APP_SECRET);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns valid=false when body has been tampered', () => {
    const originalBody = Buffer.from('{"encrypted_flow_data":"original"}');
    const sig = makePlatformSig(originalBody, APP_SECRET);

    const tamperedBody = Buffer.from('{"encrypted_flow_data":"tampered"}');
    const result = verifyFlowPlatformSignature(tamperedBody, sig, APP_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it('returns valid=false when X-Hub-Signature-256 header is missing', () => {
    const body = Buffer.from('{"encrypted_flow_data":"abc"}');
    const result = verifyFlowPlatformSignature(body, '', APP_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });

  it('returns valid=false when signature uses wrong secret', () => {
    const body = Buffer.from('{"encrypted_flow_data":"abc"}');
    const sig = makePlatformSig(body, 'wrong_secret');
    const result = verifyFlowPlatformSignature(body, sig, APP_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it('returns valid=false when META_APP_SECRET is not configured', () => {
    const body = Buffer.from('{"encrypted_flow_data":"abc"}');
    const sig = makePlatformSig(body, APP_SECRET);
    const result = verifyFlowPlatformSignature(body, sig, '');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not configured/i);
  });
});

// ─── Flow token signature tests ──────────────────────────────────────────────

describe('verifyFlowTokenSignature', () => {
  const FLOW_TOKEN = 'flow_token_abc123';

  it('returns valid=true for a correct flow token signature', () => {
    const sig = makeTokenSig(FLOW_TOKEN, TOKEN_SECRET);
    const result = verifyFlowTokenSignature(FLOW_TOKEN, sig, TOKEN_SECRET);
    expect(result.valid).toBe(true);
  });

  it('returns valid=false when the flow token has been tampered', () => {
    const sig = makeTokenSig(FLOW_TOKEN, TOKEN_SECRET);
    const result = verifyFlowTokenSignature('tampered_token', sig, TOKEN_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/mismatch/i);
  });

  it('returns valid=false when X-Hub-Flow-Token-Signature header is missing', () => {
    const result = verifyFlowTokenSignature(FLOW_TOKEN, '', TOKEN_SECRET);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing/i);
  });

  it('returns valid=false when RAINBOW_FLOWS_TOKEN_SECRET is not configured', () => {
    const sig = makeTokenSig(FLOW_TOKEN, TOKEN_SECRET);
    const result = verifyFlowTokenSignature(FLOW_TOKEN, sig, '');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not configured/i);
  });
});
