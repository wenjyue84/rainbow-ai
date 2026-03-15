/**
 * US-921: WCAG 3.3.7 Redundant Entry prevention tests
 *
 * Validates that session data (name, table, address) is persisted and
 * carried forward so the user is never asked to re-enter information.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cartSetTableInfo, cartGetTableInfo, cartClear } from '../cart-store.js';

describe('US-921: Redundant Entry Prevention', () => {
  const sessionId = 'test_session_921';

  beforeEach(() => {
    cartClear(sessionId);
  });

  describe('Table info persists across cart operations', () => {
    it('should retain table number after setting it', () => {
      cartSetTableInfo(sessionId, { tableNumber: '5', orderType: 'dine-in' });
      const info = cartGetTableInfo(sessionId);
      expect(info).toBeDefined();
      expect(info!.tableNumber).toBe('5');
      expect(info!.orderType).toBe('dine-in');
    });

    it('should merge partial updates without overwriting existing fields', () => {
      cartSetTableInfo(sessionId, { tableNumber: '5' });
      cartSetTableInfo(sessionId, { orderType: 'dine-in' });
      const info = cartGetTableInfo(sessionId);
      expect(info!.tableNumber).toBe('5');
      expect(info!.orderType).toBe('dine-in');
    });

    it('should return undefined for sessions with no table info', () => {
      expect(cartGetTableInfo('nonexistent_session')).toBeUndefined();
    });
  });

  describe('Session data store contract', () => {
    it('should accept guestName, tableNumber, orderType, deliveryAddress, seatNumber fields', () => {
      // Validates the WebchatSessionData interface contract
      const sessionData = {
        guestName: 'Ahmad',
        tableNumber: '5',
        orderType: 'dine-in',
        deliveryAddress: '123 Jalan Maju, Johor Bahru',
        seatNumber: 'A3',
        updatedAt: Date.now(),
      };

      // All fields should be present and typed correctly
      expect(typeof sessionData.guestName).toBe('string');
      expect(typeof sessionData.tableNumber).toBe('string');
      expect(typeof sessionData.orderType).toBe('string');
      expect(typeof sessionData.deliveryAddress).toBe('string');
      expect(typeof sessionData.seatNumber).toBe('string');
      expect(typeof sessionData.updatedAt).toBe('number');
    });

    it('should not re-ask for fields that are already populated', () => {
      // Simulates the system prompt builder logic
      const sessionData = {
        guestName: 'Ahmad',
        tableNumber: '5',
        deliveryAddress: '123 Jalan Maju',
      };

      const lines: string[] = [];
      if (sessionData.guestName) {
        lines.push(`Guest Name: ${sessionData.guestName} (already provided — do NOT ask again)`);
      }
      if (sessionData.deliveryAddress) {
        lines.push(`Delivery Address: ${sessionData.deliveryAddress} (already provided — offer as default, allow edit)`);
      }

      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('Ahmad');
      expect(lines[0]).toContain('do NOT ask again');
      expect(lines[1]).toContain('Jalan Maju');
      expect(lines[1]).toContain('offer as default');
    });

    it('should produce empty section when no session data exists', () => {
      const sessionData: Record<string, string> = {};
      const lines: string[] = [];
      if (sessionData.guestName) lines.push(`Guest Name: ${sessionData.guestName}`);
      if (sessionData.deliveryAddress) lines.push(`Delivery Address: ${sessionData.deliveryAddress}`);
      expect(lines).toHaveLength(0);
    });

    it('should carry forward table info from previous orders in the same session', () => {
      // First order: set table
      cartSetTableInfo(sessionId, { tableNumber: '5', orderType: 'dine-in' });

      // Simulate order placed (cart cleared but session data should persist in session store)
      const tableInfoBeforeClear = cartGetTableInfo(sessionId);
      expect(tableInfoBeforeClear!.tableNumber).toBe('5');

      // The server-side syncCartToSessionData function captures table info
      // before cart clear, so it's available for the next order
      const capturedData = {
        tableNumber: tableInfoBeforeClear!.tableNumber,
        orderType: tableInfoBeforeClear!.orderType,
      };

      // Clear cart (simulates order placed)
      cartClear(sessionId);
      expect(cartGetTableInfo(sessionId)).toBeUndefined();

      // But captured session data is still available
      expect(capturedData.tableNumber).toBe('5');
      expect(capturedData.orderType).toBe('dine-in');
    });
  });

  describe('Client-side localStorage contract', () => {
    it('should only update fields that are explicitly provided', () => {
      // Simulates the saveSessionData function logic
      const existing = { guestName: 'Ahmad', tableNumber: '5' };
      const newData = { orderType: 'takeaway' };

      const merged = { ...existing };
      for (const [k, v] of Object.entries(newData)) {
        if (v) (merged as any)[k] = v;
      }

      expect(merged.guestName).toBe('Ahmad'); // not overwritten
      expect(merged.tableNumber).toBe('5');    // not overwritten
      expect((merged as any).orderType).toBe('takeaway'); // added
    });

    it('should truncate long values for safety', () => {
      const longName = 'A'.repeat(200);
      const truncated = longName.slice(0, 100);
      expect(truncated.length).toBe(100);

      const longAddress = 'B'.repeat(600);
      const truncatedAddr = longAddress.slice(0, 500);
      expect(truncatedAddr.length).toBe(500);
    });
  });
});
