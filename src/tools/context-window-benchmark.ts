#!/usr/bin/env node

/**
 * context-window-benchmark.ts
 *
 * Benchmarks intent classification accuracy with varying conversation history lengths.
 * Tests against a labeled validation dataset and reports optimal context window per profile
 * with accuracy deltas.
 *
 * Usage:
 *   npx tsx src/tools/context-window-benchmark.ts [--profile <profile>]
 *   npm run benchmark:context-window -- --profile pelangi
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { IntentResult, ChatMessage } from '../assistant/types.js';
import { classifyMessage } from '../assistant/intents.js';

// ─── Configuration ────────────────────────────────────────────────────

const CONTEXT_WINDOWS = [3, 5, 10, 20];
const FIXTURE_FILE = resolve('tests/fixtures/validation_conversations.jsonl');
const OUTPUT_DIR = resolve('benchmark-results');
const REPORT_FILE = resolve(OUTPUT_DIR, 'context-window-accuracy-report.json');
const CSV_FILE = resolve(OUTPUT_DIR, 'context-window-accuracy.csv');

interface ValidationMessage {
  role: 'user' | 'assistant';
  content: string;
  ground_truth_intent?: string;
}

interface ValidationConversation {
  profile_id: string;
  conversation_id: string;
  messages: ValidationMessage[];
}

interface WindowAccuracy {
  windowSize: number;
  correct: number;
  total: number;
  accuracy: number;  // 0-1
}

interface ProfileResults {
  profileId: string;
  windowResults: WindowAccuracy[];
  optimalWindow: number;
  optimalAccuracy: number;
  accuracyDelta: number;  // improvement from smallest to optimal
  confidenceInterval95: {
    lower: number;
    upper: number;
  };
  sampleCount: number;
}

interface BenchmarkReport {
  timestamp: string;
  totalSamples: number;
  profiles: ProfileResults[];
  globalStats: {
    avgAccuracyBy Window: Record<number, number>;
    recommendedWindow: number;
  };
}

// ─── Fixture Loading ──────────────────────────────────────────────────

function loadValidationDataset(): ValidationConversation[] {
  try {
    const content = readFileSync(FIXTURE_FILE, 'utf-8');
    const conversations: ValidationConversation[] = [];

    content.split('\n').forEach(line => {
      if (line.trim()) {
        try {
          conversations.push(JSON.parse(line));
        } catch (e) {
          console.warn(`Failed to parse JSONL line: ${line.substring(0, 80)}...`);
        }
      }
    });

    return conversations;
  } catch (err) {
    console.error(`Failed to load fixture file: ${FIXTURE_FILE}`);
    throw err;
  }
}

// ─── Conversation Context Building ────────────────────────────────────

/**
 * Extract the last N messages from conversation history, limiting to contextWindowSize.
 * Returns the most recent contextWindowSize messages up to the current message index.
 */
function buildContextHistory(messages: ValidationMessage[], upToIndex: number, contextWindowSize: number): ChatMessage[] {
  if (contextWindowSize <= 0 || upToIndex <= 0) return [];

  // Get all messages before upToIndex
  const messagesBefore = messages.slice(0, upToIndex);

  // Get the last contextWindowSize messages
  const startIdx = Math.max(0, messagesBefore.length - contextWindowSize);
  const slicedMessages = messagesBefore.slice(startIdx);

  // Convert to ChatMessage format with timestamps
  return slicedMessages.map((msg, idx) => ({
    role: msg.role,
    content: msg.content,
    timestamp: Date.now() - (slicedMessages.length - idx) * 1000  // Older messages get earlier timestamps
  }));
}

// ─── Intent Matching ──────────────────────────────────────────────────

/**
 * Check if classified intent matches the expected intent.
 * Uses substring matching to handle both specific and generic intent names.
 */
function intentMatches(classified: string, expected: string): boolean {
  // Exact match
  if (classified === expected) return true;

  // Substring match (e.g., "booking" matches "booking_request")
  if (classified.includes(expected) || expected.includes(classified)) return true;

  // Category-level match (e.g., "booking" matches "checkin" category if from same intent family)
  const bookingFamily = ['booking', 'availability', 'pricing'];
  const checkinFamily = ['check_in_arrival', 'checkin_info', 'checkin'];
  const checkoutFamily = ['checkout_procedure', 'checkout_info', 'checkout', 'late_checkout_request'];
  const complaintFamily = ['complaint', 'facility_malfunction', 'noise_complaint', 'cleanliness_complaint', 'climate_control_complaint'];
  const rulesFamily = ['rules_policy', 'rules'];
  const paymentFamily = ['payment_info', 'payment_made', 'billing_inquiry', 'billing_dispute', 'payment'];

  const families = [bookingFamily, checkinFamily, checkoutFamily, complaintFamily, rulesFamily, paymentFamily];

  for (const family of families) {
    if (family.includes(classified) && family.includes(expected)) {
      return true;
    }
  }

  return false;
}

// ─── Benchmarking Logic ────────────────────────────────────────────────

async function benchmarkConversation(
  conversation: ValidationConversation,
  windowSize: number
): Promise<{ correct: number; total: number }> {
  let correct = 0;
  let total = 0;

  for (let i = 0; i < conversation.messages.length; i++) {
    const message = conversation.messages[i];

    // Only test user messages with ground truth intent
    if (message.role === 'user' && message.ground_truth_intent) {
      total++;

      // Build context history up to this message (excluding the current message)
      const history = buildContextHistory(conversation.messages, i, windowSize);

      try {
        // Classify the message
        const result: IntentResult = await classifyMessage(message.content, history);

        // Check if it matches expected intent
        if (intentMatches(result.category, message.ground_truth_intent)) {
          correct++;
        }
      } catch (err) {
        console.warn(`Classification failed for message: "${message.content.substring(0, 50)}..."`);
      }
    }
  }

  return { correct, total };
}

async function benchmarkProfile(
  profileId: string,
  conversations: ValidationConversation[]
): Promise<ProfileResults> {
  const windowResults: Map<number, { correct: number; total: number }> = new Map();

  // Initialize window results
  for (const window of CONTEXT_WINDOWS) {
    windowResults.set(window, { correct: 0, total: 0 });
  }

  // Benchmark each conversation with each window size
  for (const conversation of conversations) {
    if (conversation.profile_id !== profileId) continue;

    for (const windowSize of CONTEXT_WINDOWS) {
      const result = await benchmarkConversation(conversation, windowSize);
      const current = windowResults.get(windowSize)!;
      current.correct += result.correct;
      current.total += result.total;
    }
  }

  // Calculate accuracies and find optimal
  const accuracies: WindowAccuracy[] = [];
  let maxAccuracy = 0;
  let optimalWindow = CONTEXT_WINDOWS[0];

  for (const window of CONTEXT_WINDOWS) {
    const { correct, total } = windowResults.get(window)!;
    const accuracy = total > 0 ? correct / total : 0;
    accuracies.push({ windowSize: window, correct, total, accuracy });

    if (accuracy > maxAccuracy) {
      maxAccuracy = accuracy;
      optimalWindow = window;
    }
  }

  // Calculate accuracy delta from smallest to optimal window
  const smallestAccuracy = accuracies[0]?.accuracy || 0;
  const accuracyDelta = maxAccuracy - smallestAccuracy;

  // Calculate 95% confidence interval using normal approximation
  const optimalResult = windowResults.get(optimalWindow)!;
  const p = maxAccuracy;
  const n = optimalResult.total;
  const z = 1.96;  // 95% CI
  const se = n > 0 ? Math.sqrt((p * (1 - p)) / n) : 0;
  const margin = z * se;

  return {
    profileId,
    windowResults: accuracies,
    optimalWindow,
    optimalAccuracy: maxAccuracy,
    accuracyDelta,
    confidenceInterval95: {
      lower: Math.max(0, p - margin),
      upper: Math.min(1, p + margin)
    },
    sampleCount: optimalResult.total
  };
}

// ─── Report Generation ────────────────────────────────────────────────

function generateReport(profiles: ProfileResults[]): BenchmarkReport {
  const avgByWindow: Record<number, number> = {};
  let totalSamples = 0;

  for (const window of CONTEXT_WINDOWS) {
    let sum = 0;
    let count = 0;

    for (const profile of profiles) {
      const windowAcc = profile.windowResults.find(w => w.windowSize === window);
      if (windowAcc && windowAcc.total > 0) {
        sum += windowAcc.accuracy;
        count++;
      }
      totalSamples += profile.sampleCount;
    }

    avgByWindow[window] = count > 0 ? sum / count : 0;
  }

  // Recommend the window with highest average accuracy
  let recommendedWindow = CONTEXT_WINDOWS[0];
  let maxAvg = 0;

  for (const window of CONTEXT_WINDOWS) {
    if (avgByWindow[window] > maxAvg) {
      maxAvg = avgByWindow[window];
      recommendedWindow = window;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalSamples,
    profiles,
    globalStats: {
      avgAccuracyByWindow: avgByWindow,
      recommendedWindow
    }
  };
}

function formatAccuracyReport(report: BenchmarkReport): string {
  const lines: string[] = [];

  lines.push('═'.repeat(80));
  lines.push('CONTEXT WINDOW BENCHMARK REPORT');
  lines.push('═'.repeat(80));
  lines.push(`Timestamp: ${report.timestamp}`);
  lines.push(`Total Samples Tested: ${report.totalSamples}`);
  lines.push(`Context Windows Tested: ${CONTEXT_WINDOWS.join(', ')}`);
  lines.push('');

  // Global stats
  lines.push('GLOBAL ACCURACY BY WINDOW SIZE');
  lines.push('-'.repeat(80));
  for (const window of CONTEXT_WINDOWS) {
    const accuracy = report.globalStats.avgAccuracyByWindow[window] * 100;
    const paddedWindow = String(window).padStart(2);
    lines.push(`  Window=${paddedWindow}:  ${accuracy.toFixed(2)}%`);
  }
  lines.push(`  ► Recommended: Window=${report.globalStats.recommendedWindow}`);
  lines.push('');

  // Per-profile results
  lines.push('PER-PROFILE RESULTS');
  lines.push('-'.repeat(80));

  for (const profile of report.profiles) {
    lines.push(`\n  Profile: ${profile.profileId}`);
    lines.push(`  Samples: ${profile.sampleCount}`);
    lines.push(`  Window Results:`);

    for (const window of profile.windowResults) {
      const accuracy = (window.accuracy * 100).toFixed(2);
      lines.push(`    Window=${window.windowSize:2}: ${accuracy}% (${window.correct}/${window.total})`);
    }

    const optimalAcc = (profile.optimalAccuracy * 100).toFixed(2);
    const delta = (profile.accuracyDelta * 100).toFixed(2);
    lines.push(`  Optimal Window: ${profile.optimalWindow}`);
    lines.push(`  Optimal Accuracy: ${optimalAcc}%`);
    lines.push(`  Accuracy Delta: +${delta}% (vs window=3)`);
    lines.push(`  95% Confidence Interval: [${(profile.confidenceInterval95.lower * 100).toFixed(2)}%, ${(profile.confidenceInterval95.upper * 100).toFixed(2)}%]`);
  }

  lines.push('');
  lines.push('═'.repeat(80));

  return lines.join('\n');
}

function saveRecommendations(report: BenchmarkReport): void {
  const recommendations = report.profiles.map(profile => ({
    profile_id: profile.profileId,
    optimal_window_size: profile.optimalWindow,
    accuracy_at_optimal: profile.optimalAccuracy,
    confidence_interval_95: profile.confidenceInterval95,
    sample_count: profile.sampleCount,
    accuracy_delta: profile.accuracyDelta,
    timestamp: report.timestamp
  }));

  writeFileSync(REPORT_FILE, JSON.stringify(recommendations, null, 2));
}

function saveCSV(report: BenchmarkReport): void {
  const rows: string[] = [];
  rows.push('profile_id,window_size,accuracy,correct,total,optimal_window,optimal_accuracy');

  for (const profile of report.profiles) {
    for (const window of profile.windowResults) {
      const isOptimal = window.windowSize === profile.optimalWindow ? 'YES' : 'NO';
      rows.push(
        `${profile.profileId},${window.windowSize},${(window.accuracy * 100).toFixed(2)},${window.correct},${window.total},${profile.optimalWindow},${(profile.optimalAccuracy * 100).toFixed(2)}`
      );
    }
  }

  writeFileSync(CSV_FILE, rows.join('\n'));
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  try {
    // Parse arguments
    const args = process.argv.slice(2);
    let filterProfile: string | null = null;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--profile' && args[i + 1]) {
        filterProfile = args[i + 1];
        i++;
      }
    }

    console.log('Loading validation dataset...');
    const conversations = loadValidationDataset();
    console.log(`Loaded ${conversations.length} conversations`);

    // Get unique profiles
    const profiles = Array.from(new Set(conversations.map(c => c.profile_id)));
    const profilesToTest = filterProfile ? [filterProfile] : profiles;

    console.log(`\nTesting profiles: ${profilesToTest.join(', ')}`);
    console.log(`Context window sizes: ${CONTEXT_WINDOWS.join(', ')}`);
    console.log(`Total benchmark runs: ${profilesToTest.length * CONTEXT_WINDOWS.length}`);
    console.log('');

    // Run benchmarks
    const profileResults: ProfileResults[] = [];

    for (const profile of profilesToTest) {
      console.log(`Benchmarking profile: ${profile}`);
      const result = await benchmarkProfile(profile, conversations);
      profileResults.push(result);
      console.log(
        `  ✓ Optimal: Window=${result.optimalWindow}, Accuracy=${(result.optimalAccuracy * 100).toFixed(2)}%`
      );
    }

    // Generate and save report
    console.log('\nGenerating report...');
    const report = generateReport(profileResults);

    // Create output directory
    mkdirSync(OUTPUT_DIR, { recursive: true });

    // Save files
    saveRecommendations(report);
    saveCSV(report);

    // Print report
    const formattedReport = formatAccuracyReport(report);
    console.log('\n' + formattedReport);

    console.log(`\nResults saved to:`);
    console.log(`  JSON: ${REPORT_FILE}`);
    console.log(`  CSV:  ${CSV_FILE}`);

    process.exit(0);
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(1);
  }
}

main();
