/**
 * Pacing Monitor Tests (US-891)
 *
 * Tests portfolio pacing detection, state management, and admin notification.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parsePacingFromResponse,
  getPacingState,
  initPacingNotifier,
  _resetForTesting,
} from '../../lib/pacing-monitor.js';

// ─── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  _resetForTesting();
});

afterEach(() => {
  _resetForTesting();
});

// ─── parsePacingFromResponse ──────────────────────────────────────

describe('parsePacingFromResponse', () => {
  it('returns pacingPaused=false for healthy response with no issues', () => {
    const response = {
      quality_rating: 'GREEN',
      messaging_limit_tier: '100000',
      health_status: {
        can_send_message: 'AVAILABLE',
        entities: [],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(false);
    expect(state.affectedTemplateName).toBeNull();
    expect(state.percentNotDelivered).toBeNull();
    expect(state.lastCheckedAt).toBeTruthy();
    expect(state.pauseDetectedAt).toBeNull();
  });

  it('detects pacingPaused=true when health_status entity has LIMITED can_send_message', () => {
    const response = {
      quality_rating: 'YELLOW',
      health_status: {
        entities: [
          {
            can_send_message: 'LIMITED',
            entity_type: 'PHONE_NUMBER',
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
    expect(state.pauseDetectedAt).toBeTruthy();
  });

  it('detects pacingPaused=true when health_status entity has BLOCKED can_send_message', () => {
    const response = {
      health_status: {
        entities: [
          {
            can_send_message: 'BLOCKED',
            entity_type: 'PHONE_NUMBER',
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
  });

  it('detects pacingPaused=true when quality_rating is RED', () => {
    const response = {
      quality_rating: 'RED',
      health_status: { entities: [] },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
  });

  it('extracts affected template name from entity', () => {
    const response = {
      health_status: {
        entities: [
          {
            can_send_message: 'LIMITED',
            entity_type: 'TEMPLATE',
            id: 'checkout_reminder',
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
    expect(state.affectedTemplateName).toBe('checkout_reminder');
  });

  it('extracts percentNotDelivered from error description with percentage', () => {
    const response = {
      health_status: {
        entities: [
          {
            can_send_message: 'AVAILABLE',
            errors: [
              {
                error_code: 131026,
                error_description: 'Template pacing active — 35.5% of messages not yet delivered',
              },
            ],
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
    expect(state.percentNotDelivered).toBe(35.5);
  });

  it('detects pacing from error with pacing in possible_solution', () => {
    const response = {
      health_status: {
        entities: [
          {
            errors: [
              {
                error_code: 999,
                possible_solution: 'Message delivery is being throttled due to pacing controls',
              },
            ],
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
  });

  it('returns pacingPaused=false for empty response', () => {
    const response = {};
    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(false);
  });

  it('returns pacingPaused=false for GREEN quality with available status', () => {
    const response = {
      quality_rating: 'GREEN',
      health_status: {
        entities: [
          {
            can_send_message: 'AVAILABLE',
            errors: [],
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(false);
  });
});

// ─── getPacingState ───────────────────────────────────────────────

describe('getPacingState', () => {
  it('returns default state with pacingPaused=false initially', () => {
    const state = getPacingState();
    expect(state.pacingPaused).toBe(false);
    expect(state.affectedTemplateName).toBeNull();
    expect(state.percentNotDelivered).toBeNull();
    expect(state.lastCheckedAt).toBeTruthy();
  });

  it('returns a copy (not a reference) of the internal state', () => {
    const state1 = getPacingState();
    const state2 = getPacingState();
    expect(state1).toEqual(state2);
    expect(state1).not.toBe(state2);
  });
});

// ─── initPacingNotifier ───────────────────────────────────────────

describe('initPacingNotifier', () => {
  it('accepts a send function without error', () => {
    const mockSend = vi.fn().mockResolvedValue(undefined);
    expect(() => initPacingNotifier(mockSend)).not.toThrow();
  });
});

// ─── PacingState shape ────────────────────────────────────────────

describe('PacingState shape', () => {
  it('parsed state has all required fields', () => {
    const response = {
      quality_rating: 'YELLOW',
      health_status: {
        entities: [
          {
            can_send_message: 'LIMITED',
            entity_type: 'TEMPLATE',
            id: 'promo_offer',
            errors: [
              {
                error_code: 131026,
                error_description: '42% of batch not delivered',
              },
            ],
          },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state).toHaveProperty('pacingPaused', true);
    expect(state).toHaveProperty('affectedTemplateName', 'promo_offer');
    expect(state).toHaveProperty('percentNotDelivered', 42);
    expect(state).toHaveProperty('lastCheckedAt');
    expect(state).toHaveProperty('pauseDetectedAt');
    expect(typeof state.lastCheckedAt).toBe('string');
    expect(typeof state.pauseDetectedAt).toBe('string');
  });

  it('non-paused state has null pauseDetectedAt', () => {
    const response = {
      quality_rating: 'GREEN',
      health_status: { entities: [] },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pauseDetectedAt).toBeNull();
  });
});

// ─── Multiple entities ────────────────────────────────────────────

describe('multiple entities', () => {
  it('detects pacing if ANY entity is LIMITED', () => {
    const response = {
      health_status: {
        entities: [
          { can_send_message: 'AVAILABLE' },
          { can_send_message: 'LIMITED', entity_type: 'TEMPLATE', id: 'feedback_request' },
          { can_send_message: 'AVAILABLE' },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
    expect(state.affectedTemplateName).toBe('feedback_request');
  });

  it('picks last template entity when multiple templates affected', () => {
    const response = {
      health_status: {
        entities: [
          { can_send_message: 'LIMITED', entity_type: 'TEMPLATE', id: 'template_a' },
          { can_send_message: 'LIMITED', entity_type: 'TEMPLATE', id: 'template_b' },
        ],
      },
    };

    const state = parsePacingFromResponse(response);
    expect(state.pacingPaused).toBe(true);
    // Last template overwrites
    expect(state.affectedTemplateName).toBe('template_b');
  });
});
