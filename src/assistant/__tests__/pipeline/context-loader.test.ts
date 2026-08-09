/**
 * Tests for Multi-Turn Context Loader Pipeline Stage (US-396)
 *
 * Tests verify:
 * - Loading last 3 messages from conversation
 * - Filtering messages older than 24 hours
 * - Formatting context window correctly
 * - Proper injection into system prompt
 */

import { describe, it, expect } from 'vitest';
import { loadContextWindow, injectContextWindow } from '../../pipeline/stages/context-loader.js';
import type { PipelineState } from '../../pipeline/types.js';
import type { ChatMessage, ConversationState } from '../../types.js';
import type { IPipelineContext } from '../../pipeline/pipeline-context.js';

describe('Multi-Turn Context Loader (US-396)', () => {
  const createMockConversation = (messages: ChatMessage[]): ConversationState => ({
    phone: '601234567890',
    pushName: 'Test User',
    messages,
    language: 'en',
    bookingState: null,
    workflowState: null,
    activeFlow: null,
    unknownCount: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    lastIntent: null,
    lastIntentConfidence: null,
    lastIntentTimestamp: null,
    slots: {},
    repeatCount: 0,
    lastUserMessageAt: null,
  });

  const createMockContext = (): IPipelineContext => ({
    getSettings: () => ({}),
    getRouting: () => ({}),
    getWorkflows: () => ({}),
    getWorkflow: () => ({}),
    getTimeSensitiveIntentSet: () => new Set(),
    guessTopicFiles: () => [],
    buildSystemPrompt: (persona) => persona,
    getTimeContext: () => '',
    retrieveContext: async () => ({ hasRelevantContext: false, chunks: [], latencyMs: 0 }),
    ragReady: false,
    getStaticReply: () => null,
    getStaticReplyImageUrl: () => null,
    getTemplate: () => '',
    getOrCreate: () => createMockConversation([]),
    addMessage: () => {},
    updateBookingState: () => {},
    updateWorkflowState: () => {},
    updateActiveFlow: () => {},
    incrementUnknown: () => 0,
    resetUnknown: () => {},
    updateLastIntent: () => {},
    checkRepeatIntent: () => ({ isRepeat: false, count: 0 }),
    applyConversationSummarization: async (msgs) => ({ messages: msgs, wasSummarized: false, originalCount: msgs.length, reducedCount: msgs.length }),
    isAIAvailable: () => true,
    classifyMessageWithContext: async () => ({ category: 'unknown', confidence: 0, entities: {}, source: 'regex' }),
    classifyAndRespond: async () => ({ response: 'test' }),
    classifyOnly: async () => ({ intent: 'unknown' }),
    generateReplyOnly: async () => 'test',
    classifyAndRespondWithSmartFallback: async () => ({ response: 'test' }),
    detectMessageType: () => 'text',
    detectLanguage: () => 'en',
    handleBookingStep: async () => ({}),
    createBookingState: () => ({ stage: 'inquiry' }),
    executeWorkflowStep: async () => ({}),
    createWorkflowState: () => ({ workflowId: '', steps: [] }),
    forwardWorkflowSummary: async () => {},
    escalateToStaff: async () => 'escalated',
    shouldEscalate: () => null,
    logEscalationEvent: () => {},
    trackIntentPrediction: async () => {},
    trackIntentClassified: () => {},
    trackEscalation: () => {},
    trackWorkflowStarted: () => {},
    trackBookingStarted: () => {},
    sendWhatsAppTypingIndicator: async () => {},
    sendMessage: async () => ({}),
    notifyAdminConfigError: async () => {},
    logMessage: async () => {},
    routerContext: {} as any,
  });

  const createMockState = (convo: ConversationState): PipelineState => ({
    phone: '601234567890',
    msg: {} as any,
    convo,
    processText: 'test',
    lang: 'en',
    response: null,
    diaryEvent: null,
    devMetadata: {
      startTime: Date.now(),
      fromRecovery: false,
      inputHash: '',
    },
  });

  describe('loadContextWindow', () => {
    it('should return empty context window when conversation has no messages', async () => {
      const convo = createMockConversation([]);
      const state = createMockState(convo);
      const context = createMockContext();

      const result = await loadContextWindow(state, context);

      expect(result.contextWindow).toBe('');
      expect(result.messageCount).toBe(0);
      expect(result.filteredCount).toBe(0);
    });

    it('should load last 3 messages when more than 3 exist', async () => {
      const now = Date.now();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Message 1', timestamp: (now - 10000) / 1000 },
        { role: 'assistant', content: 'Response 1', timestamp: (now - 9000) / 1000 },
        { role: 'user', content: 'Message 2', timestamp: (now - 8000) / 1000 },
        { role: 'assistant', content: 'Response 2', timestamp: (now - 7000) / 1000 },
        { role: 'user', content: 'Message 3', timestamp: (now - 6000) / 1000 },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();

      const result = await loadContextWindow(state, context);

      expect(result.messageCount).toBe(3);
      expect(result.contextWindow).toContain('User: Message 2');
      expect(result.contextWindow).toContain('Assistant: Response 2');
      expect(result.contextWindow).toContain('User: Message 3');
      expect(result.contextWindow).not.toContain('Message 1');
    });

    it('should format context correctly with User and Assistant labels', async () => {
      const now = Date.now();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello', timestamp: (now - 2000) / 1000 },
        { role: 'assistant', content: 'Hi there!', timestamp: (now - 1000) / 1000 },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();

      const result = await loadContextWindow(state, context);

      expect(result.contextWindow).toContain('Previous messages:');
      expect(result.contextWindow).toContain('User: Hello');
      expect(result.contextWindow).toContain('Assistant: Hi there!');
    });

    it('should exclude messages older than 24 hours', async () => {
      const now = Date.now();
      const oneDayAgoSeconds = (now - 24 * 60 * 60 * 1000) / 1000;
      const twoHoursAgoSeconds = (now - 2 * 60 * 60 * 1000) / 1000;

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Old message', timestamp: oneDayAgoSeconds - 100 }, // > 24 hours
        { role: 'assistant', content: 'Old response', timestamp: oneDayAgoSeconds - 99 },
        { role: 'user', content: 'Recent message', timestamp: twoHoursAgoSeconds },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();

      const result = await loadContextWindow(state, context);

      expect(result.filteredCount).toBe(2);
      expect(result.messageCount).toBe(1);
      expect(result.contextWindow).toContain('Recent message');
      expect(result.contextWindow).not.toContain('Old message');
    });

    it('should handle single message within 24 hours', async () => {
      const now = Date.now();
      const oneHourAgoSeconds = (now - 60 * 60 * 1000) / 1000;

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Single message', timestamp: oneHourAgoSeconds },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();

      const result = await loadContextWindow(state, context);

      expect(result.messageCount).toBe(1);
      expect(result.contextWindow).toContain('User: Single message');
    });

    it('should preserve message order (most recent at end)', async () => {
      const now = Date.now();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'First', timestamp: (now - 3000) / 1000 },
        { role: 'assistant', content: 'Second', timestamp: (now - 2000) / 1000 },
        { role: 'user', content: 'Third', timestamp: (now - 1000) / 1000 },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();

      const result = await loadContextWindow(state, context);

      const lines = result.contextWindow.split('\n');
      const firstLine = lines.find(l => l.includes('First'));
      const thirdLine = lines.find(l => l.includes('Third'));
      expect(lines.indexOf(firstLine!)).toBeLessThan(lines.indexOf(thirdLine!));
    });
  });

  describe('injectContextWindow', () => {
    it('should inject context window into system prompt', () => {
      const basePrompt = 'You are a helpful assistant.';
      const context = 'Previous messages:\nUser: Hi\nAssistant: Hello';

      const result = injectContextWindow(basePrompt, context);

      expect(result).toContain(basePrompt);
      expect(result).toContain('<conversation_context>');
      expect(result).toContain(context);
      expect(result).toContain('</conversation_context>');
    });

    it('should return unchanged prompt when context is empty', () => {
      const basePrompt = 'You are a helpful assistant.';
      const emptyContext = '';

      const result = injectContextWindow(basePrompt, emptyContext);

      expect(result).toBe(basePrompt);
    });

    it('should preserve base prompt structure', () => {
      const basePrompt = 'You are a hostel AI.\nYou help guests with bookings.';
      const context = 'Previous messages:\nUser: Can I book?';

      const result = injectContextWindow(basePrompt, context);

      expect(result.startsWith(basePrompt)).toBe(true);
    });

    it('should separate context block with newlines', () => {
      const basePrompt = 'Base prompt.';
      const context = 'Context here.';

      const result = injectContextWindow(basePrompt, context);

      expect(result).toContain('\n\n<conversation_context>');
      expect(result).toContain('</conversation_context>');
    });
  });

  describe('Integration: context loader pipeline', () => {
    it('should handle realistic multi-turn conversation', async () => {
      const now = Date.now();
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What are your room rates?', timestamp: (now - 5000) / 1000 },
        { role: 'assistant', content: 'Our rooms start at RM80 per night.', timestamp: (now - 4500) / 1000 },
        { role: 'user', content: 'Do you have availability next week?', timestamp: (now - 3000) / 1000 },
        { role: 'assistant', content: 'Yes, we have rooms available.', timestamp: (now - 2500) / 1000 },
        { role: 'user', content: 'I want to book for 3 nights', timestamp: (now - 1000) / 1000 },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();
      const basePrompt = 'You are a hostel booking assistant.';

      const loader = await loadContextWindow(state, context);
      const enhanced = injectContextWindow(basePrompt, loader.contextWindow);

      expect(loader.messageCount).toBe(3);
      expect(enhanced).toContain('Do you have availability next week?');
      expect(enhanced).toContain('Yes, we have rooms available.');
      expect(enhanced).toContain('I want to book for 3 nights');
    });

    it('should gracefully handle all messages older than 24 hours', async () => {
      const now = Date.now();
      const twoDaysAgoSeconds = (now - 48 * 60 * 60 * 1000) / 1000;

      const messages: ChatMessage[] = [
        { role: 'user', content: 'Old 1', timestamp: twoDaysAgoSeconds },
        { role: 'assistant', content: 'Old 2', timestamp: twoDaysAgoSeconds + 100 },
      ];

      const convo = createMockConversation(messages);
      const state = createMockState(convo);
      const context = createMockContext();
      const basePrompt = 'Base prompt.';

      const loader = await loadContextWindow(state, context);
      const enhanced = injectContextWindow(basePrompt, loader.contextWindow);

      expect(loader.messageCount).toBe(0);
      expect(enhanced).toBe(basePrompt); // No injection when context is empty
    });
  });
});
