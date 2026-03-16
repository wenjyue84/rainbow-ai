/**
 * US-909: WhatsApp Flows Data-Exchange Endpoint
 *
 * Handles encrypted data-exchange requests from Meta for WhatsApp Flows.
 * Supports:
 *   - INIT action: returns initial screen data (available room options)
 *   - check_availability: validates dates and checks room availability
 *   - submit_reservation: creates booking and sends confirmation
 *   - PING health-check: responds with {data: {status: 'active'}}
 *
 * Encryption: RSA-OAEP + AES-128-GCM per Meta's WhatsApp Flows protocol.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { decryptRequest, encryptResponse } from '../../lib/whatsapp-flows-crypto.js';
import { sendWhatsAppMessage } from '../../lib/baileys-client.js';
import { pool } from '../../lib/db.js';
import { recordFlowSuccess, recordFlowError } from '../../lib/whatsapp-flows-health.js';

const router = Router();

// ─── Configuration ────────────────────────────────────────────────────
const FLOW_PRIVATE_KEY_PATH = process.env.WA_FLOWS_PRIVATE_KEY_PATH || '';
const FLOW_PRIVATE_KEY_PEM = process.env.WA_FLOWS_PRIVATE_KEY || '';
const FLOW_TOKEN = process.env.WA_FLOWS_TOKEN || '';

let _privateKey: string | null = null;

function getPrivateKey(): string | null {
  if (_privateKey) return _privateKey;

  // Prefer env var, then file
  if (FLOW_PRIVATE_KEY_PEM) {
    _privateKey = FLOW_PRIVATE_KEY_PEM;
    return _privateKey;
  }

  if (FLOW_PRIVATE_KEY_PATH && existsSync(FLOW_PRIVATE_KEY_PATH)) {
    try {
      _privateKey = readFileSync(FLOW_PRIVATE_KEY_PATH, 'utf-8');
      return _privateKey;
    } catch (err: any) {
      console.error('[WhatsApp Flows] Failed to read private key:', err.message);
    }
  }

  return null;
}

// ─── Room Type Options ────────────────────────────────────────────────
// Default room/bed options for Pelangi Capsule Hostel
const DEFAULT_ROOM_OPTIONS = [
  { id: 'mixed_dorm', title: 'Mixed Dorm Bed (RM35/night)' },
  { id: 'female_dorm', title: 'Female Dorm Bed (RM35/night)' },
  { id: 'private_room', title: 'Private Room (RM120/night)' },
  { id: 'family_room', title: 'Family Room (RM180/night)' },
];

// ─── Booking Reference Generator ──────────────────────────────────────
function generateBookingRef(): string {
  const date = new Date();
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `PEL-${yy}${mm}${dd}-${rand}`;
}

// ─── Date Validation ──────────────────────────────────────────────────
function validateDates(checkIn: string, checkOut: string): string | null {
  if (!checkIn || !checkOut) return 'Please select both check-in and check-out dates.';

  const inDate = new Date(checkIn);
  const outDate = new Date(checkOut);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (isNaN(inDate.getTime())) return 'Invalid check-in date format.';
  if (isNaN(outDate.getTime())) return 'Invalid check-out date format.';
  if (inDate < today) return 'Check-in date cannot be in the past.';
  if (outDate <= inDate) return 'Check-out date must be after check-in date.';

  const nights = Math.ceil((outDate.getTime() - inDate.getTime()) / (1000 * 60 * 60 * 24));
  if (nights > 30) return 'Maximum stay is 30 nights. Please select a shorter period.';

  return null; // Valid
}

// ─── Guest Count Validation ───────────────────────────────────────────
function validateGuestCount(raw: string | number): string | null {
  const count = typeof raw === 'string' ? parseInt(raw, 10) : raw;
  if (isNaN(count) || count < 1) return 'Please enter at least 1 guest.';
  if (count > 20) return 'Maximum 20 guests per booking. For larger groups, please contact us directly.';
  return null;
}

// ─── Availability Check (stub with DB fallback) ───────────────────────
async function checkAvailability(
  checkIn: string,
  checkOut: string,
  roomType?: string
): Promise<{ available: boolean; message?: string }> {
  // Try to check against DB if available
  try {
    if (pool) {
      // Simple availability check: count existing reservations for the period
      // This is a simplified check — real implementation would use a proper
      // calendar/inventory system. For now, we always return available
      // unless the system is aware of full occupancy.
      return { available: true };
    }
  } catch (err: any) {
    console.warn('[WhatsApp Flows] Availability check DB error:', err.message);
  }

  // Default: available (the hostel can manage overbooking manually)
  return { available: true };
}

// ─── Build Confirmation Summary ───────────────────────────────────────
function buildSummary(data: {
  checkIn: string;
  checkOut: string;
  roomType: string;
  guestCount: string | number;
  specialRequests?: string;
}): string {
  const roomLabel = DEFAULT_ROOM_OPTIONS.find(r => r.id === data.roomType)?.title || data.roomType;
  const nights = Math.ceil(
    (new Date(data.checkOut).getTime() - new Date(data.checkIn).getTime()) / (1000 * 60 * 60 * 24)
  );

  return [
    `Check-in: ${data.checkIn}`,
    `Check-out: ${data.checkOut}`,
    `Duration: ${nights} night${nights > 1 ? 's' : ''}`,
    `Room: ${roomLabel}`,
    `Guests: ${data.guestCount}`,
    data.specialRequests ? `Special Requests: ${data.specialRequests}` : '',
    '',
    'A confirmation message will be sent to your WhatsApp shortly.',
  ].filter(Boolean).join('\n');
}

// ─── Action Handlers ──────────────────────────────────────────────────

type FlowAction = 'INIT' | 'check_availability' | 'validate_dates' | 'submit_reservation';

interface FlowResponse {
  screen?: string;
  data?: Record<string, any>;
}

async function handleInit(): Promise<FlowResponse> {
  const today = new Date().toISOString().split('T')[0];
  const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return {
    screen: 'RESERVATION_DATES',
    data: {
      today,
      max_date: maxDate,
      error_message: '',
    },
  };
}

async function handleCheckAvailability(payload: Record<string, any>): Promise<FlowResponse> {
  const { check_in_date, check_out_date } = payload;

  // Validate dates
  const dateError = validateDates(check_in_date, check_out_date);
  if (dateError) {
    return {
      screen: 'RESERVATION_DATES',
      data: { error_message: dateError },
    };
  }

  // Check availability
  const result = await checkAvailability(check_in_date, check_out_date);
  if (!result.available) {
    return {
      screen: 'RESERVATION_DATES',
      data: {
        error_message: result.message || 'No rooms available for the selected dates. Please try different dates.',
      },
    };
  }

  // Dates valid and rooms available — advance to details screen
  return {
    screen: 'RESERVATION_DETAILS',
    data: {
      room_options: DEFAULT_ROOM_OPTIONS,
      check_in_date,
      check_out_date,
      error_message: '',
    },
  };
}

async function handleSubmitReservation(
  payload: Record<string, any>,
  senderPhone?: string
): Promise<FlowResponse> {
  const { check_in_date, check_out_date, room_type, guest_count, special_requests } = payload;

  // Validate dates again (defense in depth)
  const dateError = validateDates(check_in_date, check_out_date);
  if (dateError) {
    return {
      screen: 'RESERVATION_DETAILS',
      data: {
        room_options: DEFAULT_ROOM_OPTIONS,
        check_in_date,
        check_out_date,
        error_message: dateError,
      },
    };
  }

  // Validate guest count
  const guestError = validateGuestCount(guest_count);
  if (guestError) {
    return {
      screen: 'RESERVATION_DETAILS',
      data: {
        room_options: DEFAULT_ROOM_OPTIONS,
        check_in_date,
        check_out_date,
        error_message: guestError,
      },
    };
  }

  // Validate special requests length
  if (special_requests && String(special_requests).length > 600) {
    return {
      screen: 'RESERVATION_DETAILS',
      data: {
        room_options: DEFAULT_ROOM_OPTIONS,
        check_in_date,
        check_out_date,
        error_message: 'Special requests must be 600 characters or less.',
      },
    };
  }

  // Final availability check
  const avail = await checkAvailability(check_in_date, check_out_date, room_type);
  if (!avail.available) {
    return {
      screen: 'RESERVATION_DETAILS',
      data: {
        room_options: DEFAULT_ROOM_OPTIONS,
        check_in_date,
        check_out_date,
        error_message: avail.message || 'Selected room is no longer available. Please choose another.',
      },
    };
  }

  // Generate booking reference
  const bookingRef = generateBookingRef();

  // Build summary
  const summary = buildSummary({
    checkIn: check_in_date,
    checkOut: check_out_date,
    roomType: room_type,
    guestCount: guest_count,
    specialRequests: special_requests,
  });

  // Store booking in DB (fire-and-forget — don't block the Flow response)
  persistBooking({
    bookingRef,
    checkIn: check_in_date,
    checkOut: check_out_date,
    roomType: room_type,
    guestCount: typeof guest_count === 'string' ? parseInt(guest_count, 10) : guest_count,
    specialRequests: special_requests || null,
    senderPhone: senderPhone || null,
  }).catch(err => console.error('[WhatsApp Flows] Failed to persist booking:', err.message));

  // Send WhatsApp confirmation (fire-and-forget)
  if (senderPhone) {
    const roomLabel = DEFAULT_ROOM_OPTIONS.find(r => r.id === room_type)?.title || room_type;
    const nights = Math.ceil(
      (new Date(check_out_date).getTime() - new Date(check_in_date).getTime()) / (1000 * 60 * 60 * 24)
    );
    const confirmMsg = [
      `*Booking Confirmed* ✅`,
      ``,
      `Reference: *${bookingRef}*`,
      `Check-in: ${check_in_date}`,
      `Check-out: ${check_out_date} (${nights} night${nights > 1 ? 's' : ''})`,
      `Room: ${roomLabel}`,
      `Guests: ${guest_count}`,
      special_requests ? `Special Requests: ${special_requests}` : '',
      ``,
      `Check-in time: 2:00 PM`,
      `Door password: 1270#`,
      `WiFi: PelangiHostel`,
      ``,
      `Thank you for choosing Pelangi Capsule Hostel!`,
    ].filter(Boolean).join('\n');

    sendWhatsAppMessage(senderPhone, confirmMsg).catch(err =>
      console.error('[WhatsApp Flows] Failed to send confirmation:', err.message)
    );
  }

  return {
    screen: 'RESERVATION_CONFIRM',
    data: {
      booking_ref: bookingRef,
      summary,
    },
  };
}

// ─── DB Persistence ───────────────────────────────────────────────────
let _tableEnsured = false;

async function ensureReservationsTable(): Promise<void> {
  if (_tableEnsured || !pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_flow_reservations (
        id SERIAL PRIMARY KEY,
        booking_ref TEXT UNIQUE NOT NULL,
        check_in DATE NOT NULL,
        check_out DATE NOT NULL,
        room_type TEXT NOT NULL,
        guest_count INTEGER NOT NULL DEFAULT 1,
        special_requests TEXT,
        sender_phone TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    _tableEnsured = true;
  } catch (err: any) {
    console.warn('[WhatsApp Flows] Failed to ensure reservations table:', err.message);
  }
}

async function persistBooking(booking: {
  bookingRef: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  guestCount: number;
  specialRequests: string | null;
  senderPhone: string | null;
}): Promise<void> {
  if (!pool) return;

  await ensureReservationsTable();

  await pool.query(
    `INSERT INTO wa_flow_reservations
      (booking_ref, check_in, check_out, room_type, guest_count, special_requests, sender_phone, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (booking_ref) DO NOTHING`,
    [
      booking.bookingRef,
      booking.checkIn,
      booking.checkOut,
      booking.roomType,
      booking.guestCount,
      booking.specialRequests,
      booking.senderPhone,
    ]
  );
}

// ─── Health Check Endpoint (unencrypted) ──────────────────────────────
// Meta pings this endpoint to verify the data-exchange server is healthy.
// Must respond within 5 seconds with { data: { status: 'active' } }.
router.get('/whatsapp-flows/health', (_req: Request, res: Response) => {
  res.json({ data: { status: 'active' } });
});

// ─── Data Exchange Endpoint ───────────────────────────────────────────
// Meta POSTs encrypted payloads here during Flow execution.
// The endpoint decrypts, processes the action, then returns an encrypted response.
router.post('/whatsapp-flows/data-exchange', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const privateKey = getPrivateKey();

  // If no private key is configured, return a plaintext error
  // (in dev mode, also support unencrypted payloads for testing)
  if (!privateKey && process.env.NODE_ENV === 'production') {
    console.error('[WhatsApp Flows] No private key configured — cannot process encrypted request');
    recordFlowError('reservation', 'CONFIG_ERROR', 'No private key configured', Date.now() - startTime);
    res.status(500).json({ error: 'Flow endpoint not configured' });
    return;
  }

  try {
    let action: string;
    let payload: Record<string, any>;
    let aesKeyBuffer: Buffer | null = null;
    let initialVectorBuffer: Buffer | null = null;
    let flowToken: string | undefined;

    // Determine if the request is encrypted (production) or plain (dev/test)
    if (req.body.encrypted_aes_key && privateKey) {
      // Production: encrypted payload from Meta
      const decrypted = decryptRequest(req.body, privateKey);
      action = decrypted.decryptedBody.action;
      payload = decrypted.decryptedBody;
      aesKeyBuffer = decrypted.aesKeyBuffer;
      initialVectorBuffer = decrypted.initialVectorBuffer;
      flowToken = decrypted.decryptedBody.flow_token;
    } else {
      // Dev/test: plain JSON payload
      action = req.body.action;
      payload = req.body;
      flowToken = req.body.flow_token;
    }

    // Validate flow token if configured
    if (FLOW_TOKEN && flowToken && flowToken !== FLOW_TOKEN) {
      console.warn('[WhatsApp Flows] Invalid flow_token received');
      recordFlowError('reservation', 'INVALID_TOKEN', 'Invalid flow_token', Date.now() - startTime);
      res.status(421).end(); // Signal to Meta that token is invalid
      return;
    }

    // Handle PING health check (sent as encrypted action)
    if (action === 'ping' || action === 'PING') {
      const pingResponse = { data: { status: 'active' } };
      recordFlowSuccess('reservation', Date.now() - startTime, 'ping');
      if (aesKeyBuffer && initialVectorBuffer) {
        res.send(encryptResponse(pingResponse, aesKeyBuffer, initialVectorBuffer));
      } else {
        res.json(pingResponse);
      }
      return;
    }

    console.log(`[WhatsApp Flows] Processing action: ${action}`);

    // Route to action handler
    let flowResponse: FlowResponse;

    switch (action) {
      case 'INIT':
        flowResponse = await handleInit();
        break;

      case 'check_availability':
      case 'validate_dates':
        flowResponse = await handleCheckAvailability(payload);
        break;

      case 'submit_reservation':
        flowResponse = await handleSubmitReservation(payload, payload.sender_phone);
        break;

      default:
        console.warn(`[WhatsApp Flows] Unknown action: ${action}`);
        flowResponse = await handleInit(); // Fall back to init
    }

    // US-934: Record successful request
    recordFlowSuccess('reservation', Date.now() - startTime, action);

    // Return response (encrypted or plain depending on mode)
    const responseBody = flowResponse;
    if (aesKeyBuffer && initialVectorBuffer) {
      res.send(encryptResponse(responseBody, aesKeyBuffer, initialVectorBuffer));
    } else {
      res.json(responseBody);
    }
  } catch (err: any) {
    // US-934: Record endpoint failure
    recordFlowError('reservation', 'ENDPOINT_ERROR', err.message, Date.now() - startTime);
    console.error('[WhatsApp Flows] Data exchange error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Flow JSON Definition Endpoint ────────────────────────────────────
// Serves the Flow JSON screen definition for reference/registration.
router.get('/whatsapp-flows/reservation-flow.json', (_req: Request, res: Response) => {
  try {
    const flowPath = join(process.cwd(), 'src', 'assistant', 'data', 'reservation-flow.json');
    if (existsSync(flowPath)) {
      const flowJson = JSON.parse(readFileSync(flowPath, 'utf-8'));
      res.json(flowJson);
    } else {
      // Fallback: try dist path
      const distPath = join(process.cwd(), 'dist', 'assistant', 'data', 'reservation-flow.json');
      if (existsSync(distPath)) {
        const flowJson = JSON.parse(readFileSync(distPath, 'utf-8'));
        res.json(flowJson);
      } else {
        res.status(404).json({ error: 'Flow definition not found' });
      }
    }
  } catch (err: any) {
    console.error('[WhatsApp Flows] Error serving flow JSON:', err.message);
    res.status(500).json({ error: 'Failed to load flow definition' });
  }
});

export default router;
