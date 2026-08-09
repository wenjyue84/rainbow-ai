/**
 * tools/context-window-benchmark.ts
 *
 * US-401: Multi-Turn Accuracy Baseline by Context Window Size
 *
 * Benchmarks intent classification accuracy with varying conversation history lengths.
 * Tests against labeled validation dataset and reports optimal context window per profile
 * with accuracy deltas.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ChatMessage } from '../src/assistant/types.js';

interface ValidationConversation {
  profile_id: string;
  conversation_id: string;
  ground_truth_intent: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface WindowResult {
  window_size: number;
  accuracy: number;
  correct: number;
  total: number;
}

interface ProfileRecommendation {
  profile_id: string;
  optimal_window_size: number;
  accuracy_at_optimal: number;
  confidence_interval_95: {
    lower: number;
    upper: number;
  };
  window_results: WindowResult[];
}

interface BenchmarkReport {
  timestamp: string;
  profiles: ProfileRecommendation[];
  summary: {
    total_conversations: number;
    total_profiles: number;
    avg_improvement: number;
  };
}

const WINDOW_SIZES = [3, 5, 10, 20];
const FIXTURE_PATH = resolve(process.cwd(), 'tests/fixtures/validation_conversations.jsonl');

/**
 * Load validation conversations from JSONL fixture.
 * Returns array of conversations grouped by profile_id.
 */
function loadValidationConversations(): Map<string, ValidationConversation[]> {
  const content = readFileSync(FIXTURE_PATH, 'utf-8');
  const lines = content.trim().split('\n');
  const byProfile = new Map<string, ValidationConversation[]>();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const conv = JSON.parse(line) as ValidationConversation;
      if (!byProfile.has(conv.profile_id)) {
        byProfile.set(conv.profile_id, []);
      }
      byProfile.get(conv.profile_id)!.push(conv);
    } catch (err: any) {
      console.error(`Failed to parse line: ${line.substring(0, 50)}...`, err.message);
    }
  }

  return byProfile;
}

/**
 * Extract the last N messages from a conversation, handling both user and assistant messages.
 * Returns a ChatMessage array suitable for passing to classifyIntent.
 */
function getConversationContext(
  messages: ValidationConversation['messages'],
  count: number
): ChatMessage[] {
  if (count >= messages.length) {
    return messages.map(m => ({
      role: m.role,
      content: m.content,
    })) as ChatMessage[];
  }

  // Take the last `count` messages
  const startIdx = Math.max(0, messages.length - count);
  return messages.slice(startIdx).map(m => ({
    role: m.role,
    content: m.content,
  })) as ChatMessage[];
}

/**
 * Run classification benchmark for a single profile.
 * Optionally provide a custom classify function for testing.
 *
 * Returns accuracy results for each window size.
 */
export async function benchmarkProfile(
  profileId: string,
  conversations: ValidationConversation[],
  classifyFn?: (text: string, history: ChatMessage[]) => Promise<{ category: string; confidence: number }>,
): Promise<ProfileRecommendation> {
  // Use lazy import of the classification function
  if (!classifyFn) {
    const { classifyIntent } = await import('../src/assistant/ai-classification.js');
    classifyFn = (text, history) =>
      classifyIntent(text, history).then(result => ({
        category: result.category,
        confidence: result.confidence,
      }));
  }

  const windowResults: WindowResult[] = [];

  for (const windowSize of WINDOW_SIZES) {
    let correct = 0;
    const total = conversations.length;

    for (const conv of conversations) {
      if (conv.messages.length === 0) continue;

      // Get the last message (ground truth query) and its context
      const lastMsg = conv.messages[conv.messages.length - 1];
      const contextMsgs = conv.messages.slice(0, -1);
      const history = getConversationContext(contextMsgs, windowSize);

      try {
        const result = await classifyFn(lastMsg.content, history);
        if (result.category === conv.ground_truth_intent) {
          correct++;
        }
      } catch (err: any) {
        console.error(`Classification failed for ${conv.conversation_id}:`, err.message);
      }
    }

    const accuracy = total > 0 ? correct / total : 0;
    windowResults.push({
      window_size: windowSize,
      accuracy,
      correct,
      total,
    });
  }

  // Find optimal window (highest accuracy)
  const optimal = windowResults.reduce((best, current) =>
    current.accuracy > best.accuracy ? current : best
  );

  // Calculate 95% confidence interval using normal approximation
  // CI = p ± z * sqrt(p(1-p)/n) where z=1.96 for 95%
  const p = optimal.accuracy;
  const n = optimal.total;
  const z = 1.96;
  const se = Math.sqrt((p * (1 - p)) / n);
  const margin = z * se;

  return {
    profile_id: profileId,
    optimal_window_size: optimal.window_size,
    accuracy_at_optimal: optimal.accuracy,
    confidence_interval_95: {
      lower: Math.max(0, p - margin),
      upper: Math.min(1, p + margin),
    },
    window_results: windowResults,
  };
}

/**
 * Run full benchmark across all profiles.
 * Optionally provide a custom classify function for testing.
 */
export async function runBenchmark(
  classifyFn?: (text: string, history: ChatMessage[]) => Promise<{ category: string; confidence: number }>,
): Promise<BenchmarkReport> {
  const conversations = loadValidationConversations();
  const profileResults: ProfileRecommendation[] = [];
  let totalConversations = 0;

  for (const [profileId, convs] of conversations.entries()) {
    console.log(`\n[Benchmark] Profile: ${profileId}, Conversations: ${convs.length}`);
    totalConversations += convs.length;

    const result = await benchmarkProfile(profileId, convs, classifyFn);
    profileResults.push(result);

    // Print results for this profile
    console.log(`\nResults for ${profileId}:`);
    for (const wr of result.window_results) {
      const pct = (wr.accuracy * 100).toFixed(1);
      console.log(`  Window=${wr.window_size}: ${pct}% (${wr.correct}/${wr.total})`);
    }
    console.log(
      `\n  Optimal: Window=${result.optimal_window_size} with ${(result.accuracy_at_optimal * 100).toFixed(1)}% accuracy`
    );
    console.log(
      `  95% CI: [${(result.confidence_interval_95.lower * 100).toFixed(1)}%, ${(result.confidence_interval_95.upper * 100).toFixed(1)}%]`
    );
  }

  // Calculate average improvement
  let totalImprovement = 0;
  for (const profile of profileResults) {
    const minAccuracy = profile.window_results[0].accuracy;
    const maxAccuracy = profile.window_results[profile.window_results.length - 1].accuracy;
    totalImprovement += maxAccuracy - minAccuracy;
  }
  const avgImprovement = profileResults.length > 0 ? totalImprovement / profileResults.length : 0;

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    profiles: profileResults,
    summary: {
      total_conversations: totalConversations,
      total_profiles: profileResults.length,
      avg_improvement: avgImprovement,
    },
  };

  return report;
}

/**
 * Main entry point: run benchmark and output JSON report.
 */
async function main(): Promise<void> {
  try {
    console.log('[Benchmark] Starting context window benchmark...');
    const report = await runBenchmark();

    console.log('\n\n=== BENCHMARK SUMMARY ===\n');
    console.log(`Total Conversations: ${report.summary.total_conversations}`);
    console.log(`Profiles Tested: ${report.summary.total_profiles}`);
    console.log(
      `Average Improvement: ${(report.summary.avg_improvement * 100).toFixed(1)}% across all profiles`
    );

    // Output recommendation file as JSON
    const recommendations = report.profiles.map(p => ({
      profile_id: p.profile_id,
      optimal_window_size: p.optimal_window_size,
      accuracy_at_optimal: p.accuracy_at_optimal,
      confidence_interval_95: p.confidence_interval_95,
    }));

    console.log('\n=== RECOMMENDATIONS (JSON) ===\n');
    console.log(JSON.stringify(recommendations, null, 2));

    // Write full report to recommendations.json file
    const fs = await import('fs');
    const reportPath = resolve(process.cwd(), 'tools', 'context-window-recommendations.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n[Benchmark] Full report written to ${reportPath}`);

    process.exit(0);
  } catch (err: any) {
    console.error('[Benchmark] Error:', err.message || err);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { BenchmarkReport, ProfileRecommendation, WindowResult };
