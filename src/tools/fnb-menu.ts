import { MCPTool, MCPToolResult } from '../types/mcp.js';
import type { DisambiguationCandidate } from '../assistant/disambiguation-store.js';

const FNB_MCP_URL = process.env.FNB_MCP_URL || 'http://localhost:3031/api/mcp';
const FNB_MCP_SECRET = process.env.FNB_MCP_SECRET || '';

// ─── Menu Response Cache (5-minute TTL per profile+category) ─────────────────
const MENU_CACHE_TTL_MS = 5 * 60 * 1000;
interface MenuCacheEntry { text: string; expiresAt: number; }
const menuCache = new Map<string, MenuCacheEntry>();

function getMenuCacheKey(profileId: string, category?: string): string {
  return `${profileId}::${category || '__all__'}`;
}

function getMenuCache(profileId: string, category?: string): string | undefined {
  const entry = menuCache.get(getMenuCacheKey(profileId, category));
  if (entry && Date.now() < entry.expiresAt) return entry.text;
  return undefined;
}

function setMenuCache(profileId: string, text: string, category?: string): void {
  menuCache.set(getMenuCacheKey(profileId, category), { text, expiresAt: Date.now() + MENU_CACHE_TTL_MS });
}

// Re-export for convenience
export type { DisambiguationCandidate as MenuItem };

export const fnbMenuTools: MCPTool[] = [
  {
    name: 'fnb_get_menu',
    description: 'Get the full cafe menu. Optionally filter by category.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Category to filter by (optional)' }
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
  const cached = getMenuCache(profileId, category);
  if (cached) return { content: [{ type: 'text', text: cached }] };

  const input: Record<string, any> = {};
  if (category) input.category = category;
  const result = await callFnbMcp('fnb_get_menu', input);
  if (!result.isError) {
    const text = result.content[0]?.text || '';
    if (text) setMenuCache(profileId, text, category);
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

// ─── Structured Menu Item Fetch (for disambiguation) ──────────────────────────

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
