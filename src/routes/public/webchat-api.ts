/**
 * webchat-api.ts — Public Chat API (no auth required)
 *
 * Provides a rate-limited public endpoint for webchat sessions.
 * Uses the shared chat-engine for message processing.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { profileRegistry } from '../../assistant/profile-registry.js';
import { sanitizeInput, validateInputSafety, processChat } from '../../assistant/chat-engine.js';
import { toolRegistry } from '../../tools/registry.js';
import { pool } from '../../lib/db.js';
import { cartTools, createCartHandlers } from '../../tools/cart.js';
import { cartGetItems, cartFormatSummary } from '../../assistant/cart-store.js';
import { getOrderStage, ORDER_STAGE_DESCRIPTIONS } from '../../assistant/order-stage-store.js';
import { getDisambiguation } from '../../assistant/disambiguation-store.js';
import { setupSSEHeaders, sseEvent, sendStaticSSE, streamChatResponse, streamChatWithTools } from '../../assistant/chat-stream.js';

const router = Router();

// ─── Session Greeting Tracker ─────────────────────────────────────────────────
// Tracks which sessions have already received the welcome greeting (in-memory).
// Prevents duplicate greetings on page reload when no messages have been sent yet.
const SESSION_GREETING_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface GreetingSession {
  sentAt: number;
}

const greetingSessions = new Map<string, GreetingSession>();

// Cleanup stale greeting sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of greetingSessions) {
    if (now - session.sentAt > SESSION_GREETING_TTL_MS) {
      greetingSessions.delete(key);
    }
  }
}, 60 * 60 * 1000);

// ─── Database Migration (Startup) ──────────────────────────────────────────────
// Add profile_id column to rainbow_conversations if not exists
pool.query(`ALTER TABLE rainbow_conversations ADD COLUMN IF NOT EXISTS profile_id VARCHAR(50)`).catch(() => {
  // Silently ignore if already exists or other errors
});

// Public rate limit: 10 messages per minute per IP
const webchatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many messages. Please wait a moment before sending another.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(webchatLimiter);

// ─── KB Context Cache ──────────────────────────────────────────────
const kbContextCache = new Map<string, { systemPrompt: string; kbFiles: string[]; cachedAt: number }>();
const KB_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/chat/:profileId/kb-context
 *
 * Returns the compiled system prompt with all KB content injected.
 * Allows external apps to fetch Rainbow AI's knowledge context.
 */
router.get('/:profileId/kb-context', async (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;

  const profile = profileRegistry.getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: `Profile "${profileId}" not found` });
    return;
  }

  // Check cache
  const cached = kbContextCache.get(profileId);
  if (cached && Date.now() - cached.cachedAt < KB_CACHE_TTL_MS) {
    res.json(cached);
    return;
  }

  try {
    const settings = profile.configStore.getSettings();
    const basePrompt = settings.system_prompt || '';
    const kbMarkdown = profile.kb.getKnowledgeMarkdown();
    const kbFiles = Array.from((profile.kb as any).kbCache?.keys?.() ?? []).filter((f: any) => typeof f === 'string') as string[];

    const systemPrompt = `${basePrompt}\n\n---\n\n${kbMarkdown}`;
    const entry = { systemPrompt, kbFiles, cachedAt: Date.now() };
    kbContextCache.set(profileId, entry);

    res.json(entry);
  } catch (err: any) {
    console.error(`[Webchat] Error building KB context for ${profileId}:`, err.message);
    res.status(500).json({ error: 'Failed to build KB context' });
  }
});

/**
 * GET /api/chat/:profileId/history
 *
 * Returns the last 10 messages for a webchat session.
 * Used by the widget to restore conversation history on page reload.
 * Query params: sessionId (required)
 */
router.get('/:profileId/history', async (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const sessionId = req.query.sessionId as string;

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId query parameter required' });
    return;
  }

  const profile = profileRegistry.getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: `Profile "${profileId}" not found` });
    return;
  }

  const phone = 'webchat-' + sessionId;

  try {
    const result = await pool.query(
      `SELECT role, content, timestamp
       FROM rainbow_messages
       WHERE phone = $1
       ORDER BY timestamp DESC
       LIMIT 10`,
      [phone]
    );

    // Reverse to chronological order
    const messages = result.rows.reverse().map((r: any) => ({
      role: r.role === 'user' ? 'user' : 'assistant',
      content: r.content,
      timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : new Date(r.timestamp).getTime(),
    }));

    res.json({ messages, sessionId });
  } catch (err: any) {
    console.error(`[Webchat] Error fetching history for ${sessionId}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

const DEFAULT_WELCOME_MESSAGE =
  "Welcome! I'm your AI assistant. How can I help you today?";

/**
 * GET /api/chat/:profileId/greeting
 *
 * Returns a one-time welcome greeting per session.
 * Subsequent calls for the same sessionId return null (already greeted).
 * Query params: sessionId (required)
 */
router.get('/:profileId/greeting', async (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const sessionId = req.query.sessionId as string;

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId query parameter required' });
    return;
  }

  const profile = profileRegistry.getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: `Profile "${profileId}" not found` });
    return;
  }

  // Already greeted this session
  if (greetingSessions.has(sessionId)) {
    res.json({ greeting: null, sessionId });
    return;
  }

  // Read welcomeMessage from profile settings, fall back to default
  const settings = profile.configStore.getSettings() as any;
  const greeting: string = settings.welcomeMessage || DEFAULT_WELCOME_MESSAGE;

  // Mark session as greeted
  greetingSessions.set(sessionId, { sentAt: Date.now() });

  res.json({ greeting, sessionId });
});

// ─── Makan-Moments Context Builder ─────────────────────────────────────
// Extracted to reuse in both streaming and non-streaming paths.
function buildMakanMomentsContext(sessionId: string) {
  const fnbTools = toolRegistry.getToolsForProfile('makan-moments');
  const fnbHandlers = toolRegistry.getHandlersForProfile('makan-moments');
  const allTools = [...fnbTools, ...cartTools];
  const cartHandlers = createCartHandlers(sessionId);
  const allHandlers = new Map([...fnbHandlers, ...cartHandlers]);

  const currentCartItems = cartGetItems(sessionId);
  const cartSummary = cartFormatSummary(currentCartItems);
  const currentStage = getOrderStage(sessionId);
  const stageDescription = ORDER_STAGE_DESCRIPTIONS[currentStage];
  const pendingDisambig = getDisambiguation(sessionId);

  const disambigSection = pendingDisambig
    ? [
        '',
        '## Pending Item Disambiguation',
        `The guest previously searched for "${pendingDisambig.pendingItem}" and was shown ${pendingDisambig.candidates.length} options.`,
        'If the guest replies with a number or a name, call cart_pick_item with their selection.',
        'If the guest asks about something else, the disambiguation is abandoned — clear it by calling cart_search_item with the new query.',
      ].join('\n')
    : '';

  const systemPromptSuffix = [
    '## Current Order State',
    `Session: ${sessionId}`,
    `Order Stage: ${currentStage} — ${stageDescription}`,
    '',
    '## Current Cart',
    cartSummary,
    disambigSection,
    '',
    '## Order Stage Machine — STRICT RULES',
    'You are an AI waiter. Follow these rules based on the order stage:',
    '',
    'BROWSING stage: Guest is asking about the menu. Answer questions, describe dishes, show prices.',
    '  • Do NOT add anything to cart unless guest expresses clear intent to order.',
    '  • Category browsing: When guest asks for items from a specific category (e.g. "show me the drinks",',
    '    "what rice dishes do you have", "any desserts?", "list the mains"), call fnb_get_menu({ category: "<name>" }).',
    '    Supported categories: drinks, mains, rice, noodles, desserts, snacks, set meals, sides.',
    '  • Dietary filtering: When guest asks about dietary requirements, call fnb_get_menu({ dietary_tags: [...] }).',
    '    Map guest phrases to canonical tags:',
    '      vegetarian / veggie / sayur / no meat / tanpa daging → "vegetarian"',
    '      vegan / plant-based → "vegan"',
    '      halal → "halal"',
    '      no pork / pork-free / no babi / tanpa babi → "no-pork"',
    '      no nuts / nut-free / no peanuts / kacang / peanut allergy → "no-nuts"',
    '      gluten-free / no gluten / no wheat → "gluten-free"',
    '      dairy-free / lactose-free / no milk → "dairy-free"',
    '    Multiple filters use AND logic: "vegetarian and no nuts" → dietary_tags: ["vegetarian", "no-nuts"].',
    '    If no items match, say honestly: "I don\'t see any [tag] options on our menu right now. Would you like to ask our staff?"',
    '    Do NOT guess or invent items — only list what the menu response contains.',
    '    If the menu response does not indicate dietary tags, list what is returned and note that guests should confirm with staff for allergy safety.',
    '  • Item detail: When guest asks about a specific dish, call fnb_get_menu_item and include any dietary tags shown.',
    '  • Format results as a plain numbered list (no markdown tables):',
    '    "1. Item Name — RM X.XX\\n   Brief description"',
    '  • Show maximum 8 items per response. If more exist, add: "...and X more. Ask me to show more!"',
    '  • If category is not found or returns no items, call fnb_get_categories to list available categories.',
    '  • Use plain text only — no markdown tables, no asterisks, no headers — for WhatsApp/chat compatibility.',
    '',
    'ORDERING stage: Guest is adding items to their order.',
    '  • Use cart_search_item when the guest uses a vague or partial name (e.g. "the chicken", "nasi", "iced coffee").',
    '  • Use cart_add_item only when the guest uses the exact menu item name and you are certain it matches.',
    '  • Use cart_pick_item when the guest replies with a number or name after a disambiguation list.',
    '  • Use cart_remove_item when guest says remove/cancel/drop an item.',
    '  • Use cart_view when guest asks to see their current order.',
    '  • When guest signals they are DONE ordering (e.g. "that\'s all", "place my order", "ready to order"),',
    '    call order_request_confirmation to show the summary and ask "Shall I place this order?".',
    '  • Do NOT submit the order on your own — always confirm first.',
    '',
    'CONFIRMING stage: You already asked "Shall I place this order?" — WAIT for yes/no.',
    '  • If guest says YES / confirm / go ahead / place it: call order_confirm_submit.',
    '  • If guest says NO / wait / cancel / change my mind: call order_back_to_cart.',
    '  • Do NOT ask for confirmation again — you are already in confirming stage.',
    '',
    'PLACED stage: Order submitted. Cart is cleared.',
    '  • Thank the guest. Offer to help with anything else.',
    '  • If they want to order again, start fresh from BROWSING.',
  ].join('\n');

  return { allTools, allHandlers, systemPromptSuffix };
}

/**
 * POST /api/chat/:profileId/message
 *
 * Process a webchat message for a specific profile.
 * Supports SSE streaming when `stream: true` is in the request body.
 * Returns only public-safe fields (no intent/debug data).
 */
router.post('/:profileId/message', async (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const { message, history } = req.body;
  let { sessionId } = req.body;

  // Validate profile
  const profile = profileRegistry.getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: `Profile "${profileId}" not found` });
    return;
  }

  // Validate message
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message (string) required' });
    return;
  }

  // Generate sessionId on server if not provided
  if (!sessionId || typeof sessionId !== 'string') {
    sessionId = 'web_' + crypto.randomUUID().slice(0, 8) + '_' + Date.now();
  }

  // Sanitize input
  const sanitizedMessage = sanitizeInput(message);
  if (!sanitizedMessage) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }

  // Safety validation
  const safetyError = validateInputSafety(sanitizedMessage);
  if (safetyError) {
    if (req.body.stream) {
      sendStaticSSE(res, `I'm an AI assistant for ${profile.name}. I noticed your message contains unusual patterns. Please send a normal question and I'll be happy to help!`, 0, sessionId);
    } else {
      res.json({
        message: `I'm an AI assistant for ${profile.name}. I noticed your message contains unusual patterns. Please send a normal question and I'll be happy to help!`,
        responseTime: 0,
        sessionId,
      });
    }
    return;
  }

  // ─── Streaming SSE Path ──────────────────────────────────────────────
  if (req.body.stream) {
    const startTime = Date.now();
    setupSSEHeaders(res);

    let disconnected = false;
    req.on('close', () => { disconnected = true; });

    try {
      const isMakanMoments = profileId === 'makan-moments';
      const conversationHistory = (Array.isArray(history) ? history : []).map((m: any) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
        timestamp: Date.now()
      }));

      // Build system prompt from KB
      const topicFiles = profile.kb.guessTopicFiles(sanitizedMessage);
      let systemPrompt = profile.kb.buildSystemPrompt(
        profile.configStore.getSettings().system_prompt, topicFiles, profile.configStore
      );

      let fullText: string;

      if (isMakanMoments) {
        // Tool-calling path: stream with tools
        const ctx = buildMakanMomentsContext(sessionId);
        systemPrompt = `${systemPrompt}\n\n${ctx.systemPromptSuffix}`;
        fullText = await streamChatWithTools(
          res, systemPrompt, conversationHistory, sanitizedMessage,
          ctx.allTools, ctx.allHandlers
        );
      } else {
        // Non-tool path: stream LLM response directly
        fullText = await streamChatResponse(res, systemPrompt, conversationHistory, sanitizedMessage);
      }

      const responseTime = Date.now() - startTime;

      if (!disconnected) {
        sseEvent(res, { done: true, responseTime, sessionId });
        res.end();
      }

      // Persist to DB (fire-and-forget)
      const phone = 'webchat-' + sessionId;
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const pushName = 'Web Visitor (' + ip.replace('::ffff:', '') + ')';
      persistWebchatExchange(phone, pushName, sanitizedMessage, fullText, responseTime, profileId).catch(err => {
        console.error('[Webchat] DB persist error:', err.message);
      });
    } catch (err: any) {
      console.error(`[Webchat Stream] Error for ${profileId}:`, err.message);
      if (!disconnected) {
        sseEvent(res, { token: "I apologize, but I encountered an error. Please try again or contact staff." });
        sseEvent(res, { done: true, responseTime: Date.now() - startTime, sessionId });
        res.end();
      }
    }
    return;
  }

  // ─── Non-Streaming JSON Path (existing behavior) ─────────────────────
  try {
    const isMakanMoments = profileId === 'makan-moments';
    let allTools = isMakanMoments ? toolRegistry.getToolsForProfile('makan-moments') : [];
    let allHandlers = isMakanMoments ? toolRegistry.getHandlersForProfile('makan-moments') : new Map();
    let systemPromptSuffix: string | undefined;

    if (isMakanMoments) {
      const ctx = buildMakanMomentsContext(sessionId);
      allTools = ctx.allTools;
      allHandlers = ctx.allHandlers;
      systemPromptSuffix = ctx.systemPromptSuffix;
    }

    const result = await processChat({
      message: sanitizedMessage,
      history: Array.isArray(history) ? history : [],
      sessionId: sessionId || undefined,
      configStore: profile.configStore,
      kb: profile.kb,
      tools: allTools,
      toolHandlers: allHandlers,
      systemPromptSuffix,
    });

    // Persist to DB (fire-and-forget, don't block response)
    const phone = 'webchat-' + sessionId;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const pushName = 'Web Visitor (' + ip.replace('::ffff:', '') + ')';

    persistWebchatExchange(phone, pushName, sanitizedMessage, result.message, result.responseTime, profileId).catch(err => {
      console.error('[Webchat] DB persist error:', err.message);
    });

    // Return only public-safe fields
    res.json({
      message: result.message,
      responseTime: result.responseTime,
      sessionId,
    });
  } catch (err: any) {
    console.error(`[Webchat] Error processing message for ${profileId}:`, err);
    res.json({
      message: "I apologize, but I encountered an error processing your message. Please try again or contact staff if you need immediate assistance.",
      responseTime: 0,
      sessionId,
    });
  }
});

/**
 * GET /:profileId/messages/:sessionId
 * Public endpoint for webchat clients to poll for new messages (including staff replies).
 * Returns messages after a given timestamp.
 */
router.get('/:profileId/messages/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  const after = req.query.after ? Number(req.query.after) : 0;
  const phone = 'webchat-' + sessionId;

  try {
    let query: string;
    let params: any[];

    if (after > 0) {
      const afterDate = new Date(after);
      query = `SELECT role, content, timestamp, staff_name
               FROM rainbow_messages
               WHERE phone = $1 AND timestamp > $2
               ORDER BY timestamp ASC
               LIMIT 100`;
      params = [phone, afterDate];
    } else {
      query = `SELECT role, content, timestamp, staff_name
               FROM rainbow_messages
               WHERE phone = $1
               ORDER BY timestamp ASC
               LIMIT 200`;
      params = [phone];
    }

    const result = await pool.query(query, params);

    const messages = result.rows.map((r: any) => ({
      role: r.role,
      content: r.content,
      timestamp: r.timestamp instanceof Date ? r.timestamp.getTime() : new Date(r.timestamp).getTime(),
      staffName: r.staff_name || null,
    }));

    res.json({ messages, sessionId });
  } catch (err: any) {
    console.error(`[Webchat] Error fetching messages for ${sessionId}:`, err.message);
    res.json({ messages: [], sessionId });
  }
});

/**
 * Persist user message + AI response to rainbow_messages/rainbow_conversations.
 */
async function persistWebchatExchange(
  phone: string, pushName: string,
  userMessage: string, aiResponse: string, responseTime?: number, profileId?: string
): Promise<void> {
  const now = new Date();
  const nowPlus1 = new Date(now.getTime() + 1);

  // Upsert conversation
  await pool.query(
    `INSERT INTO rainbow_conversations (phone, push_name, profile_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (phone) DO UPDATE SET push_name = $2, profile_id = EXCLUDED.profile_id, updated_at = $4`,
    [phone, pushName, profileId || null, now]
  );

  // Insert user message + AI response
  await pool.query(
    `INSERT INTO rainbow_messages (phone, role, content, timestamp, source, response_time_ms)
     VALUES ($1, 'user', $2, $3, 'webchat', NULL),
            ($1, 'assistant', $4, $5, 'webchat', $6)`,
    [phone, userMessage, now, aiResponse, nowPlus1, responseTime ?? null]
  );
}

export default router;
