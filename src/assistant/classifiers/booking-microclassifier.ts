/**
 * booking-microclassifier.ts — Disambiguates high-confidence booking intents into subtypes
 *
 * Purpose: When a message is classified as 'booking' intent with confidence >= 0.7,
 * this micro-classifier further categorizes it into:
 * - check_in: guest wants to check in / arrive at property
 * - check_out: guest wants to check out / leave the property
 * - modification: guest wants to change booking dates / room type / guest count
 * - general_inquiry: guest has questions about booking status, cancellation, etc.
 *
 * Implementation: Fuzzy keyword matching against curated patterns.
 * Target accuracy: 95%+ on cross-profile test sets.
 */

import type { z } from 'zod';
import { bookingMicroclassifierSchema } from '../schemas.js';

export type BookingMicroclassifierResult = z.infer<typeof bookingMicroclassifierSchema>;

/**
 * Keyword patterns for each booking subtype.
 * Grouped by language (en, ms, zh) and subtype.
 *
 * Strategy: Match exact phrases first, then fall back to keyword presence.
 * Return the subtype with the highest confidence.
 */
const SUBTYPE_PATTERNS = {
  check_in: {
    // English
    en: [
      'check in', 'check-in', 'checkin', 'arrive', 'arriving',
      'coming', 'coming tomorrow', 'coming today', 'will arrive',
      'reach', 'reaching', 'get there', 'heading', 'on the way',
      'here now', 'im here', "i'm here", 'just arrived', 'arrived',
      'can i check in', 'ready to check in', 'when can i check in',
      'access', 'entry', 'open the door', 'unlock', 'room key',
    ],
    // Malay
    ms: [
      'check in', 'check-in', 'tiba', 'sampai', 'datang',
      'akan datang', 'sedang datang', 'sampai nanti', 'tiba nanti',
      'sudah tiba', 'dah sampai', 'dah tiba', 'tiba di sini',
      'masuk bilik', 'boleh masuk', 'mula masuk', 'buka pintu',
      'kunci', 'pintu', 'akses', 'masuk',
    ],
    // Mandarin
    zh: [
      '入住', '入住时间', '什么时候入住', '现在可以入住吗',
      '我已经到了', '我到了', '已到', '到达', '抵达',
      '现在在这里', '我在这儿', '开门', '钥匙', '房间钥匙',
      '怎么进去', '怎么开门', '进入房间', '开房间门',
    ],
  },
  check_out: {
    // English
    en: [
      'return key', 'return the key', 'return the room key',
      'check out', 'check-out', 'checkout', 'leave', 'leaving',
      'depart', 'departing', 'departure', 'go', 'going away',
      'when to leave', 'what time to leave', 'when can i leave',
      'goodbye', 'final day', 'last day', 'cancel booking', 'cancel', 'cancellation',
      'how to check out',
    ],
    // Malay
    ms: [
      'check out', 'check-out', 'keluar', 'pergi', 'akan pergi',
      'tinggal', 'meninggalkan', 'akhir hari', 'hari terakhir',
      'malam terakhir', 'kapan pergi', 'jam berapa keluar',
      'balik kunci', 'kembalikan kunci', 'pembatalan',
      'daftar keluar', 'daftar keluar hari ini',
    ],
    // Mandarin
    zh: [
      '退房', '退房时间', '什么时候退房', '现在可以退房吗',
      '我要离开', '我要走', '离开', '出门', '出房间',
      '钥匙在哪', '钥匙怎么交', '交钥匙', '归还钥匙',
      '最后一晚', '今晚退房', '明天退房', '取消订单',
    ],
  },
  modification: {
    // English
    en: [
      'add one more night', 'add more night', 'add night', 'add nights',
      'one more night', 'more nights', 'extra night', 'fewer nights',
      'change', 'changing', 'change my', 'modify', 'modification',
      'update', 'alter', 'different date', 'different room',
      'different dates', 'can i change', 'can i modify',
      'postpone', 'delay', 'move', 'extend', 'shorten',
      'room type', 'room size', 'number of guests', 'how many people',
      'upgrade', 'downgrade', 'change guest', 'change group',
    ],
    // Malay
    ms: [
      'ubah', 'mengubah', 'ubah tanggal', 'ubah tanggal saya',
      'ubah ruangan', 'ubah bilik', 'ubah malam',
      'boleh ubah', 'boleh ubah ke', 'mahu ubah',
      'tunda', 'pindahkan', 'tambah', 'kurang', 'lanjutkan',
      'banyak orang', 'berapa orang', 'bilangan tetamu',
      'jenis bilik', 'saiz bilik', 'tingkat', 'naik', 'turun',
    ],
    // Mandarin
    zh: [
      '改', '改期', '改日期', '改变', '修改', '更改',
      '改日期', '改房间', '改房型', '改人数',
      '能改吗', '可以改吗', '我要改', '延期', '提前',
      '多一晚', '少一晚', '加一晚', '减一晚',
      '房型', '房间类型', '几个人', '多少人',
    ],
  },
  general_inquiry: {
    // English - default: anything not clearly fitting above categories
    en: [
      'booking', 'reservation', 'confirm', 'confirmation',
      'status', 'when', 'what time', 'when do i', 'when will',
      'is the room', 'is it available', 'available', 'cancel',
      'price', 'cost', 'how much', 'refund', 'payment',
      'question', 'ask', 'help', 'info', 'information',
    ],
    // Malay
    ms: [
      'tempahan', 'pemesanan', 'pengesahan', 'status',
      'berapa', 'berapa harganya', 'harga', 'bayaran',
      'bilik ada', 'ada bilik', 'tersedia', 'penolakan',
      'soalan', 'tanya', 'pertanyaan', 'bantuan', 'maklumat',
    ],
    // Mandarin
    zh: [
      '订单', '订单状态', '预订', '预定', '确认',
      '什么时候', '什么时间', '房间怎么样', '有房间吗',
      '多少钱', '价格', '价钱', '退款', '支付',
      '问题', '询问', '帮助', '信息',
    ],
  },
};

/**
 * Normalize text for keyword matching:
 * - lowercase
 * - remove diacritics (Latin only)
 * - collapse whitespace
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Calculate confidence based on pattern matching.
 * Prioritizes longer/more specific patterns to avoid false positives.
 * - Multiple keyword matches (2+): 0.90
 * - Single match (longer pattern >8 chars): 0.75
 * - Single match (shorter pattern <=8 chars): 0.65
 * - Weak signal: 0.5
 */
function scoreSubtype(
  normalizedText: string,
  patterns: string[]
): { score: number; matchedKeywords: string[] } {
  // Sort patterns by length (longest first) for more specific matching
  const sortedPatterns = [...patterns].sort((a, b) => b.length - a.length);
  const matchedKeywords: string[] = [];

  // Check for exact phrase matches, prioritizing longer patterns
  for (const pattern of sortedPatterns) {
    if (normalizedText.includes(pattern)) {
      matchedKeywords.push(pattern);
    }
  }

  let score = 0;
  if (matchedKeywords.length >= 2) {
    // Multiple matches: high confidence
    score = 0.90;
  } else if (matchedKeywords.length === 1) {
    // Single match: confidence based on pattern length
    // Longer patterns are more specific and should have higher confidence
    const patternLength = matchedKeywords[0].length;
    score = patternLength > 8 ? 0.75 : 0.65;
  }

  return { score, matchedKeywords };
}

/**
 * Classify a booking intent message into a subtype.
 *
 * @param message - The user's message (already classified as 'booking')
 * @param language - Detected language ('en', 'ms', 'zh', etc.)
 * @returns Result with subtype and confidence
 */
export function classifyBookingSubtype(
  message: string,
  language: string = 'en'
): BookingMicroclassifierResult {
  const normalized = normalizeText(message);

  // Score each subtype
  const scores = {
    check_in: scoreSubtype(
      normalized,
      SUBTYPE_PATTERNS.check_in[language as keyof typeof SUBTYPE_PATTERNS.check_in] ??
        SUBTYPE_PATTERNS.check_in.en
    ),
    check_out: scoreSubtype(
      normalized,
      SUBTYPE_PATTERNS.check_out[language as keyof typeof SUBTYPE_PATTERNS.check_out] ??
        SUBTYPE_PATTERNS.check_out.en
    ),
    modification: scoreSubtype(
      normalized,
      SUBTYPE_PATTERNS.modification[language as keyof typeof SUBTYPE_PATTERNS.modification] ??
        SUBTYPE_PATTERNS.modification.en
    ),
    general_inquiry: scoreSubtype(
      normalized,
      SUBTYPE_PATTERNS.general_inquiry[language as keyof typeof SUBTYPE_PATTERNS.general_inquiry] ??
        SUBTYPE_PATTERNS.general_inquiry.en
    ),
  };

  // Find the best match
  const best = Object.entries(scores).reduce((prev, [subtype, result]) => {
    return result.score > prev.score ? { subtype: subtype as keyof typeof scores, ...result } : prev;
  }, { subtype: 'general_inquiry' as const, score: 0.5, matchedKeywords: [] });

  // If no strong match found, default to general_inquiry
  if (best.score === 0) {
    return {
      subtype: 'general_inquiry',
      confidence: 0.5,
      matchedKeywords: [],
      model: 'keyword-matching',
    };
  }

  return {
    subtype: best.subtype as any,
    confidence: best.score,
    matchedKeywords: best.matchedKeywords,
    model: 'keyword-matching',
  };
}
