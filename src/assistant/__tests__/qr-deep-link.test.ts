/**
 * Tests for US-919: QR code deep-link parsing and session context
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseDeepLink,
  setDeepLinkContext,
  getDeepLinkContext,
  clearDeepLinkContext,
  generateDeepLinkResponse,
} from '../qr-deep-link.js';

describe('US-919: QR Deep-Link Parser', () => {
  // ─── AC2: Parse pre-filled messages into session context ─────────

  describe('parseDeepLink', () => {
    it('parses ORDER:TABLE:<n> format', () => {
      const result = parseDeepLink('ORDER:TABLE:5');
      expect(result).toEqual({
        type: 'table',
        value: '5',
        originalMessage: 'ORDER:TABLE:5',
      });
    });

    it('parses ORDER:TABLE with double-digit number', () => {
      const result = parseDeepLink('ORDER:TABLE:12');
      expect(result).toEqual({
        type: 'table',
        value: '12',
        originalMessage: 'ORDER:TABLE:12',
      });
    });

    it('parses ORDER:TABLE case-insensitively', () => {
      const result = parseDeepLink('order:table:3');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('table');
      expect(result!.value).toBe('3');
    });

    it('parses ROOM:<n> format', () => {
      const result = parseDeepLink('ROOM:202');
      expect(result).toEqual({
        type: 'room',
        value: '202',
        originalMessage: 'ROOM:202',
      });
    });

    it('parses ROOM with letter suffix (e.g. 202A)', () => {
      const result = parseDeepLink('ROOM:202A');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('room');
      expect(result!.value).toBe('202A');
    });

    it('parses CAMPAIGN:<label> format', () => {
      const result = parseDeepLink('CAMPAIGN:lobby_poster');
      expect(result).toEqual({
        type: 'campaign',
        value: 'lobby_poster',
        originalMessage: 'CAMPAIGN:lobby_poster',
      });
    });

    it('parses CAMPAIGN with dashes', () => {
      const result = parseDeepLink('CAMPAIGN:march-promo-2026');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('campaign');
      expect(result!.value).toBe('march-promo-2026');
    });

    it('returns null for regular messages', () => {
      expect(parseDeepLink('Hello, I need help')).toBeNull();
      expect(parseDeepLink('I want to book a room')).toBeNull();
      expect(parseDeepLink('')).toBeNull();
    });

    it('returns null for partial matches', () => {
      expect(parseDeepLink('ORDER:TABLE:')).toBeNull();
      expect(parseDeepLink('ROOM:')).toBeNull();
      expect(parseDeepLink('CAMPAIGN:')).toBeNull();
    });

    it('trims whitespace before matching', () => {
      const result = parseDeepLink('  ORDER:TABLE:7  ');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('7');
    });
  });

  // ─── Session context management ──────────────────────────────────

  describe('session context', () => {
    const testJid = '60123456789@s.whatsapp.net';

    beforeEach(() => {
      clearDeepLinkContext(testJid);
    });

    it('stores and retrieves deep-link context', () => {
      const ctx = { type: 'table' as const, value: '5', originalMessage: 'ORDER:TABLE:5' };
      setDeepLinkContext(testJid, ctx);

      const retrieved = getDeepLinkContext(testJid);
      expect(retrieved).toEqual(ctx);
    });

    it('returns null for unknown JID', () => {
      expect(getDeepLinkContext('unknown@s.whatsapp.net')).toBeNull();
    });

    it('clears context', () => {
      setDeepLinkContext(testJid, { type: 'room' as const, value: '202', originalMessage: 'ROOM:202' });
      clearDeepLinkContext(testJid);
      expect(getDeepLinkContext(testJid)).toBeNull();
    });
  });

  // ─── AC6: Deep-link response generation ──────────────────────────

  describe('generateDeepLinkResponse', () => {
    it('generates table context response in English', () => {
      const ctx = { type: 'table' as const, value: '5', originalMessage: 'ORDER:TABLE:5' };
      const response = generateDeepLinkResponse(ctx, 'en');
      expect(response).toContain('Table 5');
      expect(response).toContain('order');
    });

    it('generates table context response in Malay', () => {
      const ctx = { type: 'table' as const, value: '3', originalMessage: 'ORDER:TABLE:3' };
      const response = generateDeepLinkResponse(ctx, 'ms');
      expect(response).toContain('Meja 3');
    });

    it('generates room context response', () => {
      const ctx = { type: 'room' as const, value: '202', originalMessage: 'ROOM:202' };
      const response = generateDeepLinkResponse(ctx, 'en');
      expect(response).toContain('Room 202');
    });

    it('generates campaign context response', () => {
      const ctx = { type: 'campaign' as const, value: 'lobby', originalMessage: 'CAMPAIGN:lobby' };
      const response = generateDeepLinkResponse(ctx, 'en');
      expect(response).toContain('Welcome');
    });

    it('falls back to English for unsupported language', () => {
      const ctx = { type: 'table' as const, value: '1', originalMessage: 'ORDER:TABLE:1' };
      const response = generateDeepLinkResponse(ctx, 'ta');
      expect(response.length).toBeGreaterThan(0);
    });
  });
});
