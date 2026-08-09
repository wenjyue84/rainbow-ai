import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface KeywordMetadata {
  keyword: string;
  intents: string[];
  severity: 'high' | 'medium';
  recommendation: string;
}

interface AnalysisResult {
  conflicting_keywords: KeywordMetadata[];
  total_conflicts: number;
  profile: string;
}

interface IntentKeywordsFile {
  intents: Array<{
    intent: string;
    keywords: Record<string, string[]>;
  }>;
}

/**
 * Load intent-keywords.json for a profile
 */
export function loadIntentKeywords(profileName: string): IntentKeywordsFile {
  const basePath = resolve(__dirname, '..', 'assistant', `data-${profileName}`);
  const filePath = resolve(basePath, 'intent-keywords.json');
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Analyze keyword conflicts within a profile
 */
export function analyzeKeywordConflicts(intentKeywordsFile: IntentKeywordsFile): AnalysisResult {
  // Build a map of keyword -> intents using that keyword
  const keywordIntentMap = new Map<string, Set<string>>();

  for (const { intent, keywords } of intentKeywordsFile.intents) {
    // Flatten all keywords across all languages
    for (const languageKeywords of Object.values(keywords)) {
      for (const keyword of languageKeywords) {
        const normalized = keyword.toLowerCase().trim();
        if (!keywordIntentMap.has(normalized)) {
          keywordIntentMap.set(normalized, new Set());
        }
        keywordIntentMap.get(normalized)!.add(intent);
      }
    }
  }

  // Find conflicts (keywords used by 2+ intents)
  const conflictingKeywords: KeywordMetadata[] = [];

  for (const [keyword, intents] of keywordIntentMap) {
    if (intents.size >= 2) {
      const intentArray = Array.from(intents).sort();
      const severity = intents.size >= 3 ? 'high' : 'medium';
      const recommendation =
        severity === 'high'
          ? `High overlap: used by ${intents.size} intents (${intentArray.join(', ')}). Consider removing from ${intentArray.slice(-1)[0]} or reassigning to most specific intent.`
          : `Medium overlap: used by 2 intents (${intentArray.join(', ')}). Review context to keep only in most specific intent.`;

      conflictingKeywords.push({
        keyword,
        intents: intentArray,
        severity,
        recommendation,
      });
    }
  }

  // Sort by severity (high first) then by number of conflicting intents
  conflictingKeywords.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.intents.length - a.intents.length;
  });

  return {
    conflicting_keywords: conflictingKeywords,
    total_conflicts: conflictingKeywords.length,
    profile: '', // will be set by caller
  };
}

/**
 * Main CLI entry point
 */
async function main() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    let profileName = 'data-makan'; // default

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--profile' && i + 1 < args.length) {
        profileName = args[i + 1];
        // Remove 'data-' prefix if present for internal use
        if (profileName.startsWith('data-')) {
          profileName = profileName.substring(5);
        }
        break;
      }
    }

    // Load and analyze
    const intentKeywordsFile = loadIntentKeywords(profileName);
    const result = analyzeKeywordConflicts(intentKeywordsFile);
    result.profile = profileName;

    // Output JSON
    console.log(JSON.stringify(result, null, 2));

    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error('Error analyzing keyword conflicts:', error);
    process.exit(1);
  }
}

// Only run main if this is the entry point
const isMain = process.argv[1] === __filename || process.argv[1].replace(/\\/g, '/') === __filename.replace(/\\/g, '/');
if (isMain) {
  main().catch(console.error);
}
