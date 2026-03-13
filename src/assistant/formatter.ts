import { configStore } from './config-store.js';
import { languageRouter } from './language-router.js';

type Language = 'en' | 'ms' | 'zh';

/**
 * Detect message language (en/ms/zh). Uses LanguageRouter (ELD + patterns);
 * defaults to 'en' when unknown for template/response selection.
 */
export function detectLanguage(text: string): Language {
  const detected = languageRouter.detectLanguage(text);
  return detected === 'unknown' ? 'en' : detected;
}

// Extended language detection — returns specific language name for non-EN/MS/ZH
// Returns null for EN/MS/ZH (handled by template system)
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
  // Tamil
  if (/[\u0B80-\u0BFF]/.test(text)) return 'Tamil';
  // Vietnamese (specific diacritics)
  if (/[ăắằẳẵặâấầẩẫậđêếềểễệôốồổỗộơớờởỡợưứừửữự]/i.test(text)) return 'Vietnamese';
  // Myanmar/Burmese
  if (/[\u1000-\u109F]/.test(text)) return 'Burmese';

  // Standard EN/MS/ZH — handled by template system
  return null;
}

export function getTemplate(key: string, lang: Language): string {
  const templates = configStore.getTemplates();
  const template = templates[key];
  if (!template) return '';
  return template[lang] || template.en;
}

export function formatPrice(amount: number, currency: string = 'MYR'): string {
  return `RM${amount.toFixed(0)}`;
}

export function formatDate(dateStr: string, lang: Language): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  const locale = lang === 'ms' ? 'ms-MY' : lang === 'zh' ? 'zh-CN' : 'en-MY';
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
