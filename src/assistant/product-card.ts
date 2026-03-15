/**
 * product-card.ts — WhatsApp product card message builder (US-885)
 *
 * Builds a single-item product card for menu item detail showcase.
 * Two modes:
 *   1. Catalog mode: Baileys productMessage (requires WhatsApp Business catalog)
 *   2. Fallback mode: Buttons message with item details + "Add to cart" button
 *
 * When not on WhatsApp, returns a plain-text fallback.
 */

import type { DisambiguationCandidate } from './disambiguation-store.js';
import { buildButtonMessage, type ButtonMessagePayload } from './formatter.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CatalogConfig {
  enabled: boolean;
  catalogId: string;
  businessJid: string;
}

export interface ProductCardItem {
  code?: string;
  name: string;
  price?: number;
  category?: string;
  description?: string;
  allergens?: string[];
  dietary_flags?: string[];
  available?: boolean;
}

// ─── Baileys Product Message (catalog mode) ──────────────────────────────────

export interface ProductMessagePayload {
  productMessage: {
    product: {
      productId: string;
      title: string;
      description: string;
      currencyCode: string;
      priceAmount1000: number;
      retailerId: string;
      productImageCount: number;
    };
    businessOwnerJid: string;
    catalog: { catalogId: string };
  };
}

/**
 * Build a Baileys product message for catalog-enabled WhatsApp Business accounts.
 * Requires a registered catalog in Meta Business Manager.
 */
export function buildProductMessage(
  item: ProductCardItem,
  catalog: CatalogConfig
): ProductMessagePayload {
  return {
    productMessage: {
      product: {
        productId: item.code || item.name.toLowerCase().replace(/\s+/g, '-'),
        title: item.name,
        description: formatItemDescription(item),
        currencyCode: 'MYR',
        priceAmount1000: Math.round((item.price ?? 0) * 1000),
        retailerId: item.code || '',
        productImageCount: 0,
      },
      businessOwnerJid: catalog.businessJid,
      catalog: { catalogId: catalog.catalogId },
    },
  };
}

// ─── Button Message Fallback (no catalog) ────────────────────────────────────

/**
 * Build a buttons message with item details and "Add to cart" action.
 * Used when WhatsApp Business catalog is not configured.
 */
export function buildProductCardButtons(
  item: ProductCardItem,
  lang: 'en' | 'ms' | 'zh' | 'ta' = 'en'
): ButtonMessagePayload {
  const body = formatItemCard(item, lang);
  const footerText = {
    en: 'Tap to add to your order',
    ms: 'Ketik untuk tambah ke pesanan',
    zh: '点击添加到您的订单',
    ta: 'உங்கள் ஆர்டரில் சேர்க்க தட்டவும்',
  }[lang] || 'Tap to add to your order';

  const addText = {
    en: 'Add to Cart 🛒',
    ms: 'Tambah ke Troli 🛒',
    zh: '加入购物车 🛒',
    ta: 'கார்ட்டில் சேர் 🛒',
  }[lang] || 'Add to Cart 🛒';

  return buildButtonMessage(
    body,
    [{ id: `add to cart: ${item.name}`, text: addText }],
    footerText
  );
}

// ─── Text Fallback ───────────────────────────────────────────────────────────

/**
 * Build a plain-text product card (for non-WhatsApp channels or text-only mode).
 */
export function productCardToText(
  item: ProductCardItem,
  lang: 'en' | 'ms' | 'zh' | 'ta' = 'en'
): string {
  const card = formatItemCard(item, lang);
  const addHint = {
    en: '\n\nReply "add to cart" to order this item.',
    ms: '\n\nBalas "add to cart" untuk pesan item ini.',
    zh: '\n\n回复 "add to cart" 以下单此菜品。',
    ta: '\n\n"add to cart" என பதிலளிக்கவும்.',
  }[lang] || '\n\nReply "add to cart" to order this item.';
  return card + addHint;
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function formatItemCard(item: ProductCardItem, lang: 'en' | 'ms' | 'zh' | 'ta'): string {
  const lines: string[] = [];

  // Item name with emoji
  lines.push(`🍽️ *${item.name}*`);

  // Price
  if (item.price !== undefined) {
    lines.push(`💰 RM ${item.price.toFixed(2)}`);
  }

  // Category
  if (item.category) {
    lines.push(`📂 ${item.category}`);
  }

  // Description
  if (item.description) {
    lines.push('');
    lines.push(item.description);
  }

  // Dietary flags
  if (item.dietary_flags && item.dietary_flags.length > 0) {
    const flagEmojis: Record<string, string> = {
      vegetarian: '🥬 Vegetarian',
      vegan: '🌱 Vegan',
      halal: '🕌 Halal',
      'no-pork': '🚫🐷 No Pork',
      'no-nuts': '🚫🥜 No Nuts',
      'gluten-free': '🌾 Gluten Free',
      'dairy-free': '🥛 Dairy Free',
    };
    const flags = item.dietary_flags
      .map(f => flagEmojis[f] || f)
      .join(' · ');
    lines.push('');
    lines.push(flags);
  }

  // Allergens
  if (item.allergens && item.allergens.length > 0) {
    const warnLabel = { en: 'Allergens', ms: 'Alergen', zh: '过敏原', ta: 'ஒவ்வாமை' }[lang] || 'Allergens';
    lines.push(`⚠️ ${warnLabel}: ${item.allergens.join(', ')}`);
  }

  // Availability
  if (item.available === false) {
    const unavail = {
      en: '❌ Currently unavailable',
      ms: '❌ Tidak tersedia buat masa ini',
      zh: '❌ 暂时售罄',
      ta: '❌ தற்போது கிடைக்கவில்லை',
    }[lang] || '❌ Currently unavailable';
    lines.push('');
    lines.push(unavail);
  }

  return lines.join('\n');
}

function formatItemDescription(item: ProductCardItem): string {
  const parts: string[] = [];
  if (item.description) parts.push(item.description);
  if (item.category) parts.push(`Category: ${item.category}`);
  if (item.dietary_flags && item.dietary_flags.length > 0) {
    parts.push(item.dietary_flags.join(', '));
  }
  return parts.join(' | ') || item.name;
}

// ─── Item Name Extraction ────────────────────────────────────────────────────

/**
 * Extract the menu item name from a user query like:
 *   "tell me about the nasi lemak"
 *   "what is roti canai"
 *   "describe mee goreng mamak"
 *   "info on teh tarik"
 */
export function extractItemNameFromQuery(text: string): string {
  const normalized = text.trim().toLowerCase();

  // Strip common prefixes (ordered longest first to avoid partial matches)
  const prefixes = [
    /^(tell\s+me\s+(more\s+)?about\s+(the\s+)?)/i,
    /^(what('s|\s+is)\s+(the\s+|a\s+)?)/i,
    /^(can\s+you\s+(tell|show)\s+me\s+(about\s+)?(the\s+)?)/i,
    /^(i\s+want\s+to\s+know\s+(about\s+)?(the\s+)?)/i,
    /^(show\s+me\s+(the\s+|details?\s+(of|for|about)\s+(the\s+)?)?)/i,
    /^(describe\s+(the\s+)?)/i,
    /^(info\s+(on|about)\s+(the\s+)?)/i,
    /^(details?\s+(of|for|about|on)\s+(the\s+)?)/i,
    /^(apa\s+(itu|tu)\s+)/i,         // Malay: "apa itu..."
    /^(cerita(kan)?\s+(tentang\s+)?)/i, // Malay: "ceritakan tentang..."
    /^(什么是|介绍一下|讲讲)/,            // Chinese: "what is...", "introduce..."
  ];

  let result = normalized;
  for (const re of prefixes) {
    result = result.replace(re, '');
  }

  // Strip trailing question marks and whitespace
  result = result.replace(/[?？。！!.]+$/, '').trim();

  return result || normalized;
}
