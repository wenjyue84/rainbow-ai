/**
 * analytics-classifier-baseline.ts
 *
 * Analyzes intent classifier accuracy per profile per intent.
 * Compares current accuracy against stored baselines and reports deltas.
 *
 * Usage: npm run analytics:classifier-baseline
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "../shared/schema-tables.js";

const { Pool } = pg;

interface AccuracyResult {
  profileId: string;
  intentType: string;
  totalCount: number;
  correctCount: number;
  accuracyPct: number;
}

interface BaselineResult {
  profileId: string;
  intentType: string;
  storedAccuracyPct: number;
  sampleCount: number;
  baselineDate: Date;
}

interface DeltaReport {
  profileId: string;
  intentType: string;
  currentAccuracy: number;
  baselineAccuracy: number;
  delta: number;
  deltaPct: string;
  currentSampleCount: number;
  status: "pass" | "degraded" | "improved" | "new";
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    console.log("🔍 Analyzing intent classifier accuracy baselines...\n");

    // Get raw results using raw SQL for better control
    const accuracyRows = await pool.query<AccuracyResult>(`
      SELECT
        p.profile_id as "profileId",
        p.predicted_intent as "intentType",
        COUNT(*) as "totalCount",
        SUM(CASE WHEN p.was_correct = true THEN 1 ELSE 0 END) as "correctCount",
        ROUND(
          (SUM(CASE WHEN p.was_correct = true THEN 1 ELSE 0 END)::NUMERIC / COUNT(*)::NUMERIC) * 100,
          2
        ) as "accuracyPct"
      FROM intent_predictions p
      WHERE p.was_correct IS NOT NULL
      GROUP BY p.profile_id, p.predicted_intent
      ORDER BY p.profile_id, p.predicted_intent
    `);

    // Get stored baselines
    const baselineRows = await pool.query<BaselineResult>(`
      SELECT
        profile_id as "profileId",
        intent_type as "intentType",
        accuracy_pct as "storedAccuracyPct",
        sample_count as "sampleCount",
        baseline_date as "baselineDate"
      FROM intent_classifier_baselines
      ORDER BY profile_id, intent_type
    `);

    // Create a map of current accuracies for easy lookup
    const currentMap = new Map<string, AccuracyResult>();
    for (const row of accuracyRows.rows) {
      const key = `${row.profileId}:${row.intentType}`;
      currentMap.set(key, row);
    }

    // Create a map of baselines for easy lookup
    const baselineMap = new Map<string, BaselineResult>();
    for (const row of baselineRows.rows) {
      const key = `${row.profileId}:${row.intentType}`;
      baselineMap.set(key, row);
    }

    // Generate delta report
    const deltaReport: DeltaReport[] = [];
    const allKeys = new Set([...currentMap.keys(), ...baselineMap.keys()]);

    for (const key of allKeys) {
      const [profileId, intentType] = key.split(":");
      const current = currentMap.get(key);
      const baseline = baselineMap.get(key);

      if (!current) {
        continue;
      }

      if (!baseline) {
        deltaReport.push({
          profileId,
          intentType,
          currentAccuracy: current.accuracyPct,
          baselineAccuracy: 0,
          delta: current.accuracyPct,
          deltaPct: "new",
          currentSampleCount: current.totalCount,
          status: "new",
        });
        continue;
      }

      const delta = current.accuracyPct - baseline.storedAccuracyPct;
      const status =
        delta < -5
          ? "degraded"
          : delta > 5
            ? "improved"
            : "pass";

      deltaReport.push({
        profileId,
        intentType,
        currentAccuracy: current.accuracyPct,
        baselineAccuracy: baseline.storedAccuracyPct,
        delta,
        deltaPct: delta === 0 ? "0%" : (delta > 0 ? "+" : "") + delta.toFixed(2) + "%",
        currentSampleCount: current.totalCount,
        status,
      });
    }

    // Print report
    console.log("📊 ACCURACY DELTA REPORT");
    console.log("═".repeat(100));
    console.log(
      "Profile ID | Intent Type       | Current % | Baseline % | Delta | Status     | Samples"
    );
    console.log("─".repeat(100));

    let degradedCount = 0;
    let improvedCount = 0;
    let passCount = 0;
    let newCount = 0;

    for (const report of deltaReport) {
      const status = report.status.padEnd(10);
      const currentStr = report.currentAccuracy.toFixed(2).padStart(8);
      const baselineStr = report.baselineAccuracy.toFixed(2).padStart(8);
      const deltaStr = report.deltaPct.padStart(6);
      const profileStr = report.profileId.padEnd(10);
      const intentStr = report.intentType.padEnd(17);
      const samplesStr = report.currentSampleCount.toString().padStart(7);

      console.log(
        `${profileStr} | ${intentStr} | ${currentStr} | ${baselineStr} | ${deltaStr} | ${status} | ${samplesStr}`
      );

      if (report.status === "degraded") degradedCount++;
      else if (report.status === "improved") improvedCount++;
      else if (report.status === "pass") passCount++;
      else if (report.status === "new") newCount++;
    }

    console.log("═".repeat(100));
    console.log(
      `\n📈 Summary: ${passCount} pass | ${improvedCount} improved | ${degradedCount} degraded | ${newCount} new\n`
    );

    if (degradedCount > 0) {
      console.log(
        "⚠️  WARNING: Classifier accuracy has degraded for " +
          degradedCount +
          " intent(s)\n"
      );
    }

    // Per-profile isolation check
    console.log("\n🔒 PROFILE ISOLATION CHECK");
    console.log("─".repeat(50));

    const profileIds = new Set(Array.from(allKeys).map((k) => k.split(":")[0]));
    for (const profileId of profileIds) {
      const profileIntents = Array.from(allKeys)
        .filter((k) => k.startsWith(profileId + ":"))
        .map((k) => k.split(":")[1]);
      console.log(`${profileId}: ${profileIntents.length} intent types`);
    }

    console.log("\n✅ Analysis complete!\n");

    await pool.end();
  } catch (error) {
    console.error("❌ Error analyzing baselines:", error);
    await pool.end();
    process.exit(1);
  }
}

main();
