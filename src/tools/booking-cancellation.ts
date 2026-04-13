/**
 * US-537: Booking Cancellation Intent with Refund Processing
 *
 * RefundProcessor implements tiered refund policy logic based on days remaining
 * before check-in. Supports profile-specific policies (pelangi, southern) with
 * fallback to defaults.
 */

import { pool } from '../lib/db.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RefundTier {
  daysThreshold: number;
  percentage: number;
}

export interface RefundPolicy {
  profileId: string;
  tiers: RefundTier[];
}

export interface BookingData {
  bookingId: string;
  profileId: string;
  checkInDate: string;
  guestName: string;
  totalAmount: number;
}

export interface RefundResult {
  bookingId: string;
  eligible: boolean;
  refundPercentage: number;
  refundAmount: number;
  daysBeforeCheckIn: number;
  reason: string;
}

// ─── Default policies ─────────────────────────────────────────────────────────

const DEFAULT_POLICIES: Record<string, RefundPolicy> = {
  pelangi: {
    profileId: 'pelangi',
    tiers: [
      { daysThreshold: 14, percentage: 100 },
      { daysThreshold: 7, percentage: 75 },
      { daysThreshold: 3, percentage: 50 },
      { daysThreshold: 0, percentage: 0 },
    ],
  },
  southern: {
    profileId: 'southern',
    tiers: [
      { daysThreshold: 7, percentage: 100 },
      { daysThreshold: 3, percentage: 50 },
      { daysThreshold: 0, percentage: 0 },
    ],
  },
};

// ─── RefundProcessor ──────────────────────────────────────────────────────────

export class RefundProcessor {
  /**
   * Calculate refund amount for a booking cancellation.
   *
   * Looks up the booking, checks the profile refund policy, computes days
   * before check-in, and returns the applicable refund tier result.
   *
   * @param bookingId - Booking identifier from the user
   * @param profileId - Business profile (e.g. 'pelangi', 'southern')
   * @param now - Override current time for testing (defaults to Date.now)
   */
  static async calculateRefund(
    bookingId: string,
    profileId: string,
    now: Date = new Date()
  ): Promise<RefundResult> {
    const booking = await RefundProcessor.fetchBooking(bookingId, profileId);

    if (!booking) {
      return {
        bookingId,
        eligible: false,
        refundPercentage: 0,
        refundAmount: 0,
        daysBeforeCheckIn: 0,
        reason: 'Booking not found.',
      };
    }

    const checkIn = new Date(booking.checkInDate);
    if (isNaN(checkIn.getTime())) {
      return {
        bookingId,
        eligible: false,
        refundPercentage: 0,
        refundAmount: 0,
        daysBeforeCheckIn: 0,
        reason: 'Invalid check-in date on booking record.',
      };
    }

    const msPerDay = 1000 * 60 * 60 * 24;
    const daysBeforeCheckIn = Math.ceil((checkIn.getTime() - now.getTime()) / msPerDay);

    // Past the check-in deadline — no refund
    if (daysBeforeCheckIn <= 0) {
      return {
        bookingId,
        eligible: false,
        refundPercentage: 0,
        refundAmount: 0,
        daysBeforeCheckIn,
        reason: 'Cancellation deadline has passed (check-in date already reached).',
      };
    }

    const policy = await RefundProcessor.fetchRefundPolicy(profileId);
    const percentage = RefundProcessor.getRefundPercentage(daysBeforeCheckIn, policy);
    const refundAmount = Math.round((booking.totalAmount * percentage) / 100);

    return {
      bookingId,
      eligible: percentage > 0,
      refundPercentage: percentage,
      refundAmount,
      daysBeforeCheckIn,
      reason:
        percentage > 0
          ? `${percentage}% refund applies (${daysBeforeCheckIn} days before check-in).`
          : 'No refund: cancellation is within the non-refundable window.',
    };
  }

  /**
   * Fetch booking data from scheduled_messages table.
   */
  static async fetchBooking(
    bookingId: string,
    profileId: string
  ): Promise<BookingData | null> {
    try {
      const result = await pool.query<{
        booking_id: string;
        profile_id: string;
        variables: string | null;
      }>(
        `SELECT booking_id, profile_id, variables
         FROM scheduled_messages
         WHERE booking_id = $1
           AND profile_id = $2
           AND status IN ('pending', 'sent')
         LIMIT 1`,
        [bookingId, profileId]
      );

      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      let vars: Record<string, unknown> = {};
      try {
        if (row.variables) vars = JSON.parse(row.variables);
      } catch {
        // variables not parseable — use empty object
      }

      const checkInDate = String(
        vars['checkInDate'] ?? vars['check_in_date'] ?? vars['arrivalDate'] ?? ''
      );
      const guestName = String(vars['guestName'] ?? vars['guest_name'] ?? 'Guest');
      const totalAmount = Number(vars['totalAmount'] ?? vars['total_amount'] ?? vars['amount'] ?? 0);

      if (!checkInDate) return null;

      return {
        bookingId: row.booking_id,
        profileId: row.profile_id,
        checkInDate,
        guestName,
        totalAmount,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[booking-cancellation] fetchBooking error:`, msg);
      return null;
    }
  }

  /**
   * Load refund policy from DB config, falling back to defaults.
   */
  static async fetchRefundPolicy(profileId: string): Promise<RefundPolicy> {
    try {
      const result = await pool.query<{ value: string }>(
        `SELECT value FROM rainbow_configs
         WHERE profile_id = $1 AND key = 'refund_policy'
         LIMIT 1`,
        [profileId]
      );

      if (result.rows.length > 0 && result.rows[0].value) {
        const parsed = JSON.parse(result.rows[0].value) as Partial<RefundPolicy>;
        if (Array.isArray(parsed.tiers) && parsed.tiers.length > 0) {
          return { profileId, tiers: parsed.tiers };
        }
      }
    } catch {
      // DB error or missing table — fall through to default
    }

    return RefundProcessor.getDefaultRefundPolicy(profileId);
  }

  /**
   * Return default refund policy for a profile, falling back to pelangi policy.
   */
  static getDefaultRefundPolicy(profileId: string): RefundPolicy {
    return DEFAULT_POLICIES[profileId] ?? DEFAULT_POLICIES['pelangi'];
  }

  /**
   * Determine the refund percentage given days before check-in and a policy.
   *
   * Iterates tiers in descending threshold order and returns the first match.
   */
  static getRefundPercentage(daysBeforeCheckIn: number, policy: RefundPolicy): number {
    // Sort tiers highest threshold first
    const sorted = [...policy.tiers].sort((a, b) => b.daysThreshold - a.daysThreshold);

    for (const tier of sorted) {
      if (daysBeforeCheckIn >= tier.daysThreshold) {
        return tier.percentage;
      }
    }

    return 0;
  }

  /**
   * Log a refund transaction to the database.
   * Non-fatal — errors are logged but do not throw.
   */
  static async processRefund(result: RefundResult, profileId: string): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO refund_transactions
           (booking_id, profile_id, refund_percentage, refund_amount, days_before_check_in, processed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (booking_id) DO NOTHING`,
        [
          result.bookingId,
          profileId,
          result.refundPercentage,
          result.refundAmount,
          result.daysBeforeCheckIn,
        ]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[booking-cancellation] processRefund DB error:`, msg);
      // Non-fatal: cancellation proceeds even if transaction log fails
    }
  }
}
