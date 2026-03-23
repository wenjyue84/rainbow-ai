/**
 * confusion-matrix-generator.ts
 *
 * Analyzes intent misclassifications from production logs by comparing
 * predicted vs. actual intents. Outputs top misclassified pairs as CSV.
 *
 * Usage:
 *   npm run metrics:confusion-matrix -- --profile=pelangi --days=7
 *   npm run metrics:confusion-matrix -- --profile=southern --days=30 --top=10
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// ── Types ─────────────────────────────────────────────────────────────

export interface ConfusionPair {
  predictedIntent: string;
  actualIntent: string;
  count: number;
  percentage: number;
}

export interface ConfusionMatrixResult {
  profile: string;
  days: number;
  totalEvaluated: number;
  totalMisclassified: number;
  overallAccuracy: number;
  topPairs: ConfusionPair[];
}

// ── Core Logic (pure, testable without DB) ───────────────────────────

/**
 * Build confusion matrix from raw rows of {predictedIntent, actualIntent}.
 * Returns top `topN` misclassified pairs sorted by count descending.
 */
export function buildConfusionMatrix(
  rows: Array<{ predictedIntent: string; actualIntent: string }>,
  topN = 5
): Array<{ predictedIntent: string; actualIntent: string; count: number }> {
  // Map<predictedIntent, Map<actualIntent, count>>
  const matrix = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const { predictedIntent, actualIntent } = row;
    if (!matrix.has(predictedIntent)) {
      matrix.set(predictedIntent, new Map());
    }
    const inner = matrix.get(predictedIntent)!;
    inner.set(actualIntent, (inner.get(actualIntent) ?? 0) + 1);
  }

  // Flatten to pairs
  const pairs: Array<{ predictedIntent: string; actualIntent: string; count: number }> = [];
  for (const [predicted, innerMap] of matrix) {
    for (const [actual, count] of innerMap) {
      pairs.push({ predictedIntent: predicted, actualIntent: actual, count });
    }
  }

  // Sort by count descending, take top N
  pairs.sort((a, b) => b.count - a.count);
  return pairs.slice(0, topN);
}

/**
 * Calculate overall accuracy from total evaluated and misclassified counts.
 */
export function calculateAccuracy(totalEvaluated: number, totalMisclassified: number): number {
  if (totalEvaluated === 0) return 0;
  return Math.round(((totalEvaluated - totalMisclassified) / totalEvaluated) * 10000) / 100;
}

// ── DB Query ──────────────────────────────────────────────────────────

/**
 * Generate confusion matrix from the intent_predictions table.
 */
export async function generateConfusionMatrix(
  pool: pg.Pool,
  profile: string,
  days: number,
  topN = 5
): Promise<ConfusionMatrixResult> {
  // Total evaluated (has actual_intent set)
  // Build WHERE clause dynamically - profile filter is optional
  let whereClause = `WHERE actual_intent IS NOT NULL AND created_at >= NOW() - ($1 || ' days')::interval`;
  const params: (string | number)[] = [days];

  if (profile !== 'all') {
    whereClause += ` AND profile = $2`;
    params.push(profile);
  }

  const totalResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*) as total FROM intent_predictions ${whereClause}`,
    params
  );

  const totalEvaluated = parseInt(totalResult.rows[0]?.total ?? "0", 10);

  // Misclassified rows: predicted != actual
  let misclassWhereClause = `WHERE actual_intent IS NOT NULL AND was_correct = false AND created_at >= NOW() - ($1 || ' days')::interval`;
  const misclassParams: (string | number)[] = [days];

  if (profile !== 'all') {
    misclassWhereClause += ` AND profile = $2`;
    misclassParams.push(profile);
  }

  const misclassRows = await pool.query<{ predictedIntent: string; actualIntent: string }>(
    `SELECT predicted_intent as "predictedIntent", actual_intent as "actualIntent"
     FROM intent_predictions
     ${misclassWhereClause}
     ORDER BY created_at DESC`,
    misclassParams
  );

  const totalMisclassified = misclassRows.rowCount ?? 0;

  const topPairsRaw = buildConfusionMatrix(misclassRows.rows, topN);
  const topPairs: ConfusionPair[] = topPairsRaw.map((p) => ({
    ...p,
    percentage:
      totalMisclassified > 0
        ? Math.round((p.count / totalMisclassified) * 10000) / 100
        : 0,
  }));

  return {
    profile,
    days,
    totalEvaluated,
    totalMisclassified,
    overallAccuracy: calculateAccuracy(totalEvaluated, totalMisclassified),
    topPairs,
  };
}

// ── CSV Formatter ─────────────────────────────────────────────────────

export function formatAsCSV(result: ConfusionMatrixResult): string {
  const lines: string[] = [
    `# Confusion Matrix — profile=${result.profile} days=${result.days}`,
    `# Total evaluated: ${result.totalEvaluated}`,
    `# Total misclassified: ${result.totalMisclassified}`,
    `# Overall accuracy: ${result.overallAccuracy}%`,
    "",
    "predicted_intent,actual_intent,count,percentage",
  ];

  for (const pair of result.topPairs) {
    lines.push(
      `${pair.predictedIntent},${pair.actualIntent},${pair.count},${pair.percentage}`
    );
  }

  return lines.join("\n");
}

// ── CLI Entry Point ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const getArg = (name: string, defaultVal: string): string => {
    const arg = args.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split("=")[1] : defaultVal;
  };

  const profile = getArg("profile", "all");
  const days = parseInt(getArg("days", "7"), 10);
  const top = parseInt(getArg("top", "5"), 10);

  if (!process.env.DATABASE_URL) {
    console.error("Error: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.error(`Generating confusion matrix: profile=${profile} days=${days} top=${top}...`);

    const result = await generateConfusionMatrix(pool, profile, days, top);
    const csv = formatAsCSV(result);

    console.log(csv);
    console.error(`\nDone. Accuracy: ${result.overallAccuracy}%`);
  } finally {
    await pool.end();
  }
}

// Run CLI only when executed directly (not when imported in tests)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  (process.argv[1].endsWith("confusion-matrix-generator.ts") ||
    process.argv[1].endsWith("confusion-matrix-generator.js"));

if (isMain) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
