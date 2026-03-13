import axios, { AxiosInstance, AxiosError } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { createModuleLogger } from './logger.js';
import { CircuitBreaker } from '../assistant/circuit-breaker.js';
import { notifyAdminConfigError } from './admin-notifier.js';
import { DIGIMAN_TIMEOUT_MS } from './timeouts.js';

const logger = createModuleLogger('http-client');

// Circuit breaker for DIGIMAN API — opens after 5 consecutive failures, 60s cooldown
const digimanCircuit = new CircuitBreaker('digiman-api', {
  failureThreshold: 5,
  cooldownMs: 60_000
});

// Keep-alive agents reuse TCP connections, avoiding handshake overhead per request
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 20 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 20 });

// Prefer explicit DIGIMAN_API_URL; support legacy PELANGI_* vars; fall back to internal host
const internalHost = process.env.DIGIMAN_MANAGER_HOST || process.env.PELANGI_MANAGER_HOST;
const rawApiUrl = process.env.DIGIMAN_API_URL
  || process.env.PELANGI_API_URL
  || (internalHost ? `http://${internalHost.replace(/\/+$/, '')}` : 'http://localhost:5000');
const API_URL = rawApiUrl.replace(/\/+$/, '');
const API_TOKEN = process.env.DIGIMAN_API_TOKEN || process.env.PELANGI_API_TOKEN;

export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Authorization': API_TOKEN ? `Bearer ${API_TOKEN}` : undefined,
    'Content-Type': 'application/json'
  },
  timeout: DIGIMAN_TIMEOUT_MS,
  httpAgent,
  httpsAgent
});

export function getApiBaseUrl(): string {
  return API_URL;
}

// ─── Troubleshooting Hints (US-206) ──────────────────────────────────
// Maps error codes/status to plain-English explanations for non-technical users
const troubleshootingHints: Record<string, { why: string; fix: string }> = {
  ECONNREFUSED: {
    why: 'The PMS server is not accepting connections.',
    fix: '1) Check if PMS is running 2) Verify DIGIMAN_API_URL in .env 3) Check firewall rules',
  },
  ETIMEDOUT: {
    why: 'Connection to the PMS server timed out.',
    fix: '1) Check firewall rules and network connectivity 2) Verify DIGIMAN_API_URL is correct 3) Check if PMS server is overloaded',
  },
  ENOTFOUND: {
    why: 'Cannot resolve the PMS server hostname.',
    fix: '1) Check DIGIMAN_API_URL spelling 2) Verify DNS settings 3) Check network connectivity',
  },
  ECONNRESET: {
    why: 'The PMS server unexpectedly closed the connection.',
    fix: '1) Check PMS server logs for crashes 2) Verify PMS server has enough memory 3) Retry in a few seconds',
  },
  ECONNABORTED: {
    why: 'The request timed out waiting for a response.',
    fix: '1) The PMS server may be overloaded — wait and retry 2) Check network latency 3) Consider increasing timeout for slow endpoints',
  },
  EPIPE: {
    why: 'The connection was broken while sending data.',
    fix: '1) PMS server may have restarted 2) Check network stability 3) Retry the request',
  },
  '401': {
    why: 'API token is invalid or expired.',
    fix: '1) Update DIGIMAN_API_TOKEN in .env 2) Verify the token has not expired 3) Check PMS admin panel for token management',
  },
  '403': {
    why: 'Access is forbidden — the token may lack required permissions.',
    fix: '1) Check DIGIMAN_API_TOKEN permissions 2) Verify the token is for the correct environment 3) Contact PMS admin',
  },
  '404': {
    why: 'The requested API endpoint does not exist on the PMS server.',
    fix: '1) Verify DIGIMAN_API_URL points to the correct server version 2) Check if the PMS API has been updated 3) Verify the endpoint path',
  },
  '500': {
    why: 'The PMS server encountered an internal error.',
    fix: '1) Check PMS server logs 2) Retry in a few seconds 3) If persistent, restart the PMS server',
  },
  '502': {
    why: 'Bad gateway — the PMS server proxy received an invalid response.',
    fix: '1) Check if PMS backend is running behind the proxy 2) Verify reverse proxy (nginx) configuration 3) Check PMS server logs',
  },
  '503': {
    why: 'PMS server is overloaded or restarting.',
    fix: '1) Wait 30 seconds and retry 2) If persistent, check PMS server logs and memory usage 3) Consider scaling up PMS resources',
  },
  '504': {
    why: 'Gateway timeout — the PMS server took too long to respond.',
    fix: '1) Check PMS server performance 2) Verify network latency between servers 3) Consider increasing proxy timeout',
  },
  CIRCUIT_OPEN: {
    why: 'Too many consecutive failures — circuit breaker activated to protect system.',
    fix: `Circuit will auto-recover in 60s. Check PMS health: curl ${API_URL}/api/health`,
  },
};

function getTroubleshootingHint(error: any): { why: string; fix: string } | null {
  // Check for network error code first
  if (error.code && troubleshootingHints[error.code]) {
    return troubleshootingHints[error.code];
  }
  // Check for HTTP status code
  const status = error.response?.status;
  if (status && troubleshootingHints[String(status)]) {
    return troubleshootingHints[String(status)];
  }
  return null;
}

// Track consecutive failures for admin notification
let consecutiveFailures = 0;

/** Status codes that should be retried */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

/** Network error codes that should be retried */
const RETRYABLE_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND']);

/** Maximum total timeout across all retries (ms) */
const MAX_TOTAL_TIMEOUT_MS = 45_000;

export interface CallAPIOptions {
  retry?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
}

function isRetryable(error: AxiosError): boolean {
  // Network-level errors (no response)
  if (!error.response && error.code && RETRYABLE_ERROR_CODES.has(error.code)) {
    return true;
  }
  // Timeout (axios ECONNABORTED or native fetch AbortError/TimeoutError)
  if (error.code === 'ECONNABORTED') {
    return true;
  }
  // AbortSignal.timeout() throws AbortError — treat as retryable
  if ((error as any).name === 'AbortError' || (error as any).name === 'TimeoutError') {
    return true;
  }
  // Retryable HTTP status codes
  const status = error.response?.status;
  if (status && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }
  return false;
}

function getBackoffMs(attempt: number): number {
  // Exponential: ~1s, ~2s, ~4s with ±20% jitter
  const base = Math.pow(2, attempt) * 1000;
  const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20%
  return Math.round(base + jitter);
}

function getRetryAfterMs(error: AxiosError): number | null {
  const retryAfter = error.response?.headers?.['retry-after'];
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!isNaN(seconds)) return seconds * 1000;
  // Could be a date string
  const date = Date.parse(retryAfter);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function callAPI<T>(
  method: string,
  path: string,
  data?: any,
  options?: CallAPIOptions
): Promise<T> {
  // Circuit breaker: fast-fail if DIGIMAN API is known to be down
  if (digimanCircuit.isOpen()) {
    const hint = troubleshootingHints.CIRCUIT_OPEN;
    throw new Error(
      `What: DIGIMAN API circuit is OPEN — skipping call to ${path}. ` +
      `Why: ${hint.why} ` +
      `Fix: ${hint.fix}`
    );
  }

  const retryEnabled = options?.retry !== false;
  const maxRetries = options?.maxRetries ?? 3;
  const perRequestTimeoutMs = options?.timeoutMs ?? 15_000;
  const totalTimeoutMs = MAX_TOTAL_TIMEOUT_MS;
  const fullUrl = path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const startTime = Date.now();

  let lastError: any;
  let failedWithRetryable = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await apiClient.request({
        method,
        url: path,
        data,
        timeout: perRequestTimeoutMs,
      });
      digimanCircuit.recordSuccess();
      consecutiveFailures = 0;
      trackSuccess(Date.now() - startTime);
      return response.data;
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      const isAxiosError = axios.isAxiosError(error);
      const retryable = isAxiosError && isRetryable(error);
      const canRetry = retryEnabled && attempt < maxRetries && retryable;

      if (retryable) {
        failedWithRetryable = true;
      }

      if (!canRetry) {
        break;
      }

      // Calculate delay
      let delayMs: number;
      if (error.response?.status === 429) {
        delayMs = getRetryAfterMs(error) ?? getBackoffMs(attempt);
      } else {
        delayMs = getBackoffMs(attempt);
      }

      // Check total timeout budget
      const elapsed = Date.now() - startTime;
      if (elapsed + delayMs > totalTimeoutMs) {
        logger.warn(`[HTTP] Retry budget exhausted for ${method} ${path} after ${elapsed}ms`);
        break;
      }

      const errorDetail = error.response?.status
        ? `${error.response.status} ${error.response.statusText || ''}`
        : error.code || error.message;
      logger.warn(`[HTTP] Retry ${attempt + 1}/${maxRetries} for ${method} ${path}: ${errorDetail} (next in ${delayMs}ms)`);

      await sleep(delayMs);
    }
  }

  // Track the error
  const errorMsg = lastError.response?.status
    ? `${lastError.response.status} ${lastError.response.statusText || ''}`
    : lastError.code || lastError.message;
  trackError(path, errorMsg);

  // Record circuit breaker failure only for retryable (server/network) errors, not client 4xx
  if (failedWithRetryable) {
    digimanCircuit.recordFailure();
  }

  // Track consecutive failures for admin notification
  consecutiveFailures++;

  // Format enhanced error with troubleshooting hints (US-206)
  const elapsedMs = ((Date.now() - startTime) / 1000).toFixed(1);
  const retryContext = retryEnabled && maxRetries > 0
    ? ` (after ${maxRetries + 1} attempts, took ${elapsedMs}s)`
    : ` (took ${elapsedMs}s)`;
  const status = lastError.response?.status;
  const bodyMessage = lastError.response?.data?.message;
  const statusText = lastError.response?.statusText;
  const hint = getTroubleshootingHint(lastError);

  let message: string;
  if (hint) {
    const what = status
      ? `${method} ${fullUrl} → ${status} ${statusText || ''}`.trim()
      : `${method} ${fullUrl} → ${lastError.code || lastError.message}`;
    message = `What: ${what}${retryContext}. Why: ${hint.why} Fix: ${hint.fix}`;
    if (bodyMessage) {
      message += ` Detail: ${bodyMessage}`;
    }
  } else {
    // Fallback for unknown error types
    const detail = status
      ? ` ${status} ${statusText || ''}`.trim()
      : ` ${lastError.message}`;
    message = bodyMessage
      ? `API Error${retryContext}: ${bodyMessage} (${fullUrl}${detail ? ` → ${detail}` : ''})`
      : `API Error${retryContext}: ${fullUrl}${detail}. Check DIGIMAN_API_URL and that digiman API is deployed there.`;
  }

  logger.error(`API call failed: ${method} ${path}`, { error: lastError.message, consecutiveFailures });

  // Notify admin on persistent failures (>3 consecutive)
  if (consecutiveFailures >= 3) {
    notifyAdminOnPersistentFailure(method, path, message, consecutiveFailures).catch(() => {});
  }

  throw new Error(message);
}

async function notifyAdminOnPersistentFailure(
  method: string, path: string, errorMessage: string, failures: number
): Promise<void> {
  const hint = troubleshootingHints[
    Object.keys(troubleshootingHints).find(k => errorMessage.includes(k)) || ''
  ];
  const steps = hint
    ? `\n\nTroubleshooting steps:\n${hint.fix}`
    : '\n\nCheck DIGIMAN_API_URL and PMS server status.';
  await notifyAdminConfigError(
    `⚠️ PMS API: ${failures} consecutive failures\n` +
    `Last: ${method} ${path}\n` +
    `Error: ${errorMessage}${steps}`
  );
}

export function getDigimanCircuitStatus() {
  return digimanCircuit.getStatus();
}

// ─── Request Tracker ──────────────────────────────────────────────────
// Lightweight tracking for the integration health dashboard (US-203)

interface RequestError {
  timestamp: number;
  path: string;
  error: string;
}

const requestTracker = {
  lastSuccessAt: null as number | null,
  lastErrorAt: null as number | null,
  recentErrors: [] as RequestError[],
  responseTimes: [] as number[],  // last 20
  totalRequests: 0,
};

const MAX_RESPONSE_TIMES = 20;
const ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function trackSuccess(responseTimeMs: number): void {
  requestTracker.lastSuccessAt = Date.now();
  requestTracker.totalRequests++;
  requestTracker.responseTimes.push(responseTimeMs);
  if (requestTracker.responseTimes.length > MAX_RESPONSE_TIMES) {
    requestTracker.responseTimes.shift();
  }
}

function trackError(path: string, error: string): void {
  const now = Date.now();
  requestTracker.lastErrorAt = now;
  requestTracker.totalRequests++;
  requestTracker.recentErrors.push({ timestamp: now, path, error });
  // Prune errors older than 5 minutes
  requestTracker.recentErrors = requestTracker.recentErrors.filter(
    e => now - e.timestamp < ERROR_WINDOW_MS
  );
}

export function getRequestStats() {
  const now = Date.now();
  // Prune stale errors
  const recentErrors = requestTracker.recentErrors.filter(
    e => now - e.timestamp < ERROR_WINDOW_MS
  );
  const times = requestTracker.responseTimes;
  const avgResponseMs = times.length > 0
    ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    : null;

  return {
    lastSuccessAt: requestTracker.lastSuccessAt
      ? new Date(requestTracker.lastSuccessAt).toISOString()
      : null,
    lastErrorAt: requestTracker.lastErrorAt
      ? new Date(requestTracker.lastErrorAt).toISOString()
      : null,
    errorCount5m: recentErrors.length,
    avgResponseMs,
    totalRequests: requestTracker.totalRequests,
  };
}
