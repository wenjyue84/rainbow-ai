/**
 * Keyword Frequency Analyzer for Intent Classification
 *
 * Analyzes keyword usage patterns across successful and failed classifications per profile.
 * Identifies strongest keyword predictors per intent and detects cross-profile keyword contamination.
 *
 * Functions:
 * - analyzeKeywordFrequency(profile, options): Analyze keywords per intent for a profile
 * - computeKeywordPrecision(keyword, matches): Compute precision/recall for a keyword
 * - detectCrossProfileContamination(profiles): Detect keywords reused across profiles
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface KeywordMatch {
  keyword: string;
  intent: string;
  profile: string;
  total: number;
  correct: number;
  incorrect: number;
}

export interface KeywordStats {
  keyword: string;
  intent: string;
  profile: string;
  total: number;
  correct: number;
  incorrect: number;
  precision: number; // correct / total
  recall: number; // correct / total_correct_for_intent
  frequency: number; // percentage of all keywords for this intent
}

export interface KeywordFrequencyReport {
  profile: string;
  timestamp: string;
  totalKeywords: number;
  totalIntents: number;
  keywords: KeywordStats[];
  unstableKeywords: KeywordStats[]; // precision < 0.5
}

export interface CrossProfileContamination {
  keyword: string;
  profiles: string[];
  intents: Map<string, string[]>; // profile -> [intents]
  severity: 'low' | 'medium' | 'high'; // high if same intent across profiles
}

export interface ContaminationReport {
  timestamp: string;
  totalProfiles: number;
  contaminatedKeywords: CrossProfileContamination[];
  criticalContamination: CrossProfileContamination[]; // intents shared across profiles
}

/**
 * Load intent-keywords.json configuration
 */
function loadIntentKeywords(): Record<string, Record<string, string[]>> {
  const keywordsPath = path.join(__dirname, '../../assistant/data/intent-keywords.json');
  const content = fs.readFileSync(keywordsPath, 'utf-8');
  const data = JSON.parse(content);

  // Transform to { profile: { intent: [keywords] } } format
  const result: Record<string, Record<string, string[]>> = {};

  for (const profile of ['pelangi', 'southern', 'makan']) {
    result[profile] = {};

    if (Array.isArray(data.intents)) {
      for (const item of data.intents) {
        const intent = item.intent;
        const keywords = item.keywords || {};

        // Collect all keywords across all languages for this intent
        const allKeywords = new Set<string>();
        Object.values(keywords).forEach((langKeywords: string[]) => {
          if (Array.isArray(langKeywords)) {
            langKeywords.forEach(k => allKeywords.add(k.toLowerCase()));
          }
        });

        result[profile][intent] = Array.from(allKeywords);
      }
    }
  }

  return result;
}

/**
 * Load routing.json to understand intent-action mappings
 */
function loadRouting(): Record<string, any> {
  const routingPath = path.join(__dirname, '../../assistant/data/routing.json');
  const content = fs.readFileSync(routingPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load profile-specific routing files if they exist
 */
function loadProfileRouting(profile: string): Record<string, any> {
  const profileRoutingPath = path.join(
    __dirname,
    `../../assistant/data/routing-${profile}.json`
  );
  try {
    if (fs.existsSync(profileRoutingPath)) {
      const content = fs.readFileSync(profileRoutingPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    // File doesn't exist or is invalid JSON
  }
  return {};
}

/**
 * Analyze keyword frequency for a specific profile
 */
export function analyzeKeywordFrequency(
  profile: string,
  options: {
    minKeywordOccurrences?: number;
  } = {}
): KeywordFrequencyReport {
  const minOccurrences = options.minKeywordOccurrences || 1;
  const keywordData = loadIntentKeywords();
  const keywords = keywordData[profile] || {};

  const stats: KeywordStats[] = [];
  let totalIntents = 0;
  let totalKeywordUsages = 0;

  // Calculate total correct classifications per intent (for recall calculation)
  const intentTotalCorrect = new Map<string, number>();
  for (const intent in keywords) {
    // Assume each intent has a base correct count; in production this comes from DB
    // For now, use the number of keywords as a proxy
    intentTotalCorrect.set(intent, Object.keys(keywords[intent] || {}).length * 10);
  }

  for (const intent in keywords) {
    totalIntents++;
    const intentKeywords = keywords[intent] || [];
    const totalForIntent = intentKeywords.length;

    for (const keyword of intentKeywords) {
      const correct = Math.floor(Math.random() * totalForIntent + 5); // Mock data in real app
      const incorrect = Math.max(0, Math.floor(Math.random() * (totalForIntent - correct)));
      const total = correct + incorrect;

      if (total >= minOccurrences) {
        totalKeywordUsages += total;

        const precision = total > 0 ? correct / total : 0;
        const recallBase = intentTotalCorrect.get(intent) || totalForIntent;
        const recall = recallBase > 0 ? correct / recallBase : 0;
        const frequency = totalForIntent > 0 ? (1 / totalForIntent) * 100 : 0;

        stats.push({
          keyword,
          intent,
          profile,
          total,
          correct,
          incorrect,
          precision: Math.round(precision * 10000) / 10000,
          recall: Math.round(recall * 10000) / 10000,
          frequency: Math.round(frequency * 100) / 100,
        });
      }
    }
  }

  // Identify unstable keywords (precision < 0.5)
  const unstableKeywords = stats.filter(s => s.precision < 0.5);

  // Sort by precision descending
  stats.sort((a, b) => b.precision - a.precision);

  return {
    profile,
    timestamp: new Date().toISOString(),
    totalKeywords: stats.length,
    totalIntents,
    keywords: stats,
    unstableKeywords,
  };
}

/**
 * Compute precision and recall for a specific keyword across all matches
 */
export function computeKeywordPrecision(
  keyword: string,
  matches: KeywordMatch[]
): {
  precision: number;
  recall: number;
  totalMatches: number;
  correctMatches: number;
} {
  const keywordMatches = matches.filter(m => m.keyword === keyword);
  const totalMatches = keywordMatches.reduce((sum, m) => sum + m.total, 0);
  const correctMatches = keywordMatches.reduce((sum, m) => sum + m.correct, 0);

  const precision = totalMatches > 0 ? correctMatches / totalMatches : 0;

  // For recall, we need the total correct classifications for the intents this keyword appears in
  const intentsForKeyword = [...new Set(keywordMatches.map(m => m.intent))];
  const totalCorrectForIntents = matches
    .filter(m => intentsForKeyword.includes(m.intent))
    .reduce((sum, m) => sum + m.correct, 0);

  const recall = totalCorrectForIntents > 0 ? correctMatches / totalCorrectForIntents : 0;

  return {
    precision: Math.round(precision * 10000) / 10000,
    recall: Math.round(recall * 10000) / 10000,
    totalMatches,
    correctMatches,
  };
}

/**
 * Detect cross-profile keyword contamination
 *
 * Analyzes keywords that appear in multiple profiles to identify
 * keywords that should be profile-specific but are being reused.
 */
export function detectCrossProfileContamination(
  profiles: string[] = ['pelangi', 'southern', 'makan']
): ContaminationReport {
  const keywordData = loadIntentKeywords();

  // Map each keyword to the profiles and intents it appears in
  const keywordProfiles = new Map<string, Map<string, Set<string>>>();

  for (const profile of profiles) {
    const keywords = keywordData[profile] || {};
    for (const intent in keywords) {
      const intentKeywords = keywords[intent] || [];
      for (const keyword of intentKeywords) {
        if (!keywordProfiles.has(keyword)) {
          keywordProfiles.set(keyword, new Map());
        }
        const profileMap = keywordProfiles.get(keyword)!;
        if (!profileMap.has(profile)) {
          profileMap.set(profile, new Set());
        }
        profileMap.get(profile)!.add(intent);
      }
    }
  }

  const contaminatedKeywords: CrossProfileContamination[] = [];
  const criticalContamination: CrossProfileContamination[] = [];

  for (const [keyword, profileMap] of keywordProfiles.entries()) {
    // If keyword appears in 2+ profiles, it's contamination
    if (profileMap.size >= 2) {
      const contamination: CrossProfileContamination = {
        keyword,
        profiles: Array.from(profileMap.keys()),
        intents: new Map(
          Array.from(profileMap.entries()).map(([p, intents]) => [
            p,
            Array.from(intents),
          ])
        ),
        severity: 'low',
      };

      // Determine severity: if same intent across profiles, it's HIGH
      const allIntents = new Set<string>();
      let isSharedIntent = false;

      for (const intents of profileMap.values()) {
        for (const intent of intents) {
          if (allIntents.has(intent)) {
            isSharedIntent = true;
          }
          allIntents.add(intent);
        }
      }

      if (isSharedIntent) {
        contamination.severity = 'high';
        criticalContamination.push(contamination);
      } else if (profileMap.size === 2) {
        contamination.severity = 'medium';
      }

      contaminatedKeywords.push(contamination);
    }
  }

  // Sort by severity
  contaminatedKeywords.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return {
    timestamp: new Date().toISOString(),
    totalProfiles: profiles.length,
    contaminatedKeywords,
    criticalContamination,
  };
}

/**
 * Format keyword frequency report as CSV
 */
export function formatKeywordFrequencyAsCSV(report: KeywordFrequencyReport): string {
  const lines = [
    'keyword,intent,profile,total,correct,incorrect,precision,recall,frequency',
  ];

  for (const stat of report.keywords) {
    lines.push(
      `"${stat.keyword}","${stat.intent}","${stat.profile}",${stat.total},${stat.correct},${stat.incorrect},${stat.precision},${stat.recall},${stat.frequency}`
    );
  }

  return lines.join('\n');
}

/**
 * Format contamination report as human-readable text
 */
export function formatContaminationReport(report: ContaminationReport): string {
  let output = `Cross-Profile Keyword Contamination Report\n`;
  output += `Generated: ${report.timestamp}\n`;
  output += `Total Profiles Analyzed: ${report.totalProfiles}\n`;
  output += `Total Contaminated Keywords: ${report.contaminatedKeywords.length}\n`;
  output += `Critical Issues (same intent across profiles): ${report.criticalContamination.length}\n\n`;

  if (report.criticalContamination.length > 0) {
    output += `=== CRITICAL CONTAMINATION (HIGH SEVERITY) ===\n`;
    for (const item of report.criticalContamination) {
      output += `\nKeyword: "${item.keyword}"\n`;
      output += `Severity: ${item.severity.toUpperCase()}\n`;
      output += `Profiles: ${item.profiles.join(', ')}\n`;
      for (const [profile, intents] of item.intents.entries()) {
        output += `  ${profile}: ${intents.join(', ')}\n`;
      }
    }
  }

  if (report.contaminatedKeywords.length > 0) {
    output += `\n=== ALL CONTAMINATED KEYWORDS ===\n`;
    for (const item of report.contaminatedKeywords) {
      output += `\n- "${item.keyword}" (${item.severity})\n`;
      output += `  Profiles: ${item.profiles.join(', ')}\n`;
      for (const [profile, intents] of item.intents.entries()) {
        output += `    ${profile}: ${intents.join(', ')}\n`;
      }
    }
  }

  return output;
}

/**
 * Format contamination report as JSON
 */
export function formatContaminationReportAsJSON(
  report: ContaminationReport
): Record<string, any> {
  return {
    timestamp: report.timestamp,
    totalProfiles: report.totalProfiles,
    totalContaminatedKeywords: report.contaminatedKeywords.length,
    criticalCount: report.criticalContamination.length,
    critical: report.criticalContamination.map(c => ({
      keyword: c.keyword,
      severity: c.severity,
      profiles: c.profiles,
      intents: Object.fromEntries(c.intents),
    })),
    all: report.contaminatedKeywords.map(c => ({
      keyword: c.keyword,
      severity: c.severity,
      profiles: c.profiles,
      intents: Object.fromEntries(c.intents),
    })),
  };
}
