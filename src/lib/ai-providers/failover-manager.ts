/**
 * failover-manager.ts — Provider failover with exponential backoff retry logic
 *
 * Implements resilient provider execution:
 * 1. Primary provider attempt
 * 2. Single retry with backoff on timeout/5xx
 * 3. Escalation to next provider (Ollama, etc.)
 * 4. Template fallback when all providers exhaust
 */

export interface FailoverAttempt {
  provider: string;
  attempt: number;
  error?: string;
  elapsedMs?: number;
}

export interface FailoverChain {
  attempts: FailoverAttempt[];
  successProvider?: string;
  finalError?: string;
}

/**
 * FailoverManager coordinates retry logic with exponential backoff
 */
export class FailoverManager {
  private attempts: FailoverAttempt[] = [];
  private startTime: number = Date.now();

  /**
   * Retry a provider call with exponential backoff
   * @param fn - The async function to retry
   * @param providerId - Provider identifier for logging
   * @param initialDelayMs - Initial delay before first retry (e.g., 100ms)
   * @param maxRetries - Maximum number of retries (default 1)
   * @returns Result from fn or throws after all retries exhausted
   */
  async retryWithBackoff<T>(
    fn: () => Promise<T>,
    providerId: string,
    initialDelayMs: number = 100,
    maxRetries: number = 1
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        const result = await fn();
        this.attempts.push({
          provider: providerId,
          attempt: attempt + 1,
          elapsedMs: Date.now() - attemptStart,
        });
        return result;
      } catch (err: any) {
        lastError = err;
        const elapsedMs = Date.now() - attemptStart;

        // Check if error is retryable (timeout or 5xx)
        const isRetryable = this._isRetryableError(err);
        const errorMsg = err.message || String(err);

        this.attempts.push({
          provider: providerId,
          attempt: attempt + 1,
          error: errorMsg,
          elapsedMs,
        });

        // If this is the last attempt or error is not retryable, throw
        if (attempt >= maxRetries || !isRetryable) {
          throw err;
        }

        // Wait with exponential backoff before retry
        const backoffMs = initialDelayMs * Math.pow(2, attempt);
        console.log(
          `[Failover] ${providerId} failed on attempt ${attempt + 1}, ` +
          `retrying in ${backoffMs}ms (error: ${errorMsg.slice(0, 100)})`
        );
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }

    throw lastError || new Error(`${providerId}: All retries exhausted`);
  }

  /**
   * Escalate to the next provider in the fallback chain
   * @param currentProvider - Current provider that failed
   * @param availableProviders - List of available providers to escalate to
   * @returns Next provider to attempt, or null if none available
   */
  escalateToNextProvider(
    currentProvider: string,
    availableProviders: Array<{ id: string; name: string; type: string }>
  ): { id: string; name: string; type: string } | null {
    // Find current provider index
    const currentIdx = availableProviders.findIndex(p => p.id === currentProvider);
    if (currentIdx < 0 || currentIdx >= availableProviders.length - 1) {
      return null;
    }

    // Return next provider
    const nextProvider = availableProviders[currentIdx + 1];
    console.log(
      `[Failover] Escalating from ${currentProvider} to ${nextProvider.id} ` +
      `(${nextProvider.type})`
    );
    return nextProvider;
  }

  /**
   * Check if an error is worth retrying
   * Retryable: timeout, 5xx errors, connection errors
   * Non-retryable: 4xx errors (auth, validation), parse errors
   */
  private _isRetryableError(err: any): boolean {
    const msg = err.message || String(err);

    // Timeout errors are always retryable
    if (err.name === 'TimeoutError' || msg.toLowerCase().includes('timeout')) {
      return true;
    }

    // 5xx errors are retryable (server-side issues)
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') ||
        msg.includes('504') || msg.includes('5xx')) {
      return true;
    }

    // Connection/network errors are retryable
    if (msg.toLowerCase().includes('econnrefused') ||
        msg.toLowerCase().includes('enotfound') ||
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('connection')) {
      return true;
    }

    return false;
  }

  /**
   * Get the complete failure chain for logging
   */
  getFailureChain(): FailoverChain {
    return {
      attempts: this.attempts,
      successProvider: this.attempts.find(a => !a.error)?.provider,
      finalError: this.attempts.at(-1)?.error,
    };
  }

  /**
   * Get total elapsed time from start of failover
   */
  getElapsedMs(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Format failure chain as log message
   */
  formatForLogging(): string {
    const chain = this.getFailureChain();
    const parts = chain.attempts.map(a => {
      const status = a.error ? `FAIL (${a.error.slice(0, 50)})` : 'OK';
      return `${a.provider}[attempt ${a.attempt}]: ${status}`;
    });
    return `Failover chain: ${parts.join(' → ')}`;
  }
}
