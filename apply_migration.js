import { db } from './src/lib/db.js';
import fs from 'fs';

async function applyMigration() {
  try {
    const sql = fs.readFileSync('./drizzle/0001_add_intent_hard_cases.sql', 'utf-8');
    const statements = sql.split('--> statement-breakpoint\n').filter(s => s.trim());
    
    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (trimmed) {
        console.log('Executing:', trimmed.substring(0, 80) + '...');
        await db.execute(trimmed);
      }
    }
    
    console.log('✅ Migration applied successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

applyMigration();
