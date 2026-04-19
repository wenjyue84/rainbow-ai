/**
 * mcp-client.ts — HTTP JSON-RPC 2.0 client for external MCP servers
 *
 * Used by Rainbow AI to call tools exposed by PMS2 (and other MCP servers)
 * without having to duplicate tool definitions locally.
 */

import type { MCPTool } from '../types/mcp.js';

export interface McpConnection {
  id: string;
  name: string;
  description?: string;
  url: string;
  transport: 'sse' | 'stdio';
  auth_type: 'none' | 'bearer';
  api_key_env: string;
  enabled: boolean;
}

const MCP_TIMEOUT_MS = 15_000;
const TOOL_CACHE_TTL_MS = 60_000;

const _toolCache = new Map<string, { tools: MCPTool[]; cachedAt: number }>();

function _getAuthHeaders(conn: McpConnection): Record<string, string> {
  if (conn.auth_type === 'bearer' && conn.api_key_env) {
    const key = process.env[conn.api_key_env];
    if (key) return { 'Authorization': `Bearer ${key}` };
  }
  return {};
}

async function _post(conn: McpConnection, body: object): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  try {
    const res = await fetch(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._getAuthHeaders(conn) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status} from MCP server "${conn.name}"`);
    const json = await res.json() as any;
    if (json.error) throw new Error(`MCP error: ${json.error.message ?? JSON.stringify(json.error)}`);
    return json.result;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`MCP server "${conn.name}" timed out after ${MCP_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

/**
 * Fetch the tool list from an external MCP server.
 * Results are cached for 60 seconds to avoid calling tools/list on every chat message.
 */
export async function fetchMcpTools(conn: McpConnection): Promise<MCPTool[]> {
  const cached = _toolCache.get(conn.id);
  if (cached && Date.now() - cached.cachedAt < TOOL_CACHE_TTL_MS) {
    return cached.tools;
  }
  const result = await _post(conn, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) as any;
  const tools = (result?.tools ?? []) as MCPTool[];
  _toolCache.set(conn.id, { tools, cachedAt: Date.now() });
  return tools;
}

/**
 * Execute a named tool on an external MCP server.
 */
export async function callMcpTool(
  conn: McpConnection,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return _post(conn, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}
