import { db } from './src/lib/db.js';
import { sql } from 'drizzle-orm';

async function checkTable() {
  try {
    const result = await db.execute(
      sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'intent_hard_cases')`
    );
    console.log('Table exists:', result);
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkTable();
