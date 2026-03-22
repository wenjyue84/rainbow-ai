/**
 * prompt-injection-guard.ts — Re-export shim for chat-engine consumers.
 *
 * The canonical implementation lives in ./pipeline/prompt-injection-guard.ts.
 * This module provides a stable import path adjacent to chat-engine.ts.
 */

export type { PromptInjectionResult } from './pipeline/prompt-injection-guard.js';
export { detectPromptInjection } from './pipeline/prompt-injection-guard.js';
