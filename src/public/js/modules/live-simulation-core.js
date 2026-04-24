// ═══════════════════════════════════════════════════════════════════
// Live Simulation Core — orchestrator (entry, list, render, SSE)
// ═══════════════════════════════════════════════════════════════════
//
// Forked from real-chat-core for the developer audit view. Renders
// the conversation list, message thread, and inline audit badges,
// and subscribes to /api/rainbow/conversations/events for live
// updates. All trace lookup is O(1) via the prefetched map in
// live-simulation-state.

import { $, resetState } from './live-simulation-state.js';
import { loadConversationBundle, sendLiveSimReply } from './live-simulation-messaging.js';
import { renderInlineBadges } from './live-simulation-badges.js';
import { renderStatsSidebar, passesFilter } from './live-simulation-stats.js';

const api = window.api;
const TEMPLATE_URL = '/public/templates/tabs/live-simulation-dev.html';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtRel(ms) {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return Math.max(1, Math.floor(diff / 1000)) + 's';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h';
  return Math.floor(diff / 86_400_000) + 'd';
}

// ─── Template injection (idempotent) ─────────────────────────────────

async function ensureTemplateInjected() {
  const mount = document.getElementById('ls-mount');
  if (!mount) {
    console.error('[LiveSim] #ls-mount not found — chat-simulator template not loaded?');
    return false;
  }
  if (document.getElementById('ls-root')) return true; // already injected
  try {
    const res = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
    if (!res.ok) {
      mount.innerHTML = '<div style="padding:24px;color:#991b1b;">Failed to load Live Simulation template.</div>';
      return false;
    }
    mount.innerHTML = await res.text();
    return true;
  } catch (err) {
    console.error('[LiveSim] template fetch failed:', err);
    mount.innerHTML = '<div style="padding:24px;color:#991b1b;">Failed to load Live Simulation template: ' + esc(err.message) + '</div>';
    return false;
  }
}

// ─── Conversation list ───────────────────────────────────────────────

function renderConversationList() {
  const list = document.getElementById('ls-conv-list');
  if (!list) return;
  if ($.conversations.length === 0) {
    list.innerHTML = '<div class="ls-empty">No conversations yet.</div>';
    return;
  }
  const searchEl = document.getElementById('ls-conv-search');
  const search = searchEl ? (searchEl.value || '').toLowerCase() : '';
  let filtered = $.conversations.filter((c) =>
    !search
    || (c.pushName || '').toLowerCase().includes(search)
    || (c.phone || '').toLowerCase().includes(search)
    || (c.lastMessage || '').toLowerCase().includes(search)
  );
  if ($.activeFilter === 'unread') {
    filtered = filtered.filter((c) => (c.unreadCount || 0) > 0);
  } else if ($.activeFilter === 'favourites') {
    filtered = filtered.filter((c) => c.favourite);
  } else if ($.activeFilter === 'groups') {
    filtered = filtered.filter((c) => c.phone && c.phone.includes('@g.us'));
  }
  if ($.channelFilter && $.channelFilter !== 'all') {
    filtered = filtered.filter((c) => c.channel === $.channelFilter);
  }
  list.innerHTML = filtered.map((c) => {
    const active = c.phone === $.activePhone ? ' active' : '';
    const initials = (c.pushName || '?').slice(0, 2).toUpperCase();
    const preview = c.lastMessageRole === 'assistant' ? '🤖 ' + (c.lastMessage || '') : (c.lastMessage || '');
    const channelBadge = c.channel === 'webchat'
      ? '<span style="font-size:10px;background:#dbeafe;color:#1d4ed8;border-radius:3px;padding:1px 4px;margin-left:4px;">🌐 Web</span>'
      : '';
    return '<div class="ls-conv-item' + active + '" '
      + 'onclick="window.openLiveSimConversation(\'' + esc(c.phone) + '\')">'
      + '<div class="ls-conv-avatar">' + esc(initials) + '</div>'
      + '<div class="ls-conv-info">'
      + '<div class="ls-conv-name">' + esc(c.pushName || c.phone) + channelBadge + '</div>'
      + '<div class="ls-conv-preview">' + esc(preview) + '</div>'
      + '</div>'
      + '<div class="ls-conv-meta">'
      + '<div class="ls-conv-time">' + esc(fmtRel(c.lastMessageAt)) + '</div>'
      + '<div class="ls-conv-count">' + (c.messageCount || 0) + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
}

// ─── Thread renderer ─────────────────────────────────────────────────

function renderThread() {
  const thread = document.getElementById('ls-thread');
  if (!thread) return;
  if (!$.activePhone || !$.messages.length) {
    thread.innerHTML = '<div class="ls-empty" style="padding:48px 24px;text-align:center;">'
      + 'Select a conversation to inspect its audit trail.</div>';
    return;
  }

  const head = document.getElementById('ls-thread-head');
  if (head) {
    const name = ($.conversations.find((c) => c.phone === $.activePhone) || {}).pushName || $.activePhone;
    head.textContent = name + '  ·  ' + $.activePhone;
  }

  let html = '';
  for (let i = 0; i < $.messages.length; i++) {
    const msg = $.messages[i];
    if (!passesFilter(msg)) continue;

    const isGuest = msg.role === 'user';
    const side = isGuest ? 'guest' : 'bot';
    const trace = $.traceByMessageKey.get(msg.role + ':' + msg.timestamp);
    const badges = isGuest ? '' : renderInlineBadges(msg, trace);
    const isThinkingAck = !isGuest && !msg.manual && msg.action === 'thinking';
    const traceBtn = (!isGuest && !msg.manual && !isThinkingAck)
      ? '<button class="ls-trace-btn" onclick="window.openTraceDrawer(' + i + ')">👉 trace</button>'
      : '';
    const prefix = isGuest ? 'G' : 'B';
    html += '<div class="ls-bubble-wrap ls-' + side + '">'
      + '<div class="ls-bubble ls-' + side + '">'
      + '<div class="ls-bubble-prefix">' + prefix + ':</div>'
      + '<div class="ls-bubble-text">' + esc(msg.content) + '</div>'
      + '<div class="ls-bubble-foot">'
      + '<span class="ls-bubble-time">' + fmtTime(msg.timestamp) + '</span>'
      + traceBtn
      + '</div>'
      + badges
      + '</div>'
      + '</div>';
  }
  thread.innerHTML = html;
  thread.scrollTop = thread.scrollHeight;

  const replyBar = document.getElementById('ls-reply-bar');
  if (replyBar) replyBar.style.display = $.activePhone ? 'flex' : 'none';
}

// ─── Conversation list fetch + open ──────────────────────────────────

async function fetchConversationList() {
  try {
    const convos = await api('/conversations/unified');
    $.conversations = convos || [];
    renderConversationList();
  } catch (err) {
    console.error('[LiveSim] list fetch failed:', err);
  }
}

export async function openLiveSimConversation(phone) {
  try {
    await loadConversationBundle(phone);
    renderConversationList();
    renderThread();
    renderStatsSidebar();
    updateRefreshLabel();
  } catch (err) {
    console.error('[LiveSim] failed to open conversation:', err);
  }
}

// ─── Refresh label ───────────────────────────────────────────────────

function updateRefreshLabel() {
  const el = document.getElementById('ls-refresh-label');
  if (!el) return;
  if (!$.lastRefreshAt) { el.textContent = ''; return; }
  const diff = Math.floor((Date.now() - $.lastRefreshAt) / 1000);
  el.textContent = diff < 2 ? 'Updated just now' : 'Updated ' + diff + 's ago';
}

// ─── SSE wiring ─────────────────────────────────────────────────────

function connectSSE() {
  if ($.eventSource) return;
  try {
    const url = window.location.origin + '/api/rainbow/conversations/events';
    const es = new EventSource(url);
    $.eventSource = es;
    es.addEventListener('conversation_update', async (e) => {
      try {
        const data = JSON.parse(e.data);
        // Refresh list always; refresh thread only if the event is for the active phone
        await fetchConversationList();
        if ($.activePhone && data && data.phone && data.phone === $.activePhone) {
          await loadConversationBundle($.activePhone);
          renderThread();
          renderStatsSidebar();
        }
        updateRefreshLabel();
      } catch (err) {
        console.warn('[LiveSim] SSE event parse failed:', err);
      }
    });
    es.onerror = () => {
      console.warn('[LiveSim] SSE error — browser will auto-reconnect');
    };
  } catch (err) {
    console.error('[LiveSim] SSE connect failed:', err);
  }
}

function disconnectSSE() {
  if ($.eventSource) {
    try { $.eventSource.close(); } catch {}
    $.eventSource = null;
  }
}

// ─── Filter window-bridge handlers ───────────────────────────────────

function rerenderAfterFilterChange() {
  renderThread();
  renderStatsSidebar();
}

window.toggleLiveSimTier = function(t) {
  if ($.filters.tier.has(t)) $.filters.tier.delete(t);
  else $.filters.tier.add(t);
  rerenderAfterFilterChange();
};

window.clearLiveSimFilters = function() {
  $.filters.tier = new Set();
  $.filters.fallbackOnly = false;
  $.filters.lowConfOnly = false;
  $.filters.hasErrorOnly = false;
  $.filters.intent = null;
  rerenderAfterFilterChange();
};

window.toggleLiveSimFlag = function(flag) {
  if (flag === 'fallbackOnly' || flag === 'lowConfOnly' || flag === 'hasErrorOnly') {
    $.filters[flag] = !$.filters[flag];
    rerenderAfterFilterChange();
  }
};

window.openLiveSimConversation = openLiveSimConversation;

window.sendLiveSimReply = sendLiveSimReply;

window.lsAutoResizeInput = function(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

window.lsHandleReplyKeydown = function(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendLiveSimReply();
  }
};

window.filterLiveSimConvList = function() {
  renderConversationList();
};

window.toggleLiveSimSidebar = function () {
  const grid = document.querySelector('.ls-grid');
  const chevron = document.getElementById('ls-sidebar-chevron');
  if (!grid || !chevron) return;
  const collapsed = grid.classList.toggle('ls-sidebar-collapsed');
  chevron.textContent = collapsed ? '«' : '»';
};

// ─── Entry / cleanup ─────────────────────────────────────────────────

export async function loadLiveSimulation() {
  // Idempotency guard (Risk §8: avoid double-injection)
  if ($.injected && document.getElementById('ls-root')) {
    // Already injected — just refresh data
    await fetchConversationList();
    if ($.activePhone) await openLiveSimConversation($.activePhone);
    connectSSE();
    return;
  }

  const ok = await ensureTemplateInjected();
  if (!ok) return;
  $.injected = true;

  await fetchConversationList();
  renderStatsSidebar();
  connectSSE();

  // 10s polling fallback — catches SSE misses and tab loads after SSE fires
  if ($.autoRefresh) clearInterval($.autoRefresh);
  $.autoRefresh = setInterval(() => {
    const tab = document.getElementById('live-simulation-content');
    if (tab && tab.classList.contains('hidden')) return;
    fetchConversationList();
  }, 10000);

  // 1s ticker for the "Updated Xs ago" label
  if ($.refreshTicker) clearInterval($.refreshTicker);
  $.refreshTicker = setInterval(() => {
    const tab = document.getElementById('live-simulation-content');
    if (tab && tab.classList.contains('hidden')) return;
    updateRefreshLabel();
  }, 1000);

  // Open the most recent conversation by default
  if ($.conversations.length > 0 && !$.activePhone) {
    openLiveSimConversation($.conversations[0].phone);
  }
}

export function setLsChannelFilter(channel) {
  $.channelFilter = channel;
  document.querySelectorAll('#ls-channel-chips .ls-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-channel') === channel);
  });
  renderConversationList();
}

export function setLsFilter(filter) {
  $.activeFilter = filter;
  document.querySelectorAll('#ls-filter-chips .ls-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.getAttribute('data-filter') === filter);
  });
  renderConversationList();
}

export function cleanupLiveSimulation() {
  disconnectSSE();
  if ($.autoRefresh) {
    clearInterval($.autoRefresh);
    $.autoRefresh = null;
  }
  if ($.refreshTicker) {
    clearInterval($.refreshTicker);
    $.refreshTicker = null;
  }
  // Keep injected DOM + state so re-entry is fast; only reset transient
  // refresh state and the SSE handle.
}
