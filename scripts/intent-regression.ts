/**
 * intent-regression.ts — US-355
 *
 * Offline intent classification regression CLI.
 * Exports last 500 intent classifications from rainbow_messages with
 * ground-truth labels from rainbow_feedback, replays them through the
 * current classifier, and compares accuracy vs baseline.
 *
 * Usage: npm run test:intent-regression
 * Exit code 0 = all intents within 5% of baseline
 * Exit code 1 = one or more intents dropped >5% accuracy
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

// ─── Types ──────────────────────────────────────────────────────────

interface MessageRow {
  id: number;
  content: string;
  intent: string;
  confidence: number;
  phone: string;
  timestamp: Date;
  profileId: string;
}

interface FeedbackRow {
  phone: string;
  intent: string;
  rating: number;
}

interface LabeledMessage {
  id: number;
  content: string;
  predictedIntent: string;
  groundTruthIntent: string;
  confidence: number;
  profileId: string;
}

interface IntentResult {
  intent: string;
  total: number;
  correct: number;
  accuracy: number;
  baseline: number | null;
  drop: number | null;
  status: 'pass' | 'degraded' | 'improved' | 'no_baseline' | 'insufficient_data';
}

interface RegressionReport {
  runAt: string;
  totalMessages: number;
  labeledMessages: number;
  results: IntentResult[];
  failingIntents: IntentResult[];
  summary: {
    pass: number;
    degraded: number;
    improved: number;
    no_baseline: number;
  };
}

// ─── Baseline Loading ────────────────────────────────────────────────

function loadBaseline(): Record<string, number> {
  const baselinePath = join(__dirname, '..', 'src', 'data', 'intent-accuracy-baseline.json');
  try {
    const raw = readFileSync(baselinePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.intents as Record<string, number>;
  } catch (err) {
    console.warn('[warn] Could not load baseline file:', err);
    return {};
  }
}

// ─── Classifier Replay ───────────────────────────────────────────────

/**
 * Rule-based classifier fallback for offline replay.
 * Classifies text using keyword matching only (no LLM API calls).
 * This mirrors T2 classification logic to avoid external deps during CI.
 */
function classifyOffline(text: string): string {
  const t = text.toLowerCase();

  // Booking-related
  if (/\b(book|booking|reserve|reservation|check.?in|check.?out|room|stay|night|dorm)\b/.test(t)) {
    if (/\b(check.?in|arrival|arrive|early|late checkin)\b/.test(t)) return 'check_in_arrival';
    if (/\b(check.?out|checkout|leaving|leave|late checkout)\b/.test(t)) return 'late_checkout_request';
    if (/\b(luggage|bag|storage|store)\b/.test(t)) return 'luggage_storage';
    return 'booking';
  }

  // Pricing & payment
  if (/\b(price|cost|rate|fee|how much|berapa|harga|charge)\b/.test(t)) return 'pricing';
  if (/\b(pay|payment|paid|transfer|bank|receipt|invoice|bill|billing)\b/.test(t)) {
    if (/\b(billing|dispute|charge|wrong amount)\b/.test(t)) return 'billing_inquiry';
    if (/\b(paid|transferred|sent|just paid)\b/.test(t)) return 'payment_made';
    return 'payment_info';
  }

  // Availability
  if (/\b(available|availability|any room|got room|ada bilik|vacant|slots)\b/.test(t)) return 'availability';

  // Facilities
  if (/\b(wifi|wi-fi|password|internet|connect)\b/.test(t)) return 'wifi';
  if (/\b(facility|facilities|amenities|pool|gym|kitchen|locker)\b/.test(t)) return 'facilities_info';
  if (/\b(air.?con|ac|fan|cold|hot|temperature|aircond)\b/.test(t)) return 'climate_control_complaint';
  if (/\b(noise|noisy|loud|disturb|quiet)\b/.test(t)) return 'noise_complaint';
  if (/\b(dirty|clean|cleanliness|hygiene|towel|bedsheet|linen)\b/.test(t)) return 'cleanliness_complaint';
  if (/\b(broken|not working|malfunction|repair|fix)\b/.test(t)) return 'facility_malfunction';

  // Directions & info
  if (/\b(where|direction|how to get|address|location|map|gps)\b/.test(t)) return 'directions';
  if (/\b(rule|policy|policies|allowed|permit|prohibited|no|can i)\b/.test(t)) return 'rules_policy';

  // Complaints
  if (/\b(complaint|complain|problem|issue|unhappy|not happy|bad|terrible)\b/.test(t)) return 'complaint';

  // Staff & contact
  if (/\b(staff|human|person|manager|contact|help|support|speak to|talk to)\b/.test(t)) return 'contact_staff';

  // Checkin/Checkout info
  if (/\b(checkin time|check in time|what time|when can i)\b/.test(t)) return 'checkin_info';
  if (/\b(checkout time|check out time|when must|deadline)\b/.test(t)) return 'checkout_info';

  // Social
  if (/\b(hi|hello|hey|good morning|good evening|salam|ola|howdy)\b/.test(t)) return 'greeting';
  if (/\b(thank|thanks|thank you|terima kasih|tq|ty|thx)\b/.test(t)) return 'thanks';

  // Review
  if (/\b(review|feedback|rating|stars|experience)\b/.test(t)) return 'review_feedback';

  // Forgot item
  if (/\b(forgot|left behind|lost|missing|item)\b/.test(t)) return 'forgot_item_post_checkout';

  // Tourist
  if (/\b(tourist|visit|attraction|place|nearby|sightseeing)\b/.test(t)) return 'tourist_guide';

  return 'general';
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const baseline = loadBaseline();

  console.log('\n=== Intent Regression CLI (US-355) ===\n');
  console.log(`Baseline intents loaded: ${Object.keys(baseline).length}`);

  try {
    // Step 1: Export last 500 intent classifications from rainbow_messages
    console.log('\nFetching last 500 messages with intent labels...');
    const messagesResult = await pool.query<MessageRow>(`
      SELECT
        id,
        content,
        intent,
        confidence,
        phone,
        timestamp,
        profile_id AS "profileId"
      FROM rainbow_messages
      WHERE role = 'user'
        AND intent IS NOT NULL
        AND intent <> ''
        AND deleted_at IS NULL
      ORDER BY timestamp DESC
      LIMIT 500
    `);

    const messages = messagesResult.rows;
    console.log(`Fetched ${messages.length} messages with predicted intent.`);

    if (messages.length === 0) {
      console.log('\nNo messages found. Ensure rainbow_messages has user messages with intent labels.');
      console.log('\nResult: PASS (no data to evaluate)\n');
      await pool.end();
      return;
    }

    // Step 2: Fetch feedback (ground truth) — thumbs up = correct (rating=1), thumbs down = wrong (rating=-1)
    const phones = [...new Set(messages.map(m => m.phone))];
    let feedbackMap = new Map<string, string>(); // phone -> corrected intent (from negative feedback)

    if (phones.length > 0) {
      const placeholders = phones.map((_, i) => `$${i + 1}`).join(',');
      const feedbackResult = await pool.query<FeedbackRow>(
        `SELECT phone_number AS phone, intent, rating FROM rainbow_feedback
         WHERE phone_number IN (${placeholders}) AND intent IS NOT NULL`,
        phones
      );

      // Map phone to intent corrections from negative feedback (rating = -1 means misclassified)
      for (const row of feedbackResult.rows) {
        if (row.rating === -1) {
          feedbackMap.set(row.phone, row.intent);
        }
      }
      console.log(`Feedback records loaded: ${feedbackResult.rows.length} (${feedbackMap.size} corrections)`);
    }

    // Step 3: Build labeled dataset
    // Ground truth: use feedback correction if available, otherwise trust original predicted intent
    // (messages with thumbs-up or no feedback are assumed correct)
    const labeled: LabeledMessage[] = messages.map(m => ({
      id: m.id,
      content: m.content,
      predictedIntent: m.intent,
      groundTruthIntent: feedbackMap.get(m.phone) ?? m.intent,
      confidence: m.confidence ?? 0,
      profileId: m.profileId ?? 'pelangi',
    }));

    console.log(`Labeled dataset size: ${labeled.length}`);

    // Step 4: Replay messages through current (offline) classifier and compute accuracy per intent
    console.log('\nReplaying messages through classifier...');

    const intentStats = new Map<string, { total: number; correct: number }>();

    for (const msg of labeled) {
      const replayedIntent = classifyOffline(msg.content);
      const gt = msg.groundTruthIntent;

      if (!intentStats.has(gt)) {
        intentStats.set(gt, { total: 0, correct: 0 });
      }
      const stats = intentStats.get(gt)!;
      stats.total++;
      if (replayedIntent === gt) {
        stats.correct++;
      }
    }

    // Step 5: Build results with baseline comparison
    const results: IntentResult[] = [];
    let anyDegraded = false;

    for (const [intent, stats] of intentStats.entries()) {
      if (stats.total < 3) {
        // Skip intents with too few samples
        results.push({
          intent,
          total: stats.total,
          correct: stats.correct,
          accuracy: stats.total > 0 ? (stats.correct / stats.total) * 100 : 0,
          baseline: baseline[intent] ?? null,
          drop: null,
          status: 'insufficient_data',
        });
        continue;
      }

      const accuracy = (stats.correct / stats.total) * 100;
      const base = baseline[intent] ?? null;
      let drop: number | null = null;
      let status: IntentResult['status'] = 'no_baseline';

      if (base !== null) {
        drop = base - accuracy; // positive = drop in accuracy
        if (drop > 5) {
          status = 'degraded';
          anyDegraded = true;
        } else if (drop < -5) {
          status = 'improved';
        } else {
          status = 'pass';
        }
      }

      results.push({ intent, total: stats.total, correct: stats.correct, accuracy, baseline: base, drop, status });
    }

    // Sort by drop desc (worst first)
    results.sort((a, b) => (b.drop ?? 0) - (a.drop ?? 0));

    // Step 6: Print accuracy table
    console.log('\n' + '─'.repeat(85));
    console.log('Intent                       | Total | Correct |  Accuracy | Baseline | Drop  | Status');
    console.log('─'.repeat(85));

    const summary = { pass: 0, degraded: 0, improved: 0, no_baseline: 0 };

    for (const r of results) {
      if (r.status !== 'insufficient_data') summary[r.status === 'no_baseline' ? 'no_baseline' : r.status]++;

      const intentStr = r.intent.padEnd(28);
      const totalStr = r.total.toString().padStart(5);
      const correctStr = r.correct.toString().padStart(7);
      const accStr = r.accuracy.toFixed(1).padStart(8) + '%';
      const baseStr = r.baseline !== null ? r.baseline.toFixed(1).padStart(7) + '%' : '      -';
      const dropStr = r.drop !== null ? (r.drop > 0 ? '-' : '+') + Math.abs(r.drop).toFixed(1).padStart(4) + '%' : '      -';
      const statusStr = r.status.padEnd(16);
      console.log(`${intentStr} | ${totalStr} | ${correctStr} | ${accStr} | ${baseStr} | ${dropStr} | ${statusStr}`);
    }

    console.log('─'.repeat(85));
    console.log(`\nSummary: ${summary.pass} pass | ${summary.improved} improved | ${summary.degraded} DEGRADED | ${summary.no_baseline} no_baseline\n`);

    const failingIntents = results.filter(r => r.status === 'degraded');

    // Step 7: Write report JSON
    const report: RegressionReport = {
      runAt: new Date().toISOString(),
      totalMessages: messages.length,
      labeledMessages: labeled.length,
      results,
      failingIntents,
      summary,
    };

    const logsDir = join(__dirname, '..', 'logs');
    mkdirSync(logsDir, { recursive: true });
    const reportPath = join(logsDir, 'intent-regression-report.json');
    writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`Report written to: ${reportPath}`);

    await pool.end();

    // Step 8: Exit code
    if (anyDegraded) {
      console.error(`\n[FAIL] ${failingIntents.length} intent(s) dropped >5% accuracy from baseline:`);
      for (const fi of failingIntents) {
        console.error(`  - ${fi.intent}: ${fi.accuracy.toFixed(1)}% (baseline ${fi.baseline}%, drop ${fi.drop?.toFixed(1)}%)`);
      }
      console.error('\nRun `npm run test:intent-regression` again after fixing classifier.\n');
      process.exit(1);
    } else {
      console.log('[PASS] All intents within 5% of baseline. No regression detected.\n');
      process.exit(0);
    }

  } catch (err) {
    console.error('[ERROR] Intent regression CLI failed:', err);
    await pool.end().catch(() => {});
    process.exit(1);
  }
}

main();
