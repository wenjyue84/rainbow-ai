/**
 * migrate-bsuid-backfill.ts — US-1025: BSUID backfill migration
 *
 * Maps existing phone-number-keyed rows in `rainbow_conversations` to their
 * BSUIDs once Meta starts delivering them. Run this periodically during the
 * transition period (June–July 2026) as new BSUID data comes in.
 *
 * How it works:
 *  1. Finds conversations that have a phone key but no BSUID yet.
 *  2. Checks if any newer conversation record has both a phone AND a BSUID
 *     (i.e., received during the 30-day dual-delivery window).
 *  3. Backfills the BSUID on the older phone-keyed rows.
 *  4. Merges any duplicate bsuid-only records into the phone-keyed record.
 *
 * Safe to run multiple times: only updates rows where bsuid IS NULL.
 *
 * Usage:
 *   npx tsx scripts/migrate-bsuid-backfill.ts [--dry-run]
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '..', '.env') });
dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set. Add it to .env first.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log(`[BSUID Migration] Starting${dryRun ? ' (DRY RUN)' : ''}...`);

    // Step 1: Ensure bsuid column exists (idempotent)
    await pool.query(`
      ALTER TABLE rainbow_conversations
      ADD COLUMN IF NOT EXISTS bsuid VARCHAR(128)
    `);

    // Step 2: Ensure unique index exists (idempotent)
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rainbow_conversations_bsuid
      ON rainbow_conversations (bsuid)
      WHERE bsuid IS NOT NULL
    `);

    // Step 3: Find phone-keyed conversations without a BSUID
    const missingBsuid = await pool.query(`
      SELECT phone, push_name
      FROM rainbow_conversations
      WHERE bsuid IS NULL
        AND phone NOT LIKE 'bsuid:%'
        AND phone NOT LIKE 'webchat-%'
      ORDER BY updated_at DESC
    `);

    console.log(`[BSUID Migration] Found ${missingBsuid.rows.length} phone-keyed conversations without BSUID`);

    // Step 4: For each phone-keyed row, check if a bsuid-only record exists
    // that should be merged (same push_name or partial phone match in BSUID)
    const bsuidOnlyRows = await pool.query(`
      SELECT phone AS bsuid_key, bsuid, push_name
      FROM rainbow_conversations
      WHERE phone LIKE 'bsuid:%'
        AND bsuid IS NOT NULL
    `);

    console.log(`[BSUID Migration] Found ${bsuidOnlyRows.rows.length} BSUID-only conversation records`);

    let mergedCount = 0;
    let backfilledCount = 0;

    // Step 5: Merge BSUID-only records into phone-keyed records
    for (const bsuidRow of bsuidOnlyRows.rows) {
      const bsuid = bsuidRow.bsuid as string;
      const bsuidKey = bsuidRow.bsuid_key as string;
      const bsuidPushName = (bsuidRow.push_name as string || '').toLowerCase();

      // Find a matching phone-keyed conversation by push_name
      const phoneMatch = missingBsuid.rows.find(
        (r: any) => (r.push_name as string || '').toLowerCase() === bsuidPushName && bsuidPushName !== ''
      );

      if (phoneMatch) {
        const phoneKey = phoneMatch.phone as string;
        console.log(`  Merge: ${bsuidKey} → ${phoneKey} (BSUID: ${bsuid}, pushName: ${bsuidPushName})`);

        if (!dryRun) {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // Backfill BSUID on phone-keyed row
            await client.query(
              `UPDATE rainbow_conversations SET bsuid = $1, updated_at = NOW() WHERE phone = $2 AND bsuid IS NULL`,
              [bsuid, phoneKey]
            );

            // Move messages from bsuid-key to phone-key
            await client.query(
              `UPDATE rainbow_messages SET phone = $1 WHERE phone = $2`,
              [phoneKey, bsuidKey]
            );

            // Move conversation state if it exists
            await client.query(
              `UPDATE rainbow_conversation_state SET phone = $1 WHERE phone = $2`,
              [phoneKey, bsuidKey]
            ).catch(() => {}); // may not exist, that's OK

            // Delete the BSUID-only conversation record
            await client.query(
              `DELETE FROM rainbow_conversations WHERE phone = $1`,
              [bsuidKey]
            );

            await client.query('COMMIT');
            mergedCount++;
          } catch (err: any) {
            await client.query('ROLLBACK');
            console.warn(`  WARN: Failed to merge ${bsuidKey} → ${phoneKey}: ${err.message}`);
          } finally {
            client.release();
          }
        } else {
          mergedCount++;
        }
      }
    }

    // Step 6: Report on conversations that still need BSUID mapping
    // (will be automatically populated as users message during the transition window)
    const stillMissing = await pool.query(`
      SELECT COUNT(*) as count
      FROM rainbow_conversations
      WHERE bsuid IS NULL
        AND phone NOT LIKE 'bsuid:%'
        AND phone NOT LIKE 'webchat-%'
    `);

    const remaining = parseInt(stillMissing.rows[0].count, 10);

    console.log(`\n[BSUID Migration] Results${dryRun ? ' (DRY RUN)' : ''}:`);
    console.log(`  Merged BSUID-only → phone-keyed: ${mergedCount}`);
    console.log(`  Conversations still awaiting BSUID: ${remaining}`);
    console.log(`  (These will be backfilled automatically when users next message)`);
    console.log(`[BSUID Migration] Done.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[BSUID Migration] Fatal error:', err);
  process.exit(1);
});
