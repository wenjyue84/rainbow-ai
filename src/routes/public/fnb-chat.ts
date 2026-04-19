/**
 * fnb-chat.ts — FnB AI Waiter Chat API (SSE streaming)
 *
 * POST /api/fnb/chat — accepts Vercel AI SDK UIMessage[] format or legacy format,
 * routes through makan-moments profile, returns SSE stream.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { sanitizeInput, validateInputSafety, processChat } from '../../assistant/chat-engine.js';
import { toolRegistry } from '../../tools/registry.js';

const router = Router();

// ─── Rate Limit ──────────────────────────────────────────────────────
const fnbChatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.FNB_CHAT_RATE_LIMIT || '30', 10),
  message: { error: 'Too many messages. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(fnbChatLimiter);

// ─── Types ───────────────────────────────────────────────────────────

interface UIMessagePart {
  type: string;
  text?: string;
}

interface UIMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parts?: UIMessagePart[];
}

interface LegacyBody {
  message: string;
  history?: Array<{ role: string; content: string }>;
  sessionId?: string;
}

interface UIMessageBody {
  messages: UIMessage[];
  sessionId?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function isUIMessageBody(body: any): body is UIMessageBody {
  return Array.isArray(body?.messages) && body.messages.length > 0;
}

function isLegacyBody(body: any): body is LegacyBody {
  return typeof body?.message === 'string';
}

/**
 * Extract the last user message text from UIMessage array.
 * Prefers parts[].text, falls back to content.
 */
function extractUserMessage(messages: UIMessage[]): string {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return '';

  // Try parts first (Vercel AI SDK format)
  if (lastUser.parts && lastUser.parts.length > 0) {
    const textParts = lastUser.parts
      .filter(p => p.type === 'text' && p.text)
      .map(p => p.text!)
      .join(' ');
    if (textParts) return textParts;
  }

  return lastUser.content || '';
}

/**
 * Convert UIMessage[] to ChatMessage[] history (excluding the last user message).
 */
function uiMessagesToHistory(messages: UIMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  // All messages except the last user message become history
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  const allButLast = messages.slice(0, -1);

  for (const msg of allButLast) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      history.push({ role: msg.role, content: msg.content });
    }
  }

  return history;
}

/**
 * Write an SSE event to the response.
 */
function sendSSE(res: Response, data: string): void {
  res.write(`data: ${data}\n\n`);
}

// ─── POST /api/fnb/chat ──────────────────────────────────────────────

router.post('/chat', async (req: Request, res: Response) => {
  const PROFILE_ID = 'makan-moments';

  // Resolve profile
  const profile = profileRegistry.getProfile(PROFILE_ID);
  if (!profile) {
    res.status(503).json({ error: `Profile "${PROFILE_ID}" not available` });
    return;
  }

  let userMessage: string;
  let history: Array<{ role: 'user' | 'assistant'; content: string }>;
  let sessionId: string;

  // Parse body — UIMessage[] or legacy format
  if (isUIMessageBody(req.body)) {
    userMessage = extractUserMessage(req.body.messages);
    history = uiMessagesToHistory(req.body.messages);
    sessionId = req.body.sessionId || 'fnb_' + crypto.randomUUID().slice(0, 8) + '_' + Date.now();
  } else if (isLegacyBody(req.body)) {
    userMessage = req.body.message;
    history = Array.isArray(req.body.history)
      ? req.body.history
          .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
      : [];
    sessionId = req.body.sessionId || 'fnb_' + crypto.randomUUID().slice(0, 8) + '_' + Date.now();
  } else {
    res.status(400).json({ error: 'Request must contain "messages" (UIMessage[]) or "message" (string)' });
    return;
  }

  // Validate message
  if (!userMessage || typeof userMessage !== 'string' || !userMessage.trim()) {
    res.status(400).json({ error: 'Empty message' });
    return;
  }

  // Sanitize
  const sanitized = sanitizeInput(userMessage);
  if (!sanitized) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }

  // Safety check
  const safetyError = validateInputSafety(sanitized);
  if (safetyError) {
    // Return a friendly SSE response instead of error
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();
    sendSSE(res, JSON.stringify({ type: 'text', text: 'I\'m the Makan Moments AI assistant. Please send a normal question and I\'ll be happy to help!' }));
    sendSSE(res, '[DONE]');
    res.end();
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  try {
    const result = await processChat({
      message: sanitized,
      history,
      sessionId,
      configStore: profile.configStore,
      kb: profile.kb,
      tools: toolRegistry.getToolsForProfile('makan-moments'),
      toolHandlers: toolRegistry.getHandlersForProfile('makan-moments'),
    });

    // Send the response as SSE event(s)
    sendSSE(res, JSON.stringify({ type: 'text', text: result.message }));
    sendSSE(res, '[DONE]');
    res.end();
  } catch (err: any) {
    console.error('[FnB Chat] Error processing message:', err);
    sendSSE(res, JSON.stringify({ type: 'text', text: 'I apologize, but I encountered an error. Please try again or ask our staff for help.' }));
    sendSSE(res, '[DONE]');
    res.end();
  }
});

export default router;
