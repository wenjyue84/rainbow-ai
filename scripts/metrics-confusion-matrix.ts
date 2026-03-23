#!/usr/bin/env node
/**
 * metrics-confusion-matrix.ts
 *
 * CLI tool for generating intent classification confusion matrix from production logs.
 * Analyzes misclassifications to identify which intent pairs are commonly confused.
 *
 * Usage:
 *   npm run metrics:confusion-matrix
 *   npm run metrics:confusion-matrix -- --profile=pelangi --days=7
 *   npm run metrics:confusion-matrix -- --profile=southern --days=30
 *
 * US-131: Generate intent classification confusion matrix from production logs
 */

import { Pool } from "pg";
import { generateConfusionMatrix } from "../src/tools/confusion-matrix-generator.js";

interface Args {
  profile: string;
  days: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const profileIdx = args.findIndex((arg) => arg.startsWith("--profile="));
  const daysIdx = args.findIndex((arg) => arg.startsWith("--days="));

  return {
    profile: profileIdx >= 0
      ? args[profileIdx].split("=")[1] || "pelangi"
      : "pelangi",
    days: daysIdx >= 0 ? parseInt(args[daysIdx].split("=")[1] || "7", 10) : 7,
  };
}

function outputCsv(result: Awaited<ReturnType<typeof generateConfusionMatrix>>) {
  // CSV header
  console.log(
    "PredictedIntent,ActualIntent,Count,Percentage,AccuracyNote"
  );

  // CSV rows for top 5 pairs
  for (const pair of result.topPairs) {
    const percentage = pair.percentage.toFixed(2);
    console.log(
      `"${pair.predictedIntent}","${pair.actualIntent}",${pair.count},${percentage}%,"Confusion: predicted ${pair.predictedIntent} but was ${pair.actualIntent}"`
    );
  }
}

async function main() {
  const { profile, days } = parseArgs();

  // Validate database URL
  if (!process.env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL environment variable not set");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Intent Classification Confusion Matrix (US-131)");
    console.log(`  Profile: ${profile} | Days: ${days}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    const result = await generateConfusionMatrix(pool, profile, days);

    // Summary stats
    console.log(`Total Evaluated Messages: ${result.totalEvaluatedMessages}`);
    console.log(
      `Total Misclassifications: ${result.totalMisclassifications}`
    );
    console.log(`Overall Accuracy: ${result.accuracy.toFixed(2)}%`);
    console.log("\nTop 5 Misclassified Intent Pairs:\n");

    // Output CSV
    outputCsv(result);

    console.log("\n═══════════════════════════════════════════════════════════\n");
  } catch (error) {
    console.error("Error generating confusion matrix:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
