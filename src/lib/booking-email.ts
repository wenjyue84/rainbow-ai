/**
 * Booking Workflow Email Confirmation (US-296)
 *
 * Generates booking confirmation emails with language-specific templates
 * and deduplication to prevent duplicate sends during workflow retries.
 */

import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('BookingEmail');

// ─── Types ────────────────────────────────────────────────────────────────

export type SupportedLanguage = 'en' | 'ms' | 'ta';

export interface BookingEmailData {
  guestName: string;
  guestEmail: string;
  confirmationId: string;
  checkIn: string;
  checkOut: string;
  guestCount: number;
  roomType?: string;
  totalAmount?: number;
}

export interface BookingEmailOutput {
  recipient: string;
  subject: string;
  body: string;
  language: SupportedLanguage;
  confirmationId: string;
}

// ─── Language Templates ───────────────────────────────────────────────────

interface EmailTemplate {
  subject: (confirmationId: string) => string;
  body: (data: BookingEmailData) => string;
}

const templates: Record<SupportedLanguage, EmailTemplate> = {
  en: {
    subject: (id) => `Booking Confirmation - ${id}`,
    body: (data) =>
      [
        `Dear ${data.guestName},`,
        ``,
        `Your booking has been confirmed!`,
        ``,
        `Booking Details:`,
        `  Confirmation ID: ${data.confirmationId}`,
        `  Check-in: ${data.checkIn}`,
        `  Check-out: ${data.checkOut}`,
        `  Guests: ${data.guestCount}`,
        ...(data.roomType ? [`  Room Type: ${data.roomType}`] : []),
        ...(data.totalAmount != null ? [`  Total: RM${data.totalAmount.toFixed(2)}`] : []),
        ``,
        `Thank you for choosing Pelangi Capsule Hostel!`,
      ].join('\n'),
  },

  ms: {
    subject: (id) => `Pengesahan Tempahan - ${id}`,
    body: (data) =>
      [
        `${data.guestName} yang dihormati,`,
        ``,
        `Tempahan anda telah disahkan!`,
        ``,
        `Butiran Tempahan:`,
        `  ID Pengesahan: ${data.confirmationId}`,
        `  Daftar Masuk: ${data.checkIn}`,
        `  Daftar Keluar: ${data.checkOut}`,
        `  Tetamu: ${data.guestCount}`,
        ...(data.roomType ? [`  Jenis Bilik: ${data.roomType}`] : []),
        ...(data.totalAmount != null ? [`  Jumlah: RM${data.totalAmount.toFixed(2)}`] : []),
        ``,
        `Terima kasih kerana memilih Pelangi Capsule Hostel!`,
      ].join('\n'),
  },

  ta: {
    subject: (id) => `முன்பதிவு உறுதிப்படுத்தல் - ${id}`,
    body: (data) =>
      [
        `அன்புள்ள ${data.guestName},`,
        ``,
        `உங்கள் முன்பதிவு உறுதிப்படுத்தப்பட்டது!`,
        ``,
        `முன்பதிவு விவரங்கள்:`,
        `  உறுதிப்படுத்தல் எண்: ${data.confirmationId}`,
        `  செக்-இன்: ${data.checkIn}`,
        `  செக்-அவுட்: ${data.checkOut}`,
        `  விருந்தினர்கள்: ${data.guestCount}`,
        ...(data.roomType ? [`  அறை வகை: ${data.roomType}`] : []),
        ...(data.totalAmount != null ? [`  மொத்தம்: RM${data.totalAmount.toFixed(2)}`] : []),
        ``,
        `Pelangi Capsule Hostel-ஐ தேர்ந்தெடுத்ததற்கு நன்றி!`,
      ].join('\n'),
  },
};

// ─── Deduplication ────────────────────────────────────────────────────────

/** Track sent emails by confirmationId to prevent duplicates on retry */
const sentEmails = new Map<string, number>();

const DEDUP_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Clear expired dedup entries (exported for testing) */
export function clearExpiredDedup(): void {
  const now = Date.now();
  for (const [key, sentAt] of sentEmails.entries()) {
    if (now - sentAt > DEDUP_TTL_MS) {
      sentEmails.delete(key);
    }
  }
}

/** Reset dedup cache (exported for testing) */
export function resetDedupCache(): void {
  sentEmails.clear();
}

/** Check if an email was already sent for a given confirmationId */
export function wasSent(confirmationId: string): boolean {
  const sentAt = sentEmails.get(confirmationId);
  if (sentAt == null) return false;
  if (Date.now() - sentAt > DEDUP_TTL_MS) {
    sentEmails.delete(confirmationId);
    return false;
  }
  return true;
}

// ─── Email Generation ─────────────────────────────────────────────────────

/**
 * Generate a booking confirmation email using the appropriate language template.
 *
 * @param data     Booking details
 * @param language Guest language preference (defaults to 'en')
 * @returns        Email output with recipient, subject, and body
 */
export function generateBookingEmail(
  data: BookingEmailData,
  language: SupportedLanguage = 'en',
): BookingEmailOutput {
  const template = templates[language] ?? templates.en;

  return {
    recipient: data.guestEmail,
    subject: template.subject(data.confirmationId),
    body: template.body(data),
    language,
    confirmationId: data.confirmationId,
  };
}

/**
 * Generate and "send" a booking confirmation email with deduplication.
 *
 * Returns the email output if generated, or `null` if the email was
 * already sent (dedup hit). In production this would hand off to an
 * email transport; here we generate the output and record the send.
 *
 * @param data     Booking details
 * @param language Guest language preference
 * @returns        Email output or null if duplicate
 */
export function sendBookingConfirmationEmail(
  data: BookingEmailData,
  language: SupportedLanguage = 'en',
): BookingEmailOutput | null {
  if (wasSent(data.confirmationId)) {
    logger.info('Duplicate email suppressed', {
      confirmationId: data.confirmationId,
      recipient: data.guestEmail,
    });
    return null;
  }

  const email = generateBookingEmail(data, language);

  // Record as sent
  sentEmails.set(data.confirmationId, Date.now());

  logger.info('Booking confirmation email generated', {
    confirmationId: data.confirmationId,
    recipient: email.recipient,
    language,
  });

  return email;
}
