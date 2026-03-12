import axios, { AxiosInstance, AxiosError } from 'axios';
import http from 'node:http';
import https from 'node:https';
import { createModuleLogger } from './logger.js';

const logger = createModuleLogger('http-client');

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
  timeout: 30000,
  httpAgent,
  httpsAgent
});

export function getApiBaseUrl(): string {
  return API_URL;
}

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
  // Timeout
  if (error.code === 'ECONNABORTED') {
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
  const retryEnabled = options?.retry !== false;
  const maxRetries = options?.maxRetries ?? 3;
  const totalTimeoutMs = options?.timeoutMs ?? MAX_TOTAL_TIMEOUT_MS;
  const fullUrl = path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  const startTime = Date.now();

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await apiClient.request({
        method,
        url: path,
        data
      });
      return response.data;
    } catch (error: any) {
      lastError = error;

      // Check if we should retry
      const isAxiosError = axios.isAxiosError(error);
      const canRetry = retryEnabled && attempt < maxRetries && isAxiosError && isRetryable(error);

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

  // Format final error
  const totalAttempts = Math.min(maxRetries + 1, Math.max(1, /* attempts made */ maxRetries + 1));
  const retryContext = retryEnabled && maxRetries > 0
    ? ` (after ${maxRetries + 1} attempts)`
    : '';
  const status = lastError.response?.status;
  const bodyMessage = lastError.response?.data?.message;
  const statusText = lastError.response?.statusText;
  const detail = status
    ? ` ${status} ${statusText || ''}`.trim()
    : ` ${lastError.message}`;
  const message = bodyMessage
    ? `API Error${retryContext}: ${bodyMessage} (${fullUrl}${detail ? ` → ${detail}` : ''})`
    : `API Error${retryContext}: ${fullUrl}${detail}. Check DIGIMAN_API_URL (or legacy PELANGI_API_URL) and that digiman API is deployed there.`;
  console.error(`API call failed: ${method} ${path}`, lastError.message);
  throw new Error(message);
}
