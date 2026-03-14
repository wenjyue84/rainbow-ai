/**
 * service-requests.ts — Service request logging for workflow enhancer
 *
 * Logs guest service requests (housekeeping, maintenance, wifi, etc.)
 * to the database for staff tracking and analytics.
 */

import { pool } from '../lib/db.js';

export interface ServiceRequestInput {
  jid: string;
  profile: string;
  requestType: string;
  details: string;
  estimatedWaitMinutes?: number;
}

/**
 * Log a service request to the database.
 * Fire-and-forget — callers should catch errors.
 */
export async function logServiceRequest(input: ServiceRequestInput): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO service_requests (jid, profile, request_type, details, estimated_wait_minutes, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT DO NOTHING`,
      [input.jid, input.profile, input.requestType, input.details, input.estimatedWaitMinutes ?? null]
    );
  } catch {
    // Table may not exist yet — silently skip
  }
}
