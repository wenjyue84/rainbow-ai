/**
 * Pre-Arrival Booking Sequence (US-884)
 *
 * Schedules a 3-message WhatsApp sequence for confirmed hostel bookings:
 *   1. Booking confirmation (immediate)
 *   2. Directions + check-in instructions (T-24h before arrival)
 *   3. "We're ready for you" message (T-1h before check-in)
 *
 * Messages are stored in the `scheduled_messages` DB table and processed
 * by a 60s polling loop. Session window and opt-out checks apply at send time.
 */

import { pool } from './db.js';
import { sessionWindowActive, logSessionExpired } from './session-window.js';
import { isOptedOut } from '../assistant/opt-out.js';
import { recordWhatsappMessageCost } from './whatsapp-cost.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface BookingInput {
  jid: string;              // Guest WhatsApp JID (phone@s.whatsapp.net or phone number)
  guestName: string;
  arrivalDate: string;      // ISO date string (YYYY-MM-DD)
  checkInTime?: string;     // HH:mm (default 14:00)
  roomType?: string;
  confirmationNumber?: string;
  profileId?: string;
}

export interface BookingSequenceResult {
  bookingId: string;
  scheduled: { step: string; sendAt: string }[];
  skipped: string[];
}

interface ScheduledRow {
  id: string;
  jid: string;
  profile_id: string;
  send_at: Date;
  template_key: string;
  variables: string | null;
  status: string;
  booking_id: string | null;
  sequence_step: string | null;
}

// ─── Template Interpolation ─────────────────────────────────────────

const TEMPLATES: Record<string, Record<string, string>> = {
  booking_confirmation: {
    en: `*Booking Confirmed!*

Hi {{guestName}}, your stay at Pelangi Capsule Hostel is confirmed!

*Check-in:* {{arrivalDate}} at {{checkInTime}}
*Room:* {{roomType}}
*Confirmation #:* {{confirmationNumber}}

We'll send you directions and check-in details closer to your arrival date. See you soon!

— Rainbow`,
    ms: `*Tempahan Disahkan!*

Hai {{guestName}}, penginapan anda di Pelangi Capsule Hostel telah disahkan!

*Daftar masuk:* {{arrivalDate}} pukul {{checkInTime}}
*Bilik:* {{roomType}}
*No. Pengesahan:* {{confirmationNumber}}

Kami akan hantar arah dan maklumat daftar masuk sebelum tarikh ketibaan anda. Jumpa nanti!

— Rainbow`,
    zh: `*预订已确认！*

您好 {{guestName}}，您在彩虹胶囊旅馆的住宿已确认！

*入住日期:* {{arrivalDate}} {{checkInTime}}
*房型:* {{roomType}}
*确认号:* {{confirmationNumber}}

我们会在您到达前发送路线和入住详情。期待您的到来！

— Rainbow`,
  },
  booking_directions: {
    en: `*Arriving Tomorrow — Directions & Check-in*

Hi {{guestName}}, we're looking forward to seeing you tomorrow!

*Address:* 26A Jalan Perang, Taman Pelangi, 80400 Johor Bahru
*Google Maps:* https://maps.app.goo.gl/maLXetUqYS5MtSLD9

*Check-in:* {{checkInTime}}
*Door password:* 1270#
*WiFi:* pelangi capsule / pw: ilovestaycapsule

Please prepare your passport (international) or IC (Malaysian) for check-in.

Video tour: youtube.com/watch?v=6Ux11oBZaQQ

— Rainbow`,
    ms: `*Tiba Esok — Arah & Daftar Masuk*

Hai {{guestName}}, kami menantikan kedatangan anda esok!

*Alamat:* 26A Jalan Perang, Taman Pelangi, 80400 Johor Bahru
*Google Maps:* https://maps.app.goo.gl/maLXetUqYS5MtSLD9

*Daftar masuk:* {{checkInTime}}
*Password pintu:* 1270#
*WiFi:* pelangi capsule / pw: ilovestaycapsule

Sila sediakan passport (antarabangsa) atau IC (Malaysia) untuk daftar masuk.

Video lawatan: youtube.com/watch?v=6Ux11oBZaQQ

— Rainbow`,
    zh: `*明天到达 — 路线和入住*

{{guestName}} 您好，期待明天见到您！

*地址:* 26A Jalan Perang, Taman Pelangi, 80400 Johor Bahru
*Google Maps:* https://maps.app.goo.gl/maLXetUqYS5MtSLD9

*入住时间:* {{checkInTime}}
*门密码:* 1270#
*WiFi:* pelangi capsule / 密码: ilovestaycapsule

请准备您的护照（国际旅客）或身份证/IC（马来西亚旅客）。

视频导览: youtube.com/watch?v=6Ux11oBZaQQ

— Rainbow`,
  },
  booking_ready: {
    en: `*We're Ready for You!*

Hi {{guestName}}, your capsule is all set! Check-in starts at {{checkInTime}}.

Just head to 26A Jalan Perang, Taman Pelangi. Door password: *1270#*

Need help? Just reply here and I'll assist you!

— Rainbow`,
    ms: `*Kami Sedia Menanti!*

Hai {{guestName}}, kapsul anda sudah sedia! Daftar masuk bermula pukul {{checkInTime}}.

Terus ke 26A Jalan Perang, Taman Pelangi. Password pintu: *1270#*

Perlukan bantuan? Balas di sini dan saya akan bantu!

— Rainbow`,
    zh: `*我们已准备好迎接您！*

{{guestName}} 您好，您的胶囊房已准备就绪！入住时间从 {{checkInTime}} 开始。

请前往 26A Jalan Perang, Taman Pelangi。门密码: *1270#*

需要帮助？在这里回复，我会为您提供协助！

— Rainbow`,
  },
};

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || '');
}

function getTemplateContent(templateKey: string, vars: Record<string, string>, lang = 'en'): string {
  const t = TEMPLATES[templateKey];
  if (!t) return `[Template ${templateKey} not found]`;
  const tmpl = t[lang] || t['en'] || '';
  return interpolate(tmpl, vars);
}

// ─── Schedule Booking Sequence ──────────────────────────────────────

export async function scheduleBookingSequence(input: BookingInput): Promise<BookingSequenceResult> {
  const bookingId = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const profileId = input.profileId || 'pelangi';
  const checkInTime = input.checkInTime || '14:00';
  const roomType = input.roomType || 'Capsule';
  const confirmationNumber = input.confirmationNumber || bookingId;

  const vars: Record<string, string> = {
    guestName: input.guestName,
    arrivalDate: input.arrivalDate,
    checkInTime,
    roomType,
    confirmationNumber,
  };
  const varsJson = JSON.stringify(vars);

  // Parse arrival datetime
  const arrivalDateTime = new Date(`${input.arrivalDate}T${checkInTime}:00+08:00`); // MYT
  const now = new Date();
  const hoursUntilArrival = (arrivalDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  const scheduled: { step: string; sendAt: string }[] = [];
  const skipped: string[] = [];

  // Step 1: Booking confirmation — immediate
  const confirmSendAt = new Date(now.getTime() + 5000); // 5s delay
  await insertScheduledMessage(input.jid, profileId, confirmSendAt, 'booking_confirmation', varsJson, bookingId, 'confirmation');
  scheduled.push({ step: 'confirmation', sendAt: confirmSendAt.toISOString() });

  // Step 2: Directions — T-24h before arrival
  if (hoursUntilArrival > 24) {
    const directionsSendAt = new Date(arrivalDateTime.getTime() - 24 * 60 * 60 * 1000);
    await insertScheduledMessage(input.jid, profileId, directionsSendAt, 'booking_directions', varsJson, bookingId, 'directions');
    scheduled.push({ step: 'directions', sendAt: directionsSendAt.toISOString() });
  } else {
    skipped.push('directions (arrival within 24h)');
  }

  // Step 3: Ready — T-1h before check-in
  if (hoursUntilArrival > 1) {
    const readySendAt = new Date(arrivalDateTime.getTime() - 1 * 60 * 60 * 1000);
    await insertScheduledMessage(input.jid, profileId, readySendAt, 'booking_ready', varsJson, bookingId, 'ready');
    scheduled.push({ step: 'ready', sendAt: readySendAt.toISOString() });
  } else {
    skipped.push('ready (arrival within 1h)');
  }

  console.log(`[BookingSequence] Scheduled ${scheduled.length} messages for booking ${bookingId} (${input.guestName})`);
  return { bookingId, scheduled, skipped };
}

async function insertScheduledMessage(
  jid: string, profileId: string, sendAt: Date,
  templateKey: string, variables: string, bookingId: string, step: string
): Promise<void> {
  await pool.query(
    `INSERT INTO scheduled_messages (id, jid, profile_id, send_at, template_key, variables, status, booking_id, sequence_step)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'pending', $6, $7)`,
    [jid, profileId, sendAt, templateKey, variables, bookingId, step]
  );
}

// ─── Cancel Booking Sequence ────────────────────────────────────────

export async function cancelBookingSequence(bookingId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE scheduled_messages SET status = 'cancelled' WHERE booking_id = $1 AND status = 'pending'`,
    [bookingId]
  );
  const count = result.rowCount || 0;
  if (count > 0) {
    console.log(`[BookingSequence] Cancelled ${count} pending messages for booking ${bookingId}`);
  }
  return count;
}

// ─── List Bookings ──────────────────────────────────────────────────

export async function listBookings(profileId?: string): Promise<any[]> {
  const where = profileId ? 'WHERE profile_id = $1' : '';
  const params = profileId ? [profileId] : [];
  const result = await pool.query(
    `SELECT booking_id, jid, profile_id, variables,
            MIN(created_at) as created_at,
            array_agg(sequence_step ORDER BY send_at) as steps,
            array_agg(status ORDER BY send_at) as step_statuses,
            array_agg(send_at ORDER BY send_at) as send_times
     FROM scheduled_messages
     WHERE booking_id IS NOT NULL
     ${profileId ? 'AND profile_id = $1' : ''}
     GROUP BY booking_id, jid, profile_id, variables
     ORDER BY MIN(created_at) DESC
     LIMIT 100`,
    params
  );
  return result.rows.map(row => {
    const vars = row.variables ? JSON.parse(row.variables) : {};
    return {
      bookingId: row.booking_id,
      jid: row.jid,
      profileId: row.profile_id,
      guestName: vars.guestName,
      arrivalDate: vars.arrivalDate,
      createdAt: row.created_at,
      steps: (row.steps as string[]).map((step: string, i: number) => ({
        step,
        status: (row.step_statuses as string[])[i],
        sendAt: (row.send_times as Date[])[i],
      })),
    };
  });
}

// ─── Polling Engine ─────────────────────────────────────────────────

const POLL_INTERVAL_MS = 60_000; // 60 seconds
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function processScheduledMessages(): Promise<void> {
  try {
    const result = await pool.query<ScheduledRow>(
      `SELECT id, jid, profile_id, send_at, template_key, variables, status, booking_id, sequence_step
       FROM scheduled_messages
       WHERE status = 'pending' AND send_at <= NOW()
       ORDER BY send_at ASC
       LIMIT 10`
    );

    for (const row of result.rows) {
      await sendScheduledMessage(row);
    }
  } catch (err: any) {
    console.error('[BookingSequence] Poll error:', err.message);
  }
}

async function sendScheduledMessage(row: ScheduledRow): Promise<void> {
  const vars = row.variables ? JSON.parse(row.variables) : {};

  // Opt-out check
  if (isOptedOut(row.jid)) {
    await markMessage(row.id, 'skipped', 'opted_out');
    console.warn(`[BookingSequence] Skipped ${row.id} — opted out`);
    return;
  }

  // Session window check — if expired, use utility template (leave pending for now)
  const sessionActive = await sessionWindowActive(row.jid);
  if (!sessionActive) {
    // Outside 24h window — log and skip (requires pre-approved template)
    logSessionExpired(row.jid, 'booking-sequence', row.template_key);
    await markMessage(row.id, 'skipped', 'session_expired');
    console.warn(`[BookingSequence] Skipped ${row.id} — session window expired`);
    return;
  }

  try {
    const content = getTemplateContent(row.template_key, vars);
    const { sendWhatsAppMessage } = await import('./baileys-client.js');
    await sendWhatsAppMessage(row.jid, content);

    // Log to conversation
    const { logMessage, getConversation } = await import('../assistant/conversation-logger.js');
    const convo = await getConversation(row.jid);
    const pushName = convo?.pushName || vars.guestName || 'Guest';
    await logMessage(row.jid, pushName, 'assistant', content, {
      manual: true,
      staffName: 'Booking Sequence',
    });

    await markMessage(row.id, 'sent');
    console.log(`[BookingSequence] Sent ${row.sequence_step} message ${row.id} to ${row.jid}`);

    // Track cost
    recordWhatsappMessageCost({ phone: row.jid, templateType: 'utility' }).catch(() => {});
  } catch (err: any) {
    await markMessage(row.id, 'pending', err.message); // Leave pending for retry
    console.error(`[BookingSequence] Failed to send ${row.id}:`, err.message);
  }
}

async function markMessage(id: string, status: string, error?: string): Promise<void> {
  const sentAt = status === 'sent' ? new Date() : null;
  await pool.query(
    `UPDATE scheduled_messages SET status = $1, sent_at = $2, error = $3 WHERE id = $4`,
    [status, sentAt, error || null, id]
  );
}

// ─── Init / Shutdown ────────────────────────────────────────────────

export function startBookingSequenceProcessor(): void {
  if (pollTimer) clearInterval(pollTimer);

  // Delayed start to let DB connect
  setTimeout(() => {
    processScheduledMessages().catch(err => {
      console.error('[BookingSequence] Initial poll failed:', err.message);
    });
  }, 15_000);

  pollTimer = setInterval(() => {
    processScheduledMessages().catch(err => {
      console.error('[BookingSequence] Poll failed:', err.message);
    });
  }, POLL_INTERVAL_MS);

  console.log('[BookingSequence] Processor started (60s polling)');
}

export function stopBookingSequenceProcessor(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[BookingSequence] Processor stopped');
  }
}

// ─── Exports for testing ────────────────────────────────────────────

export { interpolate as _interpolate, getTemplateContent as _getTemplateContent, TEMPLATES as _TEMPLATES };
