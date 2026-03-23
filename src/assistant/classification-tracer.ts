/**
 * US-122: Intent Classification Decision Tracer
 *
 * Logs top-3 intent candidates with confidence breakdown for each classification.
 * Enables debugging misclassifications and accuracy tracking per profile.
 */

export interface ClassificationCandidate {
  name: string;
  confidence: number;
  matched_keywords: string[];
}

export interface ClassificationTrace {
  timestamp: number;
  conversation_id: string;
  input_text: string;
  detected_language: string;
  candidates: ClassificationCandidate[];
  chosen_intent: string;
  chosen_confidence: number;
  chosen_source: string;
  tie_break_reason: string;
}

// In-memory circular buffer for classification traces
const MAX_TRACES_PER_CONVERSATION = 100;
const MAX_CONVERSATIONS = 500;
const traces = new Map<string, ClassificationTrace[]>();
const conversationOrder: string[] = [];

/**
 * Record a classification decision trace
 */
export function recordClassificationTrace(trace: ClassificationTrace): void {
  const { conversation_id } = trace;

  if (!traces.has(conversation_id)) {
    traces.set(conversation_id, []);
    conversationOrder.push(conversation_id);

    // Evict oldest conversation if over limit
    while (conversationOrder.length > MAX_CONVERSATIONS) {
      const oldest = conversationOrder.shift()!;
      traces.delete(oldest);
    }
  }

  const convTraces = traces.get(conversation_id)!;
  convTraces.push(trace);

  // Cap per-conversation traces
  if (convTraces.length > MAX_TRACES_PER_CONVERSATION) {
    convTraces.shift();
  }
}

/**
 * Get classification traces for a conversation
 */
export function getClassificationTraces(conversationId: string): ClassificationTrace[] {
  return traces.get(conversationId) || [];
}

/**
 * Get all conversation IDs that have traces
 */
export function getTracedConversationIds(): string[] {
  return Array.from(traces.keys());
}

/**
 * Clear all traces (for testing)
 */
export function clearTraces(): void {
  traces.clear();
  conversationOrder.length = 0;
}

/**
 * Build a classification trace from the 4-tier intent classification results.
 *
 * Takes the winning result plus any runner-up candidates from different tiers
 * and normalizes confidence scores so top-3 sum to ~100%.
 */
export function buildClassificationTrace(params: {
  conversationId: string;
  inputText: string;
  detectedLanguage: string;
  chosenIntent: string;
  chosenConfidence: number;
  chosenSource: string;
  matchedKeyword?: string;
  matchedExample?: string;
  fuzzyResults?: Array<{ intent: string; score: number; matchedKeyword?: string }>;
  semanticResults?: Array<{ intent: string; score: number; matchedExample?: string }>;
  llmResult?: { category: string; confidence: number };
  tieBreakReason?: string;
}): ClassificationTrace {
  const {
    conversationId,
    inputText,
    detectedLanguage,
    chosenIntent,
    chosenConfidence,
    chosenSource,
    matchedKeyword,
    matchedExample,
    fuzzyResults = [],
    semanticResults = [],
    llmResult,
    tieBreakReason,
  } = params;

  // Collect all candidates from different tiers
  const rawCandidates: ClassificationCandidate[] = [];

  // Add fuzzy candidates
  for (const fr of fuzzyResults) {
    rawCandidates.push({
      name: fr.intent,
      confidence: fr.score,
      matched_keywords: fr.matchedKeyword ? [fr.matchedKeyword] : [],
    });
  }

  // Add semantic candidates
  for (const sr of semanticResults) {
    rawCandidates.push({
      name: sr.intent,
      confidence: sr.score,
      matched_keywords: sr.matchedExample ? [`example: ${sr.matchedExample}`] : [],
    });
  }

  // Add LLM result if present and not already included
  if (llmResult && !rawCandidates.some(c => c.name === llmResult.category)) {
    rawCandidates.push({
      name: llmResult.category,
      confidence: llmResult.confidence,
      matched_keywords: [],
    });
  }

  // Ensure the chosen intent is in the list
  if (!rawCandidates.some(c => c.name === chosenIntent)) {
    const keywords: string[] = [];
    if (matchedKeyword) keywords.push(matchedKeyword);
    if (matchedExample) keywords.push(`example: ${matchedExample}`);
    rawCandidates.push({
      name: chosenIntent,
      confidence: chosenConfidence,
      matched_keywords: keywords,
    });
  }

  // Deduplicate by intent name (keep highest confidence)
  const deduped = new Map<string, ClassificationCandidate>();
  for (const c of rawCandidates) {
    const existing = deduped.get(c.name);
    if (!existing || c.confidence > existing.confidence) {
      deduped.set(c.name, c);
    } else if (existing && c.matched_keywords.length > 0) {
      // Merge keywords
      existing.matched_keywords = [...new Set([...existing.matched_keywords, ...c.matched_keywords])];
    }
  }

  // Sort by confidence descending and take top 3
  const sorted = Array.from(deduped.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  // Normalize confidence scores so they sum to ~100%
  const rawSum = sorted.reduce((sum, c) => sum + c.confidence, 0);
  const candidates: ClassificationCandidate[] = rawSum > 0
    ? sorted.map(c => ({
        ...c,
        confidence: Math.round((c.confidence / rawSum) * 10000) / 100, // 2 decimal places as percentage
      }))
    : sorted;

  // Determine tie-break reason
  let reason = tieBreakReason || '';
  if (!reason) {
    if (chosenSource === 'regex') {
      reason = 'Emergency/regex pattern matched — highest priority tier';
    } else if (chosenSource === 'fuzzy') {
      reason = `Fuzzy keyword match above threshold${matchedKeyword ? ` (keyword: "${matchedKeyword}")` : ''}`;
    } else if (chosenSource === 'semantic') {
      reason = `Semantic similarity above threshold${matchedExample ? ` (example: "${matchedExample}")` : ''}`;
    } else if (chosenSource === 'llm') {
      reason = 'LLM classification — lower tiers did not meet threshold';
    } else {
      reason = 'Highest confidence candidate selected';
    }
  }

  return {
    timestamp: Date.now(),
    conversation_id: conversationId,
    input_text: inputText,
    detected_language: detectedLanguage,
    candidates,
    chosen_intent: chosenIntent,
    chosen_confidence: chosenConfidence,
    chosen_source: chosenSource,
    tie_break_reason: reason,
  };
}
