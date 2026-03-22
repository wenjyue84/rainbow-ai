/**
 * Topic Drift Detector (US-093)
 *
 * Detects when conversation context drifts away from booking/inquiry topics,
 * triggering alternative fallback response strategy instead of passing
 * off-topic context to AI model.
 *
 * Algorithm:
 * 1. Extract primary topic keywords from conversation history
 * 2. Classify current message intent against primary topic
 * 3. Calculate coherence score based on keyword overlap and recency
 * 4. Return drift detection with confidence score
 */

import type { ChatMessage } from '../types.js';

// Topic categories and their keywords
const TOPIC_KEYWORDS = {
  booking: [
    'book', 'booking', 'reserve', 'reservation', 'check-in', 'checkin',
    'check-out', 'checkout', 'room', 'capsule', 'night', 'date', 'guest',
    'availability', 'price', 'rate', 'cost', 'confirm', 'deposit',
    'payment', 'pay', 'duration', 'stay', 'nights', 'reserve', 'schedule',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ],
  inquiry: [
    'info', 'information', 'facilities', 'rules', 'wifi', 'address',
    'directions', 'contact', 'phone', 'email', 'hours', 'open',
    'amenities', 'equipment', 'services', 'available',
  ],
  general: [
    'hello', 'hi', 'hey', 'thanks', 'thank', 'bye', 'goodbye',
    'okay', 'ok', 'yes', 'no', 'please', 'sorry', 'help',
    'weather', 'food', 'pizza', 'game', 'physics', 'color', 'roof',
    'like', 'time', 'today', 'tomorrow', 'next', 'play', 'video',
  ],
};

/**
 * Extracts keywords from a message and normalizes them
 */
function extractKeywords(text: string): Set<string> {
  const normalized = text.toLowerCase().trim();
  const words = normalized
    .split(/\s+/)
    .filter((w) => w.length > 2); // Filter short words

  return new Set(words);
}

/**
 * Determines the primary topic of a message
 * Returns: 'booking' | 'inquiry' | 'general' | null
 */
function classifyTopic(text: string): string | null {
  const keywords = extractKeywords(text);
  const scores: Record<string, number> = {
    booking: 0,
    inquiry: 0,
    general: 0,
  };

  // Count keyword matches
  for (const [topic, topicKeywords] of Object.entries(TOPIC_KEYWORDS)) {
    for (const keyword of topicKeywords) {
      if (keywords.has(keyword)) {
        scores[topic]++;
      }
    }
  }

  // Find highest score
  const maxScore = Math.max(...Object.values(scores));

  // If no keywords matched, message is likely general/off-topic
  if (maxScore === 0) {
    return 'general';
  }

  // Return topic with highest score
  for (const [topic, score] of Object.entries(scores)) {
    if (score === maxScore) {
      return topic;
    }
  }

  return 'general'; // Default to general if no clear topic
}

/**
 * Calculates similarity between two text segments using keyword overlap
 */
function calculateSimilarity(text1: string, text2: string): number {
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);

  if (keywords1.size === 0 || keywords2.size === 0) return 0;

  const intersection = new Set([...keywords1].filter((x) => keywords2.has(x)));
  const union = new Set([...keywords1, ...keywords2]);

  // Jaccard similarity
  return intersection.size / union.size;
}

/**
 * Detects topic drift in conversation
 *
 * @param messages - Conversation history (ChatMessage[])
 * @param threshold - Confidence threshold (default 0.7)
 * @returns {drifted: boolean, confidence: number}
 *
 * Example:
 *   detectTopicDrift([
 *     {role: 'user', content: 'I want to book a room', timestamp: 0},
 *     {role: 'assistant', content: 'Sure, how many nights?', timestamp: 1},
 *     {role: 'user', content: 'What is the weather like?', timestamp: 2}
 *   ], 0.7)
 *   // Returns: {drifted: true, confidence: 0.85}
 */
export function detectTopicDrift(
  messages: ChatMessage[],
  threshold: number = 0.7
): { drifted: boolean; confidence: number } {
  // Need at least 3 messages to detect drift (user + assistant + user)
  if (messages.length < 3) {
    return { drifted: false, confidence: 0 };
  }

  // Get last user message
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'user');
  if (!lastUserMessage) {
    return { drifted: false, confidence: 0 };
  }

  // Get previous messages for context
  const previousMessages = messages.slice(0, -1);
  if (previousMessages.length === 0) {
    return { drifted: false, confidence: 0 };
  }

  // Determine primary topic from conversation history
  // Only look at USER messages to determine primary topic
  const userMessages = previousMessages.filter((m) => m.role === 'user');

  if (userMessages.length === 0) {
    return { drifted: false, confidence: 0 };
  }

  // Find the most recent non-general topic from user messages
  let primaryTopic: string | null = null;
  for (let i = userMessages.length - 1; i >= 0; i--) {
    const topic = classifyTopic(userMessages[i].content);
    if (topic && topic !== 'general') {
      primaryTopic = topic;
      break;
    }
  }

  // If no specific topic found, use first topic (even if general)
  if (!primaryTopic && userMessages.length > 0) {
    primaryTopic = classifyTopic(userMessages[0].content);
  }

  // If still no primary topic, assume general conversation (no drift possible)
  if (!primaryTopic) {
    return { drifted: false, confidence: 0 };
  }

  // Classify current message topic
  const currentTopic = classifyTopic(lastUserMessage.content);

  // Calculate coherence based on topic matching
  let coherenceScore = 0;

  if (currentTopic === primaryTopic) {
    // Same topic = high coherence
    coherenceScore = 0.95;
  } else if (
    (primaryTopic === 'booking' && currentTopic === 'inquiry') ||
    (primaryTopic === 'inquiry' && currentTopic === 'booking')
  ) {
    // Related topics (booking ↔ inquiry) = medium-high coherence
    coherenceScore = 0.72;
  } else if (currentTopic === 'general' && primaryTopic !== 'general') {
    // General topic = low coherence if primary was specific
    coherenceScore = 0.25;
  } else {
    // Unrelated topics = very low coherence
    coherenceScore = 0.15;
  }

  // Boost coherence only if current message has HIGH keyword overlap with recent context
  const recentContextWindow = previousMessages.slice(-3);
  if (recentContextWindow.length > 0) {
    const contextText = recentContextWindow
      .map((m) => m.content)
      .join(' ');
    const similarity = calculateSimilarity(lastUserMessage.content, contextText);
    // Only boost if similarity is very high (>0.5)
    if (similarity > 0.5) {
      coherenceScore = Math.max(coherenceScore, similarity * 0.85);
    }
  }

  // Calculate drift confidence
  const driftConfidence = 1 - coherenceScore;

  // Detect drift if confidence exceeds threshold
  const drifted = driftConfidence > threshold;

  return {
    drifted,
    confidence: driftConfidence,
  };
}

/**
 * Get topic drift recovery prompt (topic refocus message)
 * Used when drift is detected
 */
export function getTopicRefocusPrompt(language: 'en' | 'ms' | 'zh' | 'ta'): string {
  const prompts: Record<string, string> = {
    en: "I notice we were discussing booking and accommodation topics. Would you like to get back to that, or do you have other questions about Pelangi Capsule Hostel?",
    ms: "Saya perasan kami sedang membincangkan topik tempahan dan penginapan. Adakah anda ingin kembali ke itu, atau adakah anda mempunyai soalan lain tentang Pelangi Capsule Hostel?",
    zh: "我注意到我们在讨论预订和住宿话题。您是否想回到该话题，或者您对彩虹胶囊旅舍有其他问题？",
    ta: "நாங்கள் முன்பு பதிவுசெய்தல் மற்றும் தங்குமிடம் பற்றி பேசினோம். நீங்கள் அதற்குத் திரும்ப விரும்புகிறீர்களா, அல்லது பெலங்கி கேப்சுல் ஹோஸ்டல் பற்றி வேறு கேள்விகள் உள்ளனவா?",
  };

  return prompts[language] || prompts.en;
}
