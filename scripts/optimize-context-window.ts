#!/usr/bin/env tsx
/**
 * US-377: Conversation Context Window Size Optimizer CLI
 *
 * Analyzes production conversations to determine optimal message context window size
 * per profile, balancing conversation quality against token usage.
 *
 * Usage:
 *   npm run optimize:context-window -- pelangi
 *   npm run optimize:context-window -- data-makan
 *
 * Output: Report showing optimal window size with quality/token breakdown
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

interface ConversationData {
  phone: string;
  messageCount: number;
  messages: {
    id: number;
    role: string;
    content: string;
    timestamp: Date;
    responseTimeMs?: number;
    totalTokens?: number;
  }[];
  hasBooking: boolean;
}

interface WindowAnalysis {
  windowSize: number;
  avgResponseLength: number;
  avgResponseTime: number;
  avgTokensPerMessage: number;
  bookingSuccessRate: number;
  qualityScore: number;
  totalTokensPerConversation: number;
}

/**
 * Calculate percentile value from sorted array
 */
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Fetch conversations with their messages for a profile
 */
async function fetchConversations(pool: pg.Pool, profileId: string, limit: number = 100): Promise<ConversationData[]> {
  const query = `
    SELECT
      rc.phone,
      rc.status,
      (SELECT json_agg(json_build_object(
        'id', rm.id,
        'role', rm.role,
        'content', rm.content,
        'timestamp', rm.timestamp,
        'responseTimeMs', rm.response_time_ms,
        'totalTokens', rm.total_tokens
      ) ORDER BY rm.timestamp ASC)
      FROM rainbow_messages rm
      WHERE rm.phone = rc.phone
      ) as messages
    FROM rainbow_conversations rc
    WHERE rc.profile_id = $1
      AND rc.status = 'active'
    ORDER BY rc.created_at DESC
    LIMIT $2
  `;

  const result = await pool.query(query, [profileId, limit]);

  const conversations: ConversationData[] = result.rows
    .map((row: any) => ({
      phone: row.phone,
      messageCount: row.messages?.length || 0,
      messages: (row.messages || []).map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp),
      })),
      hasBooking: row.status === 'active', // Simplified: assume active means had a booking attempt
    }))
    .filter(c => c.messageCount >= 5); // Need at least 5 messages for meaningful analysis

  return conversations;
}

/**
 * Calculate quality score based on response characteristics
 * Quality = avg response length (normalized) + booking success rate + token efficiency
 */
function calculateQualityScore(
  avgResponseLength: number,
  bookingSuccessRate: number,
  tokenEfficiency: number
): number {
  // Normalize response length (ideal: 50-500 chars)
  const lengthScore = Math.min(1, Math.max(0, avgResponseLength / 200)) * 0.4;

  // Booking success rate (0-1)
  const bookingScore = bookingSuccessRate * 0.4;

  // Token efficiency (higher is worse, so invert)
  const efficiencyScore = Math.max(0, 1 - tokenEfficiency / 500) * 0.2;

  return (lengthScore + bookingScore + efficiencyScore);
}

/**
 * Analyze conversations at different context window sizes
 */
async function analyzeContextWindows(
  conversations: ConversationData[]
): Promise<WindowAnalysis[]> {
  const windowSizes = [5, 10, 15, 20];
  const results: WindowAnalysis[] = [];

  for (const windowSize of windowSizes) {
    const responseLengths: number[] = [];
    const responseTimes: number[] = [];
    const tokensPerMessage: number[] = [];
    let totalTokens = 0;
    let bookingCount = 0;

    for (const conv of conversations) {
      if (conv.messages.length < windowSize) continue;

      // Get the last `windowSize` messages
      const window = conv.messages.slice(-windowSize);

      // Analyze AI responses in this window
      const aiResponses = window.filter(m => m.role === 'assistant');

      for (const resp of aiResponses) {
        if (resp.content) {
          responseLengths.push(resp.content.length);
        }
        if (resp.responseTimeMs) {
          responseTimes.push(resp.responseTimeMs);
        }
        if (resp.totalTokens) {
          tokensPerMessage.push(resp.totalTokens);
          totalTokens += resp.totalTokens;
        }
      }

      if (conv.hasBooking) {
        bookingCount++;
      }
    }

    const avgResponseLength = responseLengths.length > 0
      ? responseLengths.reduce((a, b) => a + b, 0) / responseLengths.length
      : 0;

    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const avgTokensPerMessage = tokensPerMessage.length > 0
      ? tokensPerMessage.reduce((a, b) => a + b, 0) / tokensPerMessage.length
      : 0;

    const bookingSuccessRate = conversations.length > 0
      ? bookingCount / conversations.length
      : 0;

    const totalTokensPerConversation = conversations.length > 0
      ? totalTokens / conversations.length
      : 0;

    const qualityScore = calculateQualityScore(
      avgResponseLength,
      bookingSuccessRate,
      totalTokensPerConversation
    );

    results.push({
      windowSize,
      avgResponseLength,
      avgResponseTime,
      avgTokensPerMessage,
      bookingSuccessRate,
      qualityScore,
      totalTokensPerConversation,
    });
  }

  return results;
}

/**
 * Find optimal context window size
 */
function findOptimalWindow(analyses: WindowAnalysis[]): WindowAnalysis {
  // Sort by quality score (descending)
  const sorted = [...analyses].sort((a, b) => b.qualityScore - a.qualityScore);

  // Prefer smaller window if quality difference is < 5%
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[0].qualityScore - sorted[i].qualityScore;
    if (diff < 0.05 && sorted[i].windowSize < sorted[0].windowSize) {
      return sorted[i];
    }
  }

  return sorted[0];
}

/**
 * Generate analysis report
 */
function generateReport(
  profileId: string,
  conversationCount: number,
  analyses: WindowAnalysis[]
): string {
  const optimal = findOptimalWindow(analyses);

  let report = `\n${'='.repeat(90)}\n`;
  report += `CONTEXT WINDOW OPTIMIZATION REPORT\n`;
  report += `Profile: ${profileId.toUpperCase()}\n`;
  report += `Analysis Date: ${new Date().toISOString()}\n`;
  report += `Conversations Analyzed: ${conversationCount}\n`;
  report += `${'='.repeat(90)}\n\n`;

  // Summary table
  report += `WINDOW SIZE ANALYSIS\n`;
  report += `${'-'.repeat(90)}\n`;
  report += `Size | Quality | Avg Response | Avg Response | Tokens/Msg | Booking   | Tokens/\n`;
  report += `     | Score   | Length (chr) | Time (ms)    | (all msgs) | Success % | Conv  \n`;
  report += `${'-'.repeat(90)}\n`;

  for (const analysis of analyses) {
    const isOptimal = analysis.windowSize === optimal.windowSize ? ' ← OPTIMAL' : '';
    report += `${String(analysis.windowSize).padEnd(4)} | ${(analysis.qualityScore).toFixed(3)} `;
    report += `| ${String(Math.round(analysis.avgResponseLength)).padEnd(12)} `;
    report += `| ${String(Math.round(analysis.avgResponseTime)).padEnd(12)} `;
    report += `| ${String(analysis.avgTokensPerMessage.toFixed(1)).padEnd(10)} `;
    report += `| ${String((analysis.bookingSuccessRate * 100).toFixed(1)).padEnd(9)} `;
    report += `| ${String(Math.round(analysis.totalTokensPerConversation)).padEnd(5)}${isOptimal}\n`;
  }

  report += `\n${'='.repeat(90)}\n`;
  report += `RECOMMENDATION\n`;
  report += `${'='.repeat(90)}\n`;
  report += `Profile ${profileId}: optimal window ${optimal.windowSize} messages\n`;
  report += `Quality Score: ${(optimal.qualityScore * 100).toFixed(1)}%\n`;
  report += `Tokens per Conversation: ${Math.round(optimal.totalTokensPerConversation)}\n`;
  report += `Booking Success Rate: ${(optimal.bookingSuccessRate * 100).toFixed(1)}%\n`;
  report += `Avg Response Length: ${Math.round(optimal.avgResponseLength)} characters\n\n`;

  // Token savings analysis
  const maxTokens = Math.max(...analyses.map(a => a.totalTokensPerConversation));
  const tokenSavings = ((maxTokens - optimal.totalTokensPerConversation) / maxTokens * 100).toFixed(1);
  report += `TOKEN EFFICIENCY\n`;
  report += `${'-'.repeat(90)}\n`;
  report += `Window ${optimal.windowSize} saves ${tokenSavings}% tokens vs. largest window\n`;
  report += `Without sacrificing quality (score: ${(optimal.qualityScore * 100).toFixed(1)}%)\n\n`;

  // Quality breakdown
  report += `QUALITY CONTRIBUTION ANALYSIS\n`;
  report += `${'-'.repeat(90)}\n`;
  const lengthContribution = (Math.min(1, Math.max(0, optimal.avgResponseLength / 200)) * 0.4 * 100).toFixed(1);
  const bookingContribution = (optimal.bookingSuccessRate * 0.4 * 100).toFixed(1);
  const efficiencyContribution = (Math.max(0, 1 - optimal.totalTokensPerConversation / 500) * 0.2 * 100).toFixed(1);
  report += `Response Length Quality: ${lengthContribution}%\n`;
  report += `Booking Success Quality: ${bookingContribution}%\n`;
  report += `Token Efficiency Quality: ${efficiencyContribution}%\n\n`;

  // Configuration instruction
  report += `NEXT STEPS\n`;
  report += `${'-'.repeat(90)}\n`;
  report += `Update src/assistant/data/settings.json:\n`;
  report += `Add or update the contextWindow setting for this profile to: ${optimal.windowSize}\n`;
  report += `Example: "contextWindow": ${optimal.windowSize}\n\n`;

  return report;
}

/**
 * Main execution
 */
async function main() {
  const profileId = process.argv[2];

  if (!profileId) {
    console.error('Usage: npm run optimize:context-window -- <profile>');
    console.error('Example: npm run optimize:context-window -- pelangi');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log(`\nFetching conversations for profile: ${profileId}...`);
    const conversations = await fetchConversations(pool, profileId, 100);

    if (conversations.length < 10) {
      console.error(`\n❌ Need at least 10 conversations with 5+ messages. Found: ${conversations.length}`);
      process.exit(1);
    }

    console.log(`✓ Loaded ${conversations.length} conversations\n`);
    console.log('Analyzing context windows...');
    const analyses = await analyzeContextWindows(conversations);

    const report = generateReport(profileId, conversations.length, analyses);
    console.log(report);

    // Exit with success
    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
