import type { IntentResult, ChatMessage } from './types.js';
import { classifyIntent as llmClassify } from './ai-client.js';
import { FuzzyIntentMatcher, type KeywordIntent } from './fuzzy-matcher.js';
import { FuzzyKeywordMatcher } from './utils/fuzzy-matcher.js';
import { logFuzzyMatch } from './utils/fuzzy-match-logger.js';
import { languageRouter } from './language-router.js';
import { getSemanticMatcher, type IntentExamples } from './semantic-matcher.js';
import { getIntentConfig, buildIntentThresholdMap, checkTierThreshold } from './intent-config.js';
import intentKeywordsData from './data/intent-keywords.json' with { type: 'json' };
import intentExamplesData from './data/intent-examples.json' with { type: 'json' };
import intentsJsonData from './data/intents.json' with { type: 'json' };
import intentSynonymsData from './data/intent-synonyms.json' with { type: 'json' };
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { keywordMatchCache } from '../lib/keyword-match-cache.js';

// Re-export public API from extracted modules (keeps all imports from './intents.js' working)
export { isEmergency, getEmergencyIntent, getRegexDeflection } from './emergency-patterns.js';
export type { MultiIntentResult } from './multi-intent.js';

import { loadEmergencyPatternsFromFile, getEmergencyIntent, getRegexDeflection } from './emergency-patterns.js';
import { mapLLMIntentToSpecific } from './llm-intent-mapper.js';
import { tryMultiIntentSplit, correctCheckInFalsePositive } from './multi-intent.js';
import { buildClassificationTrace, recordClassificationTrace } from './classification-tracer.js';
import { applyLanguageWeight, buildIntentWeightsMap, type KeywordWeights } from './classifier/keyword-weights.js';
import { detectKeywordContradictions, type TopScore } from './classifier/contradiction-detector.js';

// ─── Context-Aware Intent Classification Helpers (US-584) ──────────

/**
 * Extract the last 2-3 intent classifications from conversation history
 * US-584: Returns array of previous intent strings for context-aware boosting
 */
function getPreviousIntents(history: ChatMessage[], windowSize: number = 3): string[] {
  const previousIntents: string[] = [];

  // Scan history backwards (most recent first)
  for (let i = history.length - 1; i >= 0 && previousIntents.length < windowSize; i--) {
    const msg = history[i] as any; // ChatMessage may have intent field from DB
    if (msg.intent && msg.intent !== 'unknown' && typeof msg.intent === 'string') {
      previousIntents.unshift(msg.intent); // Prepend to maintain chronological order
    }
  }

  return previousIntents;
}

/**
 * Check if text contains temporal keywords related to booking duration
 * US-584: Detects phrases like "3 nights", "7 days", "2 weeks"
 * Supports English, Malay, Mandarin, and other languages
 */
function hasTemporalKeywords(text: string): boolean {
  // Pattern: number + optional space + temporal keyword
  // Works with ASCII (nights, days, weeks, hari, minggu) and non-ASCII (晚, 天, 周)
  const temporalPattern = /\d+\s*(nights?|days?|weeks?|hari|minggu|晚|天|周|nacht|مساء|رات|ہفتوں)/i;
  return temporalPattern.test(text);
}

/**
 * Apply context-aware boosting to classification result
 * US-584: Boosts booking_confirmation by 18% when previous intent is booking_inquiry
 * and current message contains temporal keywords
 */
function applyContextAwareBoost(
  result: IntentResult,
  text: string,
  previousIntents: string[]
): IntentResult {
  // Check conditions for booking confirmation boost
  const hasPreviousBookingInquiry = previousIntents.includes('booking_inquiry') ||
                                     previousIntents.includes('booking');
  const hasTemporalContent = hasTemporalKeywords(text);

  // Only boost if:
  // 1. Current classification is booking_confirmation or booking
  // 2. Previous intent was booking_inquiry or booking
  // 3. Message has temporal keywords
  if (
    (result.category === 'booking_confirmation' || result.category === 'booking') &&
    hasPreviousBookingInquiry &&
    hasTemporalContent
  ) {
    const boostedConfidence = Math.min(1.0, result.confidence * 1.18); // 18% boost
    console.log(
      `[Intent] 🚀 US-584 Context boost applied: ${result.category} ` +
      `(${(result.confidence * 100).toFixed(0)}% → ${(boostedConfidence * 100).toFixed(0)}%) ` +
      `[prev: ${previousIntents[previousIntents.length - 1] || 'none'}, temporal: yes]`
    );
    return {
      ...result,
      confidence: boostedConfidence,
    };
  }

  return result;
}

// ─── Fuzzy Keyword Matcher (with Profile Support) ────────────

let fuzzyMatcher: FuzzyIntentMatcher | null = null;
const fuzzyMatchersByProfile = new Map<string, FuzzyIntentMatcher>();

// US-572: Per-profile intent → keyword_weights map (built alongside fuzzy matchers)
const intentWeightsByProfile = new Map<string, Map<string, KeywordWeights>>();

/**
 * US-525: Load intent keywords for a profile.
 * Checks for profile-specific file first (intent-keywords-{profile}.json),
 * then falls back to default intent-keywords.json
 */
function loadIntentKeywords(profileId: string = 'pelangi'): any {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const profileSpecificPath = join(dataDir, `intent-keywords-${profileId}.json`);
  const defaultPath = join(dataDir, 'intent-keywords.json');

  if (existsSync(profileSpecificPath)) {
    try {
      const content = readFileSync(profileSpecificPath, 'utf-8');
      console.log(`[Intents:US-525] Loaded profile-specific keywords for "${profileId}"`);
      return JSON.parse(content);
    } catch (err: any) {
      console.warn(`[Intents:US-525] Failed to load profile-specific keywords: ${err.message}, falling back to default`);
    }
  }

  try {
    const content = readFileSync(defaultPath, 'utf-8');
    console.log(`[Intents:US-525] Loaded default keywords (profile: "${profileId}")`);
    return JSON.parse(content);
  } catch (err: any) {
    console.error(`[Intents:US-525] Failed to load default keywords: ${err.message}`);
    return intentKeywordsData; // fallback to import
  }
}

/**
 * US-563: Load intent synonyms from file (or fallback to import)
 * Attempts to load from disk first, then falls back to imported JSON
 */
function loadIntentSynonyms(): any {
  const dataDir = join(process.cwd(), 'src', 'assistant', 'data');
  const synonymsPath = join(dataDir, 'intent-synonyms.json');

  if (existsSync(synonymsPath)) {
    try {
      const content = readFileSync(synonymsPath, 'utf-8');
      console.log('[Intents:US-563] Loaded intent synonyms from disk');
      return JSON.parse(content);
    } catch (err: any) {
      console.warn(`[Intents:US-563] Failed to load synonyms from disk: ${err.message}, using default`);
    }
  }

  console.log('[Intents:US-563] Using default intent synonyms');
  return intentSynonymsData;
}

/**
 * US-563: Merge primary keywords with synonyms for an intent
 * Combines keywords and synonyms (weighted equally) into a single keyword list
 */
function mergeKeywordsAndSynonyms(
  intentName: string,
  primaryKeywords: string[],
  synonymsData: any
): string[] {
  // Find synonyms for this intent
  const intentSynonym = synonymsData.intents?.find((s: any) => s.intent === intentName);
  if (!intentSynonym || !intentSynonym.synonyms) {
    return primaryKeywords; // No synonyms, return primary keywords only
  }

  // Merge primary keywords with synonyms (weighted equally)
  const mergedKeywords = [...primaryKeywords];
  for (const [lang, syns] of Object.entries(intentSynonym.synonyms)) {
    mergedKeywords.push(...(syns as string[]));
  }

  // Return deduplicated list (case-insensitive)
  const seen = new Set<string>();
  return mergedKeywords.filter(kw => {
    const lower = kw.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

function initFuzzyMatcherForProfile(keywordIntents: KeywordIntent[]): FuzzyIntentMatcher {
  const matcher = new FuzzyIntentMatcher(keywordIntents);
  console.log('[Intents] Fuzzy matcher initialized with', keywordIntents.length, 'keyword groups');
  return matcher;
}

function initFuzzyMatcher(profileKeywordData?: any): void {
  const keywordData = profileKeywordData || intentKeywordsData;
  const synonymsData = loadIntentSynonyms();
  const keywordIntents: KeywordIntent[] = [];

  for (const intent of keywordData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords)) {
      // US-563: Merge synonyms with primary keywords
      const mergedKeywords = mergeKeywordsAndSynonyms(
        intent.intent,
        keywords as string[],
        synonymsData
      );
      keywordIntents.push({
        intent: intent.intent,
        keywords: mergedKeywords,
        language: lang as 'en' | 'ms' | 'zh' | 'ta'
      });
    }

    // US-053: Include regional variants if they exist
    if ((intent as any).regional_variants) {
      for (const [lang, variants] of Object.entries((intent as any).regional_variants)) {
        // US-563: Also merge synonyms into regional variants
        const mergedVariants = mergeKeywordsAndSynonyms(
          intent.intent,
          variants as string[],
          synonymsData
        );
        keywordIntents.push({
          intent: intent.intent,
          keywords: mergedVariants,
          language: lang as 'en' | 'ms' | 'zh' | 'ta'
        });
      }
    }
  }

  fuzzyMatcher = initFuzzyMatcherForProfile(keywordIntents);
  console.log('[Intents] Fuzzy matcher initialized with', keywordIntents.length, 'keyword groups (includes full_price_list, US-563: synonyms merged)');
}

/**
 * Get or create a fuzzy matcher for a specific profile
 * US-525: Per-profile intent keyword configuration
 * US-563: Merge synonyms with primary keywords
 */
function getFuzzyMatcherForProfile(profileId: string = 'pelangi'): FuzzyIntentMatcher {
  if (fuzzyMatchersByProfile.has(profileId)) {
    return fuzzyMatchersByProfile.get(profileId)!;
  }

  const keywordData = loadIntentKeywords(profileId);
  const synonymsData = loadIntentSynonyms();
  const keywordIntents: KeywordIntent[] = [];

  for (const intent of keywordData.intents) {
    for (const [lang, keywords] of Object.entries(intent.keywords)) {
      // US-563: Merge synonyms with primary keywords
      const mergedKeywords = mergeKeywordsAndSynonyms(
        intent.intent,
        keywords as string[],
        synonymsData
      );
      keywordIntents.push({
        intent: intent.intent,
        keywords: mergedKeywords,
        language: lang as 'en' | 'ms' | 'zh' | 'ta'
      });
    }

    // US-053: Include regional variants if they exist
    if ((intent as any).regional_variants) {
      for (const [lang, variants] of Object.entries((intent as any).regional_variants)) {
        // US-563: Also merge synonyms into regional variants
        const mergedVariants = mergeKeywordsAndSynonyms(
          intent.intent,
          variants as string[],
          synonymsData
        );
        keywordIntents.push({
          intent: intent.intent,
          keywords: mergedVariants,
          language: lang as 'en' | 'ms' | 'zh' | 'ta'
        });
      }
    }
  }

  const matcher = initFuzzyMatcherForProfile(keywordIntents);
  fuzzyMatchersByProfile.set(profileId, matcher);

  // US-572: Build intent weights map for this profile
  const weightsMap = buildIntentWeightsMap(keywordData);
  intentWeightsByProfile.set(profileId, weightsMap);

  return matcher;
}

// ─── Init (enhanced with fuzzy + semantic matching) ────────────────

export async function initIntents(): Promise<void> {
  await loadEmergencyPatternsFromFile();
  initFuzzyMatcher();

  // US-533: Invalidate keyword match cache whenever intents are re-initialized
  keywordMatchCache.invalidateAll();
  console.log('[KeywordCache-US533] Cache invalidated on intent re-init');

  // Build per-intent threshold map (Layer 1)
  buildIntentThresholdMap(intentsJsonData);

  // Initialize semantic matcher (Phase 3 - async, takes 5-10 seconds)
  const semanticMatcher = getSemanticMatcher();
  const intentExamples = intentExamplesData.intents as IntentExamples[];

  // Initialize in background (don't block startup)
  semanticMatcher.initialize(intentExamples).then(() => {
    const stats = semanticMatcher.getStats();
    console.log(
      `[Intents] Semantic matcher ready: ${stats.totalIntents} intents, ` +
      `${stats.totalExamples} examples`
    );
  }).catch(error => {
    console.error('[Intents] Semantic matcher initialization failed:', error);
  });

  console.log('[Intents] Hybrid mode: Emergency → Fuzzy → Semantic → LLM');
}

// ─── Main Classification Function (Enhanced with 4-tier system + Config) ─────

/**
 * Classify intent using configurable 4-tier system with context awareness:
 * 1. Emergency patterns (regex) - highest priority
 * 2. Fuzzy keyword matching with context - fast path (<5ms)
 * 3. Semantic similarity with context - medium path (50-200ms)
 * 4. LLM classification with configurable context - fallback for complex queries
 *
 * @param text - User message text
 * @param history - Previous messages for context
 * @param lastIntent - Last detected intent
 * @param preferredLanguage - Stored language preference from conversation metadata (US-119)
 * @param conversationId - Optional conversation ID for classification tracing (US-122)
 * @param profileId - Optional profile ID for US-525 per-profile keyword configuration (default: 'pelangi')
 */
export async function classifyMessageWithContext(
  text: string,
  history: ChatMessage[] = [],
  lastIntent: string | null = null,
  preferredLanguage?: string,
  conversationId?: string,
  profileId: string = 'pelangi'
): Promise<IntentResult> {
  const config = getIntentConfig();
  const currentMatcher = getFuzzyMatcherForProfile(profileId);

  // US-122: Collect tier candidates for classification tracing
  const tierCandidates: Array<{ intent: string; score: number; matchedKeyword?: string; matchedExample?: string }> = [];

  // US-122: Helper to trace and return result
  function traceAndReturn(result: IntentResult, tieBreakReason?: string): IntentResult {
    if (conversationId) {
      try {
        const trace = buildClassificationTrace({
          conversationId,
          inputText: text,
          detectedLanguage: detectedLang || 'unknown',
          chosenIntent: result.category,
          chosenConfidence: result.confidence,
          chosenSource: result.source,
          matchedKeyword: result.matchedKeyword,
          matchedExample: result.matchedExample,
          fuzzyResults: tierCandidates.filter(c => c.matchedKeyword !== undefined),
          semanticResults: tierCandidates.filter(c => c.matchedExample !== undefined),
          llmResult: tierCandidates.find(c => !c.matchedKeyword && !c.matchedExample)
            ? { category: tierCandidates.find(c => !c.matchedKeyword && !c.matchedExample)!.intent, confidence: tierCandidates.find(c => !c.matchedKeyword && !c.matchedExample)!.score }
            : undefined,
          tieBreakReason,
        });
        recordClassificationTrace(trace);
      } catch (err) {
        // Never let tracing break classification
      }
    }
    // US-584: Apply context-aware boosting for booking confirmation
    const previousIntents = getPreviousIntents(history);
    let boostedResult = applyContextAwareBoost(result, text, previousIntents);

    // US-395: Attach top-3 alternative intents (excluding the chosen one) for confidence gating context
    const alternatives = tierCandidates
      .filter(c => c.intent !== boostedResult.category)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(c => ({ intent: c.intent, confidence: c.score }));
    return alternatives.length > 0 ? { ...boostedResult, alternatives } : boostedResult;
  }

  // TIER 0: Language Detection
  const detectedLang = languageRouter.detectLanguage(text);
  const langName = languageRouter.getLanguageName(detectedLang);

  // US-119: Use preferred language if available, otherwise use detected language
  const effectiveLang = (preferredLanguage && (preferredLanguage as any) !== 'unknown')
    ? (preferredLanguage as any)
    : detectedLang;

  console.log(`[Intent] 🌍 Language: ${langName} (${detectedLang})${preferredLanguage ? ` [preferred: ${preferredLanguage}]` : ''}`);

  // US-062: Mandarin classifier — when zh detected, route through
  // language-filtered fuzzy match with Mandarin keyword variants
  if (detectedLang === 'zh') {
    console.log('[Intent] 🀄 Mandarin detected — using zh keyword variants for classification');
  }

  // PRE-PROCESSING: Deduplicate heavily repeated words (e.g., "hello hello hello" → "hello")
  let processedText = text;
  const words = text.trim().split(/\s+/);
  if (words.length >= 3) {
    const wordCounts: Record<string, number> = {};
    for (const w of words) wordCounts[w.toLowerCase()] = (wordCounts[w.toLowerCase()] || 0) + 1;
    // If one word makes up 80%+ of the message, deduplicate to just that word
    for (const [word, count] of Object.entries(wordCounts)) {
      if (count / words.length >= 0.8) {
        processedText = word;
        console.log(`[Intent] 🔄 Dedup: "${text}" → "${processedText}"`);
        break;
      }
    }
  }

  // TIER 1: Emergency check (always enabled, always single message)
  if (config.tiers.tier1_emergency.enabled) {
    const emergencyIntent = getEmergencyIntent(text);
    if (emergencyIntent !== null) {
      console.log(`[Intent] 🚨 EMERGENCY detected (regex) → ${emergencyIntent}`);
      return traceAndReturn({
        category: emergencyIntent as any,
        confidence: 1.0,
        entities: { emergency: 'true' },
        source: 'regex',
        detectedLanguage: detectedLang
      }, 'Emergency/regex pattern matched — highest priority tier');
    }
    // Check for non-emergency regex deflections (e.g., prompt injection → greeting)
    const deflection = getRegexDeflection(text);
    if (deflection !== null) {
      console.log(`[Intent] 🛡️ Regex deflection → ${deflection}`);
      return traceAndReturn({
        category: deflection as any,
        confidence: 1.0,
        entities: {},
        source: 'regex',
        detectedLanguage: detectedLang
      }, 'Regex deflection pattern matched');
    }
  }

  // TIER 2: Fuzzy keyword matching WITH CONTEXT
  // US-119: Use effective language (preferred or detected) for keyword filtering
  // US-533: Check keyword match cache before running fuzzy similarity computations
  let fuzzyHighConfidenceResult: IntentResult | null = null;
  if (config.tiers.tier2_fuzzy.enabled && currentMatcher) {
    const contextSize = config.tiers.tier2_fuzzy.contextMessages;
    const context = history.slice(-contextSize);
    const languageFilter = effectiveLang !== 'unknown' ? effectiveLang : undefined;

    // US-533: Cache lookup — skip fuzzy computation for repeated phrases
    const cacheKey = `${profileId}:${processedText}`;
    const cachedMatch = keywordMatchCache.get(cacheKey);
    if (cachedMatch) {
      console.log(
        `[KeywordCache-US533] Cache HIT for phrase "${processedText.slice(0, 40)}" ` +
        `→ ${cachedMatch.intent} (${(cachedMatch.confidence * 100).toFixed(0)}%)`
      );
      return traceAndReturn({
        category: cachedMatch.intent as any,
        confidence: cachedMatch.confidence,
        entities: {},
        source: 'fuzzy',
        matchedKeyword: cachedMatch.matchedKeyword,
        detectedLanguage: detectedLang,
      }, 'T2 keyword cache hit (US-533)');
    }
    console.log(`[KeywordCache-US533] Cache MISS for phrase "${processedText.slice(0, 40)}"`);

    const fuzzyResult = currentMatcher.matchWithContext(
      processedText,
      context,
      lastIntent,
      languageFilter
    );

    // US-122: Collect fuzzy candidates for tracing
    if (fuzzyResult) {
      tierCandidates.push({
        intent: fuzzyResult.intent,
        score: fuzzyResult.score,
        matchedKeyword: fuzzyResult.matchedKeyword,
      });

      // Also collect top alternatives from the matcher
      const allFuzzy = currentMatcher.getTopMatches?.(processedText, 3, languageFilter);
      if (allFuzzy) {
        for (const alt of allFuzzy) {
          if (alt.intent !== fuzzyResult.intent) {
            tierCandidates.push({ intent: alt.intent, score: alt.score, matchedKeyword: alt.matchedKeyword });
          }
        }
      }

      // US-573: Detect keyword contradictions (ambiguous messages)
      // Check if multiple intents have scores within 15% of top score
      const allMatches: TopScore[] = [fuzzyResult, ...(allFuzzy || [])];
      const contradictionCheck = detectKeywordContradictions(processedText, allMatches);

      if (contradictionCheck.hasContradiction) {
        console.log(
          `[Intent:US-573] Ambiguous message detected: ${contradictionCheck.conflicting_intents.join(', ')} ` +
          `all within 15% of top score`
        );

        // Return clarification-required intent with conflicting intents for UI display
        return traceAndReturn({
          category: 'clarification-required' as any,
          confidence: 0.5, // Neutral confidence for clarification
          entities: {
            conflicting_intents: contradictionCheck.conflicting_intents.join(', '),
            top_scores: JSON.stringify(contradictionCheck.top_scores),
          },
          source: 'fuzzy',
          detectedLanguage: detectedLang
        }, `Keyword contradiction detected: ${contradictionCheck.conflicting_intents.join(', ')}`);
      }
    }

    // US-572: Apply language-specific weight multiplier to score before threshold comparison
    let weightedFuzzyScore = fuzzyResult?.score ?? 0;
    if (fuzzyResult) {
      const profileWeights = intentWeightsByProfile.get(profileId);
      const intentWeights = profileWeights?.get(fuzzyResult.intent);
      if (intentWeights) {
        weightedFuzzyScore = applyLanguageWeight(fuzzyResult.score, effectiveLang, intentWeights);
        if (weightedFuzzyScore !== fuzzyResult.score) {
          console.log(
            `[Intent:US-572] Language weight applied: "${fuzzyResult.intent}" ` +
            `lang=${effectiveLang} score=${fuzzyResult.score.toFixed(3)} → ${weightedFuzzyScore.toFixed(3)}`
          );
        }
      }
    }

    if (fuzzyResult && checkTierThreshold(
      fuzzyResult.intent,
      weightedFuzzyScore,
      config.tiers.tier2_fuzzy.threshold,
      't2'
    )) {
      const correctedIntent = correctCheckInFalsePositive(fuzzyResult.intent, processedText);
      const finalIntent = correctedIntent ?? fuzzyResult.intent;
      const finalConfidence = correctedIntent ? 0.88 : fuzzyResult.score;
      if (correctedIntent) {
        console.log(`[Intent] ⚠️ T2 false-positive corrected: ${fuzzyResult.intent} → ${correctedIntent} (post-checkout context)`);
      } else {
        console.log(
          `[Intent] ⚡ FUZZY match: ${fuzzyResult.intent} ` +
          `(${(fuzzyResult.score * 100).toFixed(0)}% - keyword: "${fuzzyResult.matchedKeyword}")` +
          (fuzzyResult.contextBoost ? ' [CONTEXT BOOST]' : '')
        );
      }

      // US-533: Store successful match in cache
      keywordMatchCache.set(cacheKey, {
        intent: finalIntent,
        confidence: finalConfidence,
        matchedKeyword: fuzzyResult.matchedKeyword,
      });

      return traceAndReturn({
        category: finalIntent as any,
        confidence: finalConfidence,
        entities: {},
        source: 'fuzzy',
        matchedKeyword: fuzzyResult.matchedKeyword,
        detectedLanguage: detectedLang
      }, `Fuzzy keyword match above threshold (keyword: "${fuzzyResult.matchedKeyword}")`);
    }

    // US-155: Skip semantic match if fuzzy confidence is already high (saves 100-300ms)
    if (fuzzyResult && fuzzyResult.score >= 0.85) {
      const correctedHigh = correctCheckInFalsePositive(fuzzyResult.intent, processedText);
      const finalHighIntent = correctedHigh ?? fuzzyResult.intent;
      const finalHighConfidence = correctedHigh ? 0.88 : fuzzyResult.score;
      if (correctedHigh) {
        console.log(`[Intent] ⚠️ T2 high-confidence false-positive corrected: ${fuzzyResult.intent} → ${correctedHigh}`);
      } else {
        console.log(
          `[Intent] ⚡ FUZZY high-confidence shortcut: ${fuzzyResult.intent} ` +
          `(${(fuzzyResult.score * 100).toFixed(0)}% >= 85%) — skipping semantic tier`
        );
      }

      // US-533: Store high-confidence match in cache
      keywordMatchCache.set(cacheKey, {
        intent: finalHighIntent,
        confidence: finalHighConfidence,
        matchedKeyword: fuzzyResult.matchedKeyword,
      });

      fuzzyHighConfidenceResult = {
        category: finalHighIntent as any,
        confidence: finalHighConfidence,
        entities: {},
        source: 'fuzzy',
        matchedKeyword: fuzzyResult.matchedKeyword,
        detectedLanguage: detectedLang
      };
    }

    // Log if close but not confident enough
    if (fuzzyResult && fuzzyResult.score > 0.60 && fuzzyResult.score < config.tiers.tier2_fuzzy.threshold && !fuzzyHighConfidenceResult) {
      console.log(
        `[Intent] 🔸 Fuzzy match below threshold: ${fuzzyResult.intent} ` +
        `(${(fuzzyResult.score * 100).toFixed(0)}%), trying semantic...`
      );
    }
  }

  // US-456: Levenshtein Distance Fuzzy Keyword Matcher for Typo Tolerance & Logging
  // Enhanced fuzzy matching with Levenshtein distance for improved typo tolerance
  // Logs all matches ≥85% similarity to fuzzy-matches.jsonl for keyword improvement analysis
  try {
    const levMatcher = new FuzzyKeywordMatcher();
    const words = processedText.toLowerCase().split(/\s+/);

    for (const word of words) {
      // Collect all keywords from all intents for matching
      const allKeywords: string[] = [];
      for (const intent of intentKeywordsData.intents) {
        for (const keywordList of Object.values(intent.keywords)) {
          allKeywords.push(...(keywordList as string[]));
        }
      }

      // Find matches with ≥85% similarity using Levenshtein distance
      const match = levMatcher.match(word, allKeywords, 0.85);
      if (match) {
        // Log the fuzzy match for keyword improvement analysis
        logFuzzyMatch(match);
        console.log(`[Intent] 📊 US-456 Levenshtein match logged: "${match.original}" → "${match.matched}" (${(match.similarity * 100).toFixed(0)}%)`);
      }
    }
  } catch (err) {
    // Non-fatal: Levenshtein logging should not block classification
    console.debug('[Intent] US-456 Levenshtein logging failed:', err instanceof Error ? err.message : err);
  }

  // US-155: If fuzzy had high confidence (>= 0.85), skip semantic tier entirely
  if (fuzzyHighConfidenceResult) {
    return traceAndReturn(fuzzyHighConfidenceResult, 'Fuzzy high-confidence shortcut (>= 85%)');
  }

  // TIER 3: Semantic similarity matching WITH CONTEXT
  if (config.tiers.tier3_semantic.enabled) {
    const semanticMatcher = getSemanticMatcher();
    if (semanticMatcher.isReady()) {
      const semanticResult = await semanticMatcher.match(processedText, config.tiers.tier3_semantic.threshold);

      // US-122: Collect semantic candidates for tracing
      if (semanticResult) {
        tierCandidates.push({
          intent: semanticResult.intent,
          score: semanticResult.score,
          matchedExample: semanticResult.matchedExample,
        });

        // Also collect top alternatives from semantic matcher (up to 2 more for top-3)
        const allSemantic = await semanticMatcher.matchAll(processedText, 0.5);
        if (allSemantic) {
          let altCount = 0;
          for (const alt of allSemantic) {
            if (alt.intent !== semanticResult.intent && altCount < 2) {
              tierCandidates.push({ intent: alt.intent, score: alt.score, matchedExample: alt.matchedExample });
              altCount++;
            }
          }
        }
      }

      if (semanticResult && checkTierThreshold(
        semanticResult.intent,
        semanticResult.score,
        config.tiers.tier3_semantic.threshold,
        't3'
      )) {
        console.log(
          `[Intent] 🔬 SEMANTIC match: ${semanticResult.intent} ` +
          `(${(semanticResult.score * 100).toFixed(0)}% - similar to: "${semanticResult.matchedExample}")`
        );

        return traceAndReturn({
          category: semanticResult.intent as any,
          confidence: semanticResult.score,
          entities: {},
          source: 'semantic',
          matchedExample: semanticResult.matchedExample,
          detectedLanguage: detectedLang
        }, `Semantic similarity above threshold (example: "${semanticResult.matchedExample}")`);
      }

      // Log if close but not confident enough
      if (semanticResult && semanticResult.score > 0.60 && semanticResult.score < config.tiers.tier3_semantic.threshold) {
        console.log(
          `[Intent] 🔸 Semantic match below threshold: ${semanticResult.intent} ` +
          `(${(semanticResult.score * 100).toFixed(0)}%), falling back to LLM`
        );
      }
    }
  }

  // TIER 4: LLM classification WITH CONFIGURABLE CONTEXT (+ timeout fallback US-046)
  if (config.tiers.tier4_llm.enabled) {
    try {
      const contextSize = config.tiers.tier4_llm.contextMessages;
      const context = history.slice(-contextSize);

      // US-046: Wrap LLM call with configurable timeout (default 8s)
      const LLM_TIMEOUT_MS = 8000;
      let llmResult: Awaited<ReturnType<typeof llmClassify>>;
      let llmTimedOut = false;
      try {
        llmResult = await Promise.race([
          llmClassify(processedText, context),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('LLM_TIMEOUT')), LLM_TIMEOUT_MS)
          )
        ]);
      } catch (timeoutErr: any) {
        if (timeoutErr?.message === 'LLM_TIMEOUT') {
          llmTimedOut = true;
          console.warn(`[Intent] ⏱️ LLM timeout (${LLM_TIMEOUT_MS}ms) for: "${text.slice(0, 60)}"`);
          // Fallback: try semantic with lower threshold, then fuzzy with relaxed scoring
          if (config.tiers.tier3_semantic.enabled) {
            const semanticMatcher = getSemanticMatcher();
            if (semanticMatcher.isReady()) {
              const relaxedSemantic = await semanticMatcher.match(processedText, 0.55);
              if (relaxedSemantic) {
                console.log(`[Intent] ⏱️ Timeout fallback → semantic: ${relaxedSemantic.intent} (${(relaxedSemantic.score * 100).toFixed(0)}%)`);
                return {
                  category: relaxedSemantic.intent as any,
                  confidence: relaxedSemantic.score * 0.85,
                  entities: {},
                  source: 'semantic',
                  matchedExample: relaxedSemantic.matchedExample,
                  detectedLanguage: detectedLang
                };
              }
            }
          }
          if (currentMatcher) {
            const relaxedFuzzy = currentMatcher.matchWithContext(processedText, [], null, undefined);
            if (relaxedFuzzy && relaxedFuzzy.score >= 0.55) {
              console.log(`[Intent] ⏱️ Timeout fallback → fuzzy: ${relaxedFuzzy.intent} (${(relaxedFuzzy.score * 100).toFixed(0)}%)`);
              return {
                category: relaxedFuzzy.intent as any,
                confidence: relaxedFuzzy.score * 0.85,
                entities: {},
                source: 'fuzzy',
                matchedKeyword: relaxedFuzzy.matchedKeyword,
                detectedLanguage: detectedLang
              };
            }
          }
          // Multi-intent split as last resort
          const splitResult = await tryMultiIntentSplit(text, history, lastIntent, detectedLang, config, currentMatcher);
          if (splitResult) return traceAndReturn(splitResult, 'LLM timeout fallback → multi-intent split');
          return traceAndReturn({ category: 'unknown', confidence: 0, entities: {}, source: 'llm', detectedLanguage: detectedLang }, 'LLM timeout fallback → unknown');
        }
        throw timeoutErr; // Re-throw non-timeout errors
      }

      // Map generic LLM intent names to specific defined intents
      const mappedCategory = mapLLMIntentToSpecific(llmResult.category, processedText);

      // US-122: Collect LLM candidate for tracing
      tierCandidates.push({
        intent: llmResult.category,
        score: llmResult.confidence,
      });

      if (mappedCategory !== llmResult.category) {
        console.log(
          `[Intent] 🤖 LLM classified: ${llmResult.category} → mapped to: ${mappedCategory} ` +
          `(${(llmResult.confidence * 100).toFixed(0)}% with ${context.length} context messages)`
        );
      } else {
        console.log(
          `[Intent] 🤖 LLM classified: ${llmResult.category} ` +
          `(${(llmResult.confidence * 100).toFixed(0)}% with ${context.length} context messages)`
        );
      }

      // If LLM returned unknown with low confidence, try multi-intent splitting
      if (mappedCategory === 'unknown' && llmResult.confidence < 0.3) {
        const splitResult = await tryMultiIntentSplit(text, history, lastIntent, detectedLang, config, currentMatcher);
        if (splitResult) return traceAndReturn(splitResult, 'Multi-intent split fallback');
      }

      return traceAndReturn({
        ...llmResult,
        category: mappedCategory as any,
        source: 'llm',
        detectedLanguage: detectedLang
      }, 'LLM classification — lower tiers did not meet threshold');
    } catch (error) {
      console.error('[Intent] LLM classification failed:', error);
      // On LLM failure, try multi-intent splitting as last resort
      const splitResult = await tryMultiIntentSplit(text, history, lastIntent, detectedLang, config, currentMatcher);
      if (splitResult) return traceAndReturn(splitResult, 'LLM error fallback → multi-intent split');
      return traceAndReturn({
        category: 'unknown',
        confidence: 0,
        entities: {},
        source: 'llm',
        detectedLanguage: detectedLang
      }, 'LLM error fallback → unknown');
    }
  }

  // All tiers disabled or failed - return unknown
  return traceAndReturn({
    category: 'unknown',
    confidence: 0,
    entities: {},
    source: 'llm',
    detectedLanguage: detectedLang
  }, 'All tiers disabled or no candidates met threshold');
}

/**
 * Legacy function for backward compatibility
 * @deprecated Use classifyMessageWithContext() instead
 */
export async function classifyMessage(
  text: string,
  history: ChatMessage[] = []
): Promise<IntentResult> {
  return classifyMessageWithContext(text, history, null);
}
