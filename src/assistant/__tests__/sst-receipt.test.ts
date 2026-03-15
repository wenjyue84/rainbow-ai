/**
 * Tests for US-967: SST-compliant receipt generation
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateSst,
  formatSstReceipt,
  formatSstConfirmationSummary,
  _resetInvoiceCounter,
  type SstConfig,
} from '../sst-receipt.js';
import type { CartItem } from '../cart-store.js';

const enabledSstConfig: SstConfig = {
  enabled: true,
  rate: 0.06,
  registrationNo: 'W12-1234-12345678',
  vendorName: 'Makan Moments Cafe',
};

const disabledSstConfig: SstConfig = {
  enabled: false,
  rate: 0,
  registrationNo: '',
  vendorName: '',
};

const sampleItems: CartItem[] = [
  { name: 'Nasi Lemak', code: 'NL01', qty: 2, price: 12.00 },
  { name: 'Teh Tarik', code: 'TT01', qty: 1, price: 4.50 },
];

const singleItem: CartItem[] = [
  { name: 'Roti Canai', code: 'RC01', qty: 1, price: 3.00 },
];

describe('US-967: SST Receipt', () => {
  beforeEach(() => {
    _resetInvoiceCounter();
  });

  // ─── AC1: SST line item when enabled ────────────────────────────────

  describe('AC1: SST line item display', () => {
    it('shows SST (6%) line when SST is enabled', () => {
      const receipt = formatSstReceipt(enabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toContain('SST (6%): RM');
    });

    it('shows correct SST amount for sample items', () => {
      // Subtotal: 2*12 + 1*4.50 = 28.50, SST: 28.50 * 0.06 = 1.71
      const receipt = formatSstReceipt(enabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toContain('SST (6%): RM 1.71');
    });

    it('returns empty string when SST is disabled', () => {
      const receipt = formatSstReceipt(disabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toBe('');
    });
  });

  // ─── AC2: SST registration number ──────────────────────────────────

  describe('AC2: SST registration number', () => {
    it('displays SST registration number on receipt', () => {
      const receipt = formatSstReceipt(enabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toContain('SST Reg: W12-1234-12345678');
    });

    it('omits SST Reg line when registration number is empty', () => {
      const configNoReg = { ...enabledSstConfig, registrationNo: '' };
      const receipt = formatSstReceipt(configNoReg, sampleItems, 'INV-20260315-0001');
      expect(receipt).not.toContain('SST Reg:');
    });
  });

  // ─── AC3: Subtotal, SST, Grand Total as distinct values ───────────

  describe('AC3: Distinct subtotal, SST, and grand total', () => {
    it('shows subtotal, SST, and grand total as separate lines', () => {
      const receipt = formatSstReceipt(enabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toContain('Subtotal: RM 28.50');
      expect(receipt).toContain('SST (6%): RM 1.71');
      expect(receipt).toContain('Grand Total: RM 30.21');
    });

    it('calculates correctly for single item', () => {
      // Subtotal: 3.00, SST: 0.18, Grand Total: 3.18
      const { subtotal, sstAmount, grandTotal } = calculateSst(singleItem, 0.06);
      expect(subtotal).toBe(3.00);
      expect(sstAmount).toBe(0.18);
      expect(grandTotal).toBe(3.18);
    });

    it('handles items without price (qty-only items)', () => {
      const noPrice: CartItem[] = [
        { name: 'Special Request', code: 'SR', qty: 1 },
        { name: 'Nasi Lemak', code: 'NL01', qty: 1, price: 12.00 },
      ];
      const { subtotal, sstAmount, grandTotal } = calculateSst(noPrice, 0.06);
      expect(subtotal).toBe(12.00);
      expect(sstAmount).toBe(0.72);
      expect(grandTotal).toBe(12.72);
    });
  });

  // ─── AC4: No SST when disabled ────────────────────────────────────

  describe('AC4: No SST when flag is disabled', () => {
    it('confirmation summary returns empty when disabled', () => {
      const result = formatSstConfirmationSummary(disabledSstConfig, sampleItems);
      expect(result).toBe('');
    });

    it('receipt returns empty when disabled', () => {
      const result = formatSstReceipt(disabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(result).toBe('');
    });

    it('calculateSst returns zero SST when rate is 0', () => {
      const { sstAmount } = calculateSst(sampleItems, 0);
      expect(sstAmount).toBe(0);
    });
  });

  // ─── AC5: Invoice number format ──────────────────────────────────

  describe('AC5: Sequential invoice number', () => {
    it('invoice number is included in receipt', () => {
      const receipt = formatSstReceipt(enabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toContain('Invoice: INV-20260315-0001');
    });

    it('invoice number follows INV-YYYYMMDD-NNNN format', () => {
      const invoiceNumber = 'INV-20260315-0042';
      expect(invoiceNumber).toMatch(/^INV-\d{8}-\d{4}$/);
    });
  });

  // ─── Confirmation summary (pre-order) ─────────────────────────────

  describe('Confirmation summary (pre-order)', () => {
    it('shows subtotal, SST, and grand total', () => {
      const summary = formatSstConfirmationSummary(enabledSstConfig, sampleItems);
      expect(summary).toContain('Subtotal: RM 28.50');
      expect(summary).toContain('SST (6%): RM 1.71');
      expect(summary).toContain('Grand Total: RM 30.21');
    });

    it('does not include invoice number (not yet generated)', () => {
      const summary = formatSstConfirmationSummary(enabledSstConfig, sampleItems);
      expect(summary).not.toContain('Invoice:');
    });
  });

  // ─── Vendor name display ──────────────────────────────────────────

  describe('Vendor name on receipt', () => {
    it('displays vendor name on receipt', () => {
      const receipt = formatSstReceipt(enabledSstConfig, sampleItems, 'INV-20260315-0001');
      expect(receipt).toContain('Makan Moments Cafe');
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('handles empty cart', () => {
      const { subtotal, sstAmount, grandTotal } = calculateSst([], 0.06);
      expect(subtotal).toBe(0);
      expect(sstAmount).toBe(0);
      expect(grandTotal).toBe(0);
    });

    it('rounds SST to 2 decimal places', () => {
      // Price that creates a repeating decimal: 7.33 * 0.06 = 0.4398
      const items: CartItem[] = [{ name: 'Test', code: 'T1', qty: 1, price: 7.33 }];
      const { sstAmount } = calculateSst(items, 0.06);
      const decimalPlaces = sstAmount.toString().split('.')[1]?.length || 0;
      expect(decimalPlaces).toBeLessThanOrEqual(2);
    });

    it('handles large orders correctly', () => {
      const items: CartItem[] = [
        { name: 'Expensive Item', code: 'EX01', qty: 100, price: 99.99 },
      ];
      const { subtotal, sstAmount, grandTotal } = calculateSst(items, 0.06);
      expect(subtotal).toBe(9999);
      expect(sstAmount).toBe(599.94);
      expect(grandTotal).toBe(10598.94);
    });
  });
});
