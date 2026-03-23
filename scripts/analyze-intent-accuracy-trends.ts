/**
 * analyze-intent-accuracy-trends.ts (US-265)
 *
 * CLI: npm run analyze:intent-accuracy-trends
 *
 * Shows per-profile accuracy trends with regression indicators.
 * Reads from the intent_accuracy_snapshots table.
 */

import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

interface SnapshotRow {
  profile: string;
  date: Date;
  accuracy: number;
  baseline: number | null;
  sample_count: number;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log("Analyzing intent accuracy trends...\n");

    // Fetch recent snapshots (last 30 days) ordered by profile + date
    const result = await pool.query<SnapshotRow>(`
      SELECT
        profile,
        date,
        accuracy,
        baseline,
        sample_count
      FROM intent_accuracy_snapshots
      WHERE date >= NOW() - INTERVAL '30 days'
      ORDER BY profile, date DESC
    `);

    if (result.rows.length === 0) {
      console.log("No accuracy snapshots found in the last 30 days.");
      console.log("Run the daily accuracy snapshot job first to generate data.");
      await pool.end();
      return;
    }

    // Group by profile
    const byProfile = new Map<string, SnapshotRow[]>();
    for (const row of result.rows) {
      const existing = byProfile.get(row.profile) ?? [];
      existing.push(row);
      byProfile.set(row.profile, existing);
    }

    // Print per-profile report
    console.log("INTENT ACCURACY TRENDS (Last 30 Days)");
    console.log("=".repeat(95));
    console.log(
      "Profile    | Date       | Accuracy | Baseline | Delta    | Samples | Status"
    );
    console.log("-".repeat(95));

    let totalRegressions = 0;
    let totalSnapshots = 0;

    for (const [profile, snapshots] of byProfile) {
      for (const snap of snapshots) {
        totalSnapshots++;
        const dateStr = snap.date instanceof Date
          ? snap.date.toISOString().slice(0, 10)
          : String(snap.date).slice(0, 10);
        const accStr = snap.accuracy.toFixed(1).padStart(7) + "%";
        const baseStr = snap.baseline !== null
          ? snap.baseline.toFixed(1).padStart(7) + "%"
          : "    N/A ";
        const profileStr = profile.padEnd(10);

        let delta = "";
        let status = "";
        if (snap.baseline !== null) {
          const diff = snap.accuracy - snap.baseline;
          delta = (diff >= 0 ? "+" : "") + diff.toFixed(1) + "pp";
          delta = delta.padStart(8);

          if (diff < -5) {
            status = "REGRESSION";
            totalRegressions++;
          } else if (diff > 5) {
            status = "IMPROVED";
          } else {
            status = "STABLE";
          }
        } else {
          delta = "    N/A ";
          status = "NEW";
        }

        const samplesStr = snap.sample_count.toString().padStart(7);

        console.log(
          `${profileStr} | ${dateStr} | ${accStr} | ${baseStr} | ${delta} | ${samplesStr} | ${status}`
        );
      }
    }

    console.log("=".repeat(95));

    // Summary
    const profileCount = byProfile.size;
    console.log(
      `\nSummary: ${profileCount} profile(s), ${totalSnapshots} snapshot(s), ` +
      `${totalRegressions} regression(s) detected\n`
    );

    if (totalRegressions > 0) {
      console.log(
        `WARNING: ${totalRegressions} regression(s) detected where accuracy dropped >5% from baseline\n`
      );
    }

    // Latest accuracy per profile
    console.log("LATEST ACCURACY PER PROFILE");
    console.log("-".repeat(50));
    for (const [profile, snapshots] of byProfile) {
      const latest = snapshots[0]!; // already sorted DESC
      const dateStr = latest.date instanceof Date
        ? latest.date.toISOString().slice(0, 10)
        : String(latest.date).slice(0, 10);
      console.log(
        `  ${profile.padEnd(15)} ${latest.accuracy.toFixed(1)}% (${dateStr}, n=${latest.sample_count})`
      );
    }
    console.log();

    await pool.end();
  } catch (error) {
    console.error("Error analyzing accuracy trends:", error);
    await pool.end();
    process.exit(1);
  }
}

main();
