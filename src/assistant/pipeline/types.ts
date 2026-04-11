/**
 * Shared types for the message processing pipeline.
 *
 * RouterContext holds injected dependencies (sendMessage, callAPI).
 * PipelineState carries data between pipeline phases.
 */
import type { SendMessageFn, CallAPIFn, IncomingMessage, ConversationState, ChatMessage } from '../types.js';
import type { ConversationEvent } from '../memory-writer.js';
import type { ConfigStore } from '../config-store.js';
import type { KnowledgeBaseInstance } from '../knowledge-base-instance.js';

export interface RouterContext {
  sendMessage: SendMessageFn;
  callAPI: CallAPIFn;
  jayLID: string | null;
}

export interface DevMetadata {
  source?: string;
  model?: string;
  responseTime?: number;
  kbFiles: string[];
  routedAction?: string;
  workflowId?: string;
  stepId?: string;
  multiIntent?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  /** US-093: Topic drift detection result */
  topicDriftDetected?: boolean;
  /** US-093: Topic drift confidence score */
  topicDriftConfidence?: number;
  /** US-455: Extracted dates from user message before intent classification */
  extractedDates?: Array<{ original: string; iso: string; format: string; confidence: number; interpreted: string }>;
  /** US-488: Whether conversation context compression was applied */
  contextCompressionApplied?: boolean;
  /** US-488: Entity preservation metrics from context compression */
  contextCompressionMetrics?: {
    ratio: number;
    preserved: number;
    lost: number;
  };
  /** US-396: Number of context messages loaded for multi-turn context */
  contextMessagesCount?: number;
  /** US-396: Number of context messages filtered by age */
  contextMessagesFiltered?: number;
}

export interface PipelineState {
  requestId: string;
  msg: IncomingMessage;
  phone: string;
  text: string;
  processText: string;
  foreignLang: string | null;
  convo: ConversationState;
  lang: 'en' | 'ms' | 'zh' | 'ta';
  diaryEvent: ConversationEvent;
  devMetadata: DevMetadata;
  response: string | null;
  imageUrl?: string | null;
  /** US-430: Interactive message payload (list/buttons) to send instead of plain text */
  interactivePayload?: Record<string, any> | null;
  /** Language detection confidence (US-418) */
  detectedLanguageConfidence?: number;
  /** Multi-profile support */
  profileId: string;
  profileConfig: ConfigStore;
  profileKB: KnowledgeBaseInstance;
  /** US-427: performance.now() at state creation, used for total_ms trace latency */
  traceStart: number;
  /** US-843: True when this JID has no prior consent record (first-ever interaction) */
  isFirstContact?: boolean;
  /** US-955: Whether RAG retrieval found relevant KB context for this query */
  ragUsed?: boolean;
  /** US-955: Topic files selected by RAG or regex (excludes core files like AGENTS.md) */
  ragTopicFiles?: string[];
}

export type ValidationResult =
  | { continue: false; reason: string }
  | { continue: true; state: PipelineState };

export type StateResult =
  | { handled: true }
  | { handled: false };

// ─── US-408: Unified Flow Interface ─────────────────────────────────

/**
 * Context passed to flow implementations during step execution.
 */
export interface FlowContext {
  language: 'en' | 'ms' | 'zh' | 'ta';
  phone: string;
  pushName: string;
  instanceId?: string;
  messages: ChatMessage[];
  profileId?: string;
  profileConfig: ConfigStore;
  sendMessage: SendMessageFn;
}

/**
 * Result returned by a flow's start() or executeStep() method.
 */
export interface FlowStepResult {
  response: string;
  /** Updated flow-specific state, or null if the flow is complete. */
  newState: any | null;
  shouldForward?: boolean;
  conversationSummary?: string;
  metadata?: Record<string, any>;
}

/**
 * Serializable state stored on ConversationState.activeFlow.
 * Wraps the flow type identifier and the flow-specific data.
 */
export interface FlowState {
  flowType: string;
  data: any;
}

/**
 * Unified interface for multi-step conversational flows.
 *
 * Implementations handle booking, workflows, surveys, onboarding, etc.
 * New flows can be registered without modifying state-executor.ts.
 */
export interface Flow {
  /** Unique identifier for this flow type (e.g. 'booking', 'workflow', 'survey'). */
  readonly type: string;

  /** Initialize the flow and return the first step's response. */
  start(context: FlowContext, initialInput?: string | null): Promise<FlowStepResult>;

  /** Execute the next step given the current state and user message. */
  executeStep(state: any, userMessage: string, context: FlowContext): Promise<FlowStepResult>;

  /** Check if the given state represents a completed flow. */
  isComplete(state: any): boolean;
}
