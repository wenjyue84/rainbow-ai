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

/**
 * POST /api/chat/:profileId/message
 *
 * Process a webchat message for a specific profile.
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
    res.json({
      message: `I'm an AI assistant for ${profile.name}. I noticed your message contains unusual patterns. Please send a normal question and I'll be happy to help!`,
      responseTime: 0,
      sessionId,
    });
    return;
  }

  try {
    const isMakanMoments = profileId === 'makan-moments';
    const fnbTools = isMakanMoments ? toolRegistry.getToolsForProfile('makan-moments') : [];
    const fnbHandlers = isMakanMoments ? toolRegistry.getHandlersForProfile('makan-moments') : new Map();

    // Cart: inject tools and per-session handlers for makan-moments
    let allTools = fnbTools;
    let allHandlers = fnbHandlers;
    let systemPromptSuffix: string | undefined;

    if (isMakanMoments) {
      // Add cart tools to the tool list
      allTools = [...fnbTools, ...cartTools];

      // Create per-session cart handlers (close over sessionId)
      const cartHandlers = createCartHandlers(sessionId);
      allHandlers = new Map([...fnbHandlers, ...cartHandlers]);

      // Inject current cart state, order stage, and disambiguation state into system prompt
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

      systemPromptSuffix = [
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
