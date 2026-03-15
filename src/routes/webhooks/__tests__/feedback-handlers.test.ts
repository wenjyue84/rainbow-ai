/**
 * Webhook handler tests for feedback features (US-869, US-886)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dispatchWebhookEvent } from '../handlers.js';

describe('Webhook Handlers - Feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('order_served (US-869)', () => {
    it('should dispatch order_served event', async () => {
      const event = { type: 'order_served', orderId: 'MM-A1B2' };
      await expect(dispatchWebhookEvent(event)).resolves.toBeUndefined();
    });
  });

  describe('reaction (US-886)', () => {
    it('should dispatch positive reaction', async () => {
      const event = {
        type: 'reaction',
        phone: '601234567890',
        messageId: 'msg-123',
        emoji: '👍'
      };
      await expect(dispatchWebhookEvent(event)).resolves.toBeUndefined();
    });

    it('should dispatch negative reaction', async () => {
      const event = {
        type: 'reaction',
        phone: '601234567890',
        messageId: 'msg-123',
        emoji: '👎'
      };
      await expect(dispatchWebhookEvent(event)).resolves.toBeUndefined();
    });
  });
});
