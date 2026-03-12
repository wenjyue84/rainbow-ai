/**
 * Rainbow MCP Server — exposes toolRegistry tools via HTTP/SSE MCP protocol.
 *
 * Reads config from settings.json → mcp_servers.server.
 * Started/stopped from src/index.ts based on config.
 */
import express from 'express';
import type { Request, Response } from 'express';
import { createServer, type Server } from 'http';
import { toolRegistry } from './tools/registry.js';
import { configStore } from './assistant/config-store.js';

let httpServer: Server | null = null;

interface McpServerConfig {
  enabled: boolean;
  port: number;
  auth_type: 'none' | 'bearer';
  api_key_env: string;
  expose_tools: 'all' | string[];
}

function getServerConfig(): McpServerConfig {
  const settings = configStore.getSettings() as any;
  return settings.mcp_servers?.server || {
    enabled: false,
    port: 3003,
    auth_type: 'none',
    api_key_env: 'RAINBOW_MCP_KEY',
    expose_tools: 'all'
  };
}

function bearerAuth(req: Request, res: Response, config: McpServerConfig): boolean {
  if (config.auth_type !== 'bearer') return true;
  const key = process.env[config.api_key_env];
  if (!key) return true; // No key configured = open access
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  if (auth.slice(7) !== key) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

export function startMcpServer(): void {
  const config = getServerConfig();
  if (!config.enabled) return;
  if (httpServer) return; // Already running

  const app = express();
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', tools: toolRegistry.getToolCount().total });
  });

  // MCP tools/list
  app.get('/mcp/tools/list', (req, res) => {
    if (!bearerAuth(req, res, config)) return;
    const tools = toolRegistry.listTools();
    const filtered = config.expose_tools === 'all'
      ? tools
      : tools.filter(t => (config.expose_tools as string[]).includes(t.name));
    res.json({ tools: filtered });
  });

  // MCP tools/call
  app.post('/mcp/tools/call', async (req, res) => {
    if (!bearerAuth(req, res, config)) return;
    const { name, arguments: args } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Tool name required' });
      return;
    }
    const result = await toolRegistry.executeTool(name, args || {});
    res.json(result);
  });

  // SSE endpoint for MCP protocol
  app.get('/mcp/sse', (req, res) => {
    if (!bearerAuth(req, res, config)) return;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send initial capabilities
    const capabilities = {
      jsonrpc: '2.0',
      method: 'capabilities',
      params: {
        tools: toolRegistry.listTools().map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema
        }))
      }
    };
    res.write(`data: ${JSON.stringify(capabilities)}\n\n`);

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });
  });

  httpServer = createServer(app);
  httpServer.listen(config.port, () => {
    console.log(`[MCP Server] Rainbow MCP server listening on port ${config.port}`);
  });
}

export function stopMcpServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
    console.log('[MCP Server] Rainbow MCP server stopped');
  }
}

export function restartMcpServer(): void {
  stopMcpServer();
  startMcpServer();
}
