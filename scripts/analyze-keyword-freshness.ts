/**
 * US-327: Intent Keyword Freshness Analyzer CLI
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

interface KeywordsData {
  intents: {
    intent: string;
    keywords: Record<string, string[]>;
  }[];
}

interface AnalysisResult {
  staleKeywords: string[];
  coverageGaps: string[];
  matchedCount: number;
  unmatchedCount: number;
  matchedKeywords: Map<string, number>;
}

function loadKeywordsFromProfiles(): Map<string, string[]> {
  const keywordMap = new Map<string, string[]>();
  const profiles = [
    path.join(rootDir, 'src/assistant/data/intent-keywords.json'),
    path.join(rootDir, 'src/assistant/data-makan/intent-keywords.json'),
    path.join(rootDir, 'src/assistant/data-southern/intent-keywords.json'),
  ];

  for (const profilePath of profiles) {
    if (fs.existsSync(profilePath)) {
      try {
        const data: KeywordsData = JSON.parse(
          fs.readFileSync(profilePath, 'utf-8'),
        );
        for (const intentObj of data.intents) {
          const intent = intentObj.intent;
          const allKeywords: string[] = [];
          for (const lang of Object.keys(intentObj.keywords)) {
            allKeywords.push(...intentObj.keywords[lang]);
          }
          keywordMap.set(intent, allKeywords);
        }
      } catch (e) {
        console.warn(`Failed to load keywords from ${profilePath}:`, e);
      }
    }
  }
  return keywordMap;
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function matchKeywordInText(keyword: string, text: string): boolean {
  const normalized = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);
  return (
    normalized.includes(normalizedKeyword) ||
    normalized === normalizedKeyword
  );
}

function findMatchingIntent(
  text: string,
  keywordMap: Map<string, string[]>,
): string | null {
  for (const [intent, keywords] of keywordMap) {
    for (const keyword of keywords) {
      if (matchKeywordInText(keyword, text)) {
        return intent;
      }
    }
  }
  return null;
}

async function parseLogsWithDayFilter(
  logPath: string,
  daysWindow: number,
): Promise<string[]> {
  const messages: string[] = [];
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysWindow);

  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(logPath),
      crlfDelay: Infinity,
    });

    rl.on('line', (line: string) => {
      try {
        const logEntry = JSON.parse(line);
        const messageText =
          logEntry.message ||
          logEntry.text ||
          logEntry.content ||
          logEntry.msg;
        const timestamp = logEntry.timestamp || logEntry.date || logEntry.ts;

        if (messageText && typeof messageText === 'string') {
          let isWithinWindow = true;
          if (timestamp) {
            try {
              const logDate = new Date(timestamp);
              isWithinWindow = logDate >= cutoffDate;
            } catch (e) {
              isWithinWindow = true;
            }
          }
          if (isWithinWindow && messageText.trim().length > 0) {
            messages.push(messageText.trim());
          }
        }
      } catch (e) {
        if (line.trim().length > 0) {
          messages.push(line.trim());
        }
      }
    });

    rl.on('error', reject);
    rl.on('close', () => resolve(messages));
  });
}

function analyzeMessages(
  messages: string[],
  keywordMap: Map<string, string[]>,
): AnalysisResult {
  const matchedKeywords = new Map<string, number>();
  const unmatchedMessages: Set<string> = new Set();
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const [intent, keywords] of keywordMap) {
    for (const keyword of keywords) {
      matchedKeywords.set(keyword, 0);
    }
  }

  for (const message of messages) {
    const matchedIntent = findMatchingIntent(message, keywordMap);

    if (matchedIntent) {
      matchedCount++;
      const keywords = keywordMap.get(matchedIntent) || [];
      for (const keyword of keywords) {
        if (matchKeywordInText(keyword, message)) {
          matchedKeywords.set(
            keyword,
            (matchedKeywords.get(keyword) || 0) + 1,
          );
        }
      }
    } else {
      unmatchedCount++;
      unmatchedMessages.add(message);
    }
  }

  const staleKeywords: string[] = [];
  for (const [keyword, count] of matchedKeywords) {
    if (count === 0) {
      staleKeywords.push(keyword);
    }
  }

  return {
    staleKeywords: staleKeywords.sort(),
    coverageGaps: Array.from(unmatchedMessages).sort(),
    matchedCount,
    unmatchedCount,
    matchedKeywords,
  };
}

function writeReports(
  result: AnalysisResult,
  outputDir: string = process.cwd(),
): void {
  const staleKeywordsPath = path.join(outputDir, 'stale_keywords.txt');
  fs.writeFileSync(staleKeywordsPath, result.staleKeywords.join('\n') + '\n');
  console.log(
    `✓ Wrote ${result.staleKeywords.length} stale keywords to ${staleKeywordsPath}`,
  );

  const coverageGapsPath = path.join(outputDir, 'coverage_gaps.txt');
  fs.writeFileSync(coverageGapsPath, result.coverageGaps.join('\n') + '\n');
  console.log(
    `✓ Wrote ${result.coverageGaps.length} unmatched patterns to ${coverageGapsPath}`,
  );

  const coveragePercent = (
    (result.matchedCount /
      (result.matchedCount + result.unmatchedCount)) *
    100
  ).toFixed(1);
  console.log(`\n📊 Summary:`);
  console.log(`  Messages matched: ${result.matchedCount}`);
  console.log(`  Messages unmatched: ${result.unmatchedCount}`);
  console.log(`  Coverage: ${coveragePercent}%`);
  console.log(`  Stale keywords: ${result.staleKeywords.length}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let logPath: string | null = null;
  let daysWindow = 30;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && i + 1 < args.length) {
      daysWindow = parseInt(args[i + 1], 10);
      i++;
    } else if (!args[i].startsWith('--') && !logPath) {
      logPath = args[i];
    }
  }

  if (!logPath) {
    console.error('Usage: analyze-keyword-freshness <logPath> [--days N]');
    process.exit(1);
  }

  if (!fs.existsSync(logPath)) {
    console.error(`Error: Log file not found: ${logPath}`);
    process.exit(1);
  }

  console.log(`📖 Loading keywords from profiles...`);
  const keywordMap = loadKeywordsFromProfiles();

  if (keywordMap.size === 0) {
    console.error('Error: No keywords loaded from profiles');
    process.exit(1);
  }

  console.log(`  Loaded ${keywordMap.size} intents`);
  console.log(`\n📂 Parsing logs from: ${logPath}`);
  console.log(`  Time window: last ${daysWindow} days`);

  const messages = await parseLogsWithDayFilter(logPath, daysWindow);
  console.log(`  Parsed ${messages.length} messages`);

  if (messages.length === 0) {
    console.warn('Warning: No messages found in log file');
    process.exit(1);
  }

  console.log(`\n🔍 Analyzing coverage...`);
  const result = analyzeMessages(messages, keywordMap);

  console.log(`\n📝 Writing reports...`);
  writeReports(result, process.cwd());

  console.log(`\n✅ Analysis complete!`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
