/**
 * WhatsApp Flows Data Exchange Endpoint (US-909)
 *
 * Handles encrypted data-exchange requests from Meta's WhatsApp Flows.
 * Supports INIT (populate dynamic dropdowns), check_availability,
 * and submit_reservation actions.
 *
 * Endpoints:
 *   POST /api/rainbow/flows/data-exchange  — encrypted payload handler
 *   GET  /api/rainbow/flows/health         — health-check ping
 *
 * Required env vars:
 *   WA_FLOWS_PRIVATE_KEY  — RSA private key for decryption
 *   WA_FLOWS_PASSPHRASE   — optional passphrase for the key
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import {
  decryptFlowRequest,
  encryptFlowResponse,
  isFlowCryptoConfigured,
} from '../../lib/whatsapp/flow-crypto.js';
import { sendWhatsAppMessage } from '../../lib/whatsapp/index.js';

const router = Router();

// ─── Room type options (static for now, could be DB-driven later) ───
const ROOM_OPTIONS = [
  { id: 'capsule_standard', title: 'Standard Capsule' },
  { id: 'capsule_premium', title: 'Premium Capsule' },
  { id: 'private_room', title: 'Private Room' },
  { id: 'female_dorm', title: 'Female Dormitory' },
  { id: 'mixed_dorm', title: 'Mixed Dormitory' },
];

/**
 * Generate a booking reference: RB-YYYYMMDD-XXXX
 */
function generateBookingRef(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `RB-${dateStr}-${rand}`;
}

/**
 * Validate reservation dates.
 * Returns an error message or null if valid.
 */
function validateDates(checkIn: string, checkOut: string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const ciDate = new Date(checkIn);
  const coDate = new Date(checkOut);

  if (isNaN(ciDate.getTime())) return 'Invalid check-in date';
  if (isNaN(coDate.getTime())) return 'Invalid check-out date';
  if (ciDate < today) return 'Check-in date cannot be in the past';
  if (coDate <= ciDate) return 'Check-out must be after check-in';

  const nights = Math.ceil((coDate.getTime() - ciDate.getTime()) / (86400 * 1000));
  if (nights > 30) return 'Maximum stay is 30 nights';

  return null;
}

/**
 * Handle the INIT action — return initial screen data with room options.
 */
function handleInit(): Record<string, any> {
  return {
    screen: 'BOOKING_DETAILS',
    data: {
      room_options: ROOM_OPTIONS,
    },
  };
}

/**
 * Handle availability check for selected dates.
 * For now, always returns available (real PMS integration can be added later).
 */
function handleCheckAvailability(payload: Record<string, any>): Record<string, any> {
  const { check_in_date } = payload;

  if (!check_in_date) {
    return {
      screen: 'BOOKING_DETAILS',
      data: {
        room_options: ROOM_OPTIONS,
        error_message: 'Please select a check-in date',
      },
    };
  }

  // Return available rooms (real implementation would query PMS/DB)
  return {
    screen: 'BOOKING_DETAILS',
    data: {
      room_options: ROOM_OPTIONS,
    },
  };
}

/**
 * Handle reservation submission.
 */
async function handleSubmitReservation(
  payload: Record<string, any>,
  senderPhone?: string,
): Promise<Record<string, any>> {
  const { check_in_date, check_out_date, room_type, guest_count, special_requests } = payload;

  // Validate required fields
  if (!check_in_date || !check_out_date || !room_type || !guest_count) {
    return {
      screen: 'BOOKING_DETAILS',
      data: {
        room_options: ROOM_OPTIONS,
        error_message: 'Please fill in all required fields',
      },
    };
  }

  // Validate dates
  const dateError = validateDates(check_in_date, check_out_date);
  if (dateError) {
    return {
      screen: 'BOOKING_DETAILS',
      data: {
        room_options: ROOM_OPTIONS,
        error_message: dateError,
      },
    };
  }

  // Validate guest count
  const guestNum = parseInt(guest_count, 10);
  if (isNaN(guestNum) || guestNum < 1 || guestNum > 12) {
    return {
      screen: 'BOOKING_DETAILS',
      data: {
        room_options: ROOM_OPTIONS,
        error_message: 'Guest count must be between 1 and 12',
      },
    };
  }

  // Generate booking reference
  const bookingRef = generateBookingRef();

  // Find room title for display
  const roomOption = ROOM_OPTIONS.find(r => r.id === room_type);
  const roomTitle = roomOption?.title ?? room_type;

  // Log the reservation
  console.log(
    `[wa-flows] Reservation submitted: ref=${bookingRef} ` +
    `checkin=${check_in_date} checkout=${check_out_date} ` +
    `room=${room_type} guests=${guestNum} phone=${senderPhone ?? 'unknown'}`,
  );

  // Send confirmation WhatsApp message (fire-and-forget, within 10s)
  if (senderPhone) {
    const nights = Math.ceil(
      (new Date(check_out_date).getTime() - new Date(check_in_date).getTime()) / (86400 * 1000),
    );
    const confirmMsg = [
      `*Reservation Confirmed* ✅`,
      ``,
      `Reference: *${bookingRef}*`,
      `Check-in: ${check_in_date}`,
      `Check-out: ${check_out_date} (${nights} night${nights > 1 ? 's' : ''})`,
      `Room: ${roomTitle}`,
      `Guests: ${guestNum}`,
      special_requests ? `Special Requests: ${special_requests}` : '',
      ``,
      `Thank you for choosing Pelangi Capsule Hostel!`,
      `If you need to modify your reservation, just reply to this message.`,
    ].filter(Boolean).join('\n');

    sendWhatsAppMessage(senderPhone, confirmMsg).catch(err => {
      console.error(`[wa-flows] Failed to send confirmation to ${senderPhone}:`, err.message);
    });
  }

  return {
    screen: 'CONFIRMATION',
    data: {
      booking_ref: bookingRef,
      check_in_date,
      check_out_date,
      room_type: roomTitle,
      guest_count: String(guestNum),
    },
  };
}

// ─── Health Check Endpoint ──────────────────────────────────────────
router.get('/flows/health', (_req: Request, res: Response) => {
  res.status(200).json({
    data: {
      status: 'active',
    },
  });
});

// ─── Data Exchange Endpoint ─────────────────────────────────────────
router.post('/flows/data-exchange', async (req: Request, res: Response) => {
  // If crypto keys aren't configured, we can't process encrypted payloads
  if (!isFlowCryptoConfigured()) {
    console.warn('[wa-flows] Data exchange called but WA_FLOWS_PRIVATE_KEY not configured');
    res.status(421).json({ error: 'Flow encryption not configured' });
    return;
  }

  try {
    const { encrypted_aes_key, encrypted_flow_data, initial_vector } = req.body;

    if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
      res.status(400).json({ error: 'Missing required encrypted fields' });
      return;
    }

    // Decrypt the request
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptFlowRequest({
      encrypted_aes_key,
      encrypted_flow_data,
      initial_vector,
    });

    const action = decryptedBody.action as string | undefined;
    const flowToken = decryptedBody.flow_token as string | undefined;
    const screenId = decryptedBody.screen as string | undefined;
    const senderPhone = decryptedBody.flow_token_payload?.phone as string | undefined;

    console.log(
      `[wa-flows] Data exchange: action=${action ?? 'INIT'} screen=${screenId ?? 'none'} token=${flowToken ?? 'none'}`,
    );

    let responseData: Record<string, any>;

    // Route to appropriate handler
    if (!action || action === 'INIT') {
      responseData = handleInit();
    } else if (action === 'check_availability') {
      responseData = handleCheckAvailability(decryptedBody);
    } else if (action === 'submit_reservation') {
      responseData = await handleSubmitReservation(decryptedBody, senderPhone);
    } else {
      // Unknown action — return error on current screen
      responseData = {
        screen: screenId ?? 'BOOKING_DETAILS',
        data: {
          error_message: `Unknown action: ${action}`,
        },
      };
    }

    // Encrypt the response
    const encryptedResponse = encryptFlowResponse(responseData, aesKeyBuffer, initialVectorBuffer);

    res.status(200).send(encryptedResponse);
  } catch (err: any) {
    console.error('[wa-flows] Data exchange error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
