/**
 * PMS MCP Client
 *
 * HTTP client that calls the PMS2 MCP endpoint (`POST /api/mcp`)
 * using the JSON-RPC 2.0 protocol.
 *
 * Features:
 *   - Circuit breaker: fast-fails after 3 consecutive failures (60s cooldown)
 *   - Single retry with 2s backoff for 5xx/timeout (handles Vercel cold starts)
 *   - 4xx errors do NOT trip the breaker (argument errors, not outages)
 *
 * Auth: x-api-key header (separate from DIGIMAN_API_TOKEN which uses Bearer).
 *
 * Config env vars:
 *   PMS_MCP_URL  — full URL to the MCP endpoint (e.g. https://pms-capsule.vercel.app/api/mcp)
 *                  Falls back to DIGIMAN_API_URL + /api/mcp if not set.
 *   PMS_MCP_KEY  — the MCP_API_KEY value set on PMS2.
 *                  Falls back to DIGIMAN_API_TOKEN if not set.
 */

import axios, { AxiosError } from 'axios';
import { createModuleLogger } from './logger.js';
import { CircuitBreaker } from '../assistant/circuit-breaker.js';

const logger = createModuleLogger('pms-mcp-client');

const RETRY_DELAY_MS = 2_000;
const REQUEST_TIMEOUT_MS = 30_000;

function buildMCPUrl(): string {
  if (process.env.PMS_MCP_URL) return process.env.PMS_MCP_URL;
  const base = (process.env.DIGIMAN_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
  return `${base}/api/mcp`;
}

/** True for errors that indicate the server is down (not client mistakes). */
function isRetryableError(err: unknown): boolean {
  if (err instanceof AxiosError) {
    // Network error, timeout, or 5xx
    if (!err.response) return true; // network / timeout
    return err.response.status >= 500;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const mcpCircuit = new CircuitBreaker('pms-mcp', {
  failureThreshold: 3,
  cooldownMs: 60_000,
  successThreshold: 1,
});

export class PMSMCPClient {
  private readonly url: string;
  private readonly apiKey: string;

  constructor() {
    this.url = buildMCPUrl();
    this.apiKey = process.env.PMS_MCP_KEY || process.env.DIGIMAN_API_TOKEN || '';
  }

  async callTool(name: string, args: Record<string, any> = {}): Promise<any> {
    // Circuit breaker fast-fail
    if (mcpCircuit.isOpen()) {
      const status = mcpCircuit.getStatus();
      logger.warn(`MCP circuit OPEN for ${name} (cooldown ${status.cooldownRemaining}ms remaining)`);
      throw new Error(`PMS2 MCP unavailable (circuit open, retry in ${Math.ceil(status.cooldownRemaining / 1000)}s)`);
    }

    try {
      const result = await this._doCall(name, args);
      mcpCircuit.recordSuccess();
      return result;
    } catch (err: unknown) {
      // Retry once for retryable errors (5xx, timeout, network)
      if (isRetryableError(err)) {
        logger.info(`MCP call ${name} failed (retryable), retrying in ${RETRY_DELAY_MS}ms...`);
        await sleep(RETRY_DELAY_MS);
        try {
          const result = await this._doCall(name, args);
          mcpCircuit.recordSuccess();
          return result;
        } catch (retryErr: unknown) {
          if (isRetryableError(retryErr)) {
            mcpCircuit.recordFailure();
          }
          throw retryErr;
        }
      }
      // 4xx / JSON-RPC errors: do NOT trip breaker (client/argument errors)
      throw err;
    }
  }

  private async _doCall(name: string, args: Record<string, any>): Promise<any> {
    const response = await axios.post(
      this.url,
      {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: Date.now()
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );

    const body = response.data;

    if (body.error) {
      logger.warn(`MCP tool error from ${name}: ${body.error.message}`);
      throw new Error(`MCP error (${body.error.code}): ${body.error.message}`);
    }

    return body.result;
  }
}

/** Get circuit breaker status for health/monitoring endpoints. */
export function getMCPCircuitStatus() {
  return mcpCircuit.getStatus();
}

/** Reset circuit breaker (admin intervention). */
export function resetMCPCircuit() {
  mcpCircuit.reset();
}

export const pmsMCPClient = new PMSMCPClient();
