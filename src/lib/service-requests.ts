/**
 * Service Requests — US-875
 *
 * CRUD helpers for the service_requests table.
 * Used by the action-dispatch pipeline stage and admin API.
 */

import { db } from './db.js';
import { serviceRequests } from '../../shared/schema-tables.js';
import { eq, desc } from 'drizzle-orm';

export type ServiceRequestStatus = 'pending' | 'resolved';

export interface CreateServiceRequestInput {
  jid: string;
  profile?: string;
  roomNumber?: string | null;
  requestType: string;
  details?: string | null;
}

/**
 * Insert a new service request record.
 */
export async function createServiceRequest(input: CreateServiceRequestInput): Promise<string> {
  const rows = await db
    .insert(serviceRequests)
    .values({
      jid: input.jid,
      profile: input.profile ?? 'pelangi',
      roomNumber: input.roomNumber ?? null,
      requestType: input.requestType,
      details: input.details ?? null,
      status: 'pending',
      staffNotified: false,
    })
    .returning({ id: serviceRequests.id });

  return rows[0].id;
}

/**
 * Mark a service request as staff-notified.
 */
export async function markStaffNotified(id: string): Promise<void> {
  await db
    .update(serviceRequests)
    .set({ staffNotified: true })
    .where(eq(serviceRequests.id, id));
}

/**
 * Resolve a service request (staff marks as fulfilled).
 * Returns the resolved row or null if not found.
 */
export async function resolveServiceRequest(id: string): Promise<{ jid: string; requestType: string } | null> {
  const rows = await db
    .update(serviceRequests)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(eq(serviceRequests.id, id))
    .returning({ jid: serviceRequests.jid, requestType: serviceRequests.requestType });

  return rows.length > 0 ? rows[0] : null;
}

/**
 * List service requests ordered by newest first.
 */
export async function listServiceRequests(options?: {
  profile?: string;
  status?: ServiceRequestStatus;
  limit?: number;
}) {
  const limit = Math.min(options?.limit ?? 50, 200);

  let query = db
    .select()
    .from(serviceRequests)
    .orderBy(desc(serviceRequests.createdAt))
    .limit(limit);

  // Drizzle doesn't support dynamic .where() chaining easily, so we fetch and filter
  const rows = await query;

  return rows.filter(r => {
    if (options?.profile && r.profile !== options.profile) return false;
    if (options?.status && r.status !== options.status) return false;
    return true;
  });
}
