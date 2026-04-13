/**
 * Setup script to create booking_workflow_audit table if it doesn't exist
 */

import { pool } from './db.js';

async function setupTable() {
  try {
    console.log('[Setup] Creating booking_workflow_audit table...');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_workflow_audit (
        id SERIAL PRIMARY KEY,
        booking_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        reset_at TIMESTAMP NOT NULL DEFAULT NOW(),
        profile TEXT NOT NULL DEFAULT 'pelangi'
      );
    `);

    console.log('[Setup] Creating indexes...');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_workflow_audit_booking_id
        ON booking_workflow_audit(booking_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_workflow_audit_reason
        ON booking_workflow_audit(reason);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_workflow_audit_reset_at
        ON booking_workflow_audit(reset_at);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_workflow_audit_profile
        ON booking_workflow_audit(profile);
    `);

    console.log('[Setup] ✅ booking_workflow_audit table setup complete');

    await pool.end();
  } catch (error) {
    console.error('[Setup] ❌ Error setting up table:', error);
    process.exit(1);
  }
}

setupTable();
