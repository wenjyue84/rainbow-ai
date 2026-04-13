import type { ConversationState, ChatMessage } from './types.js';
import type { FlowState } from './pipeline/types.js';
import { detectLanguage } from './formatter.js';
import { StateManager } from './state-manager.js';
import {
  initStatePersistence, loadActiveStates,
  schedulePersist, deletePersistedState
} from './state-persistence.js';
import { softInvariant } from '../lib/invariant.js';
import { getIntentConfig } from './intent-config.js';
import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('conversation');

const TTL_MS = 3_600_000; // 1 hour (session TTL — separate from context inactivity TTL)
const DEFAULT_MAX_MESSAGES = 20;
const CLEANUP_INTERVAL_MS = 300_000; // 5 minutes
const TOKEN_LIMIT = 4096; // Maximum tokens in conversation context
const TOKEN_WARNING_THRESHOLD = Math.round(TOKEN_LIMIT * 0.8); // 3276 tokens (80%)

/**
 * Count tokens in text using whitespace-based approximation.
 * 1 token ≈ 1 word (split by whitespace).
 */
function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Read configurable max message window from intent config (default 20). */
function getMaxMessages(): number {
  return getIntentConfig().conversationState.maxHistoryMessages ?? DEFAULT_MAX_MESSAGES;
}

/** Read configurable context inactivity TTL in ms from intent config (default 30 min). */
function getContextInactivityTTLMs(): number {
  const ttlMinutes = getIntentConfig().conversationState.contextTTL ?? 30;
  return ttlMinutes * 60 * 1000;
}

/**
 * Return the current context window configuration for introspection/testing.
 */
export function getContextWindowConfig(): { maxMessages: number; inactivityTTLMs: number } {
  return {
    maxMessages: getMaxMessages(),
    inactivityTTLMs: getContextInactivityTTLMs(),
  };
}

// Use generic StateManager to handle TTL, cleanup, and lastActiveAt tracking
// StateManager adds 'lastActiveAt' automatically, so we omit it from the type
const conversationManager = new StateManager<Omit<ConversationState, 'lastActiveAt'>>(
  TTL_MS,
  CLEANUP_INTERVAL_MS,
  {
    onExpire: (key) => {
      deletePersistedState(key).catch(() => { });
    }
  }
);

/**
 * Initialize conversations — loads active states from DB on startup.
 */
export async function initConversations(): Promise<void> {
  await initStatePersistence();

  const savedStates = await loadActiveStates(TTL_MS);
  for (const { phone, state } of savedStates) {
    // Add empty messages array since messages are stored separately in conversation log
    conversationManager.set(phone, { ...state, messages: [] });
  }

  if (savedStates.length > 0) {
    console.log(`[Conversations] Restored ${savedStates.length} conversation(s) from database`);
  }
}

export function destroyConversations(): void {
  conversationManager.destroy();
}

/**
 * Build a composite key for profile-scoped conversation state.
 * Default profile uses plain phone for backward compatibility.
 */
function convoKey(phone: string, profileId?: string): string {
  if (!profileId || profileId === 'pelangi') return phone;
  return `${profileId}:${phone}`;
}

export function getOrCreate(phone: string, pushName: string, profileId?: string): ConversationState {
  const now = Date.now();
  const key = convoKey(phone, profileId);

  // StateManager.getOrCreate() handles TTL checking and lastActiveAt updates
  return conversationManager.getOrCreate(key, () => ({
    phone,
    profileId,  // US-160: Track profile association for routing validation
    pushName,
    messages: [],
    language: 'en' as const,
    bookingState: null,
    workflowState: null,
    activeFlow: null,
    unknownCount: 0,
    createdAt: now,
    // lastActiveAt is added automatically by StateManager
    lastIntent: null,
    lastIntentConfidence: null,
    lastIntentTimestamp: null,
    slots: {},
    repeatCount: 0,
    lastUserMessageAt: null,
    tokenCount: 0  // US-578: Track conversation token usage
  }));
}

export function addMessage(phone: string, role: 'user' | 'assistant', content: string, profileId?: string): void {
  const key = convoKey(phone, profileId);
  const maxMessages = getMaxMessages();
  const inactivityTTLMs = getContextInactivityTTLMs();

  // StateManager.update() automatically updates lastActiveAt
  conversationManager.update(key, (convo) => {
    // US-004: Reset context window after inactivity timeout
    // If a new user message arrives after configurable inactivity period, clear history
    if (role === 'user' && convo.lastUserMessageAt !== null) {
      const idleMs = Date.now() - convo.lastUserMessageAt;
      if (idleMs > inactivityTTLMs) {
        console.log(
          `[Conversation] Context reset for ${phone} after ${Math.round(idleMs / 60000)}m inactivity ` +
          `(TTL: ${Math.round(inactivityTTLMs / 60000)}m)`
        );
        convo.messages = [];
        convo.tokenCount = 0;  // US-578: Reset token count on context reset
      }
    }

    convo.messages.push({
      role,
      content,
      timestamp: Math.floor(Date.now() / 1000)
    });

    // US-578: Add tokens for this message
    convo.tokenCount += countTokens(content);

    // US-004: Prune using configurable window size from intent config
    if (convo.messages.length > maxMessages) {
      const removedMessages = convo.messages.slice(0, convo.messages.length - maxMessages);
      convo.messages = convo.messages.slice(-maxMessages);

      // US-578: Recalculate token count after pruning
      let removedTokens = 0;
      for (const msg of removedMessages) {
        removedTokens += countTokens(msg.content);
      }
      convo.tokenCount = Math.max(0, convo.tokenCount - removedTokens);
    }

    // US-578: Warn when approaching token limit (80%)
    if (convo.tokenCount >= TOKEN_WARNING_THRESHOLD) {
      logger.warn('conversation-context-token-limit', {
        conversationId: key,
        tokenCount: convo.tokenCount,
        limit: TOKEN_LIMIT,
        thresholdPercent: 80
      });
    }

    // Update language detection and last user message timestamp
    if (role === 'user') {
      convo.language = detectLanguage(content);
      convo.lastUserMessageAt = Date.now();
    }
  });

  // Debounced persist (messages not stored in DB, but metadata updates)
  const state = conversationManager.get(key);
  if (state) {
    // Runtime invariants (P3C)
    softInvariant(
      state.unknownCount >= 0,
      'unknownCount must be non-negative',
      { phone, unknownCount: state.unknownCount }
    );
    softInvariant(
      state.messages.length <= maxMessages,
      'messages exceed maxMessages',
      { phone, count: state.messages.length, max: maxMessages }
    );
    softInvariant(
      state.tokenCount >= 0,
      'tokenCount must be non-negative',
      { phone, tokenCount: state.tokenCount }
    );
    schedulePersist(key, state as ConversationState);
  }
}

export function get(phone: string, profileId?: string): ConversationState | null {
  return conversationManager.get(convoKey(phone, profileId)) || null;
}

export function getMessages(phone: string, profileId?: string): ChatMessage[] {
  return conversationManager.get(convoKey(phone, profileId))?.messages || [];
}

export function updateBookingState(phone: string, bookingState: ConversationState['bookingState'], profileId?: string): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    convo.bookingState = bookingState;
  });

  // Critical state — persist immediately
  const state = conversationManager.get(key);
  if (state) {
    softInvariant(
      !(state.bookingState !== null && state.workflowState !== null),
      'bookingState and workflowState are mutually exclusive',
      { phone, hasBooking: !!state.bookingState, hasWorkflow: !!state.workflowState }
    );
    schedulePersist(key, state as ConversationState, true);
  }
}

export function updateWorkflowState(phone: string, workflowState: ConversationState['workflowState'], profileId?: string): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    convo.workflowState = workflowState;
  });

  // Critical state — persist immediately
  const state = conversationManager.get(key);
  if (state) {
    softInvariant(
      !(state.bookingState !== null && state.workflowState !== null),
      'bookingState and workflowState are mutually exclusive',
      { phone, hasBooking: !!state.bookingState, hasWorkflow: !!state.workflowState }
    );
    schedulePersist(key, state as ConversationState, true);
  }
}

/**
 * US-408: Update the unified active flow state.
 *
 * For legacy flow types ('booking', 'workflow'), also updates the
 * corresponding dedicated field for backward compatibility.
 */
export function updateActiveFlow(phone: string, activeFlow: FlowState | null, profileId?: string): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    convo.activeFlow = activeFlow;

    // Sync to legacy fields for backward compatibility
    if (!activeFlow) {
      // Flow completed — clear legacy fields if they match
      // (Don't clear if they were set independently)
    } else if (activeFlow.flowType === 'booking') {
      convo.bookingState = activeFlow.data;
    } else if (activeFlow.flowType === 'workflow') {
      convo.workflowState = activeFlow.data;
    }
  });

  // Critical state — persist immediately
  const state = conversationManager.get(key);
  if (state) {
    schedulePersist(key, state as ConversationState, true);
  }
}

export function incrementUnknown(phone: string, profileId?: string): number {
  const key = convoKey(phone, profileId);
  let count = 0;
  conversationManager.update(key, (convo) => {
    convo.unknownCount++;
    count = convo.unknownCount;
  });
  return count;
}

export function resetUnknown(phone: string, profileId?: string): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    convo.unknownCount = 0;
  });
}

export function clearConversation(phone: string, profileId?: string): void {
  const key = convoKey(phone, profileId);
  // Update conversation to reset tokenCount before deletion
  conversationManager.update(key, (convo) => {
    convo.messages = [];
    convo.tokenCount = 0;  // US-578: Clear token count when clearing conversation
  });
  conversationManager.delete(key);
  deletePersistedState(key).catch(() => { });
}

// ─── Context-Aware Intent Tracking ──────────────────────────────────

export function updateLastIntent(
  phone: string,
  intent: string,
  confidence: number,
  profileId?: string
): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    convo.lastIntent = intent;
    convo.lastIntentConfidence = confidence;
    convo.lastIntentTimestamp = Date.now();
  });

  // Debounced persist
  const state = conversationManager.get(key);
  if (state) schedulePersist(key, state as ConversationState);
}

export function checkRepeatIntent(
  phone: string,
  intent: string,
  windowMs: number = 120_000,
  profileId?: string
): { isRepeat: boolean; count: number } {
  const convo = conversationManager.get(convoKey(phone, profileId));
  if (!convo || !convo.lastIntent || !convo.lastIntentTimestamp) {
    return { isRepeat: false, count: 0 };
  }

  const elapsed = Date.now() - convo.lastIntentTimestamp;
  if (convo.lastIntent === intent && elapsed < windowMs) {
    convo.repeatCount++;
    return { isRepeat: true, count: convo.repeatCount };
  }

  // Different intent or expired window → reset
  convo.repeatCount = 0;
  return { isRepeat: false, count: 0 };
}

export function getLastIntent(phone: string, profileId?: string): string | null {
  return conversationManager.get(convoKey(phone, profileId))?.lastIntent || null;
}

export function updateSlots(
  phone: string,
  newSlots: Record<string, any>,
  profileId?: string
): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    // Merge new slots with existing ones
    convo.slots = { ...convo.slots, ...newSlots };
  });

  // Debounced persist
  const state = conversationManager.get(key);
  if (state) schedulePersist(key, state as ConversationState);
}

export function getSlots(phone: string, profileId?: string): Record<string, any> {
  return conversationManager.get(convoKey(phone, profileId))?.slots || {};
}

export function clearSlots(phone: string, profileId?: string): void {
  const key = convoKey(phone, profileId);
  conversationManager.update(key, (convo) => {
    convo.slots = {};
  });
}

// ─── Cleanup ────────────────────────────────────────────────────────
// Cleanup is now handled automatically by StateManager
// On expire, onExpire callback deletes from DB

// For testing
export function _getConversationsSize(): number {
  return conversationManager.size();
}
