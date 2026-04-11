/**
 * Intent Confidence Regression Detector CLI
 *
 * Tracks intent classification confidence scores against baselines.
 * Detects accuracy regressions (>10% absolute or >15% relative drop).
 * Generates JSON report with profile-intent pairs and remediation suggestions.
 *
 * Usage:
 *   ts-node src/tools/intent-regression-detector.ts [--output report.json] [--re-baseline]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface IntentTestCase {
  messageText: string;
  intent: string;
  confidence: number;
  profile: string;
}

interface ConfidenceMetric {
  profile: string;
  intent: string;
  avgConfidence: number;
  minConfidence: number;
  maxConfidence: number;
  sampleCount: number;
}

interface RegressionResult {
  profile: string;
  intent: string;
  baselineConfidence: number;
  currentConfidence: number;
  absoluteDelta: number;
  relativeDelta: number; // percentage
  isRegression: boolean;
  remediationSuggestion: string;
}

interface RegressionReport {
  timestamp: string;
  regressions: RegressionResult[];
  newIntents: ConfidenceMetric[];
  summary: {
    totalIntentProfiles: number;
    regressionCount: number;
    newIntentCount: number;
  };
}

interface BaselineData {
  generatedAt: string;
  metrics: ConfidenceMetric[];
}

// Regression thresholds from acceptance criteria
const ABSOLUTE_DROP_THRESHOLD = 0.10; // >10% absolute drop
const RELATIVE_DROP_THRESHOLD = 0.15; // >15% relative degradation

/**
 * Load test fixtures from generated test files
 * Returns array of test cases from all profiles
 */
async function loadTestFixtures(): Promise<IntentTestCase[]> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '../../');
  const testFixturesDir = path.join(projectRoot, 'src/__tests__/fixtures');

  const testCases: IntentTestCase[] = [];
  const profiles = ['pelangi', 'makan', 'southern'];

  for (const profile of profiles) {
    const fixtureFile = path.join(testFixturesDir, `intent-classifications-${profile}.test.ts`);

    // Try to load fixture file if it exists
    if (fs.existsSync(fixtureFile)) {
      try {
        const content = fs.readFileSync(fixtureFile, 'utf-8');
        // Extract test cases from fixture file using simple parsing
        const casesMatch = content.match(/testCases:\s*{([^}]*?)},\s*}/s);
        if (casesMatch) {
          // Find all test case objects in the content
          const caseMatches = content.matchAll(
            /"messageText":\s*"([^"]+)",\s*"intent":\s*"([^"]+)",\s*"confidence":\s*([\d.]+)/g
          );
          for (const match of caseMatches) {
            testCases.push({
              messageText: match[1],
              intent: match[2],
              confidence: parseFloat(match[3]),
              profile,
            });
          }
        }
      } catch (err) {
        console.warn(`Failed to load fixture ${fixtureFile}: ${err}`);
      }
    }
  }

  // If no fixtures found, generate synthetic test data for demonstration
  if (testCases.length === 0) {
    testCases.push(
      // Pelangi profile
      { profile: 'pelangi', intent: 'booking', messageText: 'I want to book a room', confidence: 0.82 },
      { profile: 'pelangi', intent: 'booking', messageText: 'Can I reserve a bed?', confidence: 0.89 },
      { profile: 'pelangi', intent: 'booking', messageText: 'Do you have availability?', confidence: 0.91 },
      { profile: 'pelangi', intent: 'check_in', messageText: 'What time is check-in?', confidence: 0.88 },
      { profile: 'pelangi', intent: 'check_in', messageText: 'When can I arrive?', confidence: 0.85 },
      { profile: 'pelangi', intent: 'pricing', messageText: 'How much per night?', confidence: 0.87 },
      { profile: 'pelangi', intent: 'pricing', messageText: 'What is your rate?', confidence: 0.84 },
      { profile: 'pelangi', intent: 'facilities', messageText: 'Do you have wifi?', confidence: 0.90 },

      // Makan profile
      { profile: 'makan', intent: 'order', messageText: 'I want to order', confidence: 0.86 },
      { profile: 'makan', intent: 'order', messageText: 'Can I get a menu?', confidence: 0.88 },
      { profile: 'makan', intent: 'pricing', messageText: 'How much for a roti?', confidence: 0.85 },
      { profile: 'makan', intent: 'pricing', messageText: 'What\'s the price?', confidence: 0.80 },
      { profile: 'makan', intent: 'delivery', messageText: 'Do you deliver?', confidence: 0.89 },

      // Southern profile
      { profile: 'southern', intent: 'booking', messageText: 'I want to book', confidence: 0.84 },
      { profile: 'southern', intent: 'booking', messageText: 'Can I reserve?', confidence: 0.87 },
      { profile: 'southern', intent: 'pricing', messageText: 'How much?', confidence: 0.82 },
      { profile: 'southern', intent: 'facilities', messageText: 'Do you have parking?', confidence: 0.88 },
    );
  }

  return testCases;
}

/**
 * Calculate confidence metrics from test cases
 */
function calculateMetrics(testCases: IntentTestCase[]): Map<string, ConfidenceMetric> {
  const metricsMap = new Map<string, ConfidenceMetric>();

  // Group by profile:intent
  for (const testCase of testCases) {
    const key = `${testCase.profile}:${testCase.intent}`;
    const existing = metricsMap.get(key);

    if (existing) {
      existing.sampleCount++;
      existing.minConfidence = Math.min(existing.minConfidence, testCase.confidence);
      existing.maxConfidence = Math.max(existing.maxConfidence, testCase.confidence);
      existing.avgConfidence =
        (existing.avgConfidence * (existing.sampleCount - 1) + testCase.confidence) /
        existing.sampleCount;
    } else {
      metricsMap.set(key, {
        profile: testCase.profile,
        intent: testCase.intent,
        avgConfidence: testCase.confidence,
        minConfidence: testCase.confidence,
        maxConfidence: testCase.confidence,
        sampleCount: 1,
      });
    }
  }

  return metricsMap;
}

/**
 * Load baseline from file
 */
function loadBaseline(baselineFile: string): BaselineData | null {
  if (!fs.existsSync(baselineFile)) {
    return null;
  }

  try {
    const data = fs.readFileSync(baselineFile, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Failed to load baseline: ${err}`);
    return null;
  }
}

/**
 * Save baseline to file
 */
function saveBaseline(baselineFile: string, metrics: ConfidenceMetric[]): void {
  const baseline: BaselineData = {
    generatedAt: new Date().toISOString(),
    metrics: Array.from(metrics),
  };

  fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2), 'utf-8');
  console.log(`✓ Baseline saved to ${baselineFile}`);
}

/**
 * Detect regressions by comparing current metrics against baseline
 */
function detectRegressions(
  currentMetrics: Map<string, ConfidenceMetric>,
  baseline: BaselineData
): { regressions: RegressionResult[]; newIntents: ConfidenceMetric[] } {
  const regressions: RegressionResult[] = [];
  const newIntents: ConfidenceMetric[] = [];
  const baselineMap = new Map(baseline.metrics.map((m) => [`${m.profile}:${m.intent}`, m]));

  for (const [key, current] of currentMetrics) {
    const baselineMetric = baselineMap.get(key);

    if (!baselineMetric) {
      // New intent-profile pair
      newIntents.push(current);
      continue;
    }

    const absoluteDelta = current.avgConfidence - baselineMetric.avgConfidence;
    const relativeDelta = (absoluteDelta / baselineMetric.avgConfidence) * 100;

    // Check for regression: >10% absolute drop OR >15% relative drop
    const isRegression =
      absoluteDelta < -ABSOLUTE_DROP_THRESHOLD ||
      relativeDelta < -RELATIVE_DROP_THRESHOLD * 100;

    if (isRegression) {
      regressions.push({
        profile: current.profile,
        intent: current.intent,
        baselineConfidence: baselineMetric.avgConfidence,
        currentConfidence: current.avgConfidence,
        absoluteDelta,
        relativeDelta,
        isRegression: true,
        remediationSuggestion: buildRemediationSuggestion(current.profile, current.intent),
      });
    }
  }

  // Sort regressions by severity (largest drop first)
  regressions.sort((a, b) => a.absoluteDelta - b.absoluteDelta);

  return { regressions, newIntents };
}

/**
 * Build remediation suggestion based on profile and intent
 */
function buildRemediationSuggestion(profile: string, intent: string): string {
  const suggestions: Record<string, string> = {
    booking: `Validate ${profile} booking intent training data. Check for data isolation violations.`,
    check_in: `Review ${profile} check-in flow. Ensure KB documentation is current.`,
    check_out: `Audit ${profile} check-out conversation flows. Validate keyword coverage.`,
    pricing: `Validate pricing data for ${profile}. Check for recent price changes.`,
    cancellation: `Review cancellation policies and KB for ${profile}.`,
    facilities: `Update ${profile} facilities information and KB documents.`,
    payment: `Audit payment processing intents for ${profile}.`,
    order: `Review ${profile} order processing workflow and training data.`,
    delivery: `Validate delivery information and keywords for ${profile}.`,
  };

  return suggestions[intent] || `Retrain ${profile} ${intent} intent. Review training data quality.`;
}

/**
 * Generate regression report
 */
function generateReport(
  regressions: RegressionResult[],
  newIntents: ConfidenceMetric[],
  currentMetrics: Map<string, ConfidenceMetric>
): RegressionReport {
  return {
    timestamp: new Date().toISOString(),
    regressions,
    newIntents,
    summary: {
      totalIntentProfiles: currentMetrics.size,
      regressionCount: regressions.length,
      newIntentCount: newIntents.length,
    },
  };
}

/**
 * Print report to console
 */
function printReport(report: RegressionReport): void {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Intent Confidence Regression Detector Report              ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  console.log(`Generated: ${report.timestamp}`);
  console.log(`Total Intent-Profile Pairs: ${report.summary.totalIntentProfiles}`);
  console.log(`Regressions Detected: ${report.summary.regressionCount}`);
  console.log(`New Intents: ${report.summary.newIntentCount}\n`);

  if (report.regressions.length > 0) {
    console.log('─────────────────────────────────────────────────────────────');
    console.log('REGRESSIONS (Sorted by Severity)\n');

    for (const regression of report.regressions) {
      console.log(`[${regression.profile.toUpperCase()}] ${regression.intent}`);
      console.log(`  Baseline Confidence: ${(regression.baselineConfidence * 100).toFixed(1)}%`);
      console.log(`  Current Confidence:  ${(regression.currentConfidence * 100).toFixed(1)}%`);
      console.log(`  Absolute Delta:      ${(regression.absoluteDelta * 100).toFixed(1)}%`);
      console.log(`  Relative Delta:      ${regression.relativeDelta.toFixed(1)}%`);
      console.log(`  Remediation:         ${regression.remediationSuggestion}`);
      console.log('');
    }
  } else {
    console.log('✓ No regressions detected!\n');
  }

  if (report.newIntents.length > 0) {
    console.log('─────────────────────────────────────────────────────────────');
    console.log('NEW INTENT-PROFILE PAIRS\n');

    for (const intent of report.newIntents) {
      console.log(
        `[${intent.profile.toUpperCase()}] ${intent.intent}: ${(intent.avgConfidence * 100).toFixed(1)}%`
      );
    }
    console.log('');
  }
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(__dirname, '../../');
  const baselineFile = path.join(
    projectRoot,
    'src/assistant/data/intent-confidence-baseline.json'
  );
  const outputFile = args.includes('--output')
    ? args[args.indexOf('--output') + 1]
    : 'regression-report.json';
  const reBaseline = args.includes('--re-baseline');

  console.log('Loading test fixtures...');
  const testCases = await loadTestFixtures();
  console.log(`✓ Loaded ${testCases.length} test cases\n`);

  console.log('Calculating current metrics...');
  const currentMetrics = calculateMetrics(testCases);
  console.log(`✓ Calculated metrics for ${currentMetrics.size} intent-profile pairs\n`);

  // Check if baseline exists
  const existingBaseline = loadBaseline(baselineFile);

  if (!existingBaseline || reBaseline) {
    console.log('Creating baseline...');
    const metricsArray = Array.from(currentMetrics.values());
    saveBaseline(baselineFile, metricsArray);

    const report = generateReport([], [], currentMetrics);
    console.log('✓ First run: baseline created. No regressions to report.\n');
    printReport(report);

    if (outputFile) {
      fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
      console.log(`✓ Report saved to ${outputFile}`);
    }

    return;
  }

  // Compare against baseline
  console.log(`Comparing against baseline (${existingBaseline.generatedAt})...\n`);
  const { regressions, newIntents } = detectRegressions(currentMetrics, existingBaseline);
  const report = generateReport(regressions, newIntents, currentMetrics);

  printReport(report);

  if (outputFile) {
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
    console.log(`✓ Report saved to ${outputFile}`);
  }

  // Exit with error code if regressions found
  if (regressions.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
