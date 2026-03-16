/**
 * Off-Scope Guard (US-1026)
 *
 * Enforces Meta WhatsApp Business Platform policy: bots must serve a specific
 * business purpose. Detects general-purpose assistant queries (e.g. "write me
 * a poem", "explain quantum physics") and redirects them to business topics.
 *
 * Runs BEFORE the main LLM call in the pipeline, similar to prompt-injection-guard.
 */

export interface OffScopeResult {
  blocked: boolean;
  matchedPattern: string | null;
  category: 'creative_writing' | 'academic' | 'coding' | 'personal_advice' | 'entertainment' | 'general_knowledge' | null;
}

/**
 * Default off-scope patterns — general-purpose AI requests that violate
 * Meta's WhatsApp Business Platform terms (no general-purpose assistant mode).
 *
 * Grouped by category for audit reporting.
 */
const OFF_SCOPE_PATTERNS: Array<{ pattern: string; category: OffScopeResult['category'] }> = [
  // Creative writing
  { pattern: 'write me a', category: 'creative_writing' },
  { pattern: 'write a poem', category: 'creative_writing' },
  { pattern: 'write a story', category: 'creative_writing' },
  { pattern: 'write a song', category: 'creative_writing' },
  { pattern: 'write an essay', category: 'creative_writing' },
  { pattern: 'compose a', category: 'creative_writing' },
  { pattern: 'create a poem', category: 'creative_writing' },
  { pattern: 'create a story', category: 'creative_writing' },
  { pattern: 'generate a poem', category: 'creative_writing' },
  { pattern: 'make up a story', category: 'creative_writing' },

  // Academic / general knowledge
  { pattern: 'explain quantum', category: 'academic' },
  { pattern: 'explain relativity', category: 'academic' },
  { pattern: 'what is the meaning of life', category: 'academic' },
  { pattern: 'solve this equation', category: 'academic' },
  { pattern: 'solve this math', category: 'academic' },
  { pattern: 'help me with homework', category: 'academic' },
  { pattern: 'help me with my homework', category: 'academic' },
  { pattern: 'help with my assignment', category: 'academic' },
  { pattern: 'do my homework', category: 'academic' },
  { pattern: 'what is the capital of', category: 'academic' },
  { pattern: 'who invented', category: 'academic' },
  { pattern: 'when was the', category: 'academic' },
  { pattern: 'history of', category: 'academic' },
  { pattern: 'teach me about', category: 'academic' },
  { pattern: 'explain the theory', category: 'academic' },

  // Coding / technical
  { pattern: 'write code', category: 'coding' },
  { pattern: 'write a program', category: 'coding' },
  { pattern: 'write a script', category: 'coding' },
  { pattern: 'debug this code', category: 'coding' },
  { pattern: 'fix this code', category: 'coding' },
  { pattern: 'help me code', category: 'coding' },
  { pattern: 'write python', category: 'coding' },
  { pattern: 'write javascript', category: 'coding' },
  { pattern: 'write html', category: 'coding' },
  { pattern: 'create a website', category: 'coding' },
  { pattern: 'build an app', category: 'coding' },

  // Personal advice (non-business)
  { pattern: 'give me life advice', category: 'personal_advice' },
  { pattern: 'relationship advice', category: 'personal_advice' },
  { pattern: 'what should i do with my life', category: 'personal_advice' },
  { pattern: 'tell me my horoscope', category: 'personal_advice' },
  { pattern: 'predict my future', category: 'personal_advice' },
  { pattern: 'read my fortune', category: 'personal_advice' },
  { pattern: 'what is my zodiac', category: 'personal_advice' },

  // Entertainment / games
  { pattern: 'tell me a joke', category: 'entertainment' },
  { pattern: 'play a game', category: 'entertainment' },
  { pattern: 'let\'s play', category: 'entertainment' },
  { pattern: 'tell me a riddle', category: 'entertainment' },
  { pattern: 'play 20 questions', category: 'entertainment' },
  { pattern: 'play trivia', category: 'entertainment' },
  { pattern: 'sing me a song', category: 'entertainment' },
  { pattern: 'recite a poem', category: 'entertainment' },

  // General-purpose assistant
  { pattern: 'translate this to', category: 'general_knowledge' },
  { pattern: 'summarize this article', category: 'general_knowledge' },
  { pattern: 'summarise this article', category: 'general_knowledge' },
  { pattern: 'what do you think about', category: 'general_knowledge' },
  { pattern: 'give me a recipe for', category: 'general_knowledge' },
  { pattern: 'how do i cook', category: 'general_knowledge' },
  { pattern: 'what is the weather', category: 'general_knowledge' },
  { pattern: 'search for', category: 'general_knowledge' },
  { pattern: 'google this', category: 'general_knowledge' },
  { pattern: 'look up', category: 'general_knowledge' },
  { pattern: 'who is the president', category: 'general_knowledge' },
  { pattern: 'news about', category: 'general_knowledge' },
  { pattern: 'latest news', category: 'general_knowledge' },
];

/**
 * Business-scope allowlist — if message matches ANY of these, it's on-topic
 * and should NOT be blocked, even if it also matches an off-scope pattern.
 * This prevents false positives for legitimate business queries.
 */
const BUSINESS_ALLOWLIST: string[] = [
  // Hostel
  'book', 'booking', 'reservation', 'room', 'check in', 'check-in', 'checkin',
  'check out', 'check-out', 'checkout', 'hostel', 'capsule', 'dorm',
  'bed', 'bunk', 'locker', 'wifi', 'password', 'towel', 'amenities',
  'price', 'rate', 'cost', 'how much', 'berapa', 'harga',
  'available', 'availability', 'vacancy', 'occupancy',
  'location', 'address', 'direction', 'parking', 'nearby',
  'breakfast', 'laundry', 'facility', 'facilities',
  'staff', 'reception', 'front desk',
  'cancel', 'cancellation', 'refund', 'payment', 'pay',
  'pelangi', 'southern', 'homestay',
  // Cafe / F&B
  'menu', 'food', 'drink', 'order', 'makan', 'cafe', 'coffee',
  'tea', 'nasi', 'mee', 'roti', 'teh', 'kopi',
  'delivery', 'takeaway', 'dine in', 'table',
  // General business
  'hello', 'hi', 'hey', 'salam', 'thank', 'thanks', 'terima kasih',
  'bye', 'goodbye', 'ok', 'okay', 'yes', 'no',
  'complaint', 'feedback', 'review', 'suggest',
  'promotion', 'promo', 'discount', 'offer', 'deal',
  'hours', 'open', 'close', 'operating',
  'contact', 'phone', 'email', 'whatsapp',
];

/**
 * Check if a message is off-scope (not related to business operations).
 *
 * Logic:
 * 1. If message matches business allowlist → always allow (no false positives)
 * 2. If message matches off-scope patterns → block with redirect
 * 3. Otherwise → allow (default pass-through)
 *
 * @param text - The user's message text
 * @param customPatterns - Optional custom off-scope patterns (overrides defaults)
 * @param customAllowlist - Optional custom business allowlist (extends defaults)
 * @returns Detection result with matched pattern and category
 */
export function detectOffScope(
  text: string,
  customPatterns?: Array<{ pattern: string; category: OffScopeResult['category'] }>,
  customAllowlist?: string[]
): OffScopeResult {
  const lower = text.toLowerCase().trim();

  // Step 1: Business allowlist — if ANY business keyword matches, allow through.
  // Uses word-boundary matching to prevent false positives (e.g. 'ok' in 'joke').
  const allowlist = customAllowlist
    ? [...BUSINESS_ALLOWLIST, ...customAllowlist]
    : BUSINESS_ALLOWLIST;

  for (const keyword of allowlist) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(lower)) {
      return { blocked: false, matchedPattern: null, category: null };
    }
  }

  // Step 2: Off-scope pattern check
  const patterns = customPatterns && customPatterns.length > 0 ? customPatterns : OFF_SCOPE_PATTERNS;

  for (const { pattern, category } of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return { blocked: true, matchedPattern: pattern, category };
    }
  }

  // Step 3: Default pass-through
  return { blocked: false, matchedPattern: null, category: null };
}

/**
 * Default redirect messages per language — politely guides guests back to
 * business topics without answering the off-scope query.
 */
export const OFF_SCOPE_REDIRECT: Record<string, string> = {
  en: "I'm Rainbow, the AI assistant for Pelangi Capsule Hostel. I can help with bookings, check-in/out, room info, cafe menu, and hostel facilities. How can I assist you with your stay?",
  ms: "Saya Rainbow, pembantu AI untuk Pelangi Capsule Hostel. Saya boleh bantu dengan tempahan, daftar masuk/keluar, maklumat bilik, menu kafe, dan kemudahan hostel. Bagaimana saya boleh bantu anda?",
  zh: "我是 Rainbow，Pelangi Capsule Hostel 的 AI 助手。我可以帮您处理预订、入住/退房、房间信息、咖啡厅菜单和旅馆设施。请问有什么可以帮您的？",
  ta: "நான் Rainbow, Pelangi Capsule Hostel இன் AI உதவியாளர். முன்பதிவு, செக்-இன்/அவுட், அறை தகவல், கஃபே மெனு மற்றும் விடுதி வசதிகள் பற்றி உதவ முடியும். எப்படி உதவலாம்?",
};
