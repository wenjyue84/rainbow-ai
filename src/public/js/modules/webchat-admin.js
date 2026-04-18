// ═══════════════════════════════════════════════════════════════════
// Webchat Admin Module — Admin view of webchat conversations
// ═══════════════════════════════════════════════════════════════════
//
// Injects webchat sessions into the unified Live Chat sidebar list.
// Clicking a webchat item opens wc-chat-view inside lc-main.
// ═══════════════════════════════════════════════════════════════════

let _wcListInterval = null;
let _wcMsgInterval = null;
let _wcActiveSession = null;
let _wcConversations = [];

const WC_LIST_POLL_MS = 10000;  // 10s
const WC_MSG_POLL_MS = 5000;    // 5s

// ─── Helpers ──────────────────────────────────────────────────────

function wcEsc(s) {
  if (!s) return '';
  if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function wcAttr(s) {
  if (!s) return '';
  if (typeof window.escapeAttr === 'function') return window.escapeAttr(s);
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wcTimeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return new Date(ts).toLocaleDateString();
}

function wcFormatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ─── No-op sub-tab switch (kept for backward-compat, now unified) ─

export function switchLiveChatTab(tabName, updateHash) {
  // Unified layout: no sub-tabs. Keep hash compat for 'live-chat' links.
  if (updateHash !== false && tabName !== 'webchat') {
    window.location.hash = 'live-chat';
  }
}

// ─── Load Webchat Conversations ───────────────────────────────────

export async function loadWebchatAdmin() {
  cleanupWebchatAdmin();
  await fetchWebchatList();
  _wcListInterval = setInterval(fetchWebchatList, WC_LIST_POLL_MS);
}

async function fetchWebchatList() {
  try {
    const headers = { 'Cache-Control': 'no-cache' };
    const profileId = window._currentProfileId;
    if (profileId) headers['x-profile-id'] = profileId;

    const resp = await fetch('/api/rainbow/webchat/conversations', { headers });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[WebchatAdmin] /api/rainbow/webchat/conversations returned', resp.status, body.slice(0, 200));
      return;
    }

    _wcConversations = await resp.json();
    // Expose globally so renderList in live-chat-core.js can merge them
    window._wcConversations = _wcConversations;
    window._wcActiveSession = _wcActiveSession;
    // Trigger re-render of the unified conversation list
    if (typeof window.lcFilterConversations === 'function') window.lcFilterConversations();
  } catch (err) {
    console.error('[WebchatAdmin] Failed to fetch conversations:', err);
  }
}

// ─── Open Conversation ────────────────────────────────────────────

export async function openWebchatConversation(sessionId) {
  _wcActiveSession = sessionId;
  window._wcActiveSession = sessionId;
  // Clear active WA phone so WA items don't stay highlighted
  if (window._lcState) window._lcState.activePhone = null;

  // Stop previous message polling
  if (_wcMsgInterval) { clearInterval(_wcMsgInterval); _wcMsgInterval = null; }

  // Hide WA views, show webchat view in lc-main
  const emptyState = document.getElementById('lc-empty-state');
  const activeChat = document.getElementById('lc-active-chat');
  const wcView = document.getElementById('wc-chat-view');

  if (emptyState) emptyState.style.display = 'none';
  if (activeChat) activeChat.style.display = 'none';
  // Hide lc-main (sibling of wc-chat-view in .lc-container) so wc-chat-view fills the space
  const lcMain = document.getElementById('lc-main');
  if (lcMain) lcMain.style.display = 'none';
  if (wcView) wcView.style.display = 'flex';

  // Mark as read
  try {
    const headers = { 'Content-Type': 'application/json' };
    const profileId = window._currentProfileId;
    if (profileId) headers['x-profile-id'] = profileId;
    fetch(`/api/rainbow/webchat/conversations/${encodeURIComponent(sessionId)}/read`, {
      method: 'PATCH', headers
    });
  } catch {}

  await fetchWebchatMessages(sessionId);

  // Re-render unified list to highlight active webchat item
  if (typeof window.lcFilterConversations === 'function') window.lcFilterConversations();

  // Start polling messages
  _wcMsgInterval = setInterval(() => fetchWebchatMessages(sessionId), WC_MSG_POLL_MS);
}

async function fetchWebchatMessages(sessionId) {
  try {
    const headers = { 'Cache-Control': 'no-cache' };
    const profileId = window._currentProfileId;
    if (profileId) headers['x-profile-id'] = profileId;

    const resp = await fetch(`/api/rainbow/webchat/conversations/${encodeURIComponent(sessionId)}`, { headers });
    if (!resp.ok) return;

    const data = await resp.json();
    renderWebchatMessages(data);
  } catch (err) {
    console.error('[WebchatAdmin] Failed to fetch messages:', err);
  }
}

function renderWebchatMessages(data) {
  // Update header
  const headerName = document.getElementById('wc-chat-header-name');
  const headerMeta = document.getElementById('wc-chat-header-meta');
  if (headerName) headerName.textContent = data.pushName || 'Web Visitor';
  if (headerMeta) headerMeta.textContent = `${data.profileId || ''} \u00B7 ${data.sessionId}`;

  const container = document.getElementById('wc-messages');
  if (!container) return;

  container.innerHTML = data.messages.map(msg => {
    const isUser = msg.role === 'user';
    const isStaff = msg.role === 'staff';
    const isBot = msg.role === 'assistant';

    let bubbleClass = 'lc-bubble-incoming';
    let alignClass = '';
    let label = '';

    if (isUser) {
      bubbleClass = 'lc-bubble-incoming';
      label = '<span class="wc-msg-label wc-msg-label-user">Visitor</span>';
    } else if (isStaff) {
      bubbleClass = 'lc-bubble-outgoing';
      alignClass = 'lc-msg-outgoing';
      label = `<span class="wc-msg-label wc-msg-label-staff">${wcEsc(msg.staffName || 'Staff')}</span>`;
    } else if (isBot) {
      bubbleClass = 'lc-bubble-incoming wc-bubble-bot';
      label = '<span class="wc-msg-label wc-msg-label-bot">AI</span>';
    }

    const content = typeof window.linkifyUrls === 'function'
      ? window.linkifyUrls(wcEsc(msg.content))
      : wcEsc(msg.content);

    return `
      <div class="lc-msg ${alignClass}">
        ${label}
        <div class="lc-bubble ${bubbleClass}">
          <div class="lc-bubble-text">${content}</div>
          <div class="lc-bubble-time">${wcFormatTime(msg.timestamp)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// ─── Staff Reply ──────────────────────────────────────────────────

export async function sendWebchatReply(sessionId) {
  const input = document.getElementById('wc-reply-input');
  if (!input) return;

  const message = input.value.trim();
  if (!message || !sessionId) return;

  input.value = '';
  input.style.height = 'auto';

  try {
    const headers = { 'Content-Type': 'application/json' };
    const profileId = window._currentProfileId;
    if (profileId) headers['x-profile-id'] = profileId;

    const staffName = localStorage.getItem('lc_staff_name') || 'Staff';

    const resp = await fetch(`/api/rainbow/webchat/conversations/${encodeURIComponent(sessionId)}/reply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, staffName }),
    });

    if (resp.ok) {
      await fetchWebchatMessages(sessionId);
    }
  } catch (err) {
    console.error('[WebchatAdmin] Failed to send reply:', err);
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────

export function cleanupWebchatAdmin() {
  if (_wcListInterval) { clearInterval(_wcListInterval); _wcListInterval = null; }
  if (_wcMsgInterval) { clearInterval(_wcMsgInterval); _wcMsgInterval = null; }
}

// ─── Window Exports ──────────────────────────────────────────────

window.switchLiveChatTab = switchLiveChatTab;
window.loadWebchatAdmin = loadWebchatAdmin;
window.wcOpenConversation = openWebchatConversation;
window.wcSendReply = function () { sendWebchatReply(_wcActiveSession); };
window.wcReplyKeydown = function (e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendWebchatReply(_wcActiveSession);
  }
};
window.wcAutoResize = function (el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};
window.cleanupWebchatAdmin = cleanupWebchatAdmin;
