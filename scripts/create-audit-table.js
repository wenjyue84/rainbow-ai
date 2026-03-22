#!/usr/bin/env node
/**
 * Create conversation_audit table for US-156
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function createTable() {
  try {
    console.log('Creating conversation_audit table...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversation_audit (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(64) NOT NULL,
        guest_id VARCHAR(128),
        message TEXT NOT NULL,
        intent TEXT,
        confidence REAL,
        action_taken TEXT,
        tier TEXT,
        profile_id TEXT DEFAULT 'pelangi',
        timestamp TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Table created');

    // Create indexes
    const indexes = [
      { name: 'idx_conv_audit_phone', sql: 'CREATE INDEX IF NOT EXISTS idx_conv_audit_phone ON conversation_audit(phone)' },
      { name: 'idx_conv_audit_timestamp', sql: 'CREATE INDEX IF NOT EXISTS idx_conv_audit_timestamp ON conversation_audit(timestamp)' },
      { name: 'idx_conv_audit_phone_timestamp', sql: 'CREATE INDEX IF NOT EXISTS idx_conv_audit_phone_timestamp ON conversation_audit(phone, timestamp)' },
      { name: 'idx_conv_audit_intent', sql: 'CREATE INDEX IF NOT EXISTS idx_conv_audit_intent ON conversation_audit(intent)' },
      { name: 'idx_conv_audit_profile', sql: 'CREATE INDEX IF NOT EXISTS idx_conv_audit_profile ON conversation_audit(profile_id)' },
      { name: 'idx_conv_audit_guest_id', sql: 'CREATE INDEX IF NOT EXISTS idx_conv_audit_guest_id ON conversation_audit(guest_id)' },
    ];

    for (const idx of indexes) {
      try {
        await pool.query(idx.sql);
        console.log(`✓ Index ${idx.name} created`);
      } catch (e) {
        if (e.code === '42P07') {
          console.log(`  (${idx.name} already exists)`);
        } else {
          console.error(`✗ Index ${idx.name} failed:`, e.message);
        }
      }
    }

    console.log('\n✓ All done!');
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createTable();
