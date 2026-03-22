/**
 * US-078: Booking workflow pre-flight validator
 *
 * Validates all required booking fields before executing workflow steps,
 * failing fast with helpful suggestions for invalid bookings.
 */

import type { ConfigStore } from '../config-store.js';

export interface BookingRequest {
  checkIn?: string;      // ISO date format YYYY-MM-DD
  room_type?: string;    // e.g., "2-bed", "4-bed", "private"
  guest_name?: string;   // Guest name
  guests?: number;       // Number of guests (optional for preflight)
  checkOut?: string;     // ISO date format (optional for preflight)
}

export interface ValidateResult {
  valid: boolean;
  errors: string[];
}

/**
 * Generate list of available dates (tomorrow, +2 days, +3 days) in locale format
 */
function getAvailableDates(locale: string = 'en-MY'): string[] {
  const dates: string[] = [];
  const now = new Date();

  for (let i = 1; i <= 3; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + i);

    let formatted: string;
    if (locale === 'en-MY' || locale === 'en') {
      // Format: "24 Mar 2026"
      const day = date.getDate();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear();
      formatted = `${day} ${month} ${year}`;
    } else if (locale === 'ms') {
      // Malay format: same as English
      const day = date.getDate();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
      const month = monthNames[date.getMonth()];
      const year = date.getFullYear();
      formatted = `${day} ${month} ${year}`;
    } else if (locale === 'zh') {
      // Chinese format: 2026年3月24日
      const day = date.getDate();
      const month = date.getMonth() + 1;
      const year = date.getFullYear();
      formatted = `${year}年${month}月${day}日`;
    } else {
      // Default to ISO
      formatted = date.toISOString().split('T')[0];
    }

    dates.push(formatted);
  }

  return dates;
}

/**
 * Get room types from profile configuration
 */
function getRoomTypesFromConfig(profileConfig: ConfigStore): string[] {
  const settings = profileConfig.getSettings();

  // Try to get rooms from settings under various possible paths
  if ((settings as any).rooms && Array.isArray((settings as any).rooms)) {
    return ((settings as any).rooms as Array<{ name?: string; id?: string }>)
      .map(room => room.name || room.id)
      .filter(Boolean) as string[];
  }

  if ((settings as any).booking && (settings as any).booking.available_rooms && Array.isArray((settings as any).booking.available_rooms)) {
    return (settings as any).booking.available_rooms;
  }

  // Fallback: common room types for hostels/hotels
  return ['2-bed', '4-bed', 'private', 'dorm'];
}

/**
 * Validate a booking request before workflow execution
 *
 * @param payload - Booking request payload with checkIn, room_type, guest_name
 * @param profileConfig - ConfigStore for profile-specific settings
 * @param locale - Language/locale for error message formatting (default: 'en')
 * @returns ValidateResult with valid flag and error messages
 */
export function validateBookingRequest(
  payload: BookingRequest,
  profileConfig: ConfigStore,
  locale: string = 'en'
): ValidateResult {
  const errors: string[] = [];

  // ─── Validation 1: guest_name not empty/null ──────────────────────
  if (!payload.guest_name || payload.guest_name.trim() === '') {
    errors.push('Guest name is required. Please provide a valid name.');
  }

  // ─── Validation 2: checkIn >= today ───────────────────────────────
  if (!payload.checkIn) {
    errors.push('Check-in date is required. Please specify a check-in date.');
  } else {
    try {
      // Validate date format (must be YYYY-MM-DD)
      const dateFormatRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateFormatRegex.test(payload.checkIn)) {
        errors.push(`Invalid check-in date format. Please use YYYY-MM-DD format.`);
      } else {
        // Parse date carefully to avoid timezone issues
        const [year, month, day] = payload.checkIn.split('-').map(Number);
        const checkInDate = new Date(year, month - 1, day, 0, 0, 0, 0);

        if (isNaN(checkInDate.getTime())) {
          errors.push(`Invalid check-in date. Please use a valid date in YYYY-MM-DD format.`);
        } else {
          const today = new Date();
          today.setHours(0, 0, 0, 0); // Normalize to start of day

          if (checkInDate < today) {
            const availableDates = getAvailableDates(locale);
            const datesStr = availableDates.join(', ');

            const msgs: Record<string, string> = {
              en: `Check-in date cannot be in the past. Available dates: [${datesStr}]. Contact staff for special requests.`,
              ms: `Tarikh daftar masuk tidak boleh pada masa lalu. Tarikh tersedia: [${datesStr}]. Hubungi kakitangan untuk permintaan khas.`,
              zh: `入住日期不能是过去的日期。可用日期：[${datesStr}]。如有特殊需求，请联系工作人员。`,
              ta: `செக்-இன் தேதி கடந்த கால தேதி இருக்க முடியாது. கிடைக்கக்கூடிய தேதிகள்: [${datesStr}]. சிறப்பு요청ங்களுக்கு கர்மீडன் தொடர்பு கொள்ளவும்।`
            };

            errors.push(msgs[locale] || msgs.en);
          }
        }
      }
    } catch (err) {
      errors.push(`Invalid check-in date format. Please use YYYY-MM-DD format.`);
    }
  }

  // ─── Validation 3: room_type in profile.rooms[] ────────────────────
  if (!payload.room_type || payload.room_type.trim() === '') {
    errors.push('Room type is required. Please specify the type of room.');
  } else {
    const availableRooms = getRoomTypesFromConfig(profileConfig);
    const normalizedRoomType = payload.room_type.toLowerCase().trim();
    const normalizedAvailable = availableRooms.map(r => r.toLowerCase());

    if (!normalizedAvailable.includes(normalizedRoomType)) {
      const roomsStr = availableRooms.join(', ');

      const msgs: Record<string, string> = {
        en: `Room type "${payload.room_type}" is not available. Available rooms: ${roomsStr}. Please select from these options.`,
        ms: `Jenis bilik "${payload.room_type}" tidak tersedia. Bilik tersedia: ${roomsStr}. Sila pilih dari pilihan ini.`,
        zh: `房间类型"${payload.room_type}"不可用。可用房间：${roomsStr}。请从这些选项中选择。`,
        ta: `அறை வகை "${payload.room_type}" கிடைக்க முடியாது. கிடைக்கக்கூடிய அறைகள்: ${roomsStr}. இந்த விருப்பங்களிலிருந்து தேர்ந்தெடுக்கவும்.`
      };

      errors.push(msgs[locale] || msgs.en);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
