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
  configStore: ConfigStore;
  kb: KnowledgeBaseInstance;
  tools?: MCPTool[];
  toolHandlers?: Map<string, ToolHandler>;
  /** Optional text appended to the system prompt (e.g. current cart state). */
  systemPromptSuffix?: string;
}

export interface ChatResult {
  message: string;
  intent: string;
  confidence: number;
  responseTime: number;
  model: string;
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

// ─── Core Chat Processing ───────────────────────────────────────────

const EMERGENCY_REASSURANCE = "Our staff has been notified and help is on the way. Please stay calm and keep your friend comfortable. If their condition worsens, please call 999 for an ambulance immediately. A staff member will arrive shortly to assist you.";
const EMERGENCY_INITIAL_RESPONSE = "URGENT — This is an emergency! Our staff has been immediately notified and help is on the way. Please stay calm. Call 999 for an ambulance right away if medical assistance is needed. DO NOT move the person if they have collapsed or are unconscious. A staff member will arrive shortly to assist you. Please tell us your exact location in the hostel.";

/**
 * Process a chat message through the full Rainbow AI pipeline.
 * Returns a ChatResult with all fields populated.
 */
export async function processChat(options: ChatOptions): Promise<ChatResult> {
  const { message, history, sessionId, configStore: store, kb } = options;
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
    const result = await chatWithToolsLoop(systemPrompt, conversationHistory, message, options.tools, options.toolHandlers, store, toolLang);
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

  // Check for active workflow
  const lookupKey = sessionId || getSessionKey(conversationHistory);
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
        const result = await classifyAndRespond(systemPrompt, conversationHistory, message, intentResult.detectedLanguage as SupportedLanguage);
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
        const result = await classifyAndRespond(systemPrompt, conversationHistory, message, intentResult.detectedLanguage as SupportedLanguage);
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
    const result = await classifyAndRespond(systemPrompt, conversationHistory, message, intentResult.detectedLanguage as SupportedLanguage);
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

  return {
    message: finalMessage,
    intent: intentResult.category,
    confidence: intentResult.confidence,
    responseTime,
    model: llmModel,
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
