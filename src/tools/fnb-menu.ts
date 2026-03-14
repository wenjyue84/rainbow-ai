import { MCPTool, MCPToolResult } from '../types/mcp.js';

const FNB_MCP_URL = process.env.FNB_MCP_URL || 'http://localhost:3031/api/mcp';
const FNB_MCP_SECRET = process.env.FNB_MCP_SECRET || '';

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
      const text = await res.text();
      return {
        content: [{ type: 'text', text: `FnB MCP error (${res.status}): ${text}` }],
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
      content: [{ type: 'text', text: `FnB MCP connection error: ${error.message}` }],
      isError: true
    };
  }
}

export async function fnbGetMenu(args: any): Promise<MCPToolResult> {
  const input: Record<string, any> = {};
  if (args.category) input.category = args.category;
  return callFnbMcp('fnb_get_menu', input);
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
