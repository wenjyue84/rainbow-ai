// ─── Sentiment Analysis + Escalation Tracker ────────────────────────
// Analyzes message sentiment and escalates on consecutive negative messages

import { configStore } from './config-store.js';
import { StateManager } from './state-manager.js';

export type SentimentScore = 'positive' | 'neutral' | 'negative';

interface SentimentState {
  phone: string;
  history: Array<{
    timestamp: number;
    sentiment: SentimentScore;
    message: string;
  }>;
  consecutiveNegative: number;
  lastEscalationAt: number | null;
}

// StateManager with 1-hour TTL (matches conversation TTL) — prevents memory leaks
const sentimentManager = new StateManager<SentimentState>(3_600_000);

// Configuration (loaded from settings)
let CONSECUTIVE_THRESHOLD = 3; // Default: Escalate after 3 consecutive negative (US-822)
const HISTORY_MAX_LENGTH = 10; // Keep last 10 messages
let ESCALATION_COOLDOWN_MS = 30 * 60 * 1000; // Default: 30 min

// Load config from settings
function loadConfig() {
  const settings = configStore.getSettings();
  if (!settings || !settings.sentiment_analysis) return; // Skip if settings not loaded yet
  CONSECUTIVE_THRESHOLD = settings.sentiment_analysis.consecutive_threshold ?? 2;
  ESCALATION_COOLDOWN_MS = (settings.sentiment_analysis.cooldown_minutes ?? 30) * 60 * 1000;
}

// Initialize config
loadConfig();

// Reload config when settings change
configStore.on('reload', (domain: string) => {
  if (domain === 'settings' || domain === 'all') {
    loadConfig();
    console.log(`[Sentiment] Config reloaded: threshold=${CONSECUTIVE_THRESHOLD}, cooldown=${ESCALATION_COOLDOWN_MS / 60000}min`);
  }
});

// ─── Check if Sentiment Analysis is Enabled ────────────────────────
export function isSentimentAnalysisEnabled(): boolean {
  const settings = configStore.getSettings();
  // Guard: if settings not loaded yet, return false (sentiment analysis disabled)
  if (!settings || !settings.sentiment_analysis) {
    return false;
  }
  return settings.sentiment_analysis.enabled !== false;
}

/**
 * US-822: Profile-aware check — uses profile-specific settings object.
 */
export function isSentimentEnabledForProfile(settings: any): boolean {
  if (!settings || !settings.sentiment_analysis) return false;
  return settings.sentiment_analysis.enabled !== false;
}

// ─── Sentiment Analysis ─────────────────────────────────────────────
// Uses keyword-based detection for speed (no LLM required)

const POSITIVE_PATTERNS = [
  // English positive
  'thank', 'thanks', 'great', 'good', 'nice', 'awesome', 'perfect',
  'excellent', 'love', 'appreciate', 'helpful', 'amazing', 'wonderful',
  'fantastic', 'best', 'happy', '😊', '😄', '👍', '❤️', '🙏',

  // Malay positive
  'terima kasih', 'bagus', 'baik', 'ok', 'okay', 'setuju',

  // Chinese positive
  '谢谢', '好', '不错', '很好', '太好了', '感谢'
];

const NEGATIVE_PATTERNS = [
  // English negative - expletives & strong language (checked first for short messages)
  'shit', 'crap', 'damn', 'hell', 'bloody', 'bullshit', 'bs',

  // English negative - complaints & frustration
  'bad', 'terrible', 'awful', 'worst', 'horrible', 'useless',
  'stupid', 'idiot', 'hate', 'angry', 'frustrated', 'frustrating', 'annoying',
  'disappointed', 'waste', 'suck', 'pathetic', 'ridiculous',
  'unacceptable', 'disgust', 'furious', 'outrage', 'demand',

  // English negative - problems & dissatisfaction
  'wrong', 'broken', 'not working', "doesn't work", "don't work",
  'failed', 'error', 'problem', 'issue', 'never', 'always',
  'still not', 'still same', 'same problem', 'again',

  // English negative - cleanliness & maintenance complaints
  'not clean', 'dirty', 'unclean', 'filthy', 'messy',
  'nobody came', "didn't come", 'did not come', 'no one came',
  'not fixed', 'not repaired', 'not resolved', 'still broken',
  'i reported', 'already reported', 'reported it',
  'nobody helped', 'no response', 'ignored',

  // Stronger indicators
  'complaint', 'complain', 'refund', 'cancel', 'lawyer',
  'report you', 'manager', 'speak to manager',

  // Emojis
  '😠', '😡', '🤬', '👎', '💢', '😤', '😒', '🙄',

  // Malay negative
  'teruk', 'buruk', 'tak baik', 'tidak baik', 'masalah',
  'rosak', 'marah', 'kecewa', 'complaint', 'aduan',

  // Chinese negative
  '坏', '差', '糟', '烂', '生气', '失望', '问题', '投诉'
];

const NEUTRAL_BOOST_PATTERNS = [
  // Questions (usually neutral seeking info)
  'what', 'how', 'when', 'where', 'who', 'why', 'can you',
  'could you', 'would you', 'is there', 'do you',

  // Malay questions
  'apa', 'bagaimana', 'bila', 'di mana', 'siapa', 'kenapa',
  'boleh', 'ada',

  // Chinese questions
  '什么', '怎么', '什么时候', '哪里', '谁', '为什么', '可以'
];

export function analyzeSentiment(message: string): SentimentScore {
  const normalized = message.toLowerCase().trim();

  // Count pattern matches
  let positiveScore = 0;
  let negativeScore = 0;
  let neutralBoost = 0;

  // Check positive patterns
  for (const pattern of POSITIVE_PATTERNS) {
    if (normalized.includes(pattern)) {
      positiveScore++;
    }
  }

  // Check negative patterns
  for (const pattern of NEGATIVE_PATTERNS) {
    if (normalized.includes(pattern)) {
      negativeScore++;
    }
  }

  // Check neutral boost patterns
  for (const pattern of NEUTRAL_BOOST_PATTERNS) {
    if (normalized.includes(pattern)) {
      neutralBoost++;
    }
  }

  // Determine sentiment
  // Negative gets priority if present
  if (negativeScore > 0 && negativeScore > positiveScore) {
    return 'negative';
  }

  // Positive if clearly positive
  if (positiveScore > 0 && positiveScore > negativeScore) {
    return 'positive';
  }

  // Neutral boost (questions) → likely neutral
  if (neutralBoost > 0 && positiveScore === 0 && negativeScore === 0) {
    return 'neutral';
  }

  // Default to neutral if no clear signal
  return 'neutral';
}

// ─── Track Sentiment ────────────────────────────────────────────────
export function trackSentiment(
  phone: string,
  message: string,
  sentiment: SentimentScore
): void {
  // StateManager.getOrCreate() handles TTL checking and creates if needed
  const state = sentimentManager.getOrCreate(phone, () => ({
    phone,
    history: [],
    consecutiveNegative: 0,
    lastEscalationAt: null
  }));

  // Add to history
  state.history.push({
    timestamp: Date.now(),
    sentiment,
    message: message.slice(0, 100) // Store first 100 chars
  });

  // Trim history if too long
  if (state.history.length > HISTORY_MAX_LENGTH) {
    state.history = state.history.slice(-HISTORY_MAX_LENGTH);
  }

  // Update consecutive negative counter
  if (sentiment === 'negative') {
    state.consecutiveNegative++;
  } else {
    state.consecutiveNegative = 0; // Reset on any non-negative
  }
}

// ─── Should Escalate? ───────────────────────────────────────────────
export function shouldEscalateOnSentiment(phone: string): {
  shouldEscalate: boolean;
  reason: string | null;
  consecutiveCount: number;
} {
  return shouldEscalateOnSentimentForProfile(phone);
}

/**
 * US-822: Profile-aware escalation check.
 * Accepts optional profile-specific settings to use profile threshold/cooldown.
 */
export function shouldEscalateOnSentimentForProfile(phone: string, profileSettings?: any): {
  shouldEscalate: boolean;
  reason: string | null;
  consecutiveCount: number;
} {
  const state = sentimentManager.get(phone);

  if (!state) {
    return { shouldEscalate: false, reason: null, consecutiveCount: 0 };
  }

  // Use profile-specific or global settings
  const sa = profileSettings?.sentiment_analysis;
  const threshold = sa?.consecutive_threshold ?? CONSECUTIVE_THRESHOLD;
  const cooldownMs = sa?.cooldown_minutes != null
    ? sa.cooldown_minutes * 60 * 1000
    : ESCALATION_COOLDOWN_MS;

  // Check if we escalated recently (cooldown)
  if (state.lastEscalationAt) {
    const timeSinceEscalation = Date.now() - state.lastEscalationAt;
    if (timeSinceEscalation < cooldownMs) {
      console.log(
        `[Sentiment] Cooldown active for ${phone} ` +
        `(${Math.round(timeSinceEscalation / 1000)}s since last escalation)`
      );
      return { shouldEscalate: false, reason: null, consecutiveCount: state.consecutiveNegative };
    }
  }

  // Escalate if threshold reached
  if (state.consecutiveNegative >= threshold) {
    return {
      shouldEscalate: true,
      reason: 'sentiment',
      consecutiveCount: state.consecutiveNegative
    };
  }

  return { shouldEscalate: false, reason: null, consecutiveCount: state.consecutiveNegative };
}

// ─── Mark Escalation Sent ───────────────────────────────────────────
export function markSentimentEscalation(phone: string): void {
  const state = sentimentManager.get(phone);
  if (state) {
    state.lastEscalationAt = Date.now();
    state.consecutiveNegative = 0; // Reset counter after escalation
  }
}

// ─── Reset State (when staff replies) ──────────────────────────────
export function resetSentimentTracking(phone: string): void {
  const state = sentimentManager.get(phone);
  if (state) {
    state.consecutiveNegative = 0;
    console.log(`[Sentiment] Reset tracking for ${phone} (staff replied)`);
  }
}

// ─── Get Sentiment History (for debugging) ─────────────────────────
export function getSentimentHistory(phone: string): Array<{
  timestamp: number;
  sentiment: SentimentScore;
  message: string;
}> {
  const state = sentimentManager.get(phone);
  return state?.history ?? [];
}

// ─── Get Sentiment Stats (for analytics) ───────────────────────────
export function getSentimentStats(phone: string): {
  consecutiveNegative: number;
  lastEscalationAt: number | null;
  recentSentiments: SentimentScore[];
} | null {
  const state = sentimentManager.get(phone);
  if (!state) return null;

  return {
    consecutiveNegative: state.consecutiveNegative,
    lastEscalationAt: state.lastEscalationAt,
    recentSentiments: state.history.slice(-5).map(h => h.sentiment)
  };
}
