/**
 * E-Invoice Queue Processor (US-1039)
 *
 * Background processor that:
 * 1. Picks up pending e-invoice submissions from the einvoice_queue table
 * 2. Submits them to MyInvois API with exponential backoff retry
 * 3. On success, generates PDF and delivers via WhatsApp
 * 4. Retries for up to 72 hours; after that, flags for manual submission
 *
 * Polling interval: 30 seconds (configurable).
 * Max retry window: 72 hours.
 */

import { eq, and, lte, sql, inArray } from 'drizzle-orm';
import { db } from './db.js';
import { einvoiceQueue } from '../../shared/schema.js';
import type { InvoiceSubmission, InvoiceLineItem } from './myinvois.js';
import { submitInvoice, generateInvoicePdf } from './myinvois.js';
import { sendWhatsAppMedia, sendWhatsAppMessage } from './whatsapp/index.js';

// ─── Configuration ──────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const MAX_RETRY_HOURS = 72;
const MAX_RETRY_MS = MAX_RETRY_HOURS * 60 * 60 * 1000;
const BASE_BACKOFF_MS = 60_000; // 1 minute initial backoff
const MAX_BACKOFF_MS = 30 * 60_000; // 30 minutes max backoff
const BATCH_SIZE = 10;

// Default supplier info (from env or fallback)
const SUPPLIER_TIN = process.env.MYINVOIS_SUPPLIER_TIN || '';
const SUPPLIER_NAME = process.env.MYINVOIS_SUPPLIER_NAME || 'Pelangi Capsule Hostel';
const SUPPLIER_ADDRESS = process.env.MYINVOIS_SUPPLIER_ADDRESS || 'Johor Bahru, Johor, Malaysia';
const ADMIN_PHONE = process.env.STAFF_PRIMARY_PHONE || '';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Queue a new e-invoice for submission to MyInvois.
 * Call this after an order or booking is marked complete.
 */
export async function queueEinvoice(params: {
  transactionType: 'order' | 'booking';
  transactionId: string;
  profileId?: string;
  customerPhone?: string;
  customerName?: string;
  customerIdNumber?: string;
  supplierTin?: string;
  lineItems: InvoiceLineItem[];
  totalAmount: number;
  sstAmount?: number;
}): Promise<string> {
  const [entry] = await db.insert(einvoiceQueue).values({
    transactionType: params.transactionType,
    transactionId: params.transactionId,
    profileId: params.profileId || 'pelangi',
    customerPhone: params.customerPhone || null,
    customerName: params.customerName || null,
    customerIdNumber: params.customerIdNumber || null,
    supplierTin: params.supplierTin || SUPPLIER_TIN,
    lineItems: JSON.stringify(params.lineItems),
    totalAmount: params.totalAmount,
    sstAmount: params.sstAmount ?? 0,
    status: 'pending',
    attempts: 0,
    nextRetryAt: new Date(),
  }).returning({ id: einvoiceQueue.id });

  console.log(`[EinvoiceQueue] Queued ${params.transactionType} ${params.transactionId} → ${entry.id}`);
  return entry.id;
}

/**
 * Start the background polling loop.
 * Safe to call multiple times (idempotent).
 */
export function startEinvoiceQueueProcessor(): void {
  if (pollTimer) return;

  // Don't start if MyInvois credentials aren't configured
  if (!process.env.MYINVOIS_CLIENT_ID) {
    console.log('[EinvoiceQueue] MyInvois credentials not configured — processor disabled');
    return;
  }

  console.log('[EinvoiceQueue] Starting queue processor (poll every 30s)');
  pollTimer = setInterval(processPendingInvoices, POLL_INTERVAL_MS);

  // Run once immediately
  processPendingInvoices().catch(err => {
    console.error('[EinvoiceQueue] Initial poll failed:', err.message);
  });
}

/**
 * Stop the background polling loop.
 */
export function stopEinvoiceQueueProcessor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[EinvoiceQueue] Processor stopped');
  }
}

// ─── Queue Processing ───────────────────────────────────────────────

async function processPendingInvoices(): Promise<void> {
  if (isProcessing) return; // Prevent concurrent runs
  isProcessing = true;

  try {
    const now = new Date();

    // 1. Expire entries older than 72 hours that are still pending/submitted
    await expireOldEntries(now);

    // 2. Pick up entries ready for processing
    const entries = await db
      .select()
      .from(einvoiceQueue)
      .where(
        and(
          inArray(einvoiceQueue.status, ['pending', 'submitted']),
          lte(einvoiceQueue.nextRetryAt, now),
        )
      )
      .limit(BATCH_SIZE);

    if (entries.length === 0) return;

    console.log(`[EinvoiceQueue] Processing ${entries.length} pending invoice(s)`);

    for (const entry of entries) {
      await processOneInvoice(entry);
    }
  } catch (err: any) {
    console.error('[EinvoiceQueue] Poll error:', err.message);
  } finally {
    isProcessing = false;
  }
}

async function processOneInvoice(entry: typeof einvoiceQueue.$inferSelect): Promise<void> {
  const lineItems: InvoiceLineItem[] = JSON.parse(entry.lineItems);

  const invoice: InvoiceSubmission = {
    transactionId: entry.transactionId,
    transactionType: entry.transactionType as 'order' | 'booking',
    supplierTin: entry.supplierTin,
    supplierName: SUPPLIER_NAME,
    supplierAddress: SUPPLIER_ADDRESS,
    buyerName: entry.customerName || 'Walk-in Customer',
    buyerIdType: 'NRIC',
    buyerIdNumber: entry.customerIdNumber || '000000000000',
    transactionDate: entry.createdAt.toISOString(),
    lineItems,
    totalAmount: entry.totalAmount,
    sstAmount: entry.sstAmount,
    currency: 'MYR',
  };

  try {
    // Update attempt count
    const newAttempts = entry.attempts + 1;
    await db.update(einvoiceQueue)
      .set({
        attempts: newAttempts,
        status: 'submitted',
        updatedAt: new Date(),
      })
      .where(eq(einvoiceQueue.id, entry.id));

    // Submit to MyInvois
    const result = await submitInvoice(invoice);

    if (result.success && result.uin) {
      // Success — update status and deliver PDF
      await db.update(einvoiceQueue)
        .set({
          status: 'validated',
          uin: result.uin,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(einvoiceQueue.id, entry.id));

      console.log(`[EinvoiceQueue] ${entry.id} validated with UIN: ${result.uin}`);

      // Deliver PDF via WhatsApp
      if (entry.customerPhone) {
        await deliverInvoicePdf(entry, invoice, result.uin);
      }
    } else {
      // Failed — schedule retry with exponential backoff
      const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, newAttempts - 1), MAX_BACKOFF_MS);
      const nextRetry = new Date(Date.now() + backoffMs);
      const errorMsg = result.validationErrors?.join('; ') || 'Unknown error';

      await db.update(einvoiceQueue)
        .set({
          status: 'pending',
          lastError: errorMsg,
          nextRetryAt: nextRetry,
          updatedAt: new Date(),
        })
        .where(eq(einvoiceQueue.id, entry.id));

      console.warn(`[EinvoiceQueue] ${entry.id} attempt ${newAttempts} failed: ${errorMsg}. Next retry: ${nextRetry.toISOString()}`);
    }
  } catch (err: any) {
    // Network/unexpected error — schedule retry
    const newAttempts = entry.attempts + 1;
    const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, newAttempts - 1), MAX_BACKOFF_MS);
    const nextRetry = new Date(Date.now() + backoffMs);

    await db.update(einvoiceQueue)
      .set({
        attempts: newAttempts,
        status: 'pending',
        lastError: err.message,
        nextRetryAt: nextRetry,
        updatedAt: new Date(),
      })
      .where(eq(einvoiceQueue.id, entry.id));

    console.error(`[EinvoiceQueue] ${entry.id} error: ${err.message}. Next retry: ${nextRetry.toISOString()}`);
  }
}

/**
 * Mark entries older than 72 hours as expired and send admin alert.
 */
async function expireOldEntries(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - MAX_RETRY_MS);

  const expired = await db.update(einvoiceQueue)
    .set({
      status: 'expired',
      lastError: `Exceeded ${MAX_RETRY_HOURS}-hour retry window — requires manual submission`,
      updatedAt: now,
    })
    .where(
      and(
        inArray(einvoiceQueue.status, ['pending', 'submitted']),
        lte(einvoiceQueue.createdAt, cutoff),
      )
    )
    .returning({ id: einvoiceQueue.id, transactionId: einvoiceQueue.transactionId });

  if (expired.length > 0 && ADMIN_PHONE) {
    const ids = expired.map(e => e.transactionId).join(', ');
    try {
      await sendWhatsAppMessage(
        ADMIN_PHONE,
        `⚠️ *E-Invoice Alert*\n\n${expired.length} invoice(s) expired after ${MAX_RETRY_HOURS}h without MyInvois validation.\n\nTransaction IDs: ${ids}\n\nPlease submit manually via MyInvois portal.`,
      );
    } catch {
      console.error('[EinvoiceQueue] Failed to send admin alert for expired invoices');
    }
  }
}

/**
 * Generate and deliver e-invoice PDF via WhatsApp.
 */
async function deliverInvoicePdf(
  entry: typeof einvoiceQueue.$inferSelect,
  invoice: InvoiceSubmission,
  uin: string,
): Promise<void> {
  try {
    const pdfBuffer = generateInvoicePdf(invoice, uin);

    await sendWhatsAppMedia(
      entry.customerPhone!,
      pdfBuffer,
      'text/plain', // Plain text receipt format
      `einvoice-${entry.transactionId}.txt`,
      `Your e-invoice for ${invoice.transactionType === 'order' ? 'order' : 'booking'} ${entry.transactionId}.\nUIN: ${uin}\nVerify: https://myinvois.hasil.gov.my/verify/${uin}`,
    );

    await db.update(einvoiceQueue)
      .set({
        status: 'delivered',
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(einvoiceQueue.id, entry.id));

    console.log(`[EinvoiceQueue] ${entry.id} PDF delivered to ${entry.customerPhone}`);
  } catch (err: any) {
    console.error(`[EinvoiceQueue] ${entry.id} PDF delivery failed: ${err.message}`);
    // Invoice is validated but delivery failed — don't change status from 'validated'
    // Admin can check dashboard for undelivered invoices
  }
}
