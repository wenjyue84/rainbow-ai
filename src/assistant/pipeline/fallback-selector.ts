/**
 * Confidence-Tiered Fallback Response Selector (US-412)
 *
 * Selects profile-specific fallback responses based on confidence score buckets.
 * Prevents cross-profile contamination — each profile gets only its own responses.
 *
 * Tier 0 (conf < 0.3):  escalate to human staff
 * Tier 1 (0.3 <= conf < 0.6): uncertain response with disclaimer
 * Tier 2 (conf >= 0.6): full response
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lazy-loaded fallback responses (avoid re-reading on every call)
let _fallbackResponses: Record<string, ProfileTiers> | null = null;

interface TierResponse {
  en: string;
  ms?: string;
  zh?: string;
  ta?: string;
  [lang: string]: string | undefined;
}

interface ProfileTiers {
  tier0: TierResponse;
  tier1: TierResponse;
  tier2: TierResponse;
}

export type ConfidenceTier = 'tier0' | 'tier1' | 'tier2';

export interface FallbackSelection {
  tier: ConfidenceTier;
  response: string;
  profileId: string;
  language: string;
}

/**
 * Load fallback-responses.json from the data directory.
 * Resolves relative to this file's location regardless of cwd.
 */
function loadFallbackResponses(): Record<string, ProfileTiers> {
  if (_fallbackResponses) return _fallbackResponses;

  const dataPath = path.join(__dirname, '..', 'data', 'fallback-responses.json');
  _fallbackResponses = require(dataPath) as Record<string, ProfileTiers>;
  return _fallbackResponses;
}

/**
 * Normalise a profile ID to the key used in fallback-responses.json.
 * e.g. "pelangi-capsule" → "pelangi", "makan-moments-kl" → "makan-moments"
 */
function normaliseProfileId(profileId: string): string {
  if (profileId.startsWith('makan')) return 'makan-moments';
  if (profileId.startsWith('pelangi')) return 'pelangi';
  if (profileId.startsWith('southern')) return 'southern';
  return profileId;
}

/**
 * Determine the confidence tier from a numeric score.
 */
export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence < 0.3) return 'tier0';
  if (confidence < 0.6) return 'tier1';
  return 'tier2';
}

/**
 * Select a fallback response for the given confidence score and profile.
 * Guarantees profile isolation — only reads data for the specified profile.
 *
 * @param confidence  0–1 confidence score from intent classifier
 * @param profileId   Profile identifier (e.g. "pelangi", "makan-moments")
 * @param language    ISO 639-1 language code (default: "en")
 */
export function selectFallbackResponse(
  confidence: number,
  profileId: string,
  language: string = 'en'
): FallbackSelection {
  const tier = getConfidenceTier(confidence);
  const normProfile = normaliseProfileId(profileId);
  const responses = loadFallbackResponses();

  const profileData = responses[normProfile];
  if (!profileData) {
    // Unknown profile — return a safe generic message without leaking other profiles
    return {
      tier,
      response: 'Sorry, I am unable to assist with that right now. Please contact our team.',
      profileId: normProfile,
      language
    };
  }

  const tierData = profileData[tier];
  const response = tierData[language] ?? tierData['en'];

  return {
    tier,
    response,
    profileId: normProfile,
    language
  };
}
