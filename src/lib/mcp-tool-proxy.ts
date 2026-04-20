/**
 * mcp-tool-proxy.ts — Wraps external MCP tools as local ToolHandlers
 *
 * Converts MCPTool[] from a remote MCP server into the Map<string, ToolHandler>
 * format expected by chatWithToolsLoop / streamChatWithTools.
 */

import type { MCPTool, MCPToolResult, ToolHandler } from '../types/mcp.js';
import type { McpConnection } from './mcp-client.js';
import { callMcpTool, invalidateMcpResultCache } from './mcp-client.js';

// Patterns matching mutating tools — mirrors WRITE_TOOL_PATTERNS in mcp-client.ts
const _WRITE_PATTERN = /create|update|delete|check.?in|check.?out|mark|set_|add_|remove|cancel|upsert|patch|put_/i;

// Max chars of tool result text injected into LLM context (~500 tokens).
// Prevents oversized PMS payloads from bloating the context window.
const MAX_TOOL_RESULT_CHARS = 2000;

function _trimToolText(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return text.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[truncated, ${text.length - MAX_TOOL_RESULT_CHARS} chars omitted]`;
}

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
        // Bust the result cache for this connection after a successful write
        if (_WRITE_PATTERN.test(tool.name)) {
          invalidateMcpResultCache(conn.id);
        }
        // Remote servers may already return an MCPToolResult-shaped object
        if (result && typeof result === 'object' && Array.isArray((result as any).content)) {
          const mcp = result as MCPToolResult;
          // Trim oversized text content blocks
          return {
            ...mcp,
            content: mcp.content.map(block =>
              block.type === 'text' ? { ...block, text: _trimToolText(block.text) } : block
            ),
          };
        }
        const raw = typeof result === 'string' ? result : JSON.stringify(result);
        return {
          content: [{ type: 'text', text: _trimToolText(raw) }],
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
