/**
 * US-237: Multi-Turn Booking Clarification Dialog Manager
 *
 * State machine that guides ambiguous booking intents through a structured
 * multi-turn dialog collecting dates, room type, and guest count before
 * proceeding to booking confirmation.
 *
 * States: need_dates → need_room_type → need_guest_count → ready_confirm
 */

// ─── State Types ─────────────────────────────────────────────────────────────

export type ClarificationState =
  | 'need_dates'
  | 'need_room_type'
  | 'need_guest_count'
  | 'ready_confirm';

export interface ClarificationData {
  checkIn?: string;    // ISO date string
  checkOut?: string;   // ISO date string
  roomType?: string;   // e.g. 'dorm', 'private', 'twin'
  guestCount?: number;
}

export interface ClarificationSession {
  state: ClarificationState;
  data: ClarificationData;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const PROMPTS: Record<ClarificationState, Record<string, string>> = {
  need_dates: {
    en: 'When would you like to check in and check out? Please share both dates (e.g. "15 Apr – 18 Apr").',
    ms: 'Bilakah tarikh daftar masuk dan daftar keluar anda? Sila kongsi kedua-dua tarikh (cth. "15 Apr – 18 Apr").',
    zh: '您希望什么时候入住和退房？请提供两个日期（如"4月15日 – 4月18日"）。',
  },
  need_room_type: {
    en: 'What type of room would you prefer — dorm bed, private room, or twin room?',
    ms: 'Apakah jenis bilik yang anda pilih — katil dorm, bilik persendirian, atau bilik twin?',
    zh: '您需要哪种房型——床位宿舍、私人房间还是双床房？',
  },
  need_guest_count: {
    en: 'How many guests will be staying?',
    ms: 'Berapa ramai tetamu yang akan menginap?',
    zh: '入住的客人有几位？',
  },
  ready_confirm: {
    en: 'Great! I have all the details. Shall I confirm your booking?',
    ms: 'Bagus! Saya sudah ada semua maklumat. Boleh saya sahkan tempahan anda?',
    zh: '太好了！我已收集所有信息。要确认预订吗？',
  },
};

// ─── Date parsing helper (simple ISO / D-Mon format) ─────────────────────────

function parseDatePair(input: string): { checkIn?: string; checkOut?: string } {
  // Match common patterns: "15 Apr – 18 Apr", "2025-04-15 to 2025-04-18", etc.
  const isoRange = input.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|–|-)\s*(\d{4}-\d{2}-\d{2})/i);
  if (isoRange) return { checkIn: isoRange[1], checkOut: isoRange[2] };

  // "15 Apr – 18 Apr" (same year implied)
  const monthNames = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const dmonRe = new RegExp(`(\\d{1,2})\\s*(${monthNames})\\s*(?:–|-|to)\\s*(\\d{1,2})\\s*(${monthNames})`, 'i');
  const dmonMatch = input.match(dmonRe);
  if (dmonMatch) {
    const year = new Date().getFullYear();
    const months: Record<string, string> = {
      jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
      jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12',
    };
    const m1 = months[dmonMatch[2].toLowerCase()];
    const m2 = months[dmonMatch[4].toLowerCase()];
    if (m1 && m2) {
      return {
        checkIn: `${year}-${m1}-${dmonMatch[1].padStart(2,'0')}`,
        checkOut: `${year}-${m2}-${dmonMatch[3].padStart(2,'0')}`,
      };
    }
  }

  return {};
}

function parseGuestCount(input: string): number | null {
  const match = input.match(/\b(\d+)\b/);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 50) return n;
  }
  return null;
}

const ROOM_TYPE_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /\b(dorm|hostel|bed|bunk)\b/i, type: 'dorm' },
  { pattern: /\b(private|single|solo)\b/i, type: 'private' },
  { pattern: /\b(twin|double|couple)\b/i, type: 'twin' },
];

function parseRoomType(input: string): string | null {
  for (const { pattern, type } of ROOM_TYPE_PATTERNS) {
    if (pattern.test(input)) return type;
  }
  return null;
}

// ─── State Machine ────────────────────────────────────────────────────────────

export interface DialogStepResult {
  /** Updated session after processing the user message (null = no change) */
  session: ClarificationSession;
  /** Response message to send back to the user */
  response: string;
  /** True when all required data has been collected */
  complete: boolean;
}

/**
 * Create a fresh clarification session (always starts at need_dates).
 */
export function createClarificationSession(): ClarificationSession {
  return { state: 'need_dates', data: {} };
}

/**
 * Get the prompt for the current clarification state.
 */
export function getClarificationPrompt(
  state: ClarificationState,
  lang: string = 'en'
): string {
  const langMap = PROMPTS[state];
  return langMap[lang] ?? langMap['en'];
}

/**
 * Process one user message within a clarification session.
 *
 * Advances the state machine when valid input is received, asking for
 * missing data in sequence: dates → room type → guest count → confirm.
 */
export function processClarificationStep(
  session: ClarificationSession,
  userMessage: string,
  lang: string = 'en'
): DialogStepResult {
  const data = { ...session.data };
  let state = session.state;

  switch (state) {
    case 'need_dates': {
      const parsed = parseDatePair(userMessage);
      if (parsed.checkIn && parsed.checkOut) {
        data.checkIn = parsed.checkIn;
        data.checkOut = parsed.checkOut;
        state = 'need_room_type';
      }
      break;
    }
    case 'need_room_type': {
      const roomType = parseRoomType(userMessage);
      if (roomType) {
        data.roomType = roomType;
        state = 'need_guest_count';
      }
      break;
    }
    case 'need_guest_count': {
      const count = parseGuestCount(userMessage);
      if (count !== null) {
        data.guestCount = count;
        state = 'ready_confirm';
      }
      break;
    }
    case 'ready_confirm':
      // Already complete — return confirmation prompt again
      break;
  }

  const updatedSession: ClarificationSession = { state, data };
  const complete = state === 'ready_confirm';
  const response = getClarificationPrompt(state, lang);

  return { session: updatedSession, response, complete };
}

/**
 * Serialise a clarification session to JSON strings for DB storage.
 */
export function serialiseClarification(session: ClarificationSession): {
  clarificationState: string;
  clarificationData: string;
} {
  return {
    clarificationState: session.state,
    clarificationData: JSON.stringify(session.data),
  };
}

/**
 * Deserialise a clarification session from DB storage.
 */
export function deserialiseClarification(
  state: string | null | undefined,
  dataJson: string | null | undefined
): ClarificationSession | null {
  if (!state) return null;
  const validStates: ClarificationState[] = [
    'need_dates', 'need_room_type', 'need_guest_count', 'ready_confirm',
  ];
  if (!validStates.includes(state as ClarificationState)) return null;

  let data: ClarificationData = {};
  if (dataJson) {
    try { data = JSON.parse(dataJson); } catch { /* ignore */ }
  }

  return { state: state as ClarificationState, data };
}
