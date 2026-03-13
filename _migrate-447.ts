import { db } from './src/lib/db.js';
import { sql } from 'drizzle-orm';

async function main() {
  await db.execute(sql`
    ALTER TABLE rainbow_conversations
    ADD COLUMN IF NOT EXISTS context_summary TEXT,
    ADD COLUMN IF NOT EXISTS context_summary_at TIMESTAMP
  `);
  console.log('Migration complete: added context_summary columns');

  const r = await db.execute(sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'rainbow_conversations'
    AND column_name LIKE 'context_summary%'
  `);
  console.log('Verified columns:', JSON.stringify(r.rows));
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
