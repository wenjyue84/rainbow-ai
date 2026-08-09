/**
 * Context-Aware Fallback Response Selector (US-350)
 *
 * Selects profile-specific fallback responses based on conversation context.
 * Scores conversation history to determine relevance to booking, order, check-in, etc.
 * and selects the most appropriate fallback template from settings.
 */

import type { ConversationMessage } from '../types.js';

export interface FallbackCategory {
  category: 'default' | 'booking' | 'order' | 'checkin' | 'facilities';
  score: number;
  reason: string;
}

// Context keywords by category for scoring
const CONTEXT_KEYWORDS: Record<string, string[]> = {
  booking: [
    'booking', 'book', 'reserve', 'reservation', 'room', 'rooms', 'check-in',
    'check in', 'checkout', 'check-out', 'nights', 'dates', 'availability',
    'available', 'dates', 'when', 'how long', 'price', 'rate', 'cost',
    'tempahan', 'pesan', 'ruang', 'bilik', 'masuk', 'keluar', 'malam',
    '预订', '房间', '入住', '退房', '可用', '价格'
  ],
  order: [
    'menu', 'order', 'food', 'drink', 'coffee', 'tea', 'eat', 'eat out',
    'cafe', 'restaurant', 'price', 'cost', 'how much', 'table', 'reservation',
    'pesanan', 'makanan', 'minuman', 'kopi', 'teh', 'minum', 'makan',
    'harga', 'berapa', 'meja', 'tempahan', '菜单', '订单', '食物', '饮料',
    '咖啡', '茶', '价格'
  ],
  checkin: [
    'check-in', 'check in', 'checking in', 'arrive', 'arrival', 'arriving',
    'arrive', 'keycard', 'key card', 'key', 'access', 'room number', 'welcome',
    'masuk', 'tiba', 'sampai', 'kunci', 'akses', 'nomor bilik',
    '入住', '到达', '房间号', '钥匙', '准入'
  ],
  facilities: [
    'facilities', 'facility', 'wifi', 'wi-fi', 'internet', 'pool', 'swimming',
    'gym', 'kitchen', 'laundry', 'parking', 'elevator', 'air conditioning',
    'ac', 'refrigerator', 'tv', 'towel', 'bed', 'air con', 'ac',
    'kemudahan', 'kolam', 'wifi', 'dapur', 'pencucian', 'parkir', 'pendingin udara',
    '设施', 'wifi', '游泳池', '健身房', '厨房', '洗衣', '停车',
    '冰箱', '毛巾', '床'
  ]
};

/**
 * Score conversation context for a given category.
 * Returns a score from 0-1 based on keyword matches in conversation.
 */
function scoreContextForCategory(
  messages: ConversationMessage[],
  category: string
): number {
  if (!CONTEXT_KEYWORDS[category]) return 0;

  const keywords = CONTEXT_KEYWORDS[category];
  let totalMatches = 0;

  for (const msg of messages) {
    // Only score guest messages (not system responses)
    if (msg.role !== 'user') continue;

    const msgLower = msg.content.toLowerCase();

    for (const keyword of keywords) {
      // Case-insensitive substring match
      if (msgLower.includes(keyword)) {
        totalMatches++;
      }
    }
  }

  // Score: (matches / keywords in category)
  // This gives a simpler, more lenient scoring
  if (totalMatches === 0) return 0;
  return Math.min(totalMatches / Math.max(keywords.length * 0.5, 1), 1);
}

/**
 * Determine the best fallback category based on conversation context.
 * Returns the category with the highest score, or 'default' if no clear match.
 */
export function determineFallbackCategory(
  messages: ConversationMessage[]
): FallbackCategory {
  if (messages.length === 0) {
    return {
      category: 'default',
      score: 0,
      reason: 'No conversation history available'
    };
  }

  const categories = ['booking', 'order', 'checkin', 'facilities'];
  const scores: Record<string, number> = {};

  for (const category of categories) {
    scores[category] = scoreContextForCategory(messages, category);
  }

  // Find the best matching category
  let bestCategory = 'default';
  let bestScore = 0;
  let reason = 'No strong context match';

  for (const category of categories) {
    const score = scores[category];
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // Only switch from default if score is meaningful (> 0.05)
  if (bestScore > 0.05) {
    reason = `Matched context: ${bestCategory} (score: ${bestScore.toFixed(2)})`;
  } else {
    bestCategory = 'default';
    reason = `Weak context match (best: ${bestCategory} = ${bestScore.toFixed(2)}) → using default`;
  }

  return {
    category: bestCategory as FallbackCategory['category'],
    score: bestScore,
    reason
  };
}

/**
 * Select a fallback response based on profile, context, and language.
 * Returns the response text and logs the selection reason.
 */
export function selectContextAwareFallback(
  fallbackResponses: Record<string, any>,
  profileId: string,
  messages: ConversationMessage[],
  lang: string = 'en'
): { response: string; reason: string } {
  // Normalize profile ID (makan-moments → makan, pelangi-capsule → pelangi, etc.)
  let normalizedProfile = profileId;
  if (profileId.includes('makan')) normalizedProfile = 'makan';
  else if (profileId.includes('pelangi')) normalizedProfile = 'pelangi';
  else if (profileId.includes('southern')) normalizedProfile = 'southern';

  // Get profile-specific fallbacks
  const profileFallbacks = fallbackResponses[normalizedProfile];
  if (!profileFallbacks) {
    return {
      response: `Sorry, I am not sure about that. Our team can help!`,
      reason: `Profile '${normalizedProfile}' not found in fallback_responses`
    };
  }

  // Determine best category based on conversation context
  const contextMatch = determineFallbackCategory(messages);

  // Get the category fallback (or default if not found)
  const categoryResponses = profileFallbacks[contextMatch.category] || profileFallbacks.default;
  if (!categoryResponses) {
    return {
      response: `Sorry, I am not sure about that. Our team can help!`,
      reason: `Category '${contextMatch.category}' not found for profile '${normalizedProfile}'`
    };
  }

  // Get language-specific response (fallback to English)
  const response = categoryResponses[lang] || categoryResponses.en || 'Sorry, I am not sure about that. Our team can help!';

  const reason = `${contextMatch.reason} → selected fallback: ${normalizedProfile}/${contextMatch.category}`;

  return { response, reason };
}
