import { configStore } from './config-store.js';
import { languageRouter } from './language-router.js';

type Language = 'en' | 'ms' | 'zh' | 'ta';

/**
 * Detect message language (en/ms/zh/ta). Uses LanguageRouter (ELD + patterns);
 * defaults to 'en' when unknown for template/response selection.
 */
export function detectLanguage(text: string): Language {
  const detected = languageRouter.detectLanguage(text);
  return (detected === 'unknown' ? 'en' : detected) as Language;
}

// Extended language detection — returns specific language name for non-EN/MS/ZH/TA
// Returns null for EN/MS/ZH/TA (handled by template system or LLM language injection)
export function detectFullLanguage(text: string): string | null {
  // Thai script
  if (/[\u0E00-\u0E7F]/.test(text)) return 'Thai';
  // Japanese (Hiragana + Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'Japanese';
  // Korean (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return 'Korean';
  // Arabic script
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return 'Arabic';
  // Devanagari (Hindi)
  if (/[\u0900-\u097F]/.test(text)) return 'Hindi';
  // Tamil — handled natively as a supported language (US-874); skip foreign-lang translation
  // Vietnamese (specific diacritics)
  if (/[ăắằẳẵặâấầẩẫậđêếềểễệôốồổỗộơớờởỡợưứừửữự]/i.test(text)) return 'Vietnamese';
  // Myanmar/Burmese
  if (/[\u1000-\u109F]/.test(text)) return 'Burmese';

  // Standard EN/MS/ZH/TA — handled by template system
  return null;
}

export function getTemplate(key: string, lang: Language): string {
  const templates = configStore.getTemplates();
  const template = templates[key];
  if (!template) return '';
  // Tamil falls back to English since templates don't have Tamil translations;
  // the LLM system prompt handles generating Tamil responses.
  const effectiveLang = lang === 'ta' ? 'en' : lang;
  return template[effectiveLang] || template.en;
}

export function formatPrice(amount: number, currency: string = 'MYR'): string {
  return `RM${amount.toFixed(0)}`;
}

export function formatDate(dateStr: string, lang: Language): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  const locale = lang === 'ms' ? 'ms-MY' : lang === 'zh' ? 'zh-CN' : lang === 'ta' ? 'ta-MY' : 'en-MY';
  return date.toLocaleDateString(locale, options);
}

// ─── Interactive Message Builders (US-430) ─────────────────────────

export interface ListSection {
  title: string;
  rows: { rowId: string; title: string; description?: string }[];
}

export interface ListMessagePayload {
  listMessage: {
    title: string;
    description: string;
    buttonText: string;
    sections: { title: string; rows: { title: string; rowId: string; description?: string }[] }[];
    listType: 1; // SINGLE_SELECT
    footerText?: string;
  };
}

export interface ButtonMessagePayload {
  buttonsMessage: {
    text: string;
    buttons: { buttonId: string; buttonText: { displayText: string }; type: 1 }[];
    headerType: 1; // TEXT header
    footerText?: string;
  };
}

/**
 * Build a Baileys-compatible list message payload.
 * Max 10 rows total across all sections.
 */
export function buildListMessage(
  title: string,
  description: string,
  buttonText: string,
  sections: ListSection[],
  footerText?: string
): ListMessagePayload {
  // Enforce Baileys limits
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows > 10) {
    throw new Error(`List message supports max 10 rows, got ${totalRows}`);
  }
  if (sections.length === 0) {
    throw new Error('List message requires at least one section');
  }

  return {
    listMessage: {
      title,
      description,
      buttonText,
      sections: sections.map(s => ({
        title: s.title,
        rows: s.rows.map(r => ({
          title: r.title,
          rowId: r.rowId,
          ...(r.description ? { description: r.description } : {}),
        })),
      })),
      listType: 1, // SINGLE_SELECT
      ...(footerText ? { footerText } : {}),
    },
  };
}

/**
 * Build a Baileys-compatible buttons message payload.
 * Max 3 buttons.
 */
export function buildButtonMessage(
  body: string,
  buttons: { id: string; text: string }[],
  footerText?: string
): ButtonMessagePayload {
  if (buttons.length > 3) {
    throw new Error(`Buttons message supports max 3 buttons, got ${buttons.length}`);
  }
  if (buttons.length === 0) {
    throw new Error('Buttons message requires at least one button');
  }

  return {
    buttonsMessage: {
      text: body,
      buttons: buttons.map(b => ({
        buttonId: b.id,
        buttonText: { displayText: b.text },
        type: 1 as const, // QUICK_REPLY
      })),
      headerType: 1, // TEXT
      ...(footerText ? { footerText } : {}),
    },
  };
}

/**
 * Convert an interactive list message to a plain text fallback.
 * Used when interactiveMessages.enabled is false.
 */
export function listMessageToText(payload: ListMessagePayload): string {
  const { title, description, sections } = payload.listMessage;
  const lines: string[] = [];
  if (title) lines.push(`*${title}*`);
  if (description) lines.push(description);
  lines.push('');

  let idx = 1;
  for (const section of sections) {
    if (section.title) lines.push(`*${section.title}*`);
    for (const row of section.rows) {
      lines.push(`${idx}. ${row.title}${row.description ? ` — ${row.description}` : ''}`);
      idx++;
    }
  }
  return lines.join('\n');
}

/**
 * Convert a buttons message to a plain text fallback.
 */
export function buttonMessageToText(payload: ButtonMessagePayload): string {
  const { text, buttons } = payload.buttonsMessage;
  const lines = [text, ''];
  buttons.forEach((b, i) => {
    lines.push(`${i + 1}. ${b.buttonText.displayText}`);
  });
  return lines.join('\n');
}

// ─── Product Card Builder (US-885) ──────────────────────────────────

export interface ProductCardItem {
  name: string;
  code?: string;
  price?: number;
  description?: string;
  category?: string;
  dietary_flags?: string[];
  allergens?: string[];
  image_url?: string;
}

/**
 * Build a formatted WhatsApp product card text for a single menu item.
 * Uses WhatsApp markdown for rich formatting.
 */
export function buildProductCardText(item: ProductCardItem, lang: Language = 'en'): string {
  const lines: string[] = [];

  // Header: item name
  lines.push(`*${item.name}*`);
  if (item.code) lines.push(`_Code: ${item.code}_`);
  lines.push('');

  // Price
  if (item.price !== undefined) {
    const priceLabels: Record<string, string> = { en: 'Price', ms: 'Harga', zh: '价格', ta: 'Price' };
    lines.push(`${priceLabels[lang] || 'Price'}: *RM ${item.price.toFixed(2)}*`);
  }

  // Category
  if (item.category) {
    const catLabels: Record<string, string> = { en: 'Category', ms: 'Kategori', zh: '类别', ta: 'Category' };
    lines.push(`${catLabels[lang] || 'Category'}: ${item.category}`);
  }

  // Description
  if (item.description) {
    lines.push('');
    lines.push(item.description);
  }

  // Dietary flags
  if (item.dietary_flags && item.dietary_flags.length > 0) {
    lines.push('');
    const dietaryLabels: Record<string, string> = { en: 'Dietary', ms: 'Diet', zh: '饮食', ta: 'Dietary' };
    lines.push(`${dietaryLabels[lang] || 'Dietary'}: ${item.dietary_flags.join(', ')}`);
  }

  // Allergens
  if (item.allergens && item.allergens.length > 0) {
    const allergenLabels: Record<string, string> = { en: 'Allergens', ms: 'Alergen', zh: '过敏原', ta: 'Allergens' };
    lines.push(`${allergenLabels[lang] || 'Allergens'}: ${item.allergens.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Build a Baileys-compatible buttons message for "Add to cart" from a product card.
 * Returns the interactive payload with the product details as body text
 * and an "Add to cart" + "View menu" button.
 */
export function buildProductCardButtons(
  item: ProductCardItem,
  lang: Language = 'en'
): ButtonMessagePayload {
  const body = buildProductCardText(item, lang);

  const addToCartLabels: Record<string, string> = {
    en: 'Add to cart', ms: 'Tambah ke troli', zh: '加入购物车', ta: 'Add to cart'
  };
  const viewMenuLabels: Record<string, string> = {
    en: 'View full menu', ms: 'Lihat menu penuh', zh: '查看完整菜单', ta: 'View full menu'
  };

  return buildButtonMessage(
    body,
    [
      { id: `add_to_cart:${item.code || item.name}`, text: addToCartLabels[lang] || 'Add to cart' },
      { id: 'view_menu', text: viewMenuLabels[lang] || 'View full menu' },
    ]
  );
}

/**
 * Convert a product card buttons message to plain text fallback.
 */
export function productCardToText(item: ProductCardItem, lang: Language = 'en'): string {
  const body = buildProductCardText(item, lang);
  const addHints: Record<string, string> = {
    en: 'Reply "add to cart" to order this item, or "menu" to see the full menu.',
    ms: 'Balas "tambah ke troli" untuk pesan, atau "menu" untuk lihat menu penuh.',
    zh: '回复\u201C加入购物车\u201D下单，或\u201C菜单\u201D查看完整菜单。',
    ta: 'Reply "add to cart" to order this item, or "menu" to see the full menu.',
  };
  return `${body}\n\n${addHints[lang] || addHints.en}`;
}

export function formatPriceBreakdown(
  breakdown: { nights: number; rateType: string; baseRate: number; totalBase: number; deposit: number; total: number; savings?: string; currency: string },
  lang: Language
): string {
  const lines: string[] = [];

  if (lang === 'zh') {
    lines.push(`*价格明细*`);
    lines.push(`${breakdown.nights}晚 x RM${breakdown.baseRate}/晚`);
    lines.push(`小计: RM${breakdown.totalBase}`);
    if (breakdown.deposit > 0) lines.push(`押金: RM${breakdown.deposit}`);
    lines.push(`*总计: RM${breakdown.total}*`);
    if (breakdown.savings) lines.push(`_${breakdown.savings}_`);
  } else if (lang === 'ms') {
    lines.push(`*Pecahan Harga*`);
    lines.push(`${breakdown.nights} malam x RM${breakdown.baseRate}/malam`);
    lines.push(`Subtotal: RM${breakdown.totalBase}`);
    if (breakdown.deposit > 0) lines.push(`Deposit: RM${breakdown.deposit}`);
    lines.push(`*Jumlah: RM${breakdown.total}*`);
    if (breakdown.savings) lines.push(`_${breakdown.savings}_`);
  } else {
    lines.push(`*Price Breakdown*`);
    lines.push(`${breakdown.nights} nights x RM${breakdown.baseRate}/night`);
    lines.push(`Subtotal: RM${breakdown.totalBase}`);
    if (breakdown.deposit > 0) lines.push(`Deposit: RM${breakdown.deposit}`);
    lines.push(`*Total: RM${breakdown.total}*`);
    if (breakdown.savings) lines.push(`_${breakdown.savings}_`);
  }

  return lines.join('\n');
}
