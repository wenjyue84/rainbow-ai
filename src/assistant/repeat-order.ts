/**
 * repeat-order.ts — Repeat order offer for returning guests (US-856)
 *
 * On session start, checks if guest has a previous order within last 30 days.
 * If found, offers to repeat it as part of the greeting.
 * Guest can reply YES to load order into cart, or NO to browse normally.
 */

import { createModuleLogger } from '../lib/logger.js';

const logger = createModuleLogger('RepeatOrder');

export interface LastOrder {
  items: Array<{ code: string; qty: number; name?: string; price?: number }>;
  placedAt: Date;
  orderId?: string;
}

/**
 * Query FnB MCP for last order placed by this guest.
 * Returns null if no order found within 30 days.
 */
export async function getLastOrderFromFnB(phone: string): Promise<LastOrder | null> {
  try {
    const FNB_MCP_URL = process.env.FNB_MCP_URL || 'http://localhost:3031/api/mcp';
    const FNB_MCP_SECRET = process.env.FNB_MCP_SECRET || '';

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (FNB_MCP_SECRET) {
      headers['x-mcp-secret'] = FNB_MCP_SECRET;
    }

    const res = await fetch(FNB_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'fnb_get_last_order', input: { phone } })
    });

    if (!res.ok) {
      logger.warn('FnB MCP returned error', { phone, status: res.status });
      return null;
    }

    const data = await res.json();

    // Parse FnB MCP response: expect structure like { content: [{ type: 'text', text: "..." }] } or direct order data
    if (data.content && Array.isArray(data.content)) {
      const content = data.content[0];
      if (content.type === 'text') {
        // Try to parse JSON from text response
        try {
          const orderData = JSON.parse(content.text);
          return {
            items: orderData.items || [],
            placedAt: new Date(orderData.placedAt || Date.now()),
            orderId: orderData.orderId
          };
        } catch {
          // Text response is not JSON, return null
          logger.debug('FnB response was not JSON', { phone });
          return null;
        }
      }
    }

    // Assume data is direct order object
    if (data.items && Array.isArray(data.items)) {
      return {
        items: data.items,
        placedAt: new Date(data.placedAt || Date.now()),
        orderId: data.orderId
      };
    }

    return null;
  } catch (error: any) {
    logger.error('Failed to query FnB MCP for last order', { phone, error: error.message });
    return null;
  }
}

/**
 * Format an attractive repeat order offer message.
 */
export function formatRepeatOrderOffer(lastOrder: LastOrder, language: 'en' | 'ms' | 'zh' = 'en'): string {
  const itemsSummary = lastOrder.items
    .map(item => `${item.name || item.code} (×${item.qty})`)
    .join(', ');

  const messages = {
    en: `Welcome back! 👋 I see you last ordered: ${itemsSummary}\n\nWould you like to repeat this order? (Reply YES or NO)`,
    ms: `Selamat datang kembali! 👋 Saya lihat pesanan terakhir Anda ialah: ${itemsSummary}\n\nAdakah anda mahu mengulangi pesanan ini? (Balas YA atau TIDAK)`,
    zh: `欢迎回来！👋 我看到您上次订购了：${itemsSummary}\n\n你想重复这个订单吗？(回复 是 或 否)`
  };

  return messages[language] || messages.en;
}

/**
 * Detect if user is accepting a repeat order offer (YES response).
 */
export function isRepeatOrderAccepted(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return /^(yes|y|yeah|yep|ok|okay|sure|ya|yup|jawab|yes|confirm|setuju|shi|是|好|可以)$/i.test(normalized);
}

/**
 * Detect if user is declining a repeat order offer (NO response).
 */
export function isRepeatOrderDeclined(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return /^(no|n|nope|tidak|tidak|nah|cancel|nope|bu|不|没)$/i.test(normalized);
}
