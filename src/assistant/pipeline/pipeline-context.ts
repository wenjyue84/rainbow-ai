/**
 * Pipeline Context - Dependency Injection Container
 *
 * This interface defines all external dependencies needed by pipeline stages.
 * Instead of importing 15+ modules directly, stages receive this context,
 * enabling:
 * - Easy mocking for unit tests
 * - Clear dependency contracts
 * - Flexible implementation swapping
 * - Reduced coupling
 */

import type { RouterContext, FlowState } from './types.js';
import type { ConversationState, ChatMessage, BookingState, IntentResult, EscalationReason } from '../types.js';
import type { WorkflowState, WorkflowContext } from '../workflow-executor.js';

/**
 * Dependency container for pipeline stages.
 * All stages receive this context instead of importing modules directly.
 */
export interface IPipelineContext {
  // ─── Configuration ────────────────────────────────────────────────

  getSettings: () => any; // SettingsData
  getRouting: () => any; // RoutingData
  getWorkflows: () => any; // WorkflowsData
  getWorkflow: () => any; // WorkflowData
  getTimeSensitiveIntentSet: () => Set<string>;

  // ─── Knowledge Base ───────────────────────────────────────────────

  guessTopicFiles: (text: string) => string[];
  buildSystemPrompt: (basePersona: string, topicFiles: string[]) => string;
  getTimeContext: () => string;
  getStaticReply: (intent: string, lang: 'en' | 'ms' | 'zh' | 'ta') => string | null;
  getStaticReplyImageUrl: (intent: string) => string | null;
  getTemplate: (key: string, lang: 'en' | 'ms' | 'zh' | 'ta') => string;

  // ─── Conversation Management ──────────────────────────────────────

  getOrCreate: (phone: string, pushName: string) => ConversationState;
  addMessage: (phone: string, role: 'user' | 'assistant', content: string) => void;
  updateBookingState: (phone: string, state: BookingState | null) => void;
  updateWorkflowState: (phone: string, state: WorkflowState | null) => void;
  updateActiveFlow: (phone: string, flow: FlowState | null) => void;
  incrementUnknown: (phone: string) => number;
  resetUnknown: (phone: string) => void;
  updateLastIntent: (phone: string, intent: string, confidence: number) => void;
  checkRepeatIntent: (phone: string, intent: string) => { isRepeat: boolean; count: number };

  // ─── Conversation Summarization ───────────────────────────────────

  applyConversationSummarization: (messages: ChatMessage[]) => Promise<{
    messages: ChatMessage[];
    wasSummarized: boolean;
    originalCount: number;
    reducedCount: number;
  }>;

  // ─── AI Classification ────────────────────────────────────────────

  isAIAvailable: () => boolean;
  classifyMessageWithContext: (text: string, context: ChatMessage[], lastIntent: string | null) => Promise<IntentResult>;
  classifyAndRespond: (systemPrompt: string, context: ChatMessage[], text: string) => Promise<any>;
  classifyOnly: (text: string, context: ChatMessage[], provider?: string) => Promise<any>;
  generateReplyOnly: (systemPrompt: string, context: ChatMessage[], text: string, intent: string) => Promise<any>;
  classifyAndRespondWithSmartFallback: (systemPrompt: string, context: ChatMessage[], text: string) => Promise<any>;

  // ─── Detection & Analysis ─────────────────────────────────────────

  detectMessageType: (text: string) => string;
  detectLanguage: (text: string) => 'en' | 'ms' | 'zh' | 'ta';

  // ─── Workflows & Booking ──────────────────────────────────────────

  handleBookingStep: (state: BookingState, text: string, lang: 'en' | 'ms' | 'zh', context: ChatMessage[]) => Promise<any>;
  createBookingState: () => BookingState;
  executeWorkflowStep: (state: WorkflowState, userInput: string | null, context: WorkflowContext) => Promise<any>;
  createWorkflowState: (workflowId: string) => WorkflowState;
  forwardWorkflowSummary: (phone: string, pushName: string, workflow: any, state: WorkflowState, instanceId?: string) => Promise<void>;

  // ─── Escalation ───────────────────────────────────────────────────

  escalateToStaff: (context: any) => Promise<string>;
  shouldEscalate: (reason: EscalationReason | null, unknownCount: number, guestCount?: number) => EscalationReason | null;
  logEscalationEvent: (input: { jid: string; profileId: string; trigger: string; count?: number; metadata?: Record<string, any>; summaryContext?: { guestName: string; recentMessages: string[]; escalationReason: string } }) => void;

  // ─── Tracking ─────────────────────────────────────────────────────

  trackIntentPrediction: (conversationId: string, phone: string, text: string, intent: string, confidence: number, source: string, model?: string) => Promise<void>;
  trackIntentClassified: (intent: string, confidence: number, source: string) => void;
  trackEscalation: (phone: string, pushName: string, reason: string) => void;
  trackWorkflowStarted: (phone: string, pushName: string, workflowName: string) => void;
  trackBookingStarted: (phone: string, pushName: string) => void;

  // ─── Communication ────────────────────────────────────────────────

  sendWhatsAppTypingIndicator: (phone: string, instanceId?: string) => Promise<void>;
  sendMessage: (phone: string, text: string, instanceId?: string) => Promise<any>;
  notifyAdminConfigError: (message: string) => Promise<void>;
  logMessage: (phone: string, pushName: string, role: 'user' | 'assistant', content: string, metadata?: any) => Promise<void>;

  // ─── Router Context (injected dependencies) ───────────────────────

  routerContext: RouterContext;
}

/**
 * Create default pipeline context from real implementations.
 * Uses dynamic imports to avoid circular dependencies.
 * Accepts optional profile-specific ConfigStore and KB instance.
 */
export async function createPipelineContext(
  routerContext: RouterContext,
  profileConfig?: import('../config-store.js').ConfigStore,
  profileKB?: import('../knowledge-base-instance.js').KnowledgeBaseInstance,
): Promise<IPipelineContext> {
  // Dynamic imports to prevent circular dependency issues
  const { configStore: defaultConfigStore } = await import('../config-store.js');
  const configStore = profileConfig || defaultConfigStore;
  const { guessTopicFiles: defaultGuessTopicFiles, buildSystemPrompt: defaultBuildSystemPrompt, getTimeContext } = await import('../knowledge-base.js');
  const { getStaticReply, getStaticReplyImageUrl } = await import('../knowledge.js');
  const { getTemplate, detectLanguage } = await import('../formatter.js');
  const {
    getOrCreate, addMessage, updateBookingState, updateWorkflowState, updateActiveFlow,
    incrementUnknown, resetUnknown, updateLastIntent, checkRepeatIntent
  } = await import('../conversation.js');
  const { applyConversationSummarization } = await import('../conversation-summarizer.js');
  const {
    isAIAvailable, classifyAndRespond, classifyOnly, generateReplyOnly,
    classifyAndRespondWithSmartFallback
  } = await import('../ai-client.js');
  const { classifyMessageWithContext } = await import('../intents.js');
  const { detectMessageType } = await import('../problem-detector.js');
  const { handleBookingStep, createBookingState } = await import('../booking.js');
  const { executeWorkflowStep, createWorkflowState, forwardWorkflowSummary } = await import('../workflow-executor.js');
  const { escalateToStaff, shouldEscalate } = await import('../escalation.js');
  const { logEscalationEvent } = await import('../../lib/escalation-events.js');
  const { trackIntentPrediction } = await import('../intent-tracker.js');
  const {
    trackIntentClassified, trackEscalation,
    trackWorkflowStarted, trackBookingStarted
  } = await import('../../lib/activity-tracker.js');
  const { sendWhatsAppTypingIndicator } = await import('../../lib/baileys-client.js');
  const { notifyAdminConfigError } = await import('../../lib/admin-notifier.js');
  const { logMessage } = await import('../conversation-logger.js');

  // Build profile-aware KB functions
  const guessTopicFiles = profileKB
    ? (text: string) => profileKB.guessTopicFiles(text)
    : defaultGuessTopicFiles;
  const buildSystemPrompt = profileKB
    ? (basePersona: string, topicFiles: string[]) => profileKB.buildSystemPrompt(basePersona, topicFiles, configStore)
    : defaultBuildSystemPrompt;

  return {
    // Configuration
    getSettings: () => configStore.getSettings(),
    getRouting: () => configStore.getRouting(),
    getWorkflows: () => configStore.getWorkflows(),
    getWorkflow: () => configStore.getWorkflow(),
    getTimeSensitiveIntentSet: () => configStore.getTimeSensitiveIntentSet(),

    // Knowledge Base
    guessTopicFiles,
    buildSystemPrompt,
    getTimeContext,
    getStaticReply,
    getStaticReplyImageUrl,
    getTemplate,

    // Conversation Management
    getOrCreate,
    addMessage,
    updateBookingState,
    updateWorkflowState,
    updateActiveFlow,
    incrementUnknown,
    resetUnknown,
    updateLastIntent,
    checkRepeatIntent,

    // Conversation Summarization
    applyConversationSummarization,

    // AI Classification
    isAIAvailable,
    classifyMessageWithContext,
    classifyAndRespond,
    classifyOnly,
    generateReplyOnly,
    classifyAndRespondWithSmartFallback,

    // Detection & Analysis
    detectMessageType,
    detectLanguage,

    // Workflows & Booking
    handleBookingStep,
    createBookingState,
    executeWorkflowStep,
    createWorkflowState,
    forwardWorkflowSummary,

    // Escalation
    escalateToStaff,
    shouldEscalate,
    logEscalationEvent,

    // Tracking
    trackIntentPrediction,
    trackIntentClassified,
    trackEscalation,
    trackWorkflowStarted,
    trackBookingStarted,

    // Communication
    sendWhatsAppTypingIndicator,
    sendMessage: routerContext.sendMessage,
    notifyAdminConfigError,
    logMessage,

    // Router Context
    routerContext,
  };
}
