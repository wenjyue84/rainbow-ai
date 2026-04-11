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
import { cartGetItems, cartFormatSummary, cartGetTableInfo } from '../../assistant/cart-store.js';
import { getOrderStage, ORDER_STAGE_DESCRIPTIONS } from '../../assistant/order-stage-store.js';
import { getSessionOrderId } from '../../assistant/order-id-store.js';
import { getDisambiguation } from '../../assistant/disambiguation-store.js';
import { sessionKey } from '../../assistant/session-key.js';
import { setupSSEHeaders, sseEvent, sendStaticSSE, streamChatResponse, streamChatWithTools } from '../../assistant/chat-stream.js';
import { checkWebchatIdle, resetWebchatSession } from '../../assistant/webchat-idle-timeout.js';
import type { WebchatIdleConfig } from '../../assistant/webchat-idle-timeout.js';
import { getLastOrder } from '../../assistant/order-history-store.js';
import { computeAvailability } from '../../assistant/business-hours.js';
import type { BusinessHoursConfig } from '../../assistant/business-hours.js';

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

// ─── Database Migration (deferred until pool is available) ──────────────────────
let _webchatMigrationDone = false;
function ensureProfileIdColumn(): void {
  if (_webchatMigrationDone || !pool) return;
  _webchatMigrationDone = true;
  pool.query(`ALTER TABLE rainbow_conversations ADD COLUMN IF NOT EXISTS profile_id VARCHAR(50)`).catch(() => {});
}

// Public rate limit: 10 messages per minute per IP
const webchatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many messages. Please wait a moment before sending another.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use((_req, _res, next) => { ensureProfileIdColumn(); next(); });

// ─── US-921: Session Data Store (WCAG 3.3.7 Redundant Entry) ─────────────────
// Persists user-provided data per session so the AI never re-asks for info
// already collected (name, table number, delivery address, etc.).
interface WebchatSessionData {
  guestName?: string;
  tableNumber?: string;
  orderType?: string; // 'dine-in' | 'takeaway'
  deliveryAddress?: string;
  seatNumber?: string;
  language?: string; // 'en' | 'ms' | 'zh' | 'ta' (guest's language preference)
  updatedAt: number;
}

const sessionDataStore = new Map<string, WebchatSessionData>();
const SESSION_DATA_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup stale session data every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of sessionDataStore) {
    if (now - data.updatedAt > SESSION_DATA_TTL_MS) {
      sessionDataStore.delete(key);
    }
  }
}, 60 * 60 * 1000);

// ─── IP-Based Session Consolidation ──────────────────────────────────────────
// Maps "profileId:clientIp" → sessionId so that visitors with the same IP
// (e.g. same device in different browser, incognito, or cleared localStorage)
// are routed to a single conversation instead of spawning duplicate sessions.
const ipSessionMap = new Map<string, { sessionId: string; updatedAt: number }>();
const IP_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipSessionMap) {
    if (now - entry.updatedAt > IP_SESSION_TTL_MS) {
      ipSessionMap.delete(key);
    }
  }
}, 60 * 60 * 1000);

function getClientIp(req: Request): string {
  const raw = req.ip || (req.socket?.remoteAddress ?? 'unknown');
  return raw.replace('::ffff:', '');
}

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

// ─── Webchat Idle Config Helper ──────────────────────────────────────────────
function getWebchatIdleConfig(profile: any): Partial<WebchatIdleConfig> | undefined {
  const settings = profile.configStore.getSettings() as any;
  return settings.webchat_idle ?? undefined;
}

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
  if (greetingSessions.has(sessionKey(profileId, sessionId))) {
    res.json({ greeting: null, sessionId });
    return;
  }

  // Read welcomeMessage from profile settings, fall back to default
  const settings = profile.configStore.getSettings() as any;
  const greeting: string = settings.welcomeMessage || DEFAULT_WELCOME_MESSAGE;

  // Mark session as greeted
  greetingSessions.set(sessionKey(profileId, sessionId), { sentAt: Date.now() });

  // US-897: Check for returning customer's last order
  let lastOrder: { items: Array<{ name: string; qty: number; price?: number }>; orderId: string } | null = null;
  const returningEnabled = settings.returning_customer?.enabled === true;

  if (returningEnabled && profileId === 'makan-moments') {
    try {
      const phone = 'webchat-' + sessionId;
      const history = await getLastOrder(phone);
      if (history && history.items.length > 0) {
        lastOrder = {
          orderId: history.orderId,
          items: history.items.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
        };
      }
    } catch (err: any) {
      console.error('[Webchat] Returning customer lookup error:', err.message);
    }
  }

  // US-921: Include any previously stored session data in greeting response
  const existingSessionData = sessionDataStore.get(sessionKey(profileId, sessionId));
  res.json({ greeting, sessionId, lastOrder, sessionData: existingSessionData || null });
});

/**
 * GET /api/chat/:profileId/session-data (US-921: WCAG 3.3.7)
 *
 * Returns previously collected session data (name, table, address, etc.)
 * so the widget can pre-fill fields and the AI doesn't re-ask.
 * Query params: sessionId (required)
 */
router.get('/:profileId/session-data', (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const sessionId = req.query.sessionId as string;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId query parameter required' });
    return;
  }

  const data = sessionDataStore.get(sessionKey(profileId, sessionId));
  res.json({ sessionId, sessionData: data || null });
});

/**
 * PUT /api/chat/:profileId/session-data (US-921: WCAG 3.3.7)
 *
 * Stores/updates session context data. Called by the widget when the user
 * provides their name, table number, delivery address, etc.
 * Body: { sessionId, guestName?, tableNumber?, orderType?, deliveryAddress?, seatNumber? }
 */
router.put('/:profileId/session-data', (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const { sessionId, guestName, tableNumber, orderType, deliveryAddress, seatNumber } = req.body;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId (string) required' });
    return;
  }

  const existing = sessionDataStore.get(sessionKey(profileId, sessionId)) || { updatedAt: Date.now() };
  const updated: WebchatSessionData = {
    ...existing,
    updatedAt: Date.now(),
  };

  // Only overwrite fields that are explicitly provided (non-undefined)
  if (guestName !== undefined) updated.guestName = String(guestName).slice(0, 100);
  if (tableNumber !== undefined) updated.tableNumber = String(tableNumber).slice(0, 20);
  if (orderType !== undefined) updated.orderType = String(orderType).slice(0, 20);
  if (deliveryAddress !== undefined) updated.deliveryAddress = String(deliveryAddress).slice(0, 500);
  if (seatNumber !== undefined) updated.seatNumber = String(seatNumber).slice(0, 20);

  sessionDataStore.set(sessionKey(profileId, sessionId), updated);
  res.json({ sessionId, sessionData: updated });
});

/**
 * GET /api/chat/:profileId/config (US-846)
 *
 * Returns availability info based on configured business hours.
 * Client-side widget uses this to show/hide the offline banner.
 */
router.get('/:profileId/config', (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;

  const profile = profileRegistry.getProfile(profileId);
  if (!profile) {
    res.status(404).json({ error: `Profile "${profileId}" not found` });
    return;
  }

  const settings = profile.configStore.getSettings() as any;
  const businessHours: BusinessHoursConfig | undefined = settings.businessHours;
  const { isAvailable, nextOpenTime } = computeAvailability(businessHours);

  res.json({
    profileId,
    isAvailable,
    nextOpenTime,
    businessHours: businessHours || null,
  });
});

// ─── Makan-Moments Context Builder ─────────────────────────────────────
// Extracted to reuse in both streaming and non-streaming paths.
function buildMakanMomentsContext(sessionId: string, profileId: string) {
  const fnbTools = toolRegistry.getToolsForProfile('makan-moments');
  const fnbHandlers = toolRegistry.getHandlersForProfile('makan-moments');
  const allTools = [...fnbTools, ...cartTools];

  // US-867: Read payment methods from profile settings for post-order guidance
  const makanProfile = profileRegistry.getProfile('makan-moments');
  const makanSettings = makanProfile?.configStore.getSettings() as any;
  const paymentMethods: string[] | undefined = makanSettings?.paymentMethods;

  // US-868: Read kitchen queue thresholds from settings
  const kitchenQueue = makanSettings?.kitchenQueue as { queueWarningThreshold?: number; waitTimeWarningMinutes?: number } | undefined;

  // US-876: Read KDS/POS webhook settings
  const kds = makanSettings?.kds?.enabled ? {
    enabled: true,
    opsNotifyPhone: makanSettings.kds.opsNotifyPhone || makanSettings?.staff?.phones?.[0] || '',
    profileId: 'makan-moments',
  } : undefined;

  // US-881: Read order modification window from settings (default 2 minutes)
  const orderModWindowMinutes = makanSettings?.order_modification?.window_minutes ?? 2;
  const modificationWindowMs = orderModWindowMinutes * 60 * 1000;

  const cartHandlers = createCartHandlers(sessionId, profileId, { paymentMethods, kitchenQueue, kds, modificationWindowMs });
  const allHandlers = new Map([...fnbHandlers, ...cartHandlers]);

  const currentCartItems = cartGetItems(profileId, sessionId);
  const cartSummary = cartFormatSummary(currentCartItems);
  const currentStage = getOrderStage(profileId, sessionId);
  const stageDescription = ORDER_STAGE_DESCRIPTIONS[currentStage];
  const pendingDisambig = getDisambiguation(profileId, sessionId);
  const tableInfo = cartGetTableInfo(profileId, sessionId);
  const lastOrderId = getSessionOrderId(profileId, sessionId);

  const disambigSection = pendingDisambig
    ? [
        '',
        '## Pending Item Disambiguation',
        `The guest previously searched for "${pendingDisambig.pendingItem}" and was shown ${pendingDisambig.candidates.length} options.`,
        'If the guest replies with a number or a name, call cart_pick_item with their selection.',
        'If the guest asks about something else, the disambiguation is abandoned — clear it by calling cart_search_item with the new query.',
      ].join('\n')
    : '';

  const tableInfoSection = tableInfo
    ? tableInfo.orderType === 'takeaway'
      ? '\nTable/Order Type: Takeaway (already captured — do NOT ask again)'
      : tableInfo.tableNumber
        ? `\nTable: ${tableInfo.tableNumber} (already captured — do NOT ask again)`
        : '\nOrder Type: Dine-in (already captured — do NOT ask again)'
    : '\nTable/Order Type: Not yet captured';

  // US-921: Build session data context (WCAG 3.3.7 Redundant Entry prevention)
  const sessionData = sessionDataStore.get(sessionKey(profileId, sessionId));
  const sessionDataLines: string[] = [];
  if (sessionData) {
    if (sessionData.guestName) sessionDataLines.push(`Guest Name: ${sessionData.guestName} (already provided — do NOT ask again)`);
    if (sessionData.deliveryAddress) sessionDataLines.push(`Delivery Address: ${sessionData.deliveryAddress} (already provided — offer as default, allow edit)`);
    if (sessionData.seatNumber) sessionDataLines.push(`Seat Number: ${sessionData.seatNumber} (already provided — do NOT ask again)`);
  }
  const sessionDataSection = sessionDataLines.length > 0
    ? '\n## Previously Collected Guest Info (WCAG 3.3.7 — do NOT re-ask)\n' + sessionDataLines.join('\n')
    : '';

  const systemPromptSuffix = [
    '## Current Order State',
    `Session: ${sessionId}`,
    `Order Stage: ${currentStage} — ${stageDescription}`,
    tableInfoSection,
    sessionDataSection,
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
    '  • ALLERGEN DISPLAY (US-877): The fnb_get_menu_item response includes an allergen section at the bottom.',
    '    — If allergen data is present (e.g. "Contains: peanuts, gluten"), ALWAYS show it to the guest.',
    '    — After showing allergen info, ask: "Would you like to add this to your order?" and WAIT for confirmation.',
    '    — Only call cart_search_item or cart_add_item AFTER the guest explicitly confirms (yes/ok/confirm/ya).',
    '    — If the guest declines after seeing allergen info, do NOT add the item and offer alternatives.',
    '    — If allergen data says "not available", still show: "Please inform staff of any allergies before ordering."',
    '  • Format results as a plain numbered list (no markdown tables):',
    '    "1. Item Name — RM X.XX\\n   Brief description"',
    '  • Show maximum 8 items per response. If more exist, add: "...and X more. Ask me to show more!"',
    '  • If category is not found or returns no items, call fnb_get_categories to list available categories.',
    '  • Use plain text only — no markdown tables, no asterisks, no headers — for WhatsApp/chat compatibility.',
    '',
    'OUT-OF-STOCK handling: When cart_search_item reports an item is out of stock:',
    '  • Apologise warmly: "Sorry, [item] is currently out of stock."',
    '  • If alternatives are shown, present them naturally and let the guest choose or decline.',
    '  • If the guest declines all alternatives, offer to show the full menu.',
    '  • Do NOT add an unavailable item to the cart.',
    '',
    'ORDERING stage: Guest is adding items to their order.',
    '  • TABLE NUMBER: After adding the FIRST item to the cart, if Table/Order Type is "Not yet captured",',
    '    ask the guest: "Would you like to dine in or takeaway? If dine-in, what is your table number?"',
    '    When they reply, call cart_set_table with tableNumber and/or orderType.',
    '    Accepted formats: "table 5", "T5", "5", "takeaway", "tapau", "dine-in", "dine in".',
    '    If the guest proactively mentions their table or says takeaway, call cart_set_table immediately.',
    '    Do NOT ask again if Table/Order Type shows "already captured".',
    '  • Use cart_search_item when the guest uses a vague or partial name (e.g. "the chicken", "nasi", "iced coffee").',
    '  • Use cart_add_item only when the guest uses the exact menu item name and you are certain it matches.',
    '  • Use cart_pick_item when the guest replies with a number or name after a disambiguation list.',
    '  • Use cart_remove_item when guest says remove/cancel/drop an item.',
    '  • Use cart_view when guest asks to see their current order.',
    '  • When guest signals they are DONE ordering (e.g. "that\'s all", "place my order", "ready to order"),',
    '    call order_request_confirmation to show the summary and ask "Shall I place this order?".',
    '  • Do NOT submit the order on your own — always confirm first.',
    '',
    'MALAY & MANGLISH ORDERING: Malaysian guests mix Malay and English. Understand these patterns:',
    '  • Add-to-cart (Malay): "saya nak X", "boleh bagi X", "nak order X", "satu X", "tolong bagi X", "minta X", "nak tambah X", "bagi saya X" → call cart_search_item.',
    '  • Add-to-cart (Manglish): "can I have X lah", "I want X lah", "add one more X lah", "give me X lah" → call cart_search_item. Ignore "lah"/"la" — it is emphasis, not meaningful.',
    '  • Remove (Malay): "tak nak X", "buang X", "cancel X", "tak jadi X" → call cart_remove_item.',
    '  • Quantity (Malay): "satu" = 1, "dua" = 2, "tiga" = 3, "empat" = 4, "lima" = 5. E.g. "dua teh tarik" → qty: 2.',
    '  • Special instructions (Malay → English mapping):',
    '    "kurang manis" → "less sugar", "kurang gula" → "less sugar",',
    '    "pedas sikit" → "a little spicy", "pedas" → "spicy", "tak pedas" → "not spicy",',
    '    "tanpa bawang" → "no onion", "tanpa ais" → "no ice", "tanpa sayur" → "no vegetables",',
    '    "tambah sambal" → "extra sambal", "lebih pedas" → "extra spicy",',
    '    "kosong" → "plain/no sugar no milk", "o" (as in "teh o") → "no milk",',
    '    "banyak ais" → "extra ice", "sikit ais" → "less ice", "suam" → "warm/no ice".',
    '    When you detect these Malay instructions, translate to English and call cart_set_item_notes with the English version.',
    '  • Takeaway (Malay): "tapau", "bawa balik", "bungkus", "nak bawa pulang" → call cart_set_table with orderType: "takeaway".',
    '  • Done ordering (Malay): "dah cukup", "itu saja", "tu je", "habis dah", "confirm", "boleh hantar" → call order_request_confirmation.',
    '  • Confirm (Malay): "ya", "boleh", "ok", "betul", "confirm", "hantar" → call order_confirm_submit.',
    '  • Always reply in the same language the guest uses. If they speak Malay, reply in Malay. If Manglish, use casual Manglish.',
    '',
    'CONFIRMING stage: You already asked "Shall I place this order?" — WAIT for yes/no.',
    '  • If guest says YES / confirm / go ahead / place it: call order_confirm_submit.',
    '  • If guest says NO / wait / cancel / change my mind: call order_back_to_cart.',
    '  • Do NOT ask for confirmation again — you are already in confirming stage.',
    '',
    'PLACED stage: Order submitted. Cart is cleared.',
    '  • Thank the guest. Offer to help with anything else.',
    '  • If they want to order again, start fresh from BROWSING.',
    '',
    'REORDER (US-897): When the guest says "reorder", "same as last time", "order lagi",',
    '  "sama macam semalam", "yes" (in response to the returning-customer welcome-back prompt):',
    '  • Call reorder_last_order — it fetches the last completed order and populates the cart.',
    '  • If items were omitted due to unavailability, inform the guest.',
    '  • The guest can then modify the cart before confirming.',
    '',
    'ORDER STATUS ENQUIRY: When the guest asks about their order status:',
    '  • Trigger phrases: "where is my order", "how long more", "is my food ready", "check my order", "order status".',
    '  • Call order_check_status — it auto-retrieves the session order ID.',
    '  • If the guest provides a specific order ID (e.g. "MM-A1B2"), pass it as the orderId argument.',
    '  • Relay the status in plain, friendly language. Do NOT expose raw status codes.',
    '  • If estimated wait time is shown, include it in your response.',
    lastOrderId
      ? `  • Last placed order ID: ${lastOrderId}`
      : '  • No order has been placed in this session yet.',
    '',
    'REDUNDANT ENTRY PREVENTION (WCAG 3.3.7 — US-921):',
    '  • NEVER re-ask for information the guest has already provided in this session.',
    '  • If Guest Name is shown above, use it in checkout/confirmation without asking again.',
    '  • If Table/Order Type is "already captured", do NOT ask again — even for a second order.',
    '  • If Delivery Address is shown above, offer it as default: "Same address as before ([address])?"',
    '  • When the guest starts a new order in the same session, carry forward table/name/address.',
  ].join('\n');

  return { allTools, allHandlers, systemPromptSuffix };
}

/**
 * US-921: Sync cart table info → session data store.
 * Called after each message so that table/orderType captured via AI tool calls
 * are persisted and not re-asked on the next request.
 */
function syncCartToSessionData(sessionId: string, profileId: string): void {
  const tableInfo = cartGetTableInfo(profileId, sessionId);
  if (!tableInfo) return;

  const storeKey = sessionKey(profileId, sessionId);
  const existing = sessionDataStore.get(storeKey) || { updatedAt: Date.now() };
  let changed = false;

  if (tableInfo.tableNumber && existing.tableNumber !== tableInfo.tableNumber) {
    existing.tableNumber = tableInfo.tableNumber;
    changed = true;
  }
  if (tableInfo.orderType && existing.orderType !== tableInfo.orderType) {
    existing.orderType = tableInfo.orderType;
    changed = true;
  }

  if (changed) {
    existing.updatedAt = Date.now();
    sessionDataStore.set(storeKey, existing);
  }
}

/**
 * POST /api/chat/:profileId/message
 *
 * Process a webchat message for a specific profile.
 * Supports SSE streaming when `stream: true` is in the request body.
 * Returns only public-safe fields (no intent/debug data).
 */
router.post('/:profileId/message', webchatLimiter, async (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const { message, history, sessionData: clientSessionData } = req.body;
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

  // Resolve sessionId — prefer client-supplied value (localStorage), but fall back
  // to an existing session for this IP so that the same visitor across different
  // browsers / incognito / cleared localStorage lands in one conversation.
  const clientIp = getClientIp(req);
  const ipKey = `${profileId}:${clientIp}`;

  if (!sessionId || typeof sessionId !== 'string') {
    const mapped = ipSessionMap.get(ipKey);
    sessionId = mapped
      ? mapped.sessionId
      : 'web_' + crypto.randomUUID().slice(0, 8) + '_' + Date.now();
  }

  // Always keep the IP map current so the next fresh session resolves here.
  ipSessionMap.set(ipKey, { sessionId, updatedAt: Date.now() });

  // US-921: Merge client-side session data (name, table, address) into server store
  // US-510: Also store language preference
  if (clientSessionData && typeof clientSessionData === 'object') {
    const sdKey = sessionKey(profileId, sessionId);
    const existing = sessionDataStore.get(sdKey) || { updatedAt: Date.now() };
    const merged: WebchatSessionData = { ...existing, updatedAt: Date.now() };
    if (clientSessionData.guestName) merged.guestName = String(clientSessionData.guestName).slice(0, 100);
    if (clientSessionData.tableNumber) merged.tableNumber = String(clientSessionData.tableNumber).slice(0, 20);
    if (clientSessionData.orderType) merged.orderType = String(clientSessionData.orderType).slice(0, 20);
    if (clientSessionData.deliveryAddress) merged.deliveryAddress = String(clientSessionData.deliveryAddress).slice(0, 500);
    if (clientSessionData.seatNumber) merged.seatNumber = String(clientSessionData.seatNumber).slice(0, 20);
    if (clientSessionData.language) merged.language = String(clientSessionData.language).slice(0, 10);
    sessionDataStore.set(sdKey, merged);
  }

  // US-826: Reset idle/timed-out session when user sends a new message
  const phone = 'webchat-' + sessionId;
  resetWebchatSession(phone).catch(err => {
    console.error('[Webchat] Session reset error:', err.message);
  });

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
        const ctx = buildMakanMomentsContext(sessionId, profileId);
        systemPrompt = `${systemPrompt}\n\n${ctx.systemPromptSuffix}`;
        fullText = await streamChatWithTools(
          res, systemPrompt, conversationHistory, sanitizedMessage,
          ctx.allTools, ctx.allHandlers
        );
      } else {
        // Route through processChat so intent classification (static_reply, etc.) is respected.
        // This prevents the LLM from being called for greetings/static intents and avoids
        // the LLM hallucinating JSON debug blocks in its output.
        // US-510: Pass language preference from session data
        const sessionData = sessionDataStore.get(sessionKey(profileId, sessionId));
        const preferredLanguage = (sessionData?.language as any) || undefined;
        const result = await processChat({
          message: sanitizedMessage,
          history: Array.isArray(history) ? history : [],
          sessionId: sessionId || undefined,
          profileId,
          configStore: profile.configStore,
          kb: profile.kb,
          tools: [],
          toolHandlers: new Map(),
          preferredLanguage,
        });
        fullText = result.message;
        if (!disconnected) {
          sseEvent(res, { token: fullText });
          sseEvent(res, { done: true, responseTime: result.responseTime, sessionId, suggestions: result.suggestions });
          res.end();
        }
      }

      const responseTime = Date.now() - startTime;

      // US-921: Sync cart table info back to session data store
      if (isMakanMoments) {
        syncCartToSessionData(sessionId, profileId);
      }

      if (!disconnected && isMakanMoments) {
        // makan-moments streaming already ends via sendStaticSSE above for non-makan paths;
        // only send the done event here for makan-moments tool path.
        const updatedSessionData = sessionDataStore.get(sessionKey(profileId, sessionId)) || null;
        sseEvent(res, { done: true, responseTime, sessionId, sessionData: updatedSessionData });
        res.end();
      }

      // Persist to DB (fire-and-forget)
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
      const ctx = buildMakanMomentsContext(sessionId, profileId);
      allTools = ctx.allTools;
      allHandlers = ctx.allHandlers;
      systemPromptSuffix = ctx.systemPromptSuffix;
    }

    // US-510: Pass language preference from session data (non-streaming path)
    const nonStreamSessionData = sessionDataStore.get(sessionKey(profileId, sessionId));
    const nonStreamPreferredLanguage = (nonStreamSessionData?.language as any) || undefined;

    const result = await processChat({
      message: sanitizedMessage,
      history: Array.isArray(history) ? history : [],
      sessionId: sessionId || undefined,
      profileId,
      configStore: profile.configStore,
      kb: profile.kb,
      tools: allTools,
      toolHandlers: allHandlers,
      systemPromptSuffix,
      preferredLanguage: nonStreamPreferredLanguage,
    });

    // Persist to DB (fire-and-forget, don't block response)
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const pushName = 'Web Visitor (' + ip.replace('::ffff:', '') + ')';

    persistWebchatExchange(phone, pushName, sanitizedMessage, result.message, result.responseTime, profileId).catch(err => {
      console.error('[Webchat] DB persist error:', err.message);
    });

    // US-921: Sync cart table info back to session data store
    if (isMakanMoments) {
      syncCartToSessionData(sessionId, profileId);
    }

    // Return only public-safe fields + session data
    const updatedSessionData = sessionDataStore.get(sessionKey(profileId, sessionId)) || null;
    res.json({
      message: result.message,
      responseTime: result.responseTime,
      sessionId,
      sessionData: updatedSessionData,
      suggestions: result.suggestions,
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
  const { profileId, sessionId } = req.params;
  const after = req.query.after ? Number(req.query.after) : 0;
  const phone = 'webchat-' + sessionId;

  try {
    // US-826: Lazy idle check — may insert a re-engagement message
    const profile = profileRegistry.getProfile(profileId);
    if (profile) {
      const idleCfg = getWebchatIdleConfig(profile);
      await checkWebchatIdle(phone, idleCfg);
    }

    let query: string;
    let params: any[];

    if (after > 0) {
      const afterDate = new Date(after);
      query = `SELECT role, content, timestamp, staff_name, source
               FROM rainbow_messages
               WHERE phone = $1 AND timestamp > $2
               ORDER BY timestamp ASC
               LIMIT 100`;
      params = [phone, afterDate];
    } else {
      query = `SELECT role, content, timestamp, staff_name, source
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
      isReengagement: r.source === 'webchat-reengagement' || undefined,
    }));

    res.json({ messages, sessionId });
  } catch (err: any) {
    console.error(`[Webchat] Error fetching messages for ${sessionId}:`, err.message);
    res.json({ messages: [], sessionId });
  }
});

/**
 * POST /api/chat/:profileId/consent-log (US-841)
 * Log webchat consent acceptance with truncated session hash and user agent hash.
 */
router.post('/:profileId/consent-log', async (req: Request, res: Response) => {
  const profileId = req.params.profileId as string;
  const { sessionIdHash, acceptedAt } = req.body;

  if (!sessionIdHash || typeof sessionIdHash !== 'string') {
    res.status(400).json({ error: 'sessionIdHash (string) required' });
    return;
  }

  // Hash user-agent for privacy
  const ua = req.headers['user-agent'] || '';
  const userAgentHash = crypto.createHash('sha256').update(ua).digest('hex').slice(0, 16);
  const truncatedSessionHash = sessionIdHash.slice(0, 16);

  try {
    await pool.query(
      `INSERT INTO webchat_consent_log (session_id_hash, accepted_at, profile_id, user_agent_hash)
       VALUES ($1, $2, $3, $4)`,
      [truncatedSessionHash, acceptedAt ? new Date(acceptedAt) : new Date(), profileId, userAgentHash]
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error('[Webchat] Consent log error:', err.message);
    res.status(500).json({ error: 'Failed to log consent' });
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
