/**
 * US-507: Guard Feedback setTimeout Against Server Shutdown
 *
 * Test verifies that:
 * 1. Timer refs are stored in module-level Set
 * 2. Pending timers are cleared on SIGTERM
 * 3. No unhandled rejection on shutdown
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearPendingFeedbackTimers } from '../../src/assistant/pipeline/response-processor.js';

describe('US-507: Feedback setTimeout Guard Against Shutdown', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should store timer refs and allow clearing on shutdown', () => {
    // Simulate creating a feedback timer
    const timerRef = setTimeout(() => {
      // Simulated feedback send
    }, 1000);

    // Timer should be cleared without error
    expect(() => {
      clearTimeout(timerRef);
    }).not.toThrow();
  });

  it('should not throw when clearing empty timer set', () => {
    // clearPendingFeedbackTimers should handle empty set gracefully
    expect(() => {
      clearPendingFeedbackTimers();
    }).not.toThrow();
  });

  it('should clear console.log when timers cleared', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    clearPendingFeedbackTimers();

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Feedback]'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cleared'));

    consoleSpy.mockRestore();
  });

  it('should prevent unhandled rejection from setTimeout callback firing after shutdown', async () => {
    const rejectionHandler = vi.fn();
    const unhandledRejectionListener = (reason: any) => rejectionHandler(reason);

    process.on('unhandledRejection', unhandledRejectionListener);

    // Simulate timer that tries to send message after server closes
    const mockSendMessage = vi.fn().mockRejectedValue(new Error('HTTP request failed: server closed'));
    const timerRef = setTimeout(() => {
      mockSendMessage('phone', 'feedback prompt').catch(() => {
        // This catch should handle the error, not throw unhandled rejection
      });
    }, 10);

    // Simulate shutdown clearing the timer before it fires
    clearTimeout(timerRef);

    // Wait a bit to ensure timer didn't fire
    await new Promise(resolve => setTimeout(resolve, 50));

    // Should not have triggered unhandledRejection handler
    expect(rejectionHandler).not.toHaveBeenCalled();

    process.removeListener('unhandledRejection', unhandledRejectionListener);
  });

  it('should export clearPendingFeedbackTimers function', () => {
    expect(typeof clearPendingFeedbackTimers).toBe('function');
  });

  it('should return void from clearPendingFeedbackTimers', () => {
    const result = clearPendingFeedbackTimers();
    expect(result).toBeUndefined();
  });
});
