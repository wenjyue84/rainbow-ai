/**
 * US-920: WhatsApp Flows Digital Check-in Endpoint
 *
 * Dedicated data-exchange endpoint for the guest digital check-in flow.
 * Flow screens: CHECKIN_WELCOME → PERSONAL_DETAILS → ID_VERIFICATION →
 *               TERMS_AND_CONDITIONS → CHECKIN_COMPLETE
 *
 * Handles Meta's RSA-OAEP + AES-128-GCM encrypted payloads.
 * Reuses the crypto utilities from whatsapp-flows-crypto.ts (US-909).
 *
 * Action types:
 *   - INIT         : Start flow — pre-fills booking data from DB by phone number
 *   - data_exchange: Validate screen submission and advance to next screen
 *   - BACK         : Return to previous screen, restoring state
 *   - ping         : Health check — responds {data: {status:'active'}} within 5s
 *
 * Endpoint: POST /whatsapp-flows/checkin-exchange
 * Health:   GET  /whatsapp-flows/checkin-health
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { existsSync } from 'fs';
import { readFileSync } from 'fs';
import { decryptRequest, encryptResponse } from '../../lib/whatsapp-flows-crypto.js';
import { pool } from '../../lib/db.js';
import { callAPI } from '../../lib/http-client.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';
import { loadAdminNotificationSettings } from '../../lib/admin-notification-settings.js';

const router = Router();

// ─── Configuration ────────────────────────────────────────────────────
const CHECKIN_PRIVATE_KEY_PATH = process.env.WA_FLOWS_CHECKIN_PRIVATE_KEY_PATH
  || process.env.WA_FLOWS_PRIVATE_KEY_PATH
  || '';
const CHECKIN_PRIVATE_KEY_PEM = process.env.WA_FLOWS_CHECKIN_PRIVATE_KEY
  || process.env.WA_FLOWS_PRIVATE_KEY
  || '';
const CHECKIN_FLOW_TOKEN = process.env.WA_FLOWS_CHECKIN_TOKEN
  || process.env.WA_FLOWS_TOKEN
  || '';

let _privateKey: string | null = null;

function getPrivateKey(): string | null {
  if (_privateKey) return _privateKey;

  if (CHECKIN_PRIVATE_KEY_PEM) {
    _privateKey = CHECKIN_PRIVATE_KEY_PEM;
    return _privateKey;
  }

  if (CHECKIN_PRIVATE_KEY_PATH && existsSync(CHECKIN_PRIVATE_KEY_PATH)) {
    try {
      _privateKey = readFileSync(CHECKIN_PRIVATE_KEY_PATH, 'utf-8');
      return _privateKey;
    } catch (err: any) {
      console.error('[WA Flows Checkin] Failed to read private key:', err.message);
    }
  }

  return null;
}

// ─── Screen IDs ───────────────────────────────────────────────────────
const SCREEN = {
  WELCOME: 'CHECKIN_WELCOME',
  PERSONAL_DETAILS: 'PERSONAL_DETAILS',
  ID_VERIFICATION: 'ID_VERIFICATION',
  TERMS: 'TERMS_AND_CONDITIONS',
  COMPLETE: 'CHECKIN_COMPLETE',
} as const;

type ScreenId = typeof SCREEN[keyof typeof SCREEN];

// ─── Screen order for BACK navigation ─────────────────────────────────
const SCREEN_ORDER: ScreenId[] = [
  SCREEN.WELCOME,
  SCREEN.PERSONAL_DETAILS,
  SCREEN.ID_VERIFICATION,
  SCREEN.TERMS,
  SCREEN.COMPLETE,
];

function getPreviousScreen(currentScreen: string): ScreenId {
  const idx = SCREEN_ORDER.indexOf(currentScreen as ScreenId);
  if (idx <= 0) return SCREEN.WELCOME;
  return SCREEN_ORDER[idx - 1];
}

// ─── Booking Lookup ───────────────────────────────────────────────────
interface BookingInfo {
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  roomType: string | null;
  idNumber: string | null; // IC/passport from PMS (for validation)
  bookingRef: string | null;
}

/**
 * Look up a booking by phone number.
 * Tries: (1) wa_flow_reservations table, (2) DIGIMAN PMS API.
 * Returns null fields if booking not found.
 */
async function lookupBookingByPhone(phone: string): Promise<BookingInfo> {
  const empty: BookingInfo = {
    guestName: null,
    checkIn: null,
    checkOut: null,
    roomType: null,
    idNumber: null,
    bookingRef: null,
  };

  if (!phone) return empty;

  // Normalize phone: strip leading + and whitespace
  const normalized = phone.replace(/^\+/, '').replace(/\s/g, '');

  // 1. Try wa_flow_reservations (created by US-909 reservation flow)
  if (pool) {
    try {
      const result = await pool.query<{
        booking_ref: string;
        check_in: string;
        check_out: string;
        room_type: string;
        sender_phone: string;
      }>(
        `SELECT booking_ref, check_in::text, check_out::text, room_type, sender_phone
         FROM wa_flow_reservations
         WHERE sender_phone = $1 OR sender_phone = $2
         ORDER BY created_at DESC
         LIMIT 1`,
        [normalized, `+${normalized}`]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          guestName: null, // reservation doesn't store name
          checkIn: row.check_in,
          checkOut: row.check_out,
          roomType: row.room_type,
          idNumber: null,
          bookingRef: row.booking_ref,
        };
      }
    } catch (err: any) {
      console.warn('[WA Flows Checkin] wa_flow_reservations lookup failed:', err.message);
    }
  }

  // 2. Try DIGIMAN PMS API — search by phone number
  try {
    type PmsGuest = {
      name?: string;
      idNumber?: string;
      checkIn?: string;
      checkOut?: string;
      checkInDate?: string;
      checkOutDate?: string;
      expectedCheckoutDate?: string;
      roomType?: string;
      bookingRef?: string;
      phoneNumber?: string;
      phone?: string;
    };
    const response = await callAPI<{
      guests?: PmsGuest[];
      data?: PmsGuest[];
    }>('GET', `/api/guests/search?phone=${encodeURIComponent(normalized)}&limit=1`);

    const guests = response?.guests || response?.data || [];
    if (guests.length > 0) {
      const g = guests[0];
      return {
        guestName: g.name || null,
        checkIn: g.checkIn || g.checkInDate || null,
        checkOut: g.checkOut || g.checkOutDate || g.expectedCheckoutDate || null,
        roomType: g.roomType || null,
        idNumber: g.idNumber || null,
        bookingRef: g.bookingRef || null,
      };
    }
  } catch (_err: any) {
    // PMS endpoint may not exist — this is acceptable, we just skip pre-fill
    console.debug('[WA Flows Checkin] PMS booking lookup unavailable');
  }

  return empty;
}

// ─── IC/Passport Validation ───────────────────────────────────────────
/**
 * Validate IC/passport number format (basic).
 * Malaysian IC: 12 digits (YYMMDD-PB-XXXX format, digits only).
 * Passport: alphanumeric, 6-20 chars.
 */
function validateIdFormat(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed) return 'IC or passport number is required.';
  if (trimmed.length < 5) return 'IC/passport number is too short. Please check and re-enter.';
  if (trimmed.length > 20) return 'IC/passport number is too long. Please check and re-enter.';
  if (!/^[A-Za-z0-9\-]+$/.test(trimmed)) {
    return 'IC/passport number should only contain letters, numbers, and hyphens.';
  }
  return null;
}

/**
 * Check if submitted IC/passport matches the booking on file.
 * Returns null if no booking ID to check against (allow through).
 */
function validateIdAgainstBooking(
  submittedId: string,
  bookingId: string | null
): string | null {
  if (!bookingId) return null; // No booking on file — cannot validate
  const normalize = (s: string) => s.replace(/[\s\-]/g, '').toUpperCase();
  if (normalize(submittedId) !== normalize(bookingId)) {
    return 'The IC/passport number does not match our booking record. Please check your document and try again.';
  }
  return null;
}

// ─── DB Persistence ───────────────────────────────────────────────────
let _checkinTableEnsured = false;

async function ensureCheckinTable(): Promise<void> {
  if (_checkinTableEnsured || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_flow_checkins (
        id SERIAL PRIMARY KEY,
        booking_ref TEXT,
        guest_name TEXT NOT NULL,
        id_number TEXT NOT NULL,
        nationality TEXT,
        check_in DATE,
        check_out DATE,
        room_type TEXT,
        terms_accepted BOOLEAN NOT NULL DEFAULT false,
        sender_phone TEXT,
        status TEXT NOT NULL DEFAULT 'pending_arrival',
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    _checkinTableEnsured = true;
  } catch (err: any) {
    console.warn('[WA Flows Checkin] Failed to ensure checkin table:', err.message);
  }
}

interface CheckinRecord {
  bookingRef: string | null;
  guestName: string;
  idNumber: string;
  nationality: string | null;
  checkIn: string | null;
  checkOut: string | null;
  roomType: string | null;
  termsAccepted: boolean;
  senderPhone: string | null;
}

async function persistCheckin(record: CheckinRecord): Promise<void> {
  if (!pool) return;
  await ensureCheckinTable();
  try {
    await pool.query(
      `INSERT INTO wa_flow_checkins
         (booking_ref, guest_name, id_number, nationality, check_in, check_out, room_type, terms_accepted, sender_phone, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      [
        record.bookingRef,
        record.guestName,
        record.idNumber,
        record.nationality,
        record.checkIn,
        record.checkOut,
        record.roomType,
        record.termsAccepted,
        record.senderPhone,
      ]
    );
    console.log(`[WA Flows Checkin] Check-in persisted for ${record.guestName} (${record.idNumber})`);
  } catch (err: any) {
    console.error('[WA Flows Checkin] Failed to persist check-in:', err.message);
    throw err;
  }
}

// ─── Admin Notification ───────────────────────────────────────────────
async function notifyAdmin(record: CheckinRecord): Promise<void> {
  try {
    const config = await loadAdminNotificationSettings();
    if (!config.enabled || config.operators.length === 0) return;

    const lines = [
      '*Digital Check-in Submitted via WhatsApp Flows*',
      '',
      `Guest: ${record.guestName}`,
      `IC/Passport: ${record.idNumber}`,
      record.nationality ? `Nationality: ${record.nationality}` : '',
      record.senderPhone ? `Phone: ${record.senderPhone}` : '',
      record.bookingRef ? `Booking Ref: ${record.bookingRef}` : '',
      record.checkIn ? `Check-in Date: ${record.checkIn}` : '',
      record.checkOut ? `Check-out Date: ${record.checkOut}` : '',
      record.roomType ? `Room Type: ${record.roomType}` : '',
      '',
      `Terms Accepted: ${record.termsAccepted ? 'Yes' : 'No'}`,
      `Submitted: ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}`,
      '',
      '_Notification by Rainbow AI (WhatsApp Flows)_',
    ].filter(Boolean).join('\n');

    for (const operator of config.operators) {
      if (operator.phone) {
        await sendWhatsAppMessage(operator.phone, lines).catch((err: any) =>
          console.warn('[WA Flows Checkin] Admin notify failed:', err.message)
        );
      }
    }
  } catch (err: any) {
    console.warn('[WA Flows Checkin] Admin notification error:', err.message);
  }
}

// ─── Action Handlers ──────────────────────────────────────────────────

interface FlowResponse {
  screen?: string;
  data?: Record<string, any>;
  close_flow?: boolean;
  error?: string;
}

/** INIT: Start flow, pre-fill booking data by phone number */
async function handleInit(payload: Record<string, any>): Promise<FlowResponse> {
  // Phone may come from flow_token, sender metadata, or data fields
  const phone: string = payload.data?.user_phone
    || payload.user_phone
    || payload.flow_token
    || '';

  const booking = await lookupBookingByPhone(phone);

  return {
    screen: SCREEN.WELCOME,
    data: {
      // Pre-fill if booking found
      guest_name: booking.guestName || '',
      check_in_date: booking.checkIn || '',
      check_out_date: booking.checkOut || '',
      room_type: booking.roomType || 'Not specified',
      booking_ref: booking.bookingRef || '',
      // Pass along for validation on ID screen
      _booking_id_number: booking.idNumber || '',
      // Informational flags
      has_booking: !!(booking.checkIn || booking.bookingRef),
      error_message: '',
    },
  };
}

/** data_exchange on WELCOME screen: move to PERSONAL_DETAILS */
async function handleWelcomeSubmit(payload: Record<string, any>): Promise<FlowResponse> {
  // Carry booking context forward via hidden fields
  const bookingIdNumber: string = payload.data?._booking_id_number || payload._booking_id_number || '';
  const bookingRef: string = payload.data?.booking_ref || payload.booking_ref || '';
  const checkIn: string = payload.data?.check_in_date || payload.check_in_date || '';
  const checkOut: string = payload.data?.check_out_date || payload.check_out_date || '';
  const roomType: string = payload.data?.room_type || payload.room_type || '';

  return {
    screen: SCREEN.PERSONAL_DETAILS,
    data: {
      guest_name: payload.data?.guest_name || payload.guest_name || '',
      nationality: '',
      // Carry context forward as hidden data
      _booking_ref: bookingRef,
      _check_in_date: checkIn,
      _check_out_date: checkOut,
      _room_type: roomType,
      _booking_id_number: bookingIdNumber,
      error_message: '',
    },
  };
}

/** data_exchange on PERSONAL_DETAILS screen: validate and move to ID_VERIFICATION */
async function handlePersonalDetailsSubmit(payload: Record<string, any>): Promise<FlowResponse> {
  const guestName: string = (payload.data?.guest_name || payload.guest_name || '').trim();
  const nationality: string = (payload.data?.nationality || payload.nationality || '').trim();

  if (!guestName || guestName.length < 2) {
    return {
      screen: SCREEN.PERSONAL_DETAILS,
      data: {
        guest_name: guestName,
        nationality,
        _booking_ref: payload.data?._booking_ref || payload._booking_ref || '',
        _check_in_date: payload.data?._check_in_date || payload._check_in_date || '',
        _check_out_date: payload.data?._check_out_date || payload._check_out_date || '',
        _room_type: payload.data?._room_type || payload._room_type || '',
        _booking_id_number: payload.data?._booking_id_number || payload._booking_id_number || '',
        error_message: 'Please enter your full name (at least 2 characters).',
      },
    };
  }

  return {
    screen: SCREEN.ID_VERIFICATION,
    data: {
      ic_number: '',
      // Carry context forward
      _guest_name: guestName,
      _nationality: nationality,
      _booking_ref: payload.data?._booking_ref || payload._booking_ref || '',
      _check_in_date: payload.data?._check_in_date || payload._check_in_date || '',
      _check_out_date: payload.data?._check_out_date || payload._check_out_date || '',
      _room_type: payload.data?._room_type || payload._room_type || '',
      _booking_id_number: payload.data?._booking_id_number || payload._booking_id_number || '',
      error_message: '',
    },
  };
}

/** data_exchange on ID_VERIFICATION screen: validate IC/passport, move to TERMS */
async function handleIdVerificationSubmit(payload: Record<string, any>): Promise<FlowResponse> {
  const icNumber: string = (payload.data?.ic_number || payload.ic_number || '').trim();
  const bookingIdNumber: string = payload.data?._booking_id_number || payload._booking_id_number || '';

  // Format validation
  const formatError = validateIdFormat(icNumber);
  if (formatError) {
    return {
      screen: SCREEN.ID_VERIFICATION,
      data: {
        ic_number: icNumber,
        _guest_name: payload.data?._guest_name || payload._guest_name || '',
        _nationality: payload.data?._nationality || payload._nationality || '',
        _booking_ref: payload.data?._booking_ref || payload._booking_ref || '',
        _check_in_date: payload.data?._check_in_date || payload._check_in_date || '',
        _check_out_date: payload.data?._check_out_date || payload._check_out_date || '',
        _room_type: payload.data?._room_type || payload._room_type || '',
        _booking_id_number: bookingIdNumber,
        error_message: formatError,
      },
    };
  }

  // Booking mismatch validation
  const matchError = validateIdAgainstBooking(icNumber, bookingIdNumber || null);
  if (matchError) {
    return {
      screen: SCREEN.ID_VERIFICATION,
      data: {
        ic_number: icNumber,
        _guest_name: payload.data?._guest_name || payload._guest_name || '',
        _nationality: payload.data?._nationality || payload._nationality || '',
        _booking_ref: payload.data?._booking_ref || payload._booking_ref || '',
        _check_in_date: payload.data?._check_in_date || payload._check_in_date || '',
        _check_out_date: payload.data?._check_out_date || payload._check_out_date || '',
        _room_type: payload.data?._room_type || payload._room_type || '',
        _booking_id_number: bookingIdNumber,
        error_message: matchError,
      },
    };
  }

  return {
    screen: SCREEN.TERMS,
    data: {
      terms_text: buildTermsText(),
      terms_accepted: false,
      // Carry all context
      _guest_name: payload.data?._guest_name || payload._guest_name || '',
      _nationality: payload.data?._nationality || payload._nationality || '',
      _ic_number: icNumber,
      _booking_ref: payload.data?._booking_ref || payload._booking_ref || '',
      _check_in_date: payload.data?._check_in_date || payload._check_in_date || '',
      _check_out_date: payload.data?._check_out_date || payload._check_out_date || '',
      _room_type: payload.data?._room_type || payload._room_type || '',
      error_message: '',
    },
  };
}

/** data_exchange on TERMS screen: validate acceptance, persist, move to COMPLETE */
async function handleTermsSubmit(
  payload: Record<string, any>,
  senderPhone?: string
): Promise<FlowResponse> {
  const termsAccepted: boolean = payload.data?.terms_accepted === true
    || payload.terms_accepted === true
    || payload.data?.terms_accepted === 'true'
    || payload.terms_accepted === 'true';

  if (!termsAccepted) {
    return {
      screen: SCREEN.TERMS,
      data: {
        terms_text: buildTermsText(),
        terms_accepted: false,
        _guest_name: payload.data?._guest_name || payload._guest_name || '',
        _nationality: payload.data?._nationality || payload._nationality || '',
        _ic_number: payload.data?._ic_number || payload._ic_number || '',
        _booking_ref: payload.data?._booking_ref || payload._booking_ref || '',
        _check_in_date: payload.data?._check_in_date || payload._check_in_date || '',
        _check_out_date: payload.data?._check_out_date || payload._check_out_date || '',
        _room_type: payload.data?._room_type || payload._room_type || '',
        error_message: 'Please accept the Terms & Conditions to proceed with check-in.',
      },
    };
  }

  // Build check-in record
  const record: CheckinRecord = {
    bookingRef: payload.data?._booking_ref || payload._booking_ref || null,
    guestName: payload.data?._guest_name || payload._guest_name || 'Guest',
    idNumber: payload.data?._ic_number || payload._ic_number || '',
    nationality: payload.data?._nationality || payload._nationality || null,
    checkIn: payload.data?._check_in_date || payload._check_in_date || null,
    checkOut: payload.data?._check_out_date || payload._check_out_date || null,
    roomType: payload.data?._room_type || payload._room_type || null,
    termsAccepted: true,
    senderPhone: senderPhone || null,
  };

  // Persist check-in (within 10 seconds as required)
  const persistStart = Date.now();
  await persistCheckin(record);
  const persistMs = Date.now() - persistStart;
  console.log(`[WA Flows Checkin] Persisted in ${persistMs}ms`);

  // Notify admin (fire-and-forget)
  notifyAdmin(record).catch(() => {});

  // Send confirmation WhatsApp message (fire-and-forget)
  if (senderPhone) {
    sendCheckinConfirmation(senderPhone, record).catch(() => {});
  }

  return {
    screen: SCREEN.COMPLETE,
    data: {
      guest_name: record.guestName,
      check_in_date: record.checkIn || 'As scheduled',
      check_out_date: record.checkOut || 'As scheduled',
      room_type: record.roomType || 'As assigned',
      checkin_time: '2:00 PM',
      door_password: '1270#',
      wifi_name: 'PelangiHostel',
      booking_ref: record.bookingRef || 'Walk-in',
      confirmation_message: buildConfirmationText(record),
    },
  };
}

/** BACK action: return to previous screen with empty state */
function handleBack(payload: Record<string, any>): FlowResponse {
  const currentScreen = payload.screen || SCREEN.WELCOME;
  const prevScreen = getPreviousScreen(currentScreen);
  return {
    screen: prevScreen,
    data: {
      error_message: '',
    },
  };
}

// ─── Text Helpers ──────────────────────────────────────────────────────
function buildTermsText(): string {
  return [
    'By completing this digital check-in, you agree to:',
    '',
    '1. Pelangi Capsule Hostel House Rules — quiet hours 10 PM – 8 AM, no outside guests.',
    '2. Your personal data (name, IC/passport) will be retained for 24 months per PDPA 2024.',
    '3. A refundable key deposit of RM10 is required at the front desk.',
    '4. Check-out is at 11:00 AM; late check-out subject to availability.',
    '5. Hostel management reserves the right to request alternative accommodation in exceptional circumstances.',
  ].join('\n');
}

function buildConfirmationText(record: CheckinRecord): string {
  return [
    `Welcome to Pelangi Capsule Hostel, ${record.guestName}!`,
    '',
    'Your digital check-in is complete.',
    record.checkIn ? `Check-in date: ${record.checkIn}` : '',
    record.checkOut ? `Check-out date: ${record.checkOut}` : '',
    '',
    'Check-in time: 2:00 PM',
    'Door password: 1270#',
    'WiFi: PelangiHostel',
    '',
    'Please collect your key from the front desk. See you soon!',
  ].filter(Boolean).join('\n');
}

async function sendCheckinConfirmation(phone: string, record: CheckinRecord): Promise<void> {
  const msg = [
    `*Digital Check-in Confirmed!*`,
    '',
    `Welcome, *${record.guestName}*!`,
    '',
    record.checkIn ? `Check-in: ${record.checkIn}` : '',
    record.checkOut ? `Check-out: ${record.checkOut}` : '',
    record.roomType ? `Accommodation: ${record.roomType}` : '',
    '',
    'Check-in time: *2:00 PM*',
    'Door password: *1270#*',
    'WiFi: *PelangiHostel*',
    '',
    'Please collect your room key from the front desk.',
    'Thank you for choosing Pelangi Capsule Hostel!',
  ].filter(Boolean).join('\n');

  await sendWhatsAppMessage(phone, msg);
}

// ─── Health Check Endpoint ─────────────────────────────────────────────
// Meta pings this to verify the endpoint is healthy.
// Must respond within 5 seconds. No encryption required.
router.get('/whatsapp-flows/checkin-health', (_req: Request, res: Response) => {
  res.json({ data: { status: 'active' } });
});

// ─── Data Exchange Endpoint ────────────────────────────────────────────
// Meta POSTs encrypted payloads here during the check-in Flow execution.
// Must respond within 15 seconds (Meta hard requirement).
router.post('/whatsapp-flows/checkin-exchange', async (req: Request, res: Response) => {
  const requestStart = Date.now();

  const privateKey = getPrivateKey();

  // Require private key in production
  if (!privateKey && process.env.NODE_ENV === 'production') {
    console.error('[WA Flows Checkin] No private key configured');
    res.status(500).json({ error: 'Check-in flow endpoint not configured' });
    return;
  }

  try {
    let action: string;
    let payload: Record<string, any>;
    let aesKeyBuffer: Buffer | null = null;
    let initialVectorBuffer: Buffer | null = null;
    let flowToken: string | undefined;
    let currentScreen: string | undefined;

    // Determine if payload is encrypted (production) or plain (dev/test)
    if (req.body.encrypted_aes_key && privateKey) {
      const decrypted = decryptRequest(req.body, privateKey);
      action = decrypted.decryptedBody.action;
      payload = decrypted.decryptedBody;
      aesKeyBuffer = decrypted.aesKeyBuffer;
      initialVectorBuffer = decrypted.initialVectorBuffer;
      flowToken = decrypted.decryptedBody.flow_token;
      currentScreen = decrypted.decryptedBody.screen;
    } else {
      action = req.body.action;
      payload = req.body;
      flowToken = req.body.flow_token;
      currentScreen = req.body.screen;
    }

    // Validate flow token if configured
    if (CHECKIN_FLOW_TOKEN && flowToken && flowToken !== CHECKIN_FLOW_TOKEN) {
      console.warn('[WA Flows Checkin] Invalid flow_token');
      res.status(421).end();
      return;
    }

    // Handle PING health check (encrypted action)
    if (action === 'ping' || action === 'PING') {
      const pingResponse = { data: { status: 'active' } };
      if (aesKeyBuffer && initialVectorBuffer) {
        res.send(encryptResponse(pingResponse, aesKeyBuffer, initialVectorBuffer));
      } else {
        res.json(pingResponse);
      }
      return;
    }

    console.log(`[WA Flows Checkin] action=${action} screen=${currentScreen || 'n/a'}`);

    // Extract sender phone from various payload locations
    const senderPhone: string = payload.data?.user_phone
      || payload.user_phone
      || payload.sender_phone
      || '';

    let flowResponse: FlowResponse;

    // Route by action type
    if (action === 'INIT') {
      flowResponse = await handleInit(payload);
    } else if (action === 'BACK') {
      flowResponse = handleBack({ ...payload, screen: currentScreen });
    } else if (action === 'data_exchange') {
      // Route by current screen
      switch (currentScreen) {
        case SCREEN.WELCOME:
          flowResponse = await handleWelcomeSubmit(payload);
          break;
        case SCREEN.PERSONAL_DETAILS:
          flowResponse = await handlePersonalDetailsSubmit(payload);
          break;
        case SCREEN.ID_VERIFICATION:
          flowResponse = await handleIdVerificationSubmit(payload);
          break;
        case SCREEN.TERMS:
          flowResponse = await handleTermsSubmit(payload, senderPhone || undefined);
          break;
        default:
          // Unknown screen — fall back to INIT
          console.warn(`[WA Flows Checkin] Unknown screen for data_exchange: ${currentScreen}`);
          flowResponse = await handleInit(payload);
      }
    } else {
      // Unknown action — fall back to INIT
      console.warn(`[WA Flows Checkin] Unknown action: ${action}`);
      flowResponse = await handleInit(payload);
    }

    const elapsed = Date.now() - requestStart;
    console.log(`[WA Flows Checkin] Responded in ${elapsed}ms`);

    // Warn if approaching Meta's 15-second limit
    if (elapsed > 12000) {
      console.warn(`[WA Flows Checkin] Slow response: ${elapsed}ms (limit: 15000ms)`);
    }

    // Send encrypted or plain response
    if (aesKeyBuffer && initialVectorBuffer) {
      res.send(encryptResponse(flowResponse, aesKeyBuffer, initialVectorBuffer));
    } else {
      res.json(flowResponse);
    }
  } catch (err: any) {
    const elapsed = Date.now() - requestStart;
    console.error(`[WA Flows Checkin] Error after ${elapsed}ms:`, err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
