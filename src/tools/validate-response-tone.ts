/**
 * US-392: Fallback Response Tone Validator
 *
 * Pure logic module — validates tone of fallback response templates in knowledge.json,
 * flags dismissive language, and suggests alternatives.
 *
 * CLI wrapper: validate-response-tone-cli.ts
 */

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

export const DISMISSIVE_PATTERNS = [
  'cannot help',
  'not possible',
  'unable to',
  'cannot assist',
  'not able',
  'sorry, i cannot',
  'i don\'t know',
  'i don\'t have',
  'we don\'t have',
  'not available',
  'no longer available',
  'cannot provide',
  'not supported',
  'not allowed',
  'not permitted',
  'unfortunately',
  'i\'m afraid',
  'can\'t help',
  'can\'t assist',
];

export const APOLOGETIC_WORDS = [
  'sorry', 'apologize', 'apologies', 'regret', 'regretful',
];

export const HELPFUL_WORDS = [
  'help', 'assist', 'support', 'guide', 'available', 'happy to',
  'glad to', 'can help', 'can assist', 'let us know', 'contact us',
];

export const INTENT_GROUPS: Record<string, string[]> = {
  booking: [
    'booking', 'book', 'reservation', 'reserve', 'book_now',
    'booking_info', 'booking_confirmation',
  ],
  checkin: [
    'checkin', 'checkin_info', 'check_in', 'checkIn',
    'early_checkin', 'late_checkin', 'checkin_procedure',
  ],
  payment: [
    'payment', 'payment_info', 'payment_made', 'pay', 'pricing',
    'billing_dispute', 'billing_inquiry', 'billing_procedure',
  ],
  complaint: [
    'complaint', 'issue', 'problem', 'complaint_handling',
    'noise_complaint', 'capsule_conflict', 'damage_report',
  ],
  inquiry: [
    'inquiry', 'question', 'ask', 'facilities', 'facilities_info',
    'directions', 'tourist_guide', 'information',
  ],
  checkout: [
    'checkout', 'checkout_info', 'checkout_now', 'checkout_procedure',
    'check_out', 'checkOut',
  ],
  emergency: [
    'emergency', 'theft', 'theft_report', 'theft_emergency',
    'urgent', 'help', 'emergency_contact',
  ],
};

export interface DismissiveMatch {
  intent: string;
  language: string;
  pattern: string;
  text: string;
  lineNumber: number;
}

export interface ToneScore {
  dismissiveMatches: number;
  apologeticScore: number; // 0-1
  helpfulScore: number; // 0-1
  overallSentiment: number; // -1 (dismissive) to +1 (helpful)
}

export interface IntentToneAnalysis {
  intent: string;
  responseCount: number;
  toneScores: ToneScore[];
  groupName: string;
  avgSentiment: number;
  dismissiveCount: number;
  flagged: boolean;
}

export interface ToneReport {
  profile: string;
  generatedAt: string;
  totalIntents: number;
  totalResponses: number;
  intentAnalysis: IntentToneAnalysis[];
  groupDistribution: Record<string, {
    intents: string[];
    avgSentiment: number;
    dismissiveCount: number;
    responseCount: number;
  }>;
  flaggedIntents: IntentToneAnalysis[];
  dismissiveSummary: DismissiveMatch[];
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

function countMatches(text: string, patterns: string[]): number {
  const lowerText = text.toLowerCase();
  return patterns.reduce((count, pattern) => {
    const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    const matches = lowerText.match(regex);
    return count + (matches ? matches.length : 0);
  }, 0);
}

function calculateToneScore(text: string): ToneScore {
  const dismissiveCount = countMatches(text, DISMISSIVE_PATTERNS);
  const apologeticCount = countMatches(text, APOLOGETIC_WORDS);
  const helpfulCount = countMatches(text, HELPFUL_WORDS);

  const wordCount = text.split(/\s+/).length || 1;

  // Normalize scores (0-1)
  const apologeticScore = Math.min(apologeticCount / Math.max(wordCount / 10, 1), 1);
  const helpfulScore = Math.min(helpfulCount / Math.max(wordCount / 10, 1), 1);

  // Overall sentiment: dismissive is heavily negative, helpful/apologetic is positive
  // If dismissive patterns exist, it dominates the overall sentiment
  const positiveScore = (apologeticScore + helpfulScore) / 2;
  const negativeScore = dismissiveCount > 0 ? -Math.min(dismissiveCount / 3, 1) : 0;

  // If there are dismissive patterns and NO helpful/apologetic words, be strongly negative
  const adjustedSentiment = dismissiveCount > 0 && helpfulCount === 0 && apologeticCount === 0
    ? Math.max(-1, negativeScore)
    : Math.max(-1, Math.min(1, positiveScore + negativeScore));

  return {
    dismissiveMatches: dismissiveCount,
    apologeticScore,
    helpfulScore,
    overallSentiment: adjustedSentiment,
  };
}

function findDismissiveMatches(
  intent: string,
  text: string,
  lineNumber: number,
): DismissiveMatch[] {
  const matches: DismissiveMatch[] = [];
  const lowerText = text.toLowerCase();

  for (const pattern of DISMISSIVE_PATTERNS) {
    const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let match;
    while ((match = regex.exec(lowerText)) !== null) {
      matches.push({
        intent,
        language: 'en', // TODO: detect language
        pattern,
        text: text.substring(Math.max(0, match.index - 20), match.index + pattern.length + 20),
        lineNumber,
      });
    }
  }

  return matches;
}

function getIntentGroup(intent: string): string {
  for (const [groupName, intents] of Object.entries(INTENT_GROUPS)) {
    if (intents.includes(intent)) {
      return groupName;
    }
  }
  return 'other';
}

export function analyzeResponseTone(
  intent: string,
  responses: { en?: string; ms?: string; zh?: string },
): ToneScore[] {
  const scores: ToneScore[] = [];

  for (const [lang, text] of Object.entries(responses)) {
    if (text && text.trim()) {
      scores.push(calculateToneScore(text));
    }
  }

  return scores;
}

export function analyzeKnowledge(
  knowledge: Array<{
    intent: string;
    response: { en?: string; ms?: string; zh?: string };
  }>,
): IntentToneAnalysis[] {
  const analysis: IntentToneAnalysis[] = [];
  const dismissiveMatches: DismissiveMatch[] = [];

  for (const item of knowledge) {
    const toneScores = analyzeResponseTone(item.intent, item.response);
    const responseCount = Object.values(item.response).filter(r => r && r.trim()).length;

    let lineNumber = 0;
    for (const [lang, text] of Object.entries(item.response)) {
      if (text && text.trim()) {
        lineNumber++;
        const matches = findDismissiveMatches(item.intent, text, lineNumber);
        dismissiveMatches.push(...matches);
      }
    }

    const avgSentiment = toneScores.length > 0
      ? toneScores.reduce((sum, s) => sum + s.overallSentiment, 0) / toneScores.length
      : 0;

    const dismissiveCount = toneScores.reduce((sum, s) => sum + s.dismissiveMatches, 0);

    const groupName = getIntentGroup(item.intent);

    // Flag based on sentiment expectations per group
    let flagged = false;
    if (dismissiveCount > 0) {
      flagged = true;
    } else if (groupName === 'booking' && avgSentiment < 0.6) {
      flagged = true;
    } else if (groupName === 'inquiry' && avgSentiment < 0.7) {
      flagged = true;
    }

    analysis.push({
      intent: item.intent,
      responseCount,
      toneScores,
      groupName,
      avgSentiment,
      dismissiveCount,
      flagged,
    });
  }

  // Sort by flagged status and sentiment
  analysis.sort((a, b) => {
    if (a.flagged !== b.flagged) {
      return b.flagged ? 1 : -1;
    }
    return a.avgSentiment - b.avgSentiment;
  });

  return analysis;
}

export function buildToneReport(
  profile: string,
  knowledge: Array<{
    intent: string;
    response: { en?: string; ms?: string; zh?: string };
  }>,
): ToneReport {
  const intentAnalysis = analyzeKnowledge(knowledge);
  const dismissiveSummary: DismissiveMatch[] = [];

  // Collect all dismissive matches
  for (const analysis of intentAnalysis) {
    for (const score of analysis.toneScores) {
      if (score.dismissiveMatches > 0) {
        // Find the original text
        const item = knowledge.find(k => k.intent === analysis.intent);
        if (item) {
          let lineNum = 0;
          for (const [lang, text] of Object.entries(item.response)) {
            if (text && text.trim()) {
              lineNum++;
              const matches = findDismissiveMatches(analysis.intent, text, lineNum);
              dismissiveSummary.push(...matches);
            }
          }
        }
      }
    }
  }

  // Build group distribution
  const groupDistribution: Record<string, {
    intents: string[];
    avgSentiment: number;
    dismissiveCount: number;
    responseCount: number;
  }> = {};

  for (const analysis of intentAnalysis) {
    const group = analysis.groupName;
    if (!groupDistribution[group]) {
      groupDistribution[group] = {
        intents: [],
        avgSentiment: 0,
        dismissiveCount: 0,
        responseCount: 0,
      };
    }

    const groupData = groupDistribution[group];
    groupData.intents.push(analysis.intent);
    groupData.responseCount += analysis.responseCount;
    groupData.dismissiveCount += analysis.dismissiveCount;
  }

  // Calculate average sentiment per group
  for (const groupName of Object.keys(groupDistribution)) {
    const groupIntents = groupDistribution[groupName].intents;
    const groupAnalysis = intentAnalysis.filter(a => groupIntents.includes(a.intent));
    const avgSentiment = groupAnalysis.length > 0
      ? groupAnalysis.reduce((sum, a) => sum + a.avgSentiment, 0) / groupAnalysis.length
      : 0;
    groupDistribution[groupName].avgSentiment = avgSentiment;
  }

  return {
    profile,
    generatedAt: new Date().toISOString(),
    totalIntents: intentAnalysis.length,
    totalResponses: intentAnalysis.reduce((sum, a) => sum + a.responseCount, 0),
    intentAnalysis,
    groupDistribution,
    flaggedIntents: intentAnalysis.filter(a => a.flagged),
    dismissiveSummary: dismissiveSummary.slice(0, 50), // Limit to first 50
  };
}

export const SUGGESTION_ALTERNATIVES: Record<string, string> = {
  'cannot help': 'I\'d be happy to assist, but I need more details.',
  'not possible': 'This requires human assistance. Let me connect you with our team.',
  'unable to': 'I don\'t have access to that, but our staff can help.',
  'cannot assist': 'Let me escalate this to someone who can help.',
  'not able': 'This is beyond my capabilities, but our team is here to help.',
  'sorry, i cannot': 'I apologize, but I\'ll connect you with someone who can help.',
  'i don\'t know': 'That\'s a great question. Let me find out for you.',
  'i don\'t have': 'I don\'t have that information right now, but I can help you find it.',
  'we don\'t have': 'That\'s not currently available, but we can discuss alternatives.',
  'not available': 'That option isn\'t available at the moment, but here are alternatives:',
};

export function suggestAlternatives(
  dismissiveMatches: DismissiveMatch[],
): Record<string, string> {
  const suggestions: Record<string, string> = {};

  for (const match of dismissiveMatches) {
    const pattern = match.pattern.toLowerCase();
    if (SUGGESTION_ALTERNATIVES[pattern]) {
      if (!suggestions[match.intent]) {
        suggestions[match.intent] = SUGGESTION_ALTERNATIVES[pattern];
      }
    }
  }

  return suggestions;
}

export interface ToneSuggestionsReport {
  profile: string;
  generatedAt: string;
  suggestions: Record<string, {
    dismissivePattern: string;
    suggestion: string;
  }>;
}

export function buildSuggestionsReport(
  profile: string,
  dismissiveMatches: DismissiveMatch[],
): ToneSuggestionsReport {
  const suggestions: Record<string, {
    dismissivePattern: string;
    suggestion: string;
  }> = {};

  for (const match of dismissiveMatches) {
    const key = `${match.intent}:${match.pattern}`;
    if (!suggestions[key]) {
      const pattern = match.pattern.toLowerCase();
      suggestions[key] = {
        dismissivePattern: pattern,
        suggestion: SUGGESTION_ALTERNATIVES[pattern] || `Consider a more helpful tone for: "${match.pattern}"`,
      };
    }
  }

  return {
    profile,
    generatedAt: new Date().toISOString(),
    suggestions,
  };
}
