/**
 * sst-receipt.ts — SST-compliant receipt generation and storage (US-967)
 *
 * Handles:
 * - SST (6% service tax) calculation for Malaysian F&B compliance
 * - Sequential invoice number generation (INV-YYYYMMDD-NNNN)
 * - Receipt formatting for WhatsApp messages
 * - Receipt persistence in DB for 7-year customs retention
 */

import { pool } from '../lib/db.js';
import type { CartItem } from './cart-store.js';

export interface SstConfig {
  enabled: boolean;
  rate: number;          // e.g. 0.06 for 6%
  registrationNo: string; // e.g. W12-1234-12345678
  vendorName: string;
}

export interface ReceiptData {
  invoiceNumber: string;
  vendorName: string;
  sstRegistrationNo: string | null;
  subtotal: number;
  sstRate: number;
  sstAmount: number;
  grandTotal: number;
  items: CartItem[];
  tableNumber?: string;
  orderType?: string;
}

// In-memory daily counter for invoice numbers (resets on date change)
let lastInvoiceDate = '';
let dailyCounter = 0;

/**
 * Generate a sequential invoice number: INV-YYYYMMDD-NNNN
 * Counter resets daily. On startup, queries DB for the last invoice of the day.
 */
export async function generateInvoiceNumber(profileId: string = 'makan-moments'): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  if (dateStr !== lastInvoiceDate) {
    // New day — check DB for existing invoices today
    lastInvoiceDate = dateStr;
    dailyCounter = 0;
    try {
      const prefix = `INV-${dateStr}-`;
      const result = await pool.query(
        `SELECT invoice_number FROM order_receipts
         WHERE invoice_number LIKE $1 AND profile_id = $2
         ORDER BY invoice_number DESC LIMIT 1`,
        [prefix + '%', profileId]
      );
      if (result.rows.length > 0) {
        const lastNum = result.rows[0].invoice_number;
        const seq = parseInt(lastNum.split('-').pop() || '0', 10);
        dailyCounter = seq;
      }
    } catch {
      // DB unavailable — start from 0 (will still be unique via YYYYMMDD prefix)
    }
  }

  dailyCounter++;
  const seq = String(dailyCounter).padStart(4, '0');
  return `INV-${dateStr}-${seq}`;
}

/**
 * Calculate SST amounts from cart items.
 */
export function calculateSst(items: CartItem[], sstRate: number): { subtotal: number; sstAmount: number; grandTotal: number } {
  const subtotal = items.reduce((sum, item) => {
    return sum + (item.price !== undefined ? item.price * item.qty : 0);
  }, 0);

  const sstAmount = Math.round(subtotal * sstRate * 100) / 100; // Round to 2 decimal places
  const grandTotal = Math.round((subtotal + sstAmount) * 100) / 100;

  return { subtotal, sstAmount, grandTotal };
}

/**
 * Format a receipt line for the order confirmation/submission message.
 * When SST is enabled, shows: Subtotal, SST (6%), Grand Total, and registration number.
 * When SST is disabled, returns empty string (existing total display is used).
 */
export function formatSstReceipt(config: SstConfig, items: CartItem[], invoiceNumber: string): string {
  if (!config.enabled) return '';

  const { subtotal, sstAmount, grandTotal } = calculateSst(items, config.rate);
  const ratePercent = Math.round(config.rate * 100);

  const lines: string[] = [];
  lines.push('');  // blank line separator
  lines.push('─────────────────────');
  lines.push(`Subtotal: RM ${subtotal.toFixed(2)}`);
  lines.push(`SST (${ratePercent}%): RM ${sstAmount.toFixed(2)}`);
  lines.push(`*Grand Total: RM ${grandTotal.toFixed(2)}*`);
  lines.push('─────────────────────');
  lines.push(`Invoice: ${invoiceNumber}`);
  if (config.registrationNo) {
    lines.push(`SST Reg: ${config.registrationNo}`);
  }
  lines.push(config.vendorName);

  return lines.join('\n');
}

/**
 * Format the confirmation summary with SST breakdown (shown before order is placed).
 * Replaces the default "Total: RM X.XX" line when SST is enabled.
 */
export function formatSstConfirmationSummary(config: SstConfig, items: CartItem[]): string {
  if (!config.enabled) return '';

  const { subtotal, sstAmount, grandTotal } = calculateSst(items, config.rate);
  const ratePercent = Math.round(config.rate * 100);

  const lines: string[] = [];
  lines.push('');
  lines.push(`Subtotal: RM ${subtotal.toFixed(2)}`);
  lines.push(`SST (${ratePercent}%): RM ${sstAmount.toFixed(2)}`);
  lines.push(`*Grand Total: RM ${grandTotal.toFixed(2)}*`);

  return lines.join('\n');
}

/**
 * Store receipt in database for customs record-keeping (7-year retention).
 * Fire-and-forget pattern — errors are logged but don't block order flow.
 */
export async function storeReceipt(
  receipt: ReceiptData,
  sessionId: string,
  orderId: string,
  profileId: string = 'makan-moments'
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO order_receipts
       (invoice_number, profile_id, session_id, order_id, vendor_name,
        sst_registration_no, subtotal, sst_rate, sst_amount, grand_total,
        items, table_number, order_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        receipt.invoiceNumber,
        profileId,
        sessionId,
        orderId,
        receipt.vendorName,
        receipt.sstRegistrationNo,
        receipt.subtotal,
        receipt.sstRate,
        receipt.sstAmount,
        receipt.grandTotal,
        JSON.stringify(receipt.items.map(i => ({
          name: i.name, code: i.code, qty: i.qty, price: i.price, notes: i.notes
        }))),
        receipt.tableNumber || null,
        receipt.orderType || null,
      ]
    );
  } catch (err: any) {
    console.error(`[SST-Receipt] Failed to store receipt ${receipt.invoiceNumber}:`, err.message);
  }
}

/**
 * Reset the daily counter (for testing).
 */
export function _resetInvoiceCounter(): void {
  lastInvoiceDate = '';
  dailyCounter = 0;
}
