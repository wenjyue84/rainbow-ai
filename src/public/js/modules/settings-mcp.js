/**
 * settings-mcp.js — MCP Servers tab for Settings page
 * (Single Responsibility: MCP client connections + server configuration)
 *
 * Follows the same SRP pattern as settings-ai-models.js.
 */
import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

/**
 * Shared state accessors — injected by settings.js coordinator
 */
let _getSettingsData = () => null;
let _setSettingsData = () => {};

export function initMcpState(getter, setter) {
  _getSettingsData = getter;
  _setSettingsData = setter;
}

// ─── Main Renderer ─────────────────────────────────────────────────

export async function renderMcpServersTab(container) {
  container.innerHTML = '<div class="p-8 text-center"><div class="spinner mx-auto"></div><p class="text-sm text-neutral-500 mt-2">Loading MCP configuration...</p></div>';

  try {
    const data = await api('/mcp-servers');
    const connections = data.connections || [];
    const server = data.server || {};
    const toolCount = data.toolCount || 0;

    container.innerHTML = renderConnectionsSection(connections) + renderServerSection(server, toolCount);

    // Load server tools list
    loadServerTools();
  } catch (e) {
    container.innerHTML = '<div class="p-8 text-center text-danger-500">Failed to load MCP configuration: ' + esc(e.message) + '</div>';
  }
}
window.renderMcpServersTab = renderMcpServersTab;

// ─── Section 1: External Connections ────────────────────────────────

function renderConnectionsSection(connections) {
  const connectionCards = connections.length === 0
    ? '<div class="p-6 text-center text-neutral-400 border border-dashed rounded-xl"><p class="text-sm">No external MCP servers configured.</p><p class="text-xs mt-1">Add a connection to extend Rainbow with external tools (e.g. PMS, FNB systems).</p></div>'
    : connections.map(c => renderConnectionCard(c)).join('');

  return '<div class="bg-white border rounded-2xl p-6 mb-6">' +
    '<div class="flex items-start justify-between mb-4">' +
      '<div>' +
        '<h3 class="font-semibold text-lg">External Connections</h3>' +
        '<p class="text-sm text-neutral-500 font-medium">MCP servers that Rainbow connects to as a client. Extends available tools during conversations.</p>' +
      '</div>' +
      '<button onclick="addMcpConnection()" class="text-sm bg-primary-50 hover:bg-primary-100 text-primary-600 border border-primary-200 px-3 py-1.5 rounded-lg transition font-medium flex items-center gap-2 flex-shrink-0">' +
        '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>' +
        'Add Connection' +
      '</button>' +
    '</div>' +
    '<div id="mcp-connections-list" class="space-y-3">' + connectionCards + '</div>' +
    '<div id="mcp-connection-form" class="hidden mt-4"></div>' +
  '</div>';
}

function renderConnectionCard(c) {
  var statusBadge = c.enabled
    ? '<span class="text-xs text-success-600 font-medium bg-success-50 px-2 py-0.5 rounded border border-success-200 inline-flex items-center gap-1">Enabled</span>'
    : '<span class="text-xs text-neutral-400 font-medium bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200 inline-flex items-center gap-1">Disabled</span>';

  var transportBadge = '<span class="text-[10px] font-mono bg-neutral-200 text-neutral-600 px-1.5 py-0.5 rounded uppercase tracking-wider">' + esc(c.transport || 'sse') + '</span>';

  var authBadge = c.auth_type === 'bearer'
    ? '<span class="text-[10px] font-mono bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase tracking-wider">Bearer Auth</span>'
    : '<span class="text-[10px] font-mono bg-neutral-100 text-neutral-500 px-1.5 py-0.5 rounded uppercase tracking-wider">No Auth</span>';

  return '<div class="border rounded-2xl p-4 hover:border-primary-200 transition-colors bg-neutral-50/50" data-mcp-id="' + esc(c.id) + '">' +
    '<div class="flex items-start justify-between gap-4">' +
      '<div class="flex items-start gap-3 flex-1">' +
        '<div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">' +
          '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>' +
        '</div>' +
        '<div>' +
          '<div class="flex items-center gap-2 flex-wrap">' +
            '<span class="font-bold text-neutral-800">' + esc(c.name) + '</span>' +
            '<span class="text-[10px] font-mono bg-neutral-200 text-neutral-600 px-1.5 py-0.5 rounded uppercase tracking-wider">' + esc(c.id) + '</span>' +
            transportBadge +
            authBadge +
          '</div>' +
          (c.description ? '<p class="text-xs text-neutral-500 mt-1">' + esc(c.description) + '</p>' : '') +
          '<p class="text-xs text-neutral-400 mt-1 font-mono truncate max-w-md">' + esc(c.url) + '</p>' +
          '<div class="flex items-center gap-2 mt-2">' + statusBadge +
            '<span id="mcp-test-status-' + esc(c.id) + '" class="text-xs text-neutral-400 hidden"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="flex flex-col items-end gap-2 flex-shrink-0">' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-xs font-medium ' + (c.enabled ? 'text-primary-600' : 'text-neutral-400') + '">' + (c.enabled ? 'Active' : 'Off') + '</span>' +
          '<input type="checkbox" class="w-10 h-6 rounded-full border-neutral-300 text-primary-600 focus:ring-primary-500 transition cursor-pointer appearance-none bg-neutral-200 checked:bg-primary-500 relative after:content-[\'\'] after:absolute after:top-1 after:left-1 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all checked:after:translate-x-4" ' +
            (c.enabled ? 'checked' : '') + ' onchange="toggleMcpConnection(\'' + esc(c.id) + '\', this.checked)">' +
        '</div>' +
        '<div class="flex gap-1.5">' +
          '<button onclick="testMcpConnection(\'' + esc(c.id) + '\')" class="text-[10px] bg-white hover:bg-neutral-50 border border-neutral-200 text-neutral-600 px-2 py-1 rounded transition flex items-center gap-1 font-medium">' +
            '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>' +
            'Test' +
          '</button>' +
          '<button onclick="editMcpConnection(\'' + esc(c.id) + '\')" class="text-[10px] bg-white hover:bg-neutral-50 border border-neutral-200 text-neutral-600 px-2 py-1 rounded transition font-medium">Edit</button>' +
          '<button onclick="removeMcpConnection(\'' + esc(c.id) + '\')" class="text-[10px] bg-white hover:bg-danger-50 border border-neutral-200 hover:border-danger-200 text-neutral-600 hover:text-danger-600 px-2 py-1 rounded transition font-medium">Remove</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>';
}

// ─── Section 2: Rainbow MCP Server ──────────────────────────────────

function renderServerSection(server, toolCount) {
  var enabledChecked = server.enabled ? 'checked' : '';
  var authOptions = '<option value="none"' + (server.auth_type !== 'bearer' ? ' selected' : '') + '>None</option>' +
    '<option value="bearer"' + (server.auth_type === 'bearer' ? ' selected' : '') + '>Bearer Token</option>';

  return '<div class="bg-white border rounded-2xl p-6">' +
    '<div class="flex items-start justify-between mb-4">' +
      '<div class="flex items-center gap-3">' +
        '<div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">' +
          '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2"/></svg>' +
        '</div>' +
        '<div>' +
          '<h3 class="font-semibold text-lg">Rainbow MCP Server</h3>' +
          '<p class="text-sm text-neutral-500 font-medium">Expose Rainbow\'s ' + toolCount + ' tools as an MCP server for external systems to call.</p>' +
        '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2">' +
        '<span class="text-xs font-medium ' + (server.enabled ? 'text-emerald-600' : 'text-neutral-400') + '">' + (server.enabled ? 'Running' : 'Stopped') + '</span>' +
        '<input type="checkbox" class="w-10 h-6 rounded-full border-neutral-300 text-emerald-600 focus:ring-emerald-500 transition cursor-pointer appearance-none bg-neutral-200 checked:bg-emerald-500 relative after:content-[\'\'] after:absolute after:top-1 after:left-1 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all checked:after:translate-x-4" ' +
          enabledChecked + ' onchange="toggleMcpServer(this.checked)">' +
      '</div>' +
    '</div>' +

    '<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">Port</label>' +
        '<input type="number" id="mcp-server-port" value="' + (server.port || 3003) + '" min="1024" max="65535" class="w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500" onchange="saveMcpServerConfig()">' +
      '</div>' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">Authentication</label>' +
        '<select id="mcp-server-auth" class="w-full border rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500" onchange="saveMcpServerConfig()">' +
          authOptions +
        '</select>' +
      '</div>' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">API Key Env Var</label>' +
        '<input type="text" id="mcp-server-key-env" value="' + esc(server.api_key_env || 'RAINBOW_MCP_KEY') + '" placeholder="RAINBOW_MCP_KEY" class="w-full border rounded-xl px-3 py-2 text-sm font-mono bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500" onchange="saveMcpServerConfig()">' +
      '</div>' +
    '</div>' +

    '<div>' +
      '<label class="block text-xs text-neutral-500 mb-2">Exposed Tools</label>' +
      '<div id="mcp-server-tools-list" class="border rounded-xl p-3 bg-neutral-50 max-h-48 overflow-y-auto">' +
        '<p class="text-xs text-neutral-400">Loading tools...</p>' +
      '</div>' +
    '</div>' +
  '</div>';
}

async function loadServerTools() {
  try {
    const data = await api('/mcp-servers/server-tools');
    const toolsList = document.getElementById('mcp-server-tools-list');
    if (!toolsList) return;

    if (!data.tools || data.tools.length === 0) {
      toolsList.innerHTML = '<p class="text-xs text-neutral-400">No tools registered.</p>';
      return;
    }

    toolsList.innerHTML = '<div class="flex items-center justify-between mb-2">' +
      '<span class="text-xs font-medium text-neutral-600">' + data.count + ' tools available</span>' +
    '</div>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-1">' +
    data.tools.map(function(t) {
      return '<div class="text-xs py-1 px-2 rounded bg-white border flex items-center gap-2">' +
        '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0"></span>' +
        '<span class="font-mono text-neutral-700">' + esc(t.name) + '</span>' +
        '<span class="text-neutral-400 truncate">' + esc(t.description || '').substring(0, 60) + '</span>' +
      '</div>';
    }).join('') +
    '</div>';
  } catch (e) {
    var toolsList = document.getElementById('mcp-server-tools-list');
    if (toolsList) toolsList.innerHTML = '<p class="text-xs text-danger-500">Failed to load tools</p>';
  }
}

// ─── Connection CRUD ────────────────────────────────────────────────

export function addMcpConnection() {
  var formContainer = document.getElementById('mcp-connection-form');
  if (!formContainer) return;
  formContainer.classList.remove('hidden');
  formContainer.innerHTML = renderConnectionForm();
}
window.addMcpConnection = addMcpConnection;

export function editMcpConnection(id) {
  // Fetch current data and show form pre-filled
  api('/mcp-servers').then(function(data) {
    var conn = (data.connections || []).find(function(c) { return c.id === id; });
    if (!conn) { toast('Connection not found', 'error'); return; }
    var formContainer = document.getElementById('mcp-connection-form');
    if (!formContainer) return;
    formContainer.classList.remove('hidden');
    formContainer.innerHTML = renderConnectionForm(conn);
  }).catch(function(e) { toast(e.message, 'error'); });
}
window.editMcpConnection = editMcpConnection;

function renderConnectionForm(existing) {
  var isEdit = !!existing;
  var title = isEdit ? 'Edit Connection' : 'Add Connection';
  var idDisabled = isEdit ? 'disabled' : '';
  var c = existing || { id: '', name: '', description: '', url: '', transport: 'sse', auth_type: 'none', api_key_env: '' };

  return '<div class="border rounded-2xl p-5 bg-gradient-to-br from-primary-50/50 to-indigo-50/50">' +
    '<h4 class="font-semibold text-neutral-800 mb-4">' + title + '</h4>' +
    '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">ID</label>' +
        '<input type="text" id="mcp-form-id" value="' + esc(c.id) + '" placeholder="e.g. pms2" class="w-full border rounded-xl px-3 py-2 text-sm font-mono" ' + idDisabled + '>' +
      '</div>' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">Name</label>' +
        '<input type="text" id="mcp-form-name" value="' + esc(c.name) + '" placeholder="e.g. PMS2 Property Management" class="w-full border rounded-xl px-3 py-2 text-sm">' +
      '</div>' +
      '<div class="md:col-span-2">' +
        '<label class="block text-xs text-neutral-500 mb-1">Description</label>' +
        '<input type="text" id="mcp-form-description" value="' + esc(c.description) + '" placeholder="Brief description of what this server provides" class="w-full border rounded-xl px-3 py-2 text-sm">' +
      '</div>' +
      '<div class="md:col-span-2">' +
        '<label class="block text-xs text-neutral-500 mb-1">URL</label>' +
        '<input type="text" id="mcp-form-url" value="' + esc(c.url) + '" placeholder="http://localhost:8080/mcp/sse" class="w-full border rounded-xl px-3 py-2 text-sm font-mono">' +
      '</div>' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">Transport</label>' +
        '<select id="mcp-form-transport" class="w-full border rounded-xl px-3 py-2 text-sm">' +
          '<option value="sse"' + (c.transport !== 'stdio' ? ' selected' : '') + '>SSE (HTTP)</option>' +
          '<option value="stdio"' + (c.transport === 'stdio' ? ' selected' : '') + '>Stdio</option>' +
        '</select>' +
      '</div>' +
      '<div>' +
        '<label class="block text-xs text-neutral-500 mb-1">Authentication</label>' +
        '<select id="mcp-form-auth" class="w-full border rounded-xl px-3 py-2 text-sm">' +
          '<option value="none"' + (c.auth_type !== 'bearer' ? ' selected' : '') + '>None</option>' +
          '<option value="bearer"' + (c.auth_type === 'bearer' ? ' selected' : '') + '>Bearer Token</option>' +
        '</select>' +
      '</div>' +
      '<div class="md:col-span-2">' +
        '<label class="block text-xs text-neutral-500 mb-1">API Key Env Var</label>' +
        '<input type="text" id="mcp-form-key-env" value="' + esc(c.api_key_env) + '" placeholder="e.g. PMS2_API_KEY (reads from server env)" class="w-full border rounded-xl px-3 py-2 text-sm font-mono">' +
      '</div>' +
    '</div>' +
    '<div class="flex justify-end gap-2 mt-4">' +
      '<button onclick="cancelMcpConnectionForm()" class="text-sm text-neutral-600 hover:text-neutral-800 border px-4 py-2 rounded-lg transition">Cancel</button>' +
      '<button onclick="saveMcpConnection(' + (isEdit ? '\'' + esc(c.id) + '\'' : '') + ')" class="text-sm bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg transition font-medium">Save</button>' +
    '</div>' +
  '</div>';
}

export function cancelMcpConnectionForm() {
  var formContainer = document.getElementById('mcp-connection-form');
  if (formContainer) {
    formContainer.classList.add('hidden');
    formContainer.innerHTML = '';
  }
}
window.cancelMcpConnectionForm = cancelMcpConnectionForm;

export async function saveMcpConnection(existingId) {
  var id = existingId || (document.getElementById('mcp-form-id')?.value || '').trim();
  var name = (document.getElementById('mcp-form-name')?.value || '').trim();
  var description = (document.getElementById('mcp-form-description')?.value || '').trim();
  var url = (document.getElementById('mcp-form-url')?.value || '').trim();
  var transport = document.getElementById('mcp-form-transport')?.value || 'sse';
  var auth_type = document.getElementById('mcp-form-auth')?.value || 'none';
  var api_key_env = (document.getElementById('mcp-form-key-env')?.value || '').trim();

  if (!id || !name || !url) {
    toast('ID, Name, and URL are required', 'error');
    return;
  }

  try {
    if (existingId) {
      await api('/mcp-servers/' + existingId, {
        method: 'PATCH',
        body: { name, description, url, transport, auth_type, api_key_env }
      });
      toast('Connection updated');
    } else {
      await api('/mcp-servers', {
        method: 'POST',
        body: { id, name, description, url, transport, auth_type, api_key_env, enabled: true }
      });
      toast('Connection added');
    }
    // Refresh
    var container = document.getElementById('settings-tab-content');
    if (container) renderMcpServersTab(container);
  } catch (e) {
    toast(e.message || 'Failed to save connection', 'error');
  }
}
window.saveMcpConnection = saveMcpConnection;

export async function removeMcpConnection(id) {
  if (!confirm('Remove MCP connection "' + id + '"?')) return;
  try {
    await api('/mcp-servers/' + id, { method: 'DELETE' });
    toast('Connection removed');
    var container = document.getElementById('settings-tab-content');
    if (container) renderMcpServersTab(container);
  } catch (e) {
    toast(e.message || 'Failed to remove connection', 'error');
  }
}
window.removeMcpConnection = removeMcpConnection;

export async function testMcpConnection(id) {
  var badge = document.getElementById('mcp-test-status-' + id);
  if (badge) {
    badge.classList.remove('hidden', 'text-success-600', 'text-danger-500');
    badge.classList.add('text-neutral-400', 'animate-pulse');
    badge.textContent = 'Testing...';
  }
  try {
    var result = await api('/mcp-servers/' + id + '/test', { method: 'POST' });
    if (badge) {
      badge.classList.remove('animate-pulse', 'text-neutral-400');
      if (result.reachable) {
        badge.classList.add('text-success-600');
        badge.textContent = 'Reachable (' + result.status + ')';
      } else {
        badge.classList.add('text-danger-500');
        badge.textContent = result.error || 'Unreachable';
      }
    }
  } catch (e) {
    if (badge) {
      badge.classList.remove('animate-pulse', 'text-neutral-400');
      badge.classList.add('text-danger-500');
      badge.textContent = e.message || 'Test failed';
    }
  }
}
window.testMcpConnection = testMcpConnection;

export async function toggleMcpConnection(id, enabled) {
  try {
    await api('/mcp-servers/' + id, { method: 'PATCH', body: { enabled } });
    toast('Connection ' + id + ': ' + (enabled ? 'enabled' : 'disabled'));
  } catch (e) {
    toast(e.message, 'error');
  }
}
window.toggleMcpConnection = toggleMcpConnection;

// ─── Server Config ──────────────────────────────────────────────────

export async function saveMcpServerConfig() {
  var port = parseInt(document.getElementById('mcp-server-port')?.value || '3003', 10);
  var auth_type = document.getElementById('mcp-server-auth')?.value || 'none';
  var api_key_env = (document.getElementById('mcp-server-key-env')?.value || '').trim();

  try {
    await api('/mcp-servers/server-config', {
      method: 'PATCH',
      body: { port, auth_type, api_key_env }
    });
    toast('MCP server config saved');
  } catch (e) {
    toast(e.message || 'Failed to save server config', 'error');
  }
}
window.saveMcpServerConfig = saveMcpServerConfig;

export async function toggleMcpServer(enabled) {
  try {
    await api('/mcp-servers/server-config', {
      method: 'PATCH',
      body: { enabled }
    });
    toast('MCP server ' + (enabled ? 'enabled' : 'disabled'));
  } catch (e) {
    toast(e.message, 'error');
  }
}
window.toggleMcpServer = toggleMcpServer;
