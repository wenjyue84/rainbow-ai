/**
 * US-550: Guest Context Quick-Lookup for Booking Workflow Pre-Population
 *
 * Provides rapid guest data lookup with 5-minute TTL caching to reduce database queries.
 * Cache key format: guest:${profile}:${id}
 */

import { pool } from '../lib/db.js';

export interface GuestContext {
  id: string;
  name: string;
  unit: string;
  arrival_date: string;
  departure_date: string;
  nights: number;
}

// ─── Cache Management ────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number; // timestamp in ms
}

const contextCache = new Map<string, CacheEntry<GuestContext>>();

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get cached guest context, return null if expired or not found
 */
function getCachedContext(cacheKey: string): GuestContext | null {
  const entry = contextCache.get(cacheKey);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    contextCache.delete(cacheKey);
    return null;
  }

  return entry.data;
}

/**
 * Set guest context in cache with TTL
 */
function setCachedContext(cacheKey: string, data: GuestContext): void {
  contextCache.set(cacheKey, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Calculate number of nights between two dates
 */
function calculateNights(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * Format date to ISO string (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Load guest context from database with caching.
 *
 * @param profile - Profile ID (e.g., 'pelangi', 'southern')
 * @param guestId - Guest phone number (ID)
 * @returns GuestContext with {id, name, unit, arrival_date, departure_date, nights}
 * @throws Error if guest not found or query fails
 */
export async function loadGuestContext(profile: string, guestId: string): Promise<GuestContext> {
  const cacheKey = `guest:${profile}:${guestId}`;

  // Try cache first
  const cached = getCachedContext(cacheKey);
  if (cached) {
    console.log(`[GuestDataInjector] Cache HIT for ${cacheKey}`);
    return cached;
  }

  console.log(`[GuestDataInjector] Cache MISS for ${cacheKey}, querying database...`);

  // Query room_reservations for the guest (most recent confirmed reservation)
  const result = await pool.query(
    `SELECT
      guest_phone as id,
      guest_name as name,
      room_id as unit,
      check_in_date,
      check_out_date,
      status
    FROM room_reservations
    WHERE guest_phone = $1
      AND profile = $2
      AND status = $3
      AND check_in_date <= NOW()
    ORDER BY check_in_date DESC
    LIMIT 1`,
    [guestId, profile, 'confirmed']
  );

  if (result.rows.length === 0) {
    throw new Error(`Guest not found: ${guestId} for profile ${profile}`);
  }

  const row = result.rows[0];
  const checkIn = new Date(row.check_in_date);
  const checkOut = new Date(row.check_out_date);
  const nights = calculateNights(checkIn, checkOut);

  const context: GuestContext = {
    id: row.id,
    name: row.name,
    unit: row.unit,
    arrival_date: formatDate(checkIn),
    departure_date: formatDate(checkOut),
    nights,
  };

  // Cache for 5 minutes
  setCachedContext(cacheKey, context);
  console.log(`[GuestDataInjector] Cached guest context for ${cacheKey} (expires in ${CACHE_TTL_MS}ms)`);

  return context;
}

/**
 * Clear entire cache (useful for testing or manual invalidation)
 */
export function clearGuestContextCache(): void {
  contextCache.clear();
  console.log('[GuestDataInjector] Cache cleared');
}

/**
 * Invalidate specific cache entry
 */
export function invalidateGuestContext(profile: string, guestId: string): void {
  const cacheKey = `guest:${profile}:${guestId}`;
  contextCache.delete(cacheKey);
  console.log(`[GuestDataInjector] Invalidated cache for ${cacheKey}`);
}
