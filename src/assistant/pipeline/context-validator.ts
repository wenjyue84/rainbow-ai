/**
 * Conversation Context Validator (US-267)
 *
 * Validates conversation context structure early in the message processing
 * pipeline, before AI inference. Prevents undefined or null conversation
 * context from reaching AI providers (OpenRouter, Kimi, etc.).
 *
 * Throws InvalidContextError with clear, actionable diagnostics when
 * validation fails, including an error_code and debug endpoint reference.
 */

import type { ChatMessage, ConversationState } from '../types.js';

// ─── Error Class ────────────────────────────────────────────────────

/**
 * Thrown when conversation context fails structural validation.
 * Carries an error_code and actionable message for downstream handlers.
 */
export class InvalidContextError extends Error {
  /** Machine-readable error code for downstream handling */
  readonly error_code: string;
  /** Actionable debug hint for the end user / operator */
  readonly debugHint: string;
  /** The conversation ID (if available) for debug endpoint */
  readonly conversationId: string | undefined;

  constructor(message: string, conversationId?: string) {
    super(message);
    this.name = 'InvalidContextError';
    this.error_code = 'invalid_context';
    this.conversationId = conversationId;
    this.debugHint = conversationId
      ? `Use /admin/debug-conversation:${conversationId} to inspect conversation state`
      : 'Use /admin/debug-conversation:<conversationId> to inspect conversation state';
  }
}

// ─── Validation Result ──────────────────────────────────────────────

export interface ContextValidationResult {
  valid: boolean;
  error_code?: string;
  message?: string;
  debugHint?: string;
}

// ─── Validator ──────────────────────────────────────────────────────

/**
 * Validate that the conversation context is structurally sound before
 * it reaches AI inference. Checks:
 *
 * 1. ConversationState is not null or undefined
 * 2. messages array exists and is an array (not null/undefined)
 * 3. Each message in the array has required fields (role, content)
 *
 * @param convo - The conversation state to validate
 * @param conversationId - Optional conversation identifier for debug messages
 * @throws InvalidContextError if validation fails
 * @returns The validated conversation state (for chaining)
 */
export function validateConversationContext(
  convo: ConversationState | null | undefined,
  conversationId?: string,
): ConversationState {
  // Check 1: ConversationState itself must exist
  if (convo === null || convo === undefined) {
    throw new InvalidContextError(
      'Conversation state is null or undefined — cannot proceed to AI inference',
      conversationId,
    );
  }

  // Check 2: messages array must exist and be an array
  if (convo.messages === null || convo.messages === undefined) {
    throw new InvalidContextError(
      'Conversation messages array is null or undefined — cannot build AI context',
      conversationId ?? convo.phone,
    );
  }

  if (!Array.isArray(convo.messages)) {
    throw new InvalidContextError(
      `Conversation messages is not an array (got ${typeof convo.messages}) — cannot build AI context`,
      conversationId ?? convo.phone,
    );
  }

  // Check 3: Each message must have role and content
  for (let i = 0; i < convo.messages.length; i++) {
    const msg = convo.messages[i];
    if (!msg || typeof msg !== 'object') {
      throw new InvalidContextError(
        `Message at index ${i} is ${msg === null ? 'null' : typeof msg} — conversation context is corrupted`,
        conversationId ?? convo.phone,
      );
    }
    if (!msg.role || (msg.role !== 'user' && msg.role !== 'assistant')) {
      throw new InvalidContextError(
        `Message at index ${i} has invalid role '${msg.role}' (expected 'user' or 'assistant')`,
        conversationId ?? convo.phone,
      );
    }
    if (typeof msg.content !== 'string') {
      throw new InvalidContextError(
        `Message at index ${i} has non-string content (got ${typeof msg.content})`,
        conversationId ?? convo.phone,
      );
    }
  }

  return convo;
}

/**
 * Non-throwing variant that returns a validation result object.
 * Useful for cases where the caller wants to handle errors without try/catch.
 *
 * @param convo - The conversation state to validate
 * @param conversationId - Optional conversation identifier for debug messages
 * @returns ContextValidationResult with valid flag, error_code, and message
 */
export function checkConversationContext(
  convo: ConversationState | null | undefined,
  conversationId?: string,
): ContextValidationResult {
  try {
    validateConversationContext(convo, conversationId);
    return { valid: true };
  } catch (err) {
    if (err instanceof InvalidContextError) {
      return {
        valid: false,
        error_code: err.error_code,
        message: err.message,
        debugHint: err.debugHint,
      };
    }
    return {
      valid: false,
      error_code: 'invalid_context',
      message: String(err),
    };
  }
}

/**
 * Build a user-facing error response for invalid context errors.
 * Includes the error_code and an actionable debug endpoint reference.
 *
 * @param err - The InvalidContextError
 * @returns A formatted error response object
 */
export function buildInvalidContextResponse(err: InvalidContextError): {
  error_code: string;
  message: string;
  debugHint: string;
} {
  return {
    error_code: err.error_code,
    message: err.message,
    debugHint: err.debugHint,
  };
}
