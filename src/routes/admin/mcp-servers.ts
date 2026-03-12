import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, notFound, getStore } from './http-utils.js';
import { toolRegistry } from '../../tools/registry.js';

const router = Router();

// ─── Types ──────────────────────────────────────────────────────────

interface McpConnection {
  id: string;
  name: string;
  description: string;
  url: string;
  transport: 'sse' | 'stdio';
  auth_type: 'none' | 'bearer';
  api_key_env: string;
  enabled: boolean;
}

interface McpServerConfig {
  enabled: boolean;
  port: number;
  auth_type: 'none' | 'bearer';
  api_key_env: string;
  expose_tools: 'all' | string[];
}

interface McpSettings {
  connections: McpConnection[];
  server: McpServerConfig;
}

function getMcpSettings(res: Response): McpSettings {
  const settings = getStore(res).getSettings();
  return (settings as any).mcp_servers || {
    connections: [],
    server: {
      enabled: false,
      port: 3003,
      auth_type: 'none',
      api_key_env: 'RAINBOW_MCP_KEY',
      expose_tools: 'all'
    }
  };
}

function saveMcpSettings(res: Response, mcpSettings: McpSettings): void {
  const settings = getStore(res).getSettings();
  (settings as any).mcp_servers = mcpSettings;
  getStore(res).setSettings(settings);
}

// ─── Server Config (static routes BEFORE parameterized /:id) ────────

router.get('/mcp-servers/server-config', (_req: Request, res: Response) => {
  const mcp = getMcpSettings(res);
  res.json(mcp.server);
});

router.patch('/mcp-servers/server-config', (req: Request, res: Response) => {
  const mcp = getMcpSettings(res);
  if (req.body.enabled !== undefined) mcp.server.enabled = req.body.enabled;
  if (req.body.port !== undefined) mcp.server.port = req.body.port;
  if (req.body.auth_type !== undefined) mcp.server.auth_type = req.body.auth_type;
  if (req.body.api_key_env !== undefined) mcp.server.api_key_env = req.body.api_key_env;
  if (req.body.expose_tools !== undefined) mcp.server.expose_tools = req.body.expose_tools;
  saveMcpSettings(res, mcp);
  ok(res, { server: mcp.server });
});

router.get('/mcp-servers/server-tools', (_req: Request, res: Response) => {
  const tools = toolRegistry.listTools().map(t => ({
    name: t.name,
    description: t.description
  }));
  res.json({ tools, count: tools.length });
});

// ─── Client Connections ─────────────────────────────────────────────

router.get('/mcp-servers', (_req: Request, res: Response) => {
  const mcp = getMcpSettings(res);
  res.json({
    connections: mcp.connections,
    server: mcp.server,
    toolCount: toolRegistry.getToolCount().total
  });
});

router.post('/mcp-servers', (req: Request, res: Response) => {
  const { id, name, url, transport, description, auth_type, api_key_env, enabled } = req.body;
  if (!id || !name || !url) {
    badRequest(res, 'id, name, and url required');
    return;
  }
  const mcp = getMcpSettings(res);
  if (mcp.connections.find(c => c.id === id)) {
    res.status(409).json({ error: `Connection "${id}" already exists` });
    return;
  }
  const connection: McpConnection = {
    id: id.trim().toLowerCase().replace(/\s+/g, '-'),
    name: name.trim(),
    description: description || '',
    url: url.trim(),
    transport: transport === 'stdio' ? 'stdio' : 'sse',
    auth_type: auth_type === 'bearer' ? 'bearer' : 'none',
    api_key_env: api_key_env || '',
    enabled: enabled !== false
  };
  mcp.connections.push(connection);
  saveMcpSettings(res, mcp);
  ok(res, { connection });
});

router.patch('/mcp-servers/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const mcp = getMcpSettings(res);
  const conn = mcp.connections.find(c => c.id === id);
  if (!conn) {
    notFound(res, `Connection "${id}"`);
    return;
  }
  if (req.body.name !== undefined) conn.name = req.body.name;
  if (req.body.description !== undefined) conn.description = req.body.description;
  if (req.body.url !== undefined) conn.url = req.body.url;
  if (req.body.transport !== undefined) conn.transport = req.body.transport;
  if (req.body.auth_type !== undefined) conn.auth_type = req.body.auth_type;
  if (req.body.api_key_env !== undefined) conn.api_key_env = req.body.api_key_env;
  if (req.body.enabled !== undefined) conn.enabled = req.body.enabled;
  saveMcpSettings(res, mcp);
  ok(res, { connection: conn });
});

router.delete('/mcp-servers/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const mcp = getMcpSettings(res);
  const idx = mcp.connections.findIndex(c => c.id === id);
  if (idx === -1) {
    notFound(res, `Connection "${id}"`);
    return;
  }
  mcp.connections.splice(idx, 1);
  saveMcpSettings(res, mcp);
  ok(res, { deleted: id });
});

router.post('/mcp-servers/:id/test', async (req: Request, res: Response) => {
  const { id } = req.params;
  const mcp = getMcpSettings(res);
  const conn = mcp.connections.find(c => c.id === id);
  if (!conn) {
    notFound(res, `Connection "${id}"`);
    return;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = { 'Accept': 'text/event-stream' };
    if (conn.auth_type === 'bearer' && conn.api_key_env) {
      const key = process.env[conn.api_key_env];
      if (key) headers['Authorization'] = `Bearer ${key}`;
    }
    const response = await fetch(conn.url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    clearTimeout(timeout);
    ok(res, {
      status: response.status,
      statusText: response.statusText,
      reachable: response.ok || response.status < 500
    });
  } catch (err: any) {
    const message = err.name === 'AbortError' ? 'Connection timed out (5s)' : err.message;
    res.json({ ok: false, error: message, reachable: false });
  }
});

export default router;
