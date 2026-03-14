import { MCPTool, MCPToolResult } from '../types/mcp.js';
import type { DisambiguationCandidate } from '../assistant/disambiguation-store.js';

const FNB_MCP_URL = process.env.FNB_MCP_URL || 'http://localhost:3031/api/mcp';
const FNB_MCP_SECRET = process.env.FNB_MCP_SECRET || '';

// ─── Menu Response Cache (5-minute TTL per profile+category+tags) ────────────
const MENU_CACHE_TTL_MS = 5 * 60 * 1000;
interface MenuCacheEntry { text: string; expiresAt: number; }
const menuCache = new Map<string, MenuCacheEntry>();

// ─── Daily Specials Cache (30-min TTL, expires at midnight) ──────────────────
const SPECIALS_CACHE_TTL_MS = 30 * 60 * 1000;
interface SpecialsCacheEntry { text: string; expiresAt: number; }
const specialsCache = new Map<string, SpecialsCacheEntry>();

function getSpecialsCacheKey(profileId: string): string {
  return `specials::${profileId}`;
}

function getMidnightTimestamp(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime();
}

function getSpecialsCache(profileId: string): string | undefined {
  const entry = specialsCache.get(getSpecialsCacheKey(profileId));
  if (entry && Date.now() < entry.expiresAt) return entry.text;
  return undefined;
}

function setSpecialsCache(profileId: string, text: string): void {
  const ttlExpiry = Date.now() + SPECIALS_CACHE_TTL_MS;
  const midnightExpiry = getMidnightTimestamp();
  // Expire at whichever comes first: 30-min TTL or midnight
  const expiresAt = Math.min(ttlExpiry, midnightExpiry);
  specialsCache.set(getSpecialsCacheKey(profileId), { text, expiresAt });
}

function getMenuCacheKey(profileId: string, category?: string, dietaryTags?: string[], maxPrice?: number): string {
  const tagsKey = dietaryTags && dietaryTags.length > 0 ? `::tags:${[...dietaryTags].sort().join(',')}` : '';
  const priceKey = maxPrice ? `::maxPrice:${maxPrice}` : '';
  return `${profileId}::${category || '__all__'}${tagsKey}${priceKey}`;
}

function getMenuCache(profileId: string, category?: string, dietaryTags?: string[], maxPrice?: number): string | undefined {
  const entry = menuCache.get(getMenuCacheKey(profileId, category, dietaryTags, maxPrice));
  if (entry && Date.now() < entry.expiresAt) return entry.text;
  return undefined;
}

function setMenuCache(profileId: string, text: string, category?: string, dietaryTags?: string[], maxPrice?: number): void {
  menuCache.set(getMenuCacheKey(profileId, category, dietaryTags, maxPrice), { text, expiresAt: Date.now() + MENU_CACHE_TTL_MS });
}

// Re-export for convenience
export type { DisambiguationCandidate as MenuItem };

export const fnbMenuTools: MCPTool[] = [
  {
    name: 'fnb_get_menu',
    description: 'Get the full cafe menu. Optionally filter by category, price range, and/or dietary tags.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category to filter by (optional)' },
        max_price: { type: 'number', description: 'Maximum price in RM to filter by (optional). Returns items at or below this price, sorted cheapest first.' },
        min_price: { type: 'number', description: 'Minimum price in RM to filter by (optional).' },
        dietary_tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dietary tags to filter by (optional). Supported: vegetarian, vegan, halal, no-pork, no-nuts, gluten-free, dairy-free. AND logic applies — only items matching ALL tags are returned.'
        }
      }
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_get_menu_item',
    description: 'Get details for a specific menu item by its code',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Menu item code (e.g. "NR01")' }
      },
      required: ['code']
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_get_categories',
    description: 'Get list of menu categories',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_get_cafe_info',
    description: 'Get cafe info: hours, address, WiFi, FAQ',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  },
  {
    name: 'fnb_get_daily_specials',
    description: 'Get today\'s daily specials, promotions, and limited-time items. Returns items marked as special or on promotion with original and discounted prices.',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    allowedProfiles: ['makan-moments']
  }
];

async function callFnbMcp(tool: string, input: Record<string, any> = {}): Promise<MCPToolResult> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (FNB_MCP_SECRET) {
      headers['x-mcp-secret'] = FNB_MCP_SECRET;
    }

    const res = await fetch(FNB_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, input })
    });

    if (!res.ok) {
      return {
        content: [{ type: 'text', text: 'The cafe ordering system returned an error. Please try again or contact staff.' }],
        isError: true
      };
    }

    const data = await res.json();
    // MCP endpoint may return {content: [...]} or raw data
    const text = data.content
      ? data.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
      : JSON.stringify(data, null, 2);

    return { content: [{ type: 'text', text }] };
  } catch (error: any) {
    return {
      content: [{ type: 'text', text: 'Unable to reach the cafe ordering system right now. Please try again or ask our staff for help.' }],
      isError: true
    };
  }
}

export async function fnbGetMenu(args: any): Promise<MCPToolResult> {
  const profileId = args._profileId || 'makan-moments';
  const category = args.category as string | undefined;
  const maxPrice = args.max_price as number | undefined;
  const minPrice = args.min_price as number | undefined;
  const dietaryTags = Array.isArray(args.dietary_tags) ? (args.dietary_tags as string[]) : undefined;

  const cached = getMenuCache(profileId, category, dietaryTags, maxPrice);
  if (cached) return { content: [{ type: 'text', text: cached }] };

  const input: Record<string, any> = {};
  if (category) input.category = category;
  if (maxPrice !== undefined) input.max_price = maxPrice;
  if (minPrice !== undefined) input.min_price = minPrice;
  if (dietaryTags && dietaryTags.length > 0) input.dietary_tags = dietaryTags;

  let result = await callFnbMcp('fnb_get_menu', input);

  // Client-side price filtering as fallback if MCP doesn't support it
  if (!result.isError && (maxPrice !== undefined || minPrice !== undefined)) {
    const text = result.content[0]?.text || '';
    const items = parseMenuFromText(text);
    const filtered = items.filter(item => {
      if (item.price === undefined) return true;
      if (maxPrice !== undefined && item.price > maxPrice) return false;
      if (minPrice !== undefined && item.price < minPrice) return false;
      return true;
    });

    if (filtered.length === 0) {
      const allItems = parseMenuFromText(text);
      const minAvailable = Math.min(...allItems.filter(i => i.price !== undefined).map(i => i.price!));
      const closest = allItems.filter(i => i.price === minAvailable).slice(0, 3);
      const closestText = closest.map(c => `${c.code ? `${c.code} ` : ''}${c.name}${c.price ? ` - RM ${c.price.toFixed(2)}` : ''}`).join('\n');
      const response = maxPrice
        ? `I didn't find items under RM ${maxPrice}. The cheapest items start at RM ${minAvailable.toFixed(2)}:\n\n${closestText}`
        : `No items found in that price range. Here are our most affordable options:\n\n${closestText}`;
      result = { content: [{ type: 'text', text: response }] };
    } else {
      const sortedText = filtered
        .sort((a, b) => (a.price || Infinity) - (b.price || Infinity))
        .map(c => `${c.code ? `${c.code} ` : ''}${c.name}${c.price ? ` - RM ${c.price.toFixed(2)}` : ''}`)
        .join('\n');
      result = { content: [{ type: 'text', text: `Here are items ${maxPrice ? `under RM ${maxPrice}` : minPrice ? `from RM ${minPrice}` : 'in your price range'} (sorted by price):\n\n${sortedText}` }] };
    }
  }

  if (!result.isError) {
    const text = result.content[0]?.text || '';
    if (text) setMenuCache(profileId, text, category, dietaryTags, maxPrice);
  }
  return result;
}

export async function fnbGetMenuItem(args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_get_menu_item', { code: args.code });
}

export async function fnbGetCategories(_args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_get_categories');
}

export async function fnbGetCafeInfo(_args: any): Promise<MCPToolResult> {
  return callFnbMcp('fnb_get_cafe_info');
}

/**
 * US-864: Get daily specials and promotions.
 * Tries fnb_get_daily_specials MCP endpoint first; falls back to fnb_get_menu with isSpecial=true.
 * Cached for 30 minutes per profile, expires at midnight for fresh daily specials.
 */
export async function fnbGetDailySpecials(args: any): Promise<MCPToolResult> {
  const profileId = args._profileId || 'makan-moments';

  const cached = getSpecialsCache(profileId);
  if (cached) return { content: [{ type: 'text', text: cached }] };

  // Try dedicated specials endpoint first
  let result = await callFnbMcp('fnb_get_daily_specials', {});

  // Fallback: use fnb_get_menu with isSpecial filter if dedicated endpoint returns error
  if (result.isError) {
    result = await callFnbMcp('fnb_get_menu', { is_special: true });
  }

  if (!result.isError) {
    const text = result.content[0]?.text || '';
    if (text) {
      const formatted = formatSpecialsResponse(text);
      setSpecialsCache(profileId, formatted);
      return { content: [{ type: 'text', text: formatted }] };
    }
  }

  return result;
}

/**
 * Format the specials response to highlight urgency and pricing.
 * Adds urgency indicators for limited-quantity items.
 */
function formatSpecialsResponse(text: string): string {
  // Add urgency markers for limited quantity mentions
  return text
    .replace(/only\s+(\d+)\s+left/gi, '⚡ Only $1 left today')
    .replace(/limited\s+(?:to\s+)?(\d+)/gi, '⚡ Limited to $1')
    .replace(/(\d+)\s+(?:portion|serving|item)s?\s+(?:only|left|remaining)/gi, '⚡ $1 $2 only');
}

// ─── Structured Menu Item Fetch (for disambiguation) ──────────────────────────

function normalizeChoices(raw: any[]): import('../assistant/disambiguation-store.js').SetMealChoice[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const choices = raw
    .filter(c => c && (c.name || c.group || c.label) && Array.isArray(c.options))
    .map(c => ({
      name: String(c.name || c.group || c.label),
      options: (c.options as any[]).map((o: any) => typeof o === 'string' ? o : String(o.name || o.label || o)),
    }))
    .filter(c => c.options.length > 0);
  return choices.length > 0 ? choices : undefined;
}

function normalizeItems(raw: any[]): DisambiguationCandidate[] {
  return raw
    .filter(r => r && (r.name || r.item_name || r.title))
    .map(r => ({
      code: r.code || r.item_code || r.sku || undefined,
      name: String(r.name || r.item_name || r.title),
      price: typeof r.price === 'number' ? r.price
        : typeof r.selling_price === 'number' ? r.selling_price
        : typeof r.rate === 'number' ? r.rate
        : undefined,
      category: r.category || r.item_group || r.group || undefined,
      available: typeof r.available === 'boolean' ? r.available : undefined,
      choices: normalizeChoices(r.choices || r.components || r.customizations),
    }));
}

/**
 * Parse menu items from a plain-text menu listing.
 * Handles common formats like "Item Name - RM 8.50" or "NR01 Nasi Lemak RM8.50".
 */
function parseMenuFromText(text: string): DisambiguationCandidate[] {
  const items: DisambiguationCandidate[] = [];
  const lines = text.split('\n');

  // Pattern: optional code, name, optional price
  const lineRe = /^(?:([A-Z]{1,4}\d{1,4})\s+)?([A-Za-z][^–\-|RM\n]{2,50?}?)(?:[–\-|]\s*RM\s*([\d.]+))?/;

  for (const line of lines) {
    const trimmed = line.replace(/[*#`]/g, '').trim();
    if (trimmed.length < 3) continue;

    const m = lineRe.exec(trimmed);
    if (!m) continue;

    const name = m[2].trim();
    if (name.length < 2 || /^(category|menu|item|food|drink)/i.test(name)) continue;

    const price = m[3] ? parseFloat(m[3]) : undefined;
    const code = m[1] || undefined;

    items.push({ code, name, price });
  }

  return items;
}

/**
 * Fetch menu items as structured data for fuzzy disambiguation.
 *
 * Tries multiple response shapes from the FnB MCP:
 *   - Array of items
 *   - { items: [...] }
 *   - { data: [...] }
 *   - { menu: [...] }
 *   - MCP content format (text parsed with regex)
 */
export async function fetchMenuItems(category?: string): Promise<DisambiguationCandidate[]> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (FNB_MCP_SECRET) headers['x-mcp-secret'] = FNB_MCP_SECRET;

    const input: Record<string, any> = {};
    if (category) input.category = category;

    const res = await fetch(FNB_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: 'fnb_get_menu', input }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = await res.json();

    if (Array.isArray(data)) return normalizeItems(data);
    if (Array.isArray(data.items)) return normalizeItems(data.items);
    if (Array.isArray(data.data)) return normalizeItems(data.data);
    if (Array.isArray(data.menu)) return normalizeItems(data.menu);
    if (Array.isArray(data.message?.items)) return normalizeItems(data.message.items);

    // MCP content format — parse text
    if (Array.isArray(data.content)) {
      const text = data.content.map((c: any) => c.text || '').join('\n');
      return parseMenuFromText(text);
    }

    return [];
  } catch {
    return [];
  }
}
