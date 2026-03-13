/**
 * Centralized timeout constants for outbound HTTP calls (US-482).
 * All values are configurable via environment variables.
 */

/** Timeout for LLM provider calls (NVIDIA, OpenRouter, Ollama, Gemini, Groq) */
export const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10);

/** Timeout for DIGIMAN/PMS API calls */
export const DIGIMAN_TIMEOUT_MS = parseInt(process.env.DIGIMAN_TIMEOUT_MS ?? '10000', 10);

/** Timeout for WhatsApp Cloud API and external webhook calls */
export const WA_API_TIMEOUT_MS = parseInt(process.env.WA_API_TIMEOUT_MS ?? '15000', 10);
