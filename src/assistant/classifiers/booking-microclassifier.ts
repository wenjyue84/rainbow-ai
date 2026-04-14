/**
 * booking-microclassifier.ts — Disambiguates high-confidence booking intents
 *
 * Purpose: When a message is classified as 'booking' intent with confidence >= 0.7,
 * this micro-classifier further categorizes it into:
 * - check_in_confirm: guest wants to check in / arrive at property
 * - modification_request: guest wants to change booking dates / room type / guest count
 * - cancellation: guest wants to cancel booking
 * - availability_check: guest is asking about availability
 * - unknown: doesn't clearly fit above categories
 *
 * Implementation: Fuzzy keyword matching using keywords from intent-keywords JSON files.
 * Target accuracy: 95%+ on cross-profile test sets.
 */

import type { z } from 'zod';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { bookingMicroclassifierSchema } from '../schemas.js';

export type BookingMicroclassifierResult = z.infer<typeof bookingMicroclassifierSchema>;

/**
 * Load booking_sub keywords from intent-keywords JSON for a specific profile
 */
function loadBookingSubKeywords(profile: string): Record<string, Record<string, string[]>> {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const profilePath = join(dataDir, `intent-keywords-${profile}.json`);

  let keywordsData: any = {};

  if (existsSync(profilePath)) {
    try {
      const data = JSON.parse(readFileSync(profilePath, 'utf-8'));
      const bookingIntent = data.intents?.find((i: any) => i.intent === 'booking');
      if (bookingIntent?.keywords?.booking_sub) {
        keywordsData = bookingIntent.keywords.booking_sub;
      }
    } catch {
      // fall through to default
    }
  }

  // Default keywords if not found in profile-specific file
  if (!keywordsData.check_in_confirm) {
    keywordsData = {
      check_in_confirm: {
        en: [
          'check in', 'check-in', 'checkin', 'arrive', 'arriving',
          'coming', 'will arrive', 'reach', 'here now', 'just arrived',
          'can i check in', 'ready to check in', 'access', 'entry',
        ],
        ms: [
          'check in', 'tiba', 'sampai', 'datang', 'sudah tiba',
          'dah sampai', 'masuk bilik', 'boleh masuk', 'akses',
        ],
        zh: [
          '入住', '到了', '已到', '到达', '抵达', '开门', '房间钥匙',
        ],
      },
      modification_request: {
        en: [
          'add one more night', 'more nights', 'change', 'modify',
          'update', 'different date', 'extend', 'shorten',
          'can i change', 'can i modify', 'upgrade', 'downgrade',
        ],
        ms: [
          'ubah', 'ubah tanggal', 'ubah bilik', 'ubah malam',
          'tunda', 'tambah', 'kurang', 'lanjutkan', 'naik', 'turun',
        ],
        zh: [
          '改', '改期', '改日期', '修改', '改房间', '改人数',
          '延期', '多一晚', '少一晚', '加一晚', '减一晚',
        ],
      },
      cancellation: {
        en: [
          'cancel', 'cancellation', 'cancel booking', 'cancel my booking',
          'i want to cancel', 'can i cancel', 'how to cancel',
          'refund', 'return key', 'checkout', 'leave',
        ],
        ms: [
          'batal', 'pembatalan', 'batal booking', 'nak batal',
          'boleh batal', 'cara nak batal', 'balik kunci',
          'keluar', 'pergi',
        ],
        zh: [
          '取消', '取消订单', '退单', '退款', '退房',
          '我要取消', '可以取消吗', '怎么取消',
        ],
      },
      availability_check: {
        en: [
          'available', 'availability', 'is the room', 'do you have',
          'any room', 'have a room', 'when is available',
          'room available', 'check availability',
        ],
        ms: [
          'ada', 'tersedia', 'ketersediaan', 'ada bilik',
          'bilik ada', 'ada ruang', 'kapan ada', 'berapa harga',
        ],
        zh: [
          '有房间吗', '有吗', '房间有吗', '什么时候有',
          '可用', '空房', '房间空吗',
        ],
      },
    };
  }

  return keywordsData;
}

/**
 * Normalize text for keyword matching
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Score a text against keywords for a specific sub-intent
 */
function scoreSubIntent(
  normalizedText: string,
  keywords: string[]
): { score: number; matchedKeywords: string[] } {
  const sortedKeywords = [...keywords].sort((a, b) => b.length - a.length);
  const matched: string[] = [];

  for (const kw of sortedKeywords) {
    const kwNorm = normalizeText(kw);
    if (normalizedText.includes(kwNorm)) {
      matched.push(kw);
    }
  }

  let score = 0;
  if (matched.length >= 2) {
    score = 0.90;
  } else if (matched.length === 1) {
    const kwLen = matched[0].length;
    score = kwLen > 8 ? 0.75 : 0.65;
  }

  return { score, matchedKeywords: matched };
}

/**
 * Classify a booking intent message into a sub-intent.
 *
 * @param message - The user's message (already classified as 'booking')
 * @param language - Detected language ('en', 'ms', 'zh', etc.)
 * @param profile - Profile name ('pelangi', 'southern', 'makan', etc.)
 * @returns Result with sub_intent and confidence
 */
export function classifyBookingSubIntent(
  message: string,
  language: string = 'en',
  profile: string = 'pelangi'
): BookingMicroclassifierResult {
  const normalized = normalizeText(message);
  const keywordsData = loadBookingSubKeywords(profile);

  // Score each sub-intent
  const scores = {
    check_in_confirm: scoreSubIntent(
      normalized,
      keywordsData.check_in_confirm?.[language as keyof typeof keywordsData.check_in_confirm] ??
        keywordsData.check_in_confirm?.['en'] ??
        []
    ),
    modification_request: scoreSubIntent(
      normalized,
      keywordsData.modification_request?.[language as keyof typeof keywordsData.modification_request] ??
        keywordsData.modification_request?.['en'] ??
        []
    ),
    cancellation: scoreSubIntent(
      normalized,
      keywordsData.cancellation?.[language as keyof typeof keywordsData.cancellation] ??
        keywordsData.cancellation?.['en'] ??
        []
    ),
    availability_check: scoreSubIntent(
      normalized,
      keywordsData.availability_check?.[language as keyof typeof keywordsData.availability_check] ??
        keywordsData.availability_check?.['en'] ??
        []
    ),
  };

  // Find the best match
  const best = Object.entries(scores).reduce(
    (prev, [subIntent, result]) => {
      return result.score > prev.score
        ? { subIntent: subIntent as keyof typeof scores, ...result }
        : prev;
    },
    { subIntent: 'unknown' as const, score: 0.5, matchedKeywords: [] }
  );

  // If no match or very low confidence, return unknown
  if (best.score === 0 || best.subIntent === 'unknown') {
    return {
      sub_intent: 'unknown',
      confidence: 0.5,
      matchedKeywords: [],
      model: 'keyword-matching',
    };
  }

  return {
    sub_intent: best.subIntent as any,
    confidence: best.score,
    matchedKeywords: best.matchedKeywords,
    model: 'keyword-matching',
  };
}
