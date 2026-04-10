/**
 * chat-engine.ts — Shared message processing engine
 *
 * Extracted from testing-preview.ts to be reused by both
 * the admin preview chat and the public webchat.
 */

import type { ConfigStore } from './config-store.js';
import type { KnowledgeBaseInstance } from './knowledge-base-instance.js';
import type { MCPTool, ToolHandler } from '../types/mcp.js';
import type { ChatMessage as TypesChatMessage } from './types.js';
import type { SupportedLanguage } from './language-router.js';
import { isAIAvailable, classifyAndRespond } from './ai-client.js';
import { getUnknownFallbackMessages, chatWithToolsLoop } from './ai-response-generator.js';
import { detectPromptInjection } from './pipeline/prompt-injection-guard.js';
import { filterByRelevance, pruneContextByRelevance } from './pipeline/context-manager.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface ChatOptions {
  message: string;
  history: ChatMessage[];
  sessionId?: string;
  /** Profile ID — used to scope workflow state so profiles don't share session state. */
  profileId?: string;
  configStore: ConfigStore;
  kb: KnowledgeBaseInstance;
  tools?: MCPTool[];
  toolHandlers?: Map<string, ToolHandler>;
  /** Optional text appended to the system prompt (e.g. current cart state). */
  systemPromptSuffix?: string;
}

export interface QuickSuggestion {
  label: string;
  payload: string;
}

export interface ChatResult {
  message: string;
  intent: string;
  confidence: number;
  responseTime: number;
  model: string;
  /** Dynamic follow-up suggestions based on the response context */
  suggestions?: QuickSuggestion[];
  // Extended fields (for admin preview)
  source?: string;
  action?: string;
  routedAction?: string;
  matchedKeyword?: string;
  matchedExample?: string;
  detectedLanguage?: string;
  kbFiles?: string[];
  messageType?: string;
  problemOverride?: boolean;
  sentiment?: string | null;
  editMeta?: any;
  usage?: any;
  tokenBreakdown?: any;
  contextCount?: number;
  sanitized?: boolean;
  error?: string;
  errorHandled?: boolean;
}

// ─── Input Sanitization ─────────────────────────────────────────────

/**
 * Sanitize user input to prevent prompt injection attacks.
 * Removes suspicious patterns that could manipulate AI behavior.
 */
export function sanitizeInput(text: string): string {
  if (!text || typeof text !== 'string') return '';

  let sanitized = text.trim();

  // Limit length to prevent extremely long inputs (max 50,000 chars = ~12,500 tokens)
  if (sanitized.length > 50000) {
    sanitized = sanitized.substring(0, 50000);
  }

  // Remove null bytes and control characters (except newlines/tabs)
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  // Detect and neutralize common prompt injection patterns
  const injectionPatterns = [
    /system\s*[:：]\s*/gi,
    /\[system\]/gi,
    /\<system\>/gi,
    /you\s+are\s+now/gi,
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/gi,
    /forget\s+(all\s+)?(previous|prior|instructions?)/gi,
    /\-{10,}/g,
    /\={10,}/g,
    /\#{5,}/g,
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }

  return sanitized.trim();
}

/**
 * Validate that input doesn't contain obvious prompt injection attempts.
 * Returns an error message if suspicious, null if safe.
 */
export function validateInputSafety(text: string): string | null {
  const suspiciousKeywords = [
    'ignore instructions',
    'you are now',
    'system:',
    'assistant:',
    'human:',
    '[INST]',
    '</s>',
    '<|im_start|>',
    '<|im_end|>',
  ];

  const lowerText = text.toLowerCase();
  for (const keyword of suspiciousKeywords) {
    const occurrences = (lowerText.match(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length;
    if (occurrences >= 3) {
      return 'Input contains suspicious patterns';
    }
  }

  return null;
}

// ─── Workflow State ─────────────────────────────────────────────────

interface WorkflowState {
  workflowId: string;
  currentStepIndex: number;
  lastAccess: number;
}

const workflowStates = new Map<string, WorkflowState>();

// Clean up stale workflow states every 5 minutes (30-min TTL)
const WORKFLOW_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, state] of workflowStates) {
    if (now - state.lastAccess > WORKFLOW_TTL_MS) {
      workflowStates.delete(key);
    }
  }
}, 5 * 60 * 1000);

function getSessionKey(history: ChatMessage[]): string {
  const firstMsg = history.find(m => m.role === 'user')?.content || '';
  return `${firstMsg.slice(0, 50)}::${history.length}`;
}

function getWorkflowState(key: string): { workflowId: string; currentStepIndex: number } | undefined {
  const state = workflowStates.get(key);
  if (state) {
    state.lastAccess = Date.now();
    return { workflowId: state.workflowId, currentStepIndex: state.currentStepIndex };
  }
  return undefined;
}

function setWorkflowState(key: string, workflowId: string, stepIndex: number): void {
  workflowStates.set(key, { workflowId, currentStepIndex: stepIndex, lastAccess: Date.now() });
}

function deleteWorkflowState(key: string): void {
  workflowStates.delete(key);
}

// ─── Dynamic Suggestion Generator ───────────────────────────────────

/**
 * Generate dynamic follow-up suggestions based on the AI response, intent, and user message.
 * Uses rule-based pattern matching — no extra LLM call needed.
 *
 * Strategy: Analyze both the response content and the detected intent to pick
 * the most relevant 2-4 follow-up actions. Response-content analysis is the
 * primary driver since intent classification may return "unknown" for many queries.
 */
function generateDynamicSuggestions(
  response: string,
  intent: string,
  userMessage: string,
  profileId?: string
): QuickSuggestion[] {
  const suggestions: QuickSuggestion[] = [];
  const lowerResponse = response.toLowerCase();
  const lowerMessage = userMessage.toLowerCase();
  const combined = lowerResponse + ' ' + lowerMessage;

  // Helper: add only if label not already present
  const add = (label: string, payload: string) => {
    if (!suggestions.some(s => s.label === label)) suggestions.push({ label, payload });
  };

  // ── 1. Response-content-based analysis (primary driver) ───────
  // Scan what the AI talked about to suggest relevant follow-ups

  // Services mentioned → offer drill-down
  const mentionsServices = /\b(services?|lcl|fcl|charter|console|warehousing|transport|logistics|trucking|shipping|cross[- ]border)\b/i.test(response);
  const mentionsPricing = /\b(rate|price|rm\s*\d|cost|charge|fee|pallet|per\s+ton)\b/i.test(response);
  const mentionsQuote = /\b(quote|quotation|enquir|inquiry|details|share.*info)\b/i.test(response);
  const mentionsContact = /\b(contact|whatsapp|call|phone|reach|email|office)\b/i.test(response);
  const mentionsRoute = /\b(johor|jb|penang|melaka|singapore|thailand|selangor|kuala\s*lumpur|kl|nilai)\b/i.test(response);
  const mentionsLCL = /\blcl\b/i.test(response);
  const mentionsFCL = /\b(fcl|full\s+lorry|charter|full\s+load)\b/i.test(response);
  const mentionsConsole = /\bconsole?\b/i.test(response);
  const mentionsCrossBorder = /\b(cross[- ]border|singapore|thailand|international)\b/i.test(response);
  const mentionsWarehouse = /\b(warehous|storage|stuffing|unstuffing|3pl|4pl)\b/i.test(response);

  // If response covers services overview → suggest specific service drill-downs
  if (mentionsServices && (mentionsLCL || mentionsFCL || mentionsConsole)) {
    if (mentionsLCL) add('LCL Details', 'Tell me more about LCL pallet service');
    if (mentionsFCL) add('Full Charter', 'Tell me more about full lorry charter');
    if (mentionsConsole) add('Console Service', 'Tell me more about console service');
    if (mentionsWarehouse) add('Warehousing', 'Tell me more about warehousing services');
    if (mentionsCrossBorder) add('Cross-Border', 'Tell me about cross-border services to Singapore and Thailand');
    add('Get a Quote', 'I need a shipping quote');
  }

  // If response talks about pricing/rates → suggest specific routes or quote
  if (mentionsPricing) {
    add('Get a Quote', 'I need a shipping quote');
    if (!combined.includes('johor') && !combined.includes('jb'))
      add('JB Rates', 'What are your freight rates to Johor Bahru?');
    if (!combined.includes('penang'))
      add('Penang Rates', 'What are your freight rates to Penang?');
    if (!combined.includes('singapore') && !combined.includes('thailand'))
      add('Cross-Border', 'What are the rates for cross-border shipping?');
  }

  // If response mentions specific route → suggest quote for that route + other routes
  if (mentionsRoute) {
    add('Get a Quote', 'I need a shipping quote');
    if (!combined.includes('cross') && !combined.includes('singapore') && !combined.includes('thailand'))
      add('Cross-Border', 'Tell me about cross-border services');
    add('Check Rates', 'What are your freight rates?');
  }

  // If quote/enquiry mentioned → suggest providing details
  if (mentionsQuote && suggestions.length < 3) {
    add('Get a Quote', 'I need a shipping quote');
    add('Check Rates', 'What are your freight rates?');
  }

  // If contact info mentioned → add contact option
  if (mentionsContact && suggestions.length < 4) {
    add('Contact Team', 'How do I contact the team directly?');
  }

  // ── 2. Intent-based enrichment (secondary) ────────────────────
  // Use classified intent to fill remaining slots when content analysis
  // didn't produce enough suggestions
  if (suggestions.length < 2) {
    switch (intent) {
      case 'greeting':
      case 'thanks':
        add('Our Services', 'What services do you offer?');
        add('Get a Quote', 'I need a shipping quote');
        add('Check Rates', 'What are your freight rates?');
        break;

      case 'pricing_query':
      case 'full_price_list':
        add('Get a Quote', 'I need a shipping quote');
        add('Cross-Border', 'What are the rates for cross-border shipping?');
        break;

      case 'services_query':
        add('LCL Details', 'Tell me more about LCL pallet service');
        add('Full Charter', 'Tell me more about full lorry charter');
        add('Get a Quote', 'I need a shipping quote');
        break;

      case 'transport_enquiry':
        add('Get a Quote', 'I need a shipping quote');
        add('Check Rates', 'What are your freight rates?');
        break;

      case 'company_info':
        add('Our Services', 'What services do you offer?');
        add('Get a Quote', 'I need a shipping quote');
        break;

      case 'escalate_human':
        add('Contact Team', 'How do I contact the team directly?');
        add('Operating Hours', 'What are your operating hours?');
        break;

      default:
        break;
    }
  }

  // ── 3. Fallback: always ensure at least 2 suggestions ─────────
  if (suggestions.length < 2) {
    add('Our Services', 'What services do you offer?');
    add('Get a Quote', 'I need a shipping quote');
    add('Contact Team', 'How do I contact the team directly?');
  }

  // Limit to 4 suggestions max
  return suggestions.slice(0, 4);
}

// ─── Core Chat Processing ───────────────────────────────────────────

const EMERGENCY_REASSURANCE = "Our staff has been notified and help is on the way. Please stay calm and keep your friend comfortable. If their condition worsens, please call 999 for an ambulance immediately. A staff member will arrive shortly to assist you.";
const EMERGENCY_INITIAL_RESPONSE = "URGENT — This is an emergency! Our staff has been immediately notified and help is on the way. Please stay calm. Call 999 for an ambulance right away if medical assistance is needed. DO NOT move the person if they have collapsed or are unconscious. A staff member will arrive shortly to assist you. Please tell us your exact location in the hostel.";

/**
 * Process a chat message through the full Rainbow AI pipeline.
 * Returns a ChatResult with all fields populated.
 */
export async function processChat(options: ChatOptions): Promise<ChatResult> {
  const { message, history, sessionId, profileId, configStore: store, kb } = options;
  const startTime = Date.now();

  const conversationHistory = history.map(msg => ({
    role: (msg.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: msg.content,
    timestamp: typeof msg.timestamp === 'number' ? msg.timestamp : Date.now()
  })) as TypesChatMessage[];

  // Prompt injection guard — check before any AI processing
  const settings = options.configStore.getSettings();
  const injectionPatterns: string[] = (settings as any).security?.injection_patterns ?? [];
  const injectionResult = detectPromptInjection(sanitizeInput(message), injectionPatterns);
  if (injectionResult.blocked) {
    console.warn('[PromptInjection] WARN: injection attempt detected', {
      sessionId: sessionId ?? '(no-session)',
      matchedPattern: injectionResult.matchedPattern,
    });
    const safeResponse: string =
      (settings as any).promptInjection?.safeResponse ??
      "I can only help with hostel-related questions. How can I assist you today?";
    return {
      message: safeResponse,
      intent: 'injection_blocked',
      confidence: 1.0,
      responseTime: Date.now() - startTime,
      model: 'none',
      sanitized: true,
    };
  }

  // Tool-calling mode: bypass intent classification and use tool loop
  if (options.tools && options.tools.length > 0 && options.toolHandlers) {
    const { languageRouter } = await import('./language-router.js');
    const toolLang = languageRouter.detectLanguage(message) as SupportedLanguage;
    const topicFiles = kb.guessTopicFiles(message);
    const baseSystemPrompt = kb.buildSystemPrompt(store.getSettings().system_prompt, topicFiles, store);
    const systemPrompt = options.systemPromptSuffix
      ? `${baseSystemPrompt}\n\n${options.systemPromptSuffix}`
      : baseSystemPrompt;
    // Prune context by relevance to prevent stale context hallucination
    const prunedHistory = pruneContextByRelevance(conversationHistory, 'tool_use', 8, 0.3);
    const result = await chatWithToolsLoop(systemPrompt, prunedHistory, message, options.tools, options.toolHandlers, store, toolLang);
    const responseTime = Date.now() - startTime;
    return {
      message: result,
      intent: 'tool_use',
      confidence: 1,
      responseTime,
      model: 'tool',
      source: 'tools',
      action: 'tool_use',
      routedAction: 'tool_use',
      kbFiles: topicFiles.length > 0 ? topicFiles : [],
      contextCount: conversationHistory.length
    };
  }

  // Check for active workflow — scope key by profileId to prevent cross-profile collision
  const rawKey = sessionId || getSessionKey(conversationHistory);
  const lookupKey = profileId ? `${profileId}:${rawKey}` : rawKey;
  const activeWorkflow = getWorkflowState(lookupKey);

  const { classifyMessage, getEmergencyIntent } = await import('./intents.js');

  // Emergency check (bypass LLM/classifier)
  const emergencyIntent = getEmergencyIntent(message);
  let intentResult;

  if (emergencyIntent) {
    intentResult = {
      category: emergencyIntent,
      confidence: 1.0,
      source: 'regex',
      matchedKeyword: 'emergency',
      matchedExample: '',
      detectedLanguage: 'en'
    };
  } else {
    intentResult = await classifyMessage(message, conversationHistory);
  }

  // US-002: Confidence threshold gating — route low-confidence intents to fallback
  const confidenceGateThreshold = store.getSettings().confidence_threshold ?? 0.5;
  if (intentResult.confidence < confidenceGateThreshold && intentResult.category !== 'unknown') {
    console.log(
      `[ConfidenceGate] Intent "${intentResult.category}" confidence ${intentResult.confidence.toFixed(2)} ` +
      `below threshold ${confidenceGateThreshold.toFixed(2)} → routing to fallback`
    );
    intentResult = { ...intentResult, category: 'unknown' };
  }

  // US-208: Filter conversation history by relevance to current intent
  // Prevents hallucination from outdated requests when history exceeds 8 messages
  if (conversationHistory.length > 8) {
    const filteredHistory = filterByRelevance(
      conversationHistory,
      intentResult.category,
      0.3,  // Relevance threshold: keep messages with score >= 0.3
      8     // Min messages: always keep at least 8 most recent
    );
    if (filteredHistory.length < conversationHistory.length) {
      console.log(
        `[ContextPruner] US-208: Filtered history from ${conversationHistory.length} to ${filteredHistory.length} messages ` +
        `for intent "${intentResult.category}"`
      );
      conversationHistory.splice(0, conversationHistory.length, ...filteredHistory);
    }
  }

  const routingConfig = store.getRouting() || {};
  const route = routingConfig[intentResult.category];

  // Topic-escape: abandon workflow if user asks a clear new question
  const currentRoute = routingConfig[intentResult.category];
  const shouldEscapeWorkflow = !!activeWorkflow &&
    currentRoute?.action === 'static_reply' &&
    intentResult.confidence >= 0.8 &&
    message.includes('?');
  if (shouldEscapeWorkflow) {
    deleteWorkflowState(lookupKey);
  }
  const effectiveWorkflow = shouldEscapeWorkflow ? null : activeWorkflow;

  // Direct emergency override
  const isDirectEmergency = !!emergencyIntent &&
    emergencyIntent !== 'theft_report' &&
    emergencyIntent !== 'card_locked' &&
    !effectiveWorkflow;
  const routedAction: string = isDirectEmergency ? 'emergency' : (effectiveWorkflow ? 'workflow' : (route?.action || 'llm_reply'));

  const { detectMessageType } = await import('./problem-detector.js');
  const messageType = detectMessageType(message);

  // Sentiment analysis
  const { analyzeSentiment, isSentimentAnalysisEnabled } = await import('./sentiment-tracker.js');
  const sentimentScore = isSentimentAnalysisEnabled() ? analyzeSentiment(message) : null;

  let finalMessage = '';
  let llmModel = 'none';
  let topicFiles: string[] = [];
  let problemOverride = false;
  let llmUsage: any;
  let editMeta: any = null;

  // Emergency context detection
  const emergencyContextInHistory = conversationHistory.some(msg =>
    /\b(emergency|ambulance|URGENT|collapsed|not\s+responding|unconscious|bleeding|injured|seizure|heart\s+attack|choking)\b/i.test(msg.content)
  );
  const isEmergencyFollowupMsg = emergencyContextInHistory &&
    /\b(breathing|unconscious|not\s+responding|bleeding|hurt|conscious|condition|worse|better|awake|pulse|still|pain|help)\b/i.test(message);

  if (isDirectEmergency && isEmergencyFollowupMsg) {
    finalMessage = EMERGENCY_REASSURANCE;
  } else if (isDirectEmergency) {
    finalMessage = EMERGENCY_INITIAL_RESPONSE;
  } else if (effectiveWorkflow) {
    const workflowsData = store.getWorkflows() || { workflows: [] };
    const workflow = (workflowsData.workflows || []).find(w => w.id === effectiveWorkflow.workflowId);
    if (workflow && effectiveWorkflow.currentStepIndex < workflow.steps.length) {
      const step = workflow.steps[effectiveWorkflow.currentStepIndex];
      finalMessage = step.message?.en || '';

      // Mid-flow corrections
      const correctionPattern = /\b(actually|sorry.*mistake|i\s+meant|not\s+\d+\s+but\s+\d+)\b/i;
      if (correctionPattern.test(message)) {
        const butMatch = message.match(/but\s+(\d+)/i);
        const actuallyMatch = message.match(/(?:actually|i\s+meant)\s+(\d+)/i);
        const numbers = message.match(/\d+/g);
        const correctionNum = butMatch?.[1] || actuallyMatch?.[1] || (numbers ? numbers[0] : null);
        const ack = correctionNum
          ? `Got it! I've noted your correction — updated to ${correctionNum} guests. `
          : `Got it! I've noted your correction and updated accordingly. `;
        finalMessage = ack + finalMessage;
      }

      // Emergency context override
      if (emergencyContextInHistory && isEmergencyFollowupMsg) {
        finalMessage = EMERGENCY_REASSURANCE;
      }

      editMeta = {
        type: 'workflow',
        workflowId: effectiveWorkflow.workflowId,
        workflowName: workflow.name,
        stepId: step.id,
        stepIndex: effectiveWorkflow.currentStepIndex,
        languages: {
          en: step.message?.en || '',
          ms: step.message?.ms || '',
          zh: step.message?.zh || ''
        }
      };

      // Advance or complete workflow
      if (effectiveWorkflow.currentStepIndex + 1 < workflow.steps.length) {
        const saveKey = sessionId || getSessionKey([...conversationHistory, { role: 'user', content: message, timestamp: Date.now() }, { role: 'assistant', content: finalMessage, timestamp: Date.now() }]);
        setWorkflowState(saveKey, effectiveWorkflow.workflowId, effectiveWorkflow.currentStepIndex + 1);
      } else {
        deleteWorkflowState(lookupKey);
      }
    } else {
      deleteWorkflowState(lookupKey);
      if (isEmergencyFollowupMsg) {
        finalMessage = EMERGENCY_REASSURANCE;
      }
    }
  } else if (isEmergencyFollowupMsg) {
    finalMessage = EMERGENCY_REASSURANCE;
  } else if (routedAction === 'static_reply') {
    const knowledge = store.getKnowledge() || { static: [], dynamic: {} };
    const staticEntry = (knowledge.static || []).find(e => e.intent === intentResult.category);
    const langKey = (['ms', 'zh', 'ta'].includes(intentResult.detectedLanguage || ''))
      ? intentResult.detectedLanguage as 'en' | 'ms' | 'zh' | 'ta'
      : 'en';
    const staticText = staticEntry?.response?.[langKey] || staticEntry?.response?.en || '(no static reply configured)';

    if (messageType === 'info') {
      finalMessage = staticText;
    } else {
      problemOverride = true;
      if (isAIAvailable()) {
        topicFiles = kb.guessTopicFiles(message);
        const systemPrompt = kb.buildSystemPrompt(store.getSettings().system_prompt, topicFiles, store);
        // Prune context by relevance to prevent stale context hallucination
        const prunedHistory = pruneContextByRelevance(conversationHistory, intentResult.category, 8, 0.3);
        const result = await classifyAndRespond(systemPrompt, prunedHistory, message, intentResult.detectedLanguage as SupportedLanguage);
        finalMessage = result.response || staticText;
        llmModel = result.model || 'unknown';
        llmUsage = result.usage;
      } else {
        finalMessage = staticText;
      }
    }

    if (staticEntry) {
      editMeta = {
        type: 'knowledge',
        intent: intentResult.category,
        languages: { en: staticEntry.response.en || '', ms: staticEntry.response.ms || '', zh: staticEntry.response.zh || '' }
      };
    }

    const templates = store.getTemplates() || {};
    const tmpl = templates[intentResult.category];
    if (tmpl && editMeta) {
      editMeta.alsoTemplate = {
        key: intentResult.category,
        languages: { en: tmpl.en || '', ms: tmpl.ms || '', zh: tmpl.zh || '' }
      };
    }

  } else if (routedAction === 'workflow') {
    const workflowId = route?.workflow_id;
    if (workflowId) {
      const workflowsData = store.getWorkflows() || { workflows: [] };
      const workflow = (workflowsData.workflows || []).find(w => w.id === workflowId);
      if (workflow && workflow.steps.length > 0) {
        const introMessages: string[] = [];
        let editStep = workflow.steps[0];
        let stopIndex = 0;
        for (let i = 0; i < workflow.steps.length; i++) {
          const step = workflow.steps[i];
          introMessages.push(step.message?.en || '');
          editStep = step;
          stopIndex = i;
          if (step.waitForReply) break;
        }
        finalMessage = introMessages.join('\n\n');
        editMeta = {
          type: 'workflow',
          workflowId,
          workflowName: workflow.name,
          stepId: editStep.id,
          stepIndex: workflow.steps.indexOf(editStep),
          languages: {
            en: editStep.message?.en || '',
            ms: editStep.message?.ms || '',
            zh: editStep.message?.zh || ''
          }
        };

        if (editStep.waitForReply && stopIndex + 1 < workflow.steps.length) {
          const saveKey = sessionId || getSessionKey([...conversationHistory, { role: 'user', content: message, timestamp: Date.now() }, { role: 'assistant', content: finalMessage, timestamp: Date.now() }]);
          setWorkflowState(saveKey, workflowId, stopIndex + 1);
        }
      }
    }
    // Fallback to LLM if workflow not found
    if (!finalMessage) {
      if (isAIAvailable()) {
        topicFiles = kb.guessTopicFiles(message);
        const systemPrompt = kb.buildSystemPrompt(store.getSettings().system_prompt, topicFiles, store);
        // Prune context by relevance to prevent stale context hallucination
        const prunedHistory = pruneContextByRelevance(conversationHistory, intentResult.category, 8, 0.3);
        const result = await classifyAndRespond(systemPrompt, prunedHistory, message, intentResult.detectedLanguage as SupportedLanguage, store);
        finalMessage = result.response;
        llmModel = result.model || 'unknown';
        llmUsage = result.usage;
      } else {
        finalMessage = 'Workflow not configured';
      }
    }

  } else if (isAIAvailable()) {
    topicFiles = kb.guessTopicFiles(message);
    const systemPrompt = kb.buildSystemPrompt(store.getSettings().system_prompt, topicFiles, store);
    // Prune context by relevance to prevent stale context hallucination
    const prunedHistory = pruneContextByRelevance(conversationHistory, intentResult.category, 8, 0.3);
    const result = await classifyAndRespond(systemPrompt, prunedHistory, message, intentResult.detectedLanguage as SupportedLanguage, store);
    finalMessage = result.response;
    llmModel = result.model || 'unknown';
    llmUsage = result.usage;
  } else {
    finalMessage = 'AI not available';
  }

  // Catch-all fallback
  if (!finalMessage || !finalMessage.trim()) {
    const detectedLang = (['ms', 'zh', 'ta'].includes(intentResult.detectedLanguage || ''))
      ? intentResult.detectedLanguage as 'en' | 'ms' | 'zh' | 'ta'
      : 'en';
    finalMessage = getUnknownFallbackMessages(store)[detectedLang];
    llmModel = llmModel === 'none' ? 'static_fallback' : llmModel;
  }

  // Sentiment-based escalation
  if (sentimentScore === 'negative' && isSentimentAnalysisEnabled()) {
    const settings = store.getSettings();
    const threshold = settings.sentiment_analysis?.consecutive_threshold ?? 2;

    let consecutiveNeg = 1;
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === 'user') {
        if (analyzeSentiment(conversationHistory[i].content) === 'negative') {
          consecutiveNeg++;
        } else {
          break;
        }
      }
    }

    if (consecutiveNeg >= threshold) {
      finalMessage += "\n\nI'm sorry about the trouble you're experiencing. I've escalated this to our staff — a manager will contact you shortly to help resolve this.";
    }
  }

  const responseTime = Date.now() - startTime;

  // Token breakdown estimate
  const usage = intentResult.usage || llmUsage || null;
  let tokenBreakdown: any = null;
  if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
    const settings = store.getSettings();
    const basePromptChars = (settings.system_prompt || '').length;
    const kbChars = topicFiles.length > 0 ? topicFiles.length * 800 : 0;
    const histChars = conversationHistory.reduce((s, m) => s + m.content.length, 0);
    const userChars = message.length;
    const totalInputChars = basePromptChars + kbChars + histChars + userChars;
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    if (totalInputChars > 0 && promptTokens > 0) {
      const ratio = promptTokens / totalInputChars;
      tokenBreakdown = {
        systemPrompt: Math.round(basePromptChars * ratio),
        kbContext: Math.round(kbChars * ratio),
        conversationHistory: Math.round(histChars * ratio),
        userMessage: Math.round(userChars * ratio),
        aiResponse: completionTokens
      };
    }
  }

  // Generate dynamic follow-up suggestions based on response context
  const suggestions = generateDynamicSuggestions(finalMessage, intentResult.category, message, profileId);

  return {
    message: finalMessage,
    intent: intentResult.category,
    confidence: intentResult.confidence,
    responseTime,
    model: llmModel,
    suggestions,
    source: intentResult.source,
    action: routedAction,
    routedAction,
    matchedKeyword: intentResult.matchedKeyword,
    matchedExample: intentResult.matchedExample,
    detectedLanguage: intentResult.detectedLanguage,
    kbFiles: topicFiles.length > 0 ? ['AGENTS.md', 'soul.md', 'memory.md', ...topicFiles] : [],
    messageType,
    problemOverride,
    sentiment: sentimentScore,
    editMeta,
    usage,
    tokenBreakdown,
    contextCount: conversationHistory.length
  };
}
