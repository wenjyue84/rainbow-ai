/**
 * action-dispatch-menu.ts — Menu-related dispatch handlers
 *
 * Extracted from action-dispatch.ts for maintainability.
 * Handles: menu browsing (interactive list), price filtering, daily specials,
 * and popular item recommendations.
 */

import type { IPipelineContext } from '../pipeline-context.js';
import type { PipelineState } from '../types.js';
import type { ListSection } from '../../formatter.js';
import { buildListMessage } from '../../formatter.js';
import { fnbGetMenu, fnbGetDailySpecials, fnbGetPopularItems, fetchMenuItems } from '../../../tools/fnb-menu.js';

// ─── WhatsApp list message limits ───────────────────────────────────────────
const MENU_LIST_MAX_SECTIONS = 3;
const MENU_LIST_MAX_ITEMS_PER_SECTION = 3; // 3 sections × 3 items = 9 rows < 10 limit

/**
 * US-872: Build and send a WhatsApp interactive list message for menu browsing.
 *
 * Fetches menu items from FnB MCP, groups them by category (up to 3 sections,
 * 3 items each), and builds a Baileys listMessage payload. Falls back to plain-text
 * menu when:
 *   - interactiveMessages is disabled in settings
 *   - msg.instanceId is absent (webchat / non-WhatsApp channel)
 *   - FnB MCP is unreachable or returns no structured data
 *
 * Row IDs follow the format `add to cart: ITEMNAME` so that when the user selects
 * a row, the incoming text is immediately recognised as ORDER_ITEM_ADD by the LLM tier.
 */
export async function handleMenuBrowseInteractive(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const settings = context.getSettings();
  const interactiveEnabled = (settings as any).interactiveMessages?.enabled;
  const isWhatsApp = Boolean(state.msg.instanceId);

  // Text fallback for non-WhatsApp channels or when interactive is disabled
  if (!interactiveEnabled || !isWhatsApp) {
    await menuBrowseTextFallback(state);
    return;
  }

  // Fetch structured menu items from FnB MCP
  const items = await fetchMenuItems();

  if (items.length === 0) {
    await menuBrowseTextFallback(state);
    return;
  }

  // Group items by category
  const categoryMap = new Map<string, typeof items>();
  for (const item of items) {
    const cat = item.category || 'Others';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(item);
  }

  // Build list sections — cap at MENU_LIST_MAX_SECTIONS × MENU_LIST_MAX_ITEMS_PER_SECTION
  const sections: ListSection[] = [];
  for (const [cat, catItems] of Array.from(categoryMap.entries()).slice(0, MENU_LIST_MAX_SECTIONS)) {
    const rows = catItems.slice(0, MENU_LIST_MAX_ITEMS_PER_SECTION).map(item => ({
      rowId: `add to cart: ${item.name}`,
      title: item.name.slice(0, 24),
      ...(item.price !== undefined ? { description: `RM ${item.price.toFixed(2)}` } : {}),
    }));
    if (rows.length > 0) {
      sections.push({ title: cat.slice(0, 24), rows });
    }
  }

  if (sections.length < 1) {
    await menuBrowseTextFallback(state);
    return;
  }

  const lang = state.lang || 'en';
  const i18n: Record<string, { title: string; description: string; buttonText: string }> = {
    en: { title: 'Makan Moments Menu', description: 'Tap an item to add it to your cart 🛒', buttonText: 'View Menu' },
    ms: { title: 'Menu Makan Moments', description: 'Ketik item untuk tambah ke troli 🛒', buttonText: 'Lihat Menu' },
    zh: { title: 'Makan Moments菜单', description: '点击菜品加入购物车 🛒', buttonText: '查看菜单' },
  };
  const t = i18n[lang] || i18n.en;

  try {
    const payload = buildListMessage(t.title, t.description, t.buttonText, sections);
    state.interactivePayload = payload;
    state.response = t.description; // Plain-text fallback used if interactive send fails
    console.log(`[Dispatch] US-872: built menu list message (${sections.length} sections, makan-moments)`);
  } catch (err: any) {
    console.warn(`[Dispatch] US-872: buildListMessage failed (${err.message}), falling back to text`);
    await menuBrowseTextFallback(state);
  }
}

/** Serve a plain-text menu as a text fallback (US-872). */
async function menuBrowseTextFallback(state: PipelineState): Promise<void> {
  const result = await fnbGetMenu({ _profileId: state.profileId });
  if (result.isError || !result.content[0]?.text) {
    const lang = state.lang || 'en';
    const msgs: Record<string, string> = {
      en: 'Here\'s our menu — tap any item or type its name to order! 🍽️',
      ms: 'Ini menu kami — ketik nama item untuk memesan! 🍽️',
      zh: '这是我们的菜单 — 输入菜品名称即可下单！🍽️',
    };
    state.response = msgs[lang] || msgs.en;
  } else {
    state.response = result.content[0].text;
  }
}

/**
 * Parse price from message text (e.g., "RM 15", "15 ringgit", "under RM 10")
 * Returns [minPrice, maxPrice] or null if no price found
 */
export function parsePriceFromText(text: string): [number, number] | null {
  // Pattern: "RM X", "X ringgit", "X rm", "between X and Y", "X to Y"
  const rmPattern = /(?:RM|rm)\s*(\d+(?:\.\d{1,2})?)/;
  const ringgitPattern = /(\d+(?:\.\d{1,2})?)\s*(?:ringgit|rm)\b/i;
  const rangePattern = /(?:between|from)?\s*(?:RM|rm)?\s*(\d+(?:\.\d{1,2})?)\s*(?:and|to)\s*(?:RM|rm)?\s*(\d+(?:\.\d{1,2})?)/i;

  // Check for price range (e.g., "between 10 and 20")
  const rangeMatch = text.match(rangePattern);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (!isNaN(min) && !isNaN(max)) return [min, max];
  }

  // Check for "RM X" or "X ringgit"
  const rmMatch = text.match(rmPattern) || text.match(ringgitPattern);
  if (rmMatch && rmMatch[1]) {
    const price = parseFloat(rmMatch[1]);
    if (!isNaN(price)) return [0, price]; // maxPrice = price
  }

  return null;
}

/**
 * US-863: Handle MENU_FILTER_PRICE intent
 * Parse price from message and call fnbGetMenu with maxPrice filter
 */
export async function handleMenuFilterPrice(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  const { processText, convo } = state;

  context.resetUnknown(state.phone);

  // Parse price from the message
  const [minPrice, maxPrice] = parsePriceFromText(processText) || [undefined, undefined];

  if (maxPrice === undefined) {
    // Couldn't parse price, fall back to LLM
    state.response = 'I understood you\'re looking for items in a certain price range, but I couldn\'t parse the price. Could you please specify the amount in RM? For example, "What can I get for RM 15?"';
    return;
  }

  console.log(`[Dispatch] US-863 MENU_FILTER_PRICE: maxPrice=${maxPrice}, minPrice=${minPrice}`);

  // Call fnbGetMenu with price filter
  const result = await fnbGetMenu({
    _profileId: state.profileId,
    max_price: maxPrice,
    ...(minPrice ? { min_price: minPrice } : {})
  });

  if (result.isError) {
    state.response = 'I\'m unable to check the menu right now. Please try again or ask our staff for help.';
  } else {
    state.response = result.content[0]?.text || 'I couldn\'t retrieve the menu. Please ask our staff for assistance.';
  }
}

/**
 * US-864: Handle MENU_SPECIALS intent
 * Fetches daily specials and promotions via fnbGetDailySpecials.
 * Falls back to a graceful message if no specials are found.
 */
export async function handleMenuSpecials(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.convo.language || 'en';

  console.log(`[Dispatch] US-864 MENU_SPECIALS: fetching specials for profile=${state.profileId}`);

  const result = await fnbGetDailySpecials({ _profileId: state.profileId });

  if (result.isError) {
    const errorMessages: Record<string, string> = {
      en: "I'm unable to check today's specials right now. Please ask our staff or check back shortly!",
      ms: "Maaf, saya tidak dapat menyemak promosi hari ini buat masa ini. Sila tanya staf kami atau cuba lagi sebentar.",
      zh: "抱歉，我现在无法查看今日特餐。请询问我们的员工或稍后再试！"
    };
    state.response = errorMessages[lang] || errorMessages.en;
    return;
  }

  const text = result.content[0]?.text || '';

  if (!text || text.trim().length === 0) {
    // No specials today — offer popular items instead
    const noSpecialsMessages: Record<string, string> = {
      en: "There are no specials today, but our menu is always full of great choices! Would you like to see the full menu?",
      ms: "Tiada promosi khas hari ini, tetapi menu kami sentiasa penuh dengan pilihan yang hebat! Nak tengok menu penuh?",
      zh: "今天没有特别优惠，但我们的菜单一直有很多好选择！要看完整菜单吗？"
    };
    state.response = noSpecialsMessages[lang] || noSpecialsMessages.en;
    return;
  }

  const headerMessages: Record<string, string> = {
    en: "Here are today's specials and promotions! 🌟",
    ms: "Ini promosi dan special hari ini! 🌟",
    zh: "今日特餐和优惠来了！🌟"
  };

  state.response = `${headerMessages[lang] || headerMessages.en}\n\n${text}`;
}

/**
 * US-870: Handle MENU_RECOMMEND intent
 * Surfaces the top 3-5 most popular / featured items when guest is undecided.
 * Falls back to featured items if dedicated popular endpoint is unavailable.
 */
export async function handleMenuRecommend(
  state: PipelineState,
  context: IPipelineContext
): Promise<void> {
  context.resetUnknown(state.phone);

  const lang = state.convo.language || 'en';
  const LIMIT = 5;

  console.log(`[Dispatch] US-870 MENU_RECOMMEND: fetching popular items for profile=${state.profileId}, limit=${LIMIT}`);

  const result = await fnbGetPopularItems({ _profileId: state.profileId, limit: LIMIT });

  if (result.isError) {
    const errorMessages: Record<string, string> = {
      en: "I'm unable to fetch recommendations right now. Please ask our staff — they'll be happy to suggest something delicious! 😊",
      ms: "Maaf, saya tidak dapat mendapatkan cadangan buat masa ini. Sila tanya staf kami — mereka akan senang membantu! 😊",
      zh: "抱歉，我现在无法获取推荐。请询问我们的员工——他们很乐意为您推荐美食！😊"
    };
    state.response = errorMessages[lang] || errorMessages.en;
    return;
  }

  const text = (result.content[0]?.text || '').trim();

  if (!text) {
    const emptyMessages: Record<string, string> = {
      en: "I don't have popularity data right now, but everything on our menu is made with love! Would you like to see the full menu?",
      ms: "Saya tiada data populariti buat masa ini, tetapi semua dalam menu kami dibuat dengan penuh kasih sayang! Nak tengok menu penuh?",
      zh: "我现在没有人气数据，但我们菜单上的每道菜都是用心烹制的！要看完整菜单吗？"
    };
    state.response = emptyMessages[lang] || emptyMessages.en;
    return;
  }

  const headerMessages: Record<string, string> = {
    en: `Here are our most popular dishes right now! ⭐`,
    ms: `Ini hidangan paling popular kami sekarang! ⭐`,
    zh: `这是我们现在最受欢迎的菜肴！⭐`
  };

  const ctaMessages: Record<string, string> = {
    en: `\n\nWant me to add any of these to your order? Just let me know! 😊`,
    ms: `\n\nMahu saya tambahkan mana-mana ke pesanan anda? Beritahu saya sahaja! 😊`,
    zh: `\n\n要我把其中一道加入您的订单吗？告诉我就行！😊`
  };

  const header = headerMessages[lang] || headerMessages.en;
  const cta = ctaMessages[lang] || ctaMessages.en;
  state.response = `${header}\n\n${text}${cta}`;
}
