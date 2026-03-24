/**
 * US-376: Export Hard-Case Labels for Classifier Retraining
 *
 * Generates a JSONL file with labeled hard cases for retraining the intent classifier.
 *
 * Usage:
 *   npm run export:hard-case-labels -- <profile>
 *   npm run export:hard-case-labels -- pelangi
 *   npm run export:hard-case-labels -- southern
 *
 * Output: hard-cases-<profile>-<timestamp>.jsonl
 * Format per line: { "message": "...", "predicted": "booking", "admin_label": "pricing" }
 */

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const profile = process.argv[2] || 'pelangi';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // Query all labeled hard cases for this profile
    const result = await pool.query(
      `SELECT message_text, predicted_intent, admin_label, confidence, created_at
       FROM hard_case_queue
       WHERE profile = $1 AND admin_label IS NOT NULL
       ORDER BY created_at ASC`,
      [profile]
    );

    const rows = result.rows;

    if (rows.length === 0) {
      console.log(`No labeled hard cases found for profile "${profile}".`);
      await pool.end();
      return;
    }

    // Count by intent type
    const countsByIntent: Record<string, number> = {};
    for (const row of rows) {
      const label = row.admin_label;
      countsByIntent[label] = (countsByIntent[label] || 0) + 1;
    }

    // Generate JSONL output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputFile = path.join(process.cwd(), `hard-cases-${profile}-${timestamp}.jsonl`);
    const lines = rows.map(row =>
      JSON.stringify({
        message: row.message_text,
        predicted: row.predicted_intent,
        admin_label: row.admin_label,
      })
    );

    fs.writeFileSync(outputFile, lines.join('\n') + '\n', 'utf-8');

    console.log(`Exported ${rows.length} labeled hard cases for profile "${profile}"`);
    console.log(`Output: ${outputFile}`);
    console.log('\nCases per intent type:');
    const sortedIntents = Object.entries(countsByIntent).sort((a, b) => b[1] - a[1]);
    for (const [intent, count] of sortedIntents) {
      console.log(`  ${intent.padEnd(30)} ${count}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
