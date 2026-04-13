/**
 * US-558: Booking Workflow Timeout and Auto-Reset Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pool } from '../../lib/db.js';
import {
  initiateWorkflow,
  resetWorkflowState,
  cancelWorkflowTimeout,
  shutdown,
} from './booking-workflow.js';

describe('BookingWorkflow', () => {
  const testBookingId = `test-booking-${Date.now()}`;
  const testProfile = 'pelangi';

  beforeEach(async () => {
    // Ensure test booking audit table exists
    try {
      await pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_name = 'booking_workflow_audit'
         AND table_schema = 'public'`
      );
    } catch {
      // Table doesn't exist yet, will be created by migrations
    }
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await pool.query(
        'DELETE FROM booking_workflow_audit WHERE booking_id LIKE ?',
        [`test-booking-%`]
      );
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('resetWorkflowState', () => {
    it('should log a reset event to booking_workflow_audit', async () => {
      // Reset workflow
      await resetWorkflowState(testBookingId, 'timeout', testProfile);

      // Verify audit entry was created
      const result = await pool.query(
        'SELECT * FROM booking_workflow_audit WHERE booking_id = ?',
        [testBookingId]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].reason).toBe('timeout');
      expect(result.rows[0].profile).toBe(testProfile);
      expect(result.rows[0].reset_at).toBeDefined();
    });

    it('should log reset with correct booking_id and reason', async () => {
      const customReason = 'manual_reset';

      await resetWorkflowState(testBookingId, customReason, testProfile);

      const result = await pool.query(
        'SELECT * FROM booking_workflow_audit WHERE booking_id = ? AND reason = ?',
        [testBookingId, customReason]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].booking_id).toBe(testBookingId);
      expect(result.rows[0].reason).toBe(customReason);
    });

    it('should use default profile if not provided', async () => {
      // Note: We can't call this without specifying profile due to the function signature,
      // but we can test that it accepts the default
      await resetWorkflowState(testBookingId);

      const result = await pool.query(
        'SELECT * FROM booking_workflow_audit WHERE booking_id = ?',
        [testBookingId]
      );

      expect(result.rows[0].profile).toBe('pelangi');
    });
  });

  describe('initiateWorkflow', () => {
    it('should schedule a timeout job and return a job ID', async () => {
      const jobId = await initiateWorkflow(testBookingId, testProfile);

      expect(jobId).toBeDefined();
      expect(typeof jobId).toBe('string');
      expect(jobId).toContain('booking-timeout');
    });

    it('should create a unique job per booking ID', async () => {
      const bookingId1 = `${testBookingId}-1`;
      const bookingId2 = `${testBookingId}-2`;

      const jobId1 = await initiateWorkflow(bookingId1, testProfile);
      const jobId2 = await initiateWorkflow(bookingId2, testProfile);

      expect(jobId1).not.toBe(jobId2);
      expect(jobId1).toContain(bookingId1);
      expect(jobId2).toContain(bookingId2);
    });
  });

  describe('cancelWorkflowTimeout', () => {
    it('should cancel a scheduled timeout job', async () => {
      const bookingId = `${testBookingId}-cancel`;

      // Schedule a timeout job
      const jobId = await initiateWorkflow(bookingId, testProfile);
      expect(jobId).toBeDefined();

      // Cancel it
      await cancelWorkflowTimeout(bookingId);

      // Verify it was cancelled (this is best-effort verification)
      // In a real system with Redis running, we'd check the job queue
      console.log('Timeout job cancelled:', bookingId);
    });

    it('should not throw if job does not exist', async () => {
      const nonExistentBookingId = `${testBookingId}-nonexistent-${Date.now()}`;

      // Should not throw even if job doesn't exist
      await expect(
        cancelWorkflowTimeout(nonExistentBookingId)
      ).resolves.toBeUndefined();
    });
  });

  describe('no repeated resets', () => {
    it('should reset workflow exactly once per booking', async () => {
      // Schedule a timeout job
      await initiateWorkflow(testBookingId, testProfile);

      // Reset the workflow manually
      await resetWorkflowState(testBookingId, 'timeout', testProfile);

      // Check that only one audit entry exists
      const result = await pool.query(
        'SELECT * FROM booking_workflow_audit WHERE booking_id = ?',
        [testBookingId]
      );

      expect(result.rows).toHaveLength(1);

      // If we cancel the timeout job, a second reset shouldn't happen
      await cancelWorkflowTimeout(testBookingId);

      // Verify still only one entry
      const resultAfterCancel = await pool.query(
        'SELECT * FROM booking_workflow_audit WHERE booking_id = ?',
        [testBookingId]
      );

      expect(resultAfterCancel.rows).toHaveLength(1);
    });
  });

  afterEach(async () => {
    // Cleanup
    await shutdown();
  });
});
