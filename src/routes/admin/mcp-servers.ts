import { Router } from 'express';
import type { Request, Response } from 'express';
import { ok, badRequest, notFound, getStore } from './http-utils.js';
import { toolRegistry } from '../../tools/registry.js';
import type { McpConnection } from '../../lib/mcp-client.js';

export type { McpConnection };

const router = Router();

interface McpSettings {
  connections: McpConnection[];
}

function getMcpSettings(res: Response): McpSettings {
  const settings = getStore(res).getSettings();
  return (settings as any).mcp_servers || { connections: [] };
}

function saveMcpSettings(res: Response, mcpSettings: McpSettings): void {
  const settings = getStore(res).getSettings();
  (settings as any).mcp_servers = mcpSettings;
  getStore(res).setSettings(settings);
}

/**
 * Returns all enabled MCP client connections for a given config store.
 * Used by the chat pipeline to inject external tools at message-processing time.
 */
export function getActiveMcpConnections(configStore: { getSettings(): any }): McpConnection[] {
  const mcpSettings: McpSettings = configStore.getSettings().mcp_servers || { connections: [] };
  return (mcpSettings.connections ?? []).filter((c: McpConnection) => c.enabled);
}

// ─── Client Connections ─────────────────────────────────────────────

router.get('/mcp-servers', (_req: Request, res: Response) => {
  const mcp = getMcpSettings(res);
  res.json({
    connections: mcp.connections,
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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (conn.auth_type === 'bearer' && conn.api_key_env) {
      const key = process.env[conn.api_key_env];
      if (key) headers['Authorization'] = `Bearer ${key}`;
    }
    const response = await fetch(conn.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      ok(res, { status: response.status, statusText: response.statusText, reachable: false });
      return;
    }
    const json = await response.json() as any;
    const toolCount = json.result?.tools?.length ?? 0;
    ok(res, { status: response.status, reachable: true, toolCount });
  } catch (err: any) {
    const message = err.name === 'AbortError' ? 'Connection timed out (5s)' : err.message;
    res.json({ ok: false, error: message, reachable: false });
  }
});

export default router;
