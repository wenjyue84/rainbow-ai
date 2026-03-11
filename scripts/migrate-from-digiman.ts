/**
 * migrate-from-digiman.ts — Migrate Rainbow AI data from digiman's Neon DB
 *
 * Usage:
 *   OLD_DATABASE_URL=<digiman-url> DATABASE_URL=<rainbow-ai-url> npx tsx scripts/migrate-from-digiman.ts
 *
 * Migrates:
 *   - rainbow_conversations, rainbow_messages
 *   - rainbow_conversation_state
 *   - rainbow_feedback, intent_predictions, intent_detection_settings
 *   - rainbow_configs, rainbow_kb_files, rainbow_config_audit (raw pg tables)
 *   - app_settings WHERE key LIKE 'rainbow_%'
 */
import pg from 'pg';

const { Pool } = pg;

const OLD_DB_URL = process.env.OLD_DATABASE_URL;
const NEW_DB_URL = process.env.DATABASE_URL;

if (!OLD_DB_URL || !NEW_DB_URL) {
  console.error('Usage: OLD_DATABASE_URL=<old> DATABASE_URL=<new> npx tsx scripts/migrate-from-digiman.ts');
  process.exit(1);
}

const oldPool = new Pool({ connectionString: OLD_DB_URL, ssl: { rejectUnauthorized: false } });
const newPool = new Pool({ connectionString: NEW_DB_URL, ssl: { rejectUnauthorized: false } });

async function migrateTable(tableName: string, whereClause?: string) {
  const where = whereClause ? ` WHERE ${whereClause}` : '';
  try {
    const { rows } = await oldPool.query(`SELECT * FROM ${tableName}${where}`);
    if (rows.length === 0) {
      console.log(`  [${tableName}] 0 rows — skipping`);
      return 0;
    }

    const cols = Object.keys(rows[0]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const insertSQL = `INSERT INTO ${tableName} (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let inserted = 0;
    for (const row of rows) {
      try {
        const result = await newPool.query(insertSQL, cols.map(c => row[c]));
        inserted += result.rowCount ?? 0;
      } catch (err: any) {
        console.warn(`  [${tableName}] Row insert error: ${err.message}`);
      }
    }
    console.log(`  [${tableName}] ${inserted}/${rows.length} rows migrated`);
    return inserted;
  } catch (err: any) {
    if (err.message.includes('does not exist')) {
      console.log(`  [${tableName}] Table does not exist in source — skipping`);
    } else {
      console.error(`  [${tableName}] ERROR: ${err.message}`);
    }
    return 0;
  }
}

async function main() {
  console.log('Rainbow AI Data Migration from digiman');
  console.log('=======================================\n');

  // Drizzle-managed tables
  const tables = [
    'app_settings',
    'intent_detection_settings',
    'rainbow_feedback',
    'intent_predictions',
    'rainbow_conversation_state',
    'rainbow_conversations',
    'rainbow_messages',
  ];

  for (const table of tables) {
    const where = table === 'app_settings' ? "key LIKE 'rainbow_%'" : undefined;
    await migrateTable(table, where);
  }

  // Raw pg tables (config-db.ts creates these)
  console.log('\nRaw pg tables (config system):');
  for (const table of ['rainbow_configs', 'rainbow_kb_files', 'rainbow_config_audit']) {
    await migrateTable(table);
  }

  console.log('\nMigration complete.');
  await oldPool.end();
  await newPool.end();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
