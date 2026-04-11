#!/usr/bin/env tsx
/**
 * US-470: Booking Units Validation Audit CLI
 *
 * Audits all booking intents from the last 24h and reports invalid unit_id references.
 * Helps identify bookings that reference units that don't exist in the profile configuration.
 *
 * Usage:
 *   npm run validate:booking-units -- --profile pelangi
 *   npm run validate:booking-units -- --profile southern --hours 48
 *   npx tsx src/tools/validate-booking-units-cli.ts --profile pelangi --json
 *
 * Exit codes:
 *   0 — Audit complete (even if issues found)
 *   1 — Error (DB connection, invalid profile, etc.)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VALID_PROFILES = ['pelangi', 'southern', 'makan-moments', 'makan'];

// ─── Default Units Per Profile ─────────────────────────────────────
const DEFAULT_UNITS_BY_PROFILE: Record<string, string[]> = {
  pelangi: [
    'capsule-01', 'capsule-02', 'capsule-03', 'capsule-04', 'capsule-05',
    'capsule-06', 'capsule-07', 'capsule-08', 'capsule-09', 'capsule-10',
    'private-01', 'private-02', 'private-03', 'private-04',
    'family-01', 'family-02',
  ],
  southern: [
    'room-101', 'room-102', 'room-103', 'room-104', 'room-105',
    'room-201', 'room-202', 'room-203', 'room-204', 'room-205',
    'suite-01', 'suite-02', 'suite-03',
  ],
  'makan-moments': [
    'table-01', 'table-02', 'table-03', 'table-04', 'table-05',
  ],
};

// ─── Types ─────────────────────────────────────────────────────────

interface BookingStateJson {
  unit_id?: string;
  checkIn?: string;
  checkOut?: string;
  stage?: string;
}

interface AuditIssue {
  phone: string;
  bookingId?: string;
  unit_id: string | undefined;
  issue: string;
  timestamp: string;
}

interface AuditOutput {
  timestamp: string;
  profile: string;
  hours_analyzed: number;
  total_bookings_found: number;
  valid_units: number;
  invalid_units: number;
  issues: AuditIssue[];
  remediation_count: number;
}

// ─── Helper Functions ────────────────────────────────────────────────

async function getUnitsForProfile(profile: string, pool: pg.Pool): Promise<string[]> {
  try {
    const result = await pool.query(
      `SELECT unit_id FROM booking_units WHERE profile = $1 AND active = true`,
      [profile]
    );
    if (result.rows && result.rows.length > 0) {
      return result.rows.map((row: any) => row.unit_id);
    }
  } catch (error) {
    console.debug(`[validate] Could not query units for profile ${profile}, using defaults`);
  }

  return DEFAULT_UNITS_BY_PROFILE[profile] || [];
}

function parseBookingState(jsonStr: string | null): BookingStateJson | null {
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// ─── Formatters ───────────────────────────────────────────────────────

function formatHumanReport(output: AuditOutput): string {
  const lines: string[] = [];
  lines.push('=== Booking Units Validation Audit ===');
  lines.push(`Generated: ${output.timestamp}`);
  lines.push(`Profile: ${output.profile}`);
  lines.push(`Hours analyzed: ${output.hours_analyzed}`);
  lines.push(`Total bookings found: ${output.total_bookings_found}`);
  lines.push('');

  if (output.issues.length === 0) {
    lines.push('✓ All booking units are valid!');
  } else {
    lines.push(`Issues found: ${output.invalid_units}`);
    lines.push(`Remediation count: ${output.remediation_count}`);
    lines.push('');
    lines.push('Invalid unit references:');
    for (const issue of output.issues) {
      lines.push(`  Phone: ${issue.phone}`);
      lines.push(`    Unit ID: ${issue.unit_id || '(not set)'}`);
      lines.push(`    Issue: ${issue.issue}`);
      lines.push(`    Timestamp: ${issue.timestamp}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── DB Query ───────────────────────────────────────────────────────

async function fetchRecentBookings(
  profile: string,
  hours: number
): Promise<Array<{ phone: string; booking_state_json: string | null; last_user_message_at: string | null }>> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const pool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 2,
    idleTimeoutMillis: 5000,
  });

  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    const result = await pool.query(
      `SELECT phone, booking_state_json, last_user_message_at
       FROM rainbow_conversation_state
       WHERE profile_id = $1
       AND last_user_message_at >= $2
       AND booking_state_json IS NOT NULL
       ORDER BY last_user_message_at DESC`,
      [profile, cutoff.toISOString()]
    );

    return result.rows;
  } finally {
    await pool.end();
  }
}

// ─── Audit Logic ───────────────────────────────────────────────────

function auditBookings(
  bookings: Array<{ phone: string; booking_state_json: string | null; last_user_message_at: string | null }>,
  validUnits: string[]
): { issues: AuditIssue[]; valid: number; invalid: number } {
  const issues: AuditIssue[] = [];
  let valid = 0;
  let invalid = 0;

  for (const booking of bookings) {
    const state = parseBookingState(booking.booking_state_json);

    if (!state) continue; // Skip unparseable states

    const unitId = state.unit_id;

    // Check if unit exists or is required
    if (unitId) {
      if (!validUnits.includes(unitId)) {
        invalid++;
        issues.push({
          phone: booking.phone,
          unit_id: unitId,
          issue: `Unit ${unitId} not found in valid units for this profile`,
          timestamp: booking.last_user_message_at || new Date().toISOString(),
        });
      } else {
        valid++;
      }
    }
  }

  return { issues, valid, invalid };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const profileArg = args.find(a => a.startsWith('--profile'))?.split('=')[1] || 'pelangi';
  const hoursArg = parseInt(
    args.find(a => a.startsWith('--hours') || a.startsWith('--since'))
      ?.split('=')[1]
      ?.replace('h', '') || '24',
    10
  );
  const jsonMode = args.includes('--json');

  if (!VALID_PROFILES.includes(profileArg)) {
    console.error(`[ERROR] Unknown profile: ${profileArg}`);
    console.error(`Valid profiles: ${VALID_PROFILES.join(', ')}`);
    process.exit(1);
  }

  if (isNaN(hoursArg) || hoursArg < 1) {
    console.error('[ERROR] --hours must be a positive integer');
    process.exit(1);
  }

  // Create a temporary pool to query units
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[ERROR] DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const unitPool = new pg.Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
    max: 1,
    idleTimeoutMillis: 5000,
  });

  try {
    // Get valid units for this profile
    const validUnits = await getUnitsForProfile(profileArg, unitPool);

    // Fetch bookings
    const bookings = await fetchRecentBookings(profileArg, hoursArg);

    // Audit bookings
    const { issues, valid, invalid } = auditBookings(bookings, validUnits);

    const output: AuditOutput = {
      timestamp: new Date().toISOString(),
      profile: profileArg,
      hours_analyzed: hoursArg,
      total_bookings_found: bookings.length,
      valid_units: valid,
      invalid_units: invalid,
      issues,
      remediation_count: invalid, // Number of bookings with invalid units
    };

    if (jsonMode) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatHumanReport(output));
    }
  } catch (err: any) {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  } finally {
    await unitPool.end();
  }
}

main();
