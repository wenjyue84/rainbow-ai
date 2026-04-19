/**
 * mcp-tool-proxy.ts — Wraps external MCP tools as local ToolHandlers
 *
 * Converts MCPTool[] from a remote MCP server into the Map<string, ToolHandler>
 * format expected by chatWithToolsLoop / streamChatWithTools.
 */

import type { MCPTool, MCPToolResult, ToolHandler } from '../types/mcp.js';
import type { McpConnection } from './mcp-client.js';
import { callMcpTool } from './mcp-client.js';

/**
 * Build a handler map for all tools exposed by an external MCP connection.
 * Each handler proxies the call to the remote server and normalises the result
 * into the MCPToolResult shape that chatWithToolsLoop expects.
 */
export function buildExternalToolHandlers(
  conn: McpConnection,
  tools: MCPTool[]
): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();

  for (const tool of tools) {
    handlers.set(tool.name, async (args: any): Promise<MCPToolResult> => {
      try {
        const result = await callMcpTool(conn, tool.name, args ?? {});
        // Remote servers may already return an MCPToolResult-shaped object
        if (result && typeof result === 'object' && Array.isArray((result as any).content)) {
          return result as MCPToolResult;
        }
        return {
          content: [{
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result),
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text', text: `Tool error (${tool.name}): ${err.message}` }],
          isError: true,
        };
      }
    });
  }

  return handlers;
}
