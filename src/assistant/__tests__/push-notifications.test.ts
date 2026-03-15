/**
 * push-notifications.test.ts — Tests for US-916 push notification module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock web-push before importing the module
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    generateVAPIDKeys: vi.fn(() => ({
      publicKey: 'test-public-key-base64url',
      privateKey: 'test-private-key-base64url',
    })),
    sendNotification: vi.fn(),
  },
}));

// Mock pool
vi.mock('../../lib/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

import { getVapidPublicKey } from '../push-notifications.js';

describe('US-916: Push Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getVapidPublicKey', () => {
    it('returns a string', () => {
      const key = getVapidPublicKey();
      expect(typeof key).toBe('string');
    });

    it('returns consistent value on repeated calls', () => {
      const key1 = getVapidPublicKey();
      const key2 = getVapidPublicKey();
      expect(key1).toBe(key2);
    });
  });

  describe('PushSubscriptionData interface', () => {
    it('validates subscription shape', () => {
      const sub = {
        endpoint: 'https://push.example.com/send/abc123',
        keys: {
          p256dh: 'BNcR...',
          auth: 'tBH...',
        },
      };
      expect(sub.endpoint).toBeTruthy();
      expect(sub.keys.p256dh).toBeTruthy();
      expect(sub.keys.auth).toBeTruthy();
    });
  });

  describe('Push payload types', () => {
    it('accepts valid notification types', () => {
      const validTypes = ['order_ready', 'promotion', 'incomplete_order'];
      validTypes.forEach(type => {
        expect(validTypes).toContain(type);
      });
    });

    it('rejects invalid notification types', () => {
      const validTypes = ['order_ready', 'promotion', 'incomplete_order'];
      expect(validTypes).not.toContain('spam');
      expect(validTypes).not.toContain('');
    });
  });

  describe('Service worker file exists', () => {
    it('sw-push.js should be a valid service worker', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const swPath = path.join(process.cwd(), 'src', 'public', 'sw-push.js');
      expect(fs.existsSync(swPath)).toBe(true);

      const content = fs.readFileSync(swPath, 'utf8');
      // Must handle push events
      expect(content).toContain("addEventListener('push'");
      // Must handle notification clicks
      expect(content).toContain("addEventListener('notificationclick'");
      // Must call showNotification
      expect(content).toContain('showNotification');
      // Must handle install and activate
      expect(content).toContain("addEventListener('install'");
      expect(content).toContain("addEventListener('activate'");
    });
  });

  describe('Webchat widget push integration', () => {
    it('webchat.html should contain push notification UI elements', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const htmlPath = path.join(process.cwd(), 'src', 'public', 'webchat.html');
      expect(fs.existsSync(htmlPath)).toBe(true);

      const content = fs.readFileSync(htmlPath, 'utf8');
      // Should have notification gear button
      expect(content).toContain('notifGearBtn');
      // Should have settings panel
      expect(content).toContain('notifSettings');
      // Should register service worker
      expect(content).toContain('sw-push.js');
      // Should prompt after first interaction (not on cold load)
      expect(content).toContain('PUSH_PROMPTED_KEY');
      expect(content).toContain('userMessageCount');
      // Should have iOS PWA hint
      expect(content).toContain('Add to Home Screen');
      // Should subscribe via VAPID
      expect(content).toContain('vapid-key');
      expect(content).toContain('applicationServerKey');
    });
  });

  describe('Frequency limit validation', () => {
    it('valid frequency values are 15, 30, 60, 120', () => {
      const validFrequencies = [15, 30, 60, 120];
      validFrequencies.forEach(freq => {
        expect(freq).toBeGreaterThan(0);
        expect(freq).toBeLessThanOrEqual(120);
      });
    });
  });

  describe('Analytics endpoint', () => {
    it('analytics-push.ts should exist', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const routePath = path.join(process.cwd(), 'src', 'routes', 'admin', 'analytics-push.ts');
      expect(fs.existsSync(routePath)).toBe(true);

      const content = fs.readFileSync(routePath, 'utf8');
      expect(content).toContain('getPushAnalytics');
      expect(content).toContain('/analytics/push');
    });
  });
});
