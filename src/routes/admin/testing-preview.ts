import { Router } from 'express';
import type { Request, Response } from 'express';
import { getStore } from './http-utils.js';
import { badRequest } from './http-utils.js';
import { trackMessageReceived, trackIntentClassified, trackResponseSent } from '../../lib/activity-tracker.js';
import { sanitizeInput, validateInputSafety, processChat } from '../../assistant/chat-engine.js';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { getDefaultKBInstance } from '../../assistant/knowledge-base.js';

const router = Router();

// ─── Preview Chat (Simulate Guest Conversation) ────────────────────

router.post('/preview/chat', async (req: Request, res: Response) => {
  const { message, history, sessionId } = req.body;
  if (!message || typeof message !== 'string') {
    badRequest(res, 'message (string) required');
    return;
  }

  // Sanitize input to remove potential injection patterns
  const sanitizedMessage = sanitizeInput(message);

  // If sanitization removed everything, return error
  if (!sanitizedMessage) {
    badRequest(res, 'Invalid input');
    return;
  }

  // Validate for obvious injection attempts
  const safetyError = validateInputSafety(sanitizedMessage);
  if (safetyError) {
    // Return a safe response instead of failing
    res.json({
      message: "I'm Rainbow, an AI assistant for Pelangi Capsule Hostel. I noticed your message contains unusual patterns. Please send a normal question about the hostel and I'll be happy to help!",
      intent: 'unknown',
      source: 'validation',
      action: 'static_reply',
      routedAction: 'static_reply',
      confidence: 0,
      model: 'none',
      responseTime: 0,
      matchedKeyword: '',
      matchedExample: '',
      detectedLanguage: 'en',
      kbFiles: [],
      messageType: 'info',
      problemOverride: false,
      sentiment: null,
      editMeta: null,
      sanitized: true
    });
    return;
  }

  try {
    trackMessageReceived('simulator@preview', 'Live Sim', sanitizedMessage);

    // Resolve profile-aware config store and KB
    const store = getStore(res);
    const profileId = res.locals.profileId as string | undefined;
    const profile = profileId ? profileRegistry.getProfile(profileId) : undefined;
    const kb = profile?.kb || getDefaultKBInstance();

    const result = await processChat({
      message: sanitizedMessage,
      history: Array.isArray(history) ? history : [],
      sessionId: sessionId || undefined,
      configStore: store,
      kb,
    });

    trackIntentClassified(result.intent, result.confidence, result.source || 'unknown');
    trackResponseSent('simulator@preview', 'Live Sim', result.routedAction || 'unknown', result.responseTime);

    // Return full debug response for admin preview
    res.json(result);
  } catch (err: any) {
    // Log the error for debugging
    console.error('[Preview Chat] Error processing message:', err);

    // Always return a safe, valid response instead of a 500 error
    // This prevents "fetch failed" errors from breaking the UI
    res.json({
      message: "I apologize, but I encountered an error processing your message. This might be due to unusual input or a temporary issue. Please try rephrasing your question or contact staff if you need immediate assistance.",
      intent: 'unknown',
      source: 'error',
      action: 'static_reply',
      routedAction: 'static_reply',
      confidence: 0,
      model: 'none',
      responseTime: Date.now() - (Date.now() - 100),
      matchedKeyword: '',
      matchedExample: '',
      detectedLanguage: 'en',
      kbFiles: [],
      messageType: 'info',
      problemOverride: false,
      sentiment: null,
      editMeta: null,
      error: err.message,
      errorHandled: true
    });
  }
});

export default router;
