// ═══════════════════════════════════════════════════════════════════
// Webchat Admin Module — Admin view of webchat conversations
// ═══════════════════════════════════════════════════════════════════
//
// Provides sub-tab switching, conversation list, message view,
// and staff reply for webchat sessions in the Live Chat tab.
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

// ─── Sub-tab Switching ────────────────────────────────────────────

export function switchLiveChatTab(tabName, updateHash) {
  if (updateHash === undefined) updateHash = true;

  const waBtn = document.getElementById('lc-subtab-whatsapp');
  const wcBtn = document.getElementById('lc-subtab-webchat');
  const waContent = document.getElementById('whatsapp-chat-content');
  const wcContent = document.getElementById('webchat-content');

  if (!waBtn || !wcBtn || !waContent || !wcContent) return;

  if (tabName === 'webchat') {
    waBtn.classList.remove('text-primary-600', 'border-primary-500', 'bg-primary-50');
    waBtn.classList.add('text-neutral-600');
    wcBtn.classList.add('text-primary-600', 'border-primary-500', 'bg-primary-50');
    wcBtn.classList.remove('text-neutral-600');
    waContent.classList.add('hidden');
    wcContent.classList.remove('hidden');
    loadWebchatAdmin();
  } else {
    wcBtn.classList.remove('text-primary-600', 'border-primary-500', 'bg-primary-50');
    wcBtn.classList.add('text-neutral-600');
    waBtn.classList.add('text-primary-600', 'border-primary-500', 'bg-primary-50');
    waBtn.classList.remove('text-neutral-600');
    wcContent.classList.add('hidden');
    waContent.classList.remove('hidden');
    cleanupWebchatAdmin();
  }

  if (updateHash) {
    window.location.hash = tabName === 'webchat' ? 'live-chat/webchat' : 'live-chat';
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
    if (!resp.ok) return;

    _wcConversations = await resp.json();
    renderWebchatSidebar();
  } catch (err) {
    console.error('[WebchatAdmin] Failed to fetch conversations:', err);
  }
}

function renderWebchatSidebar() {
  const listEl = document.getElementById('wc-conversation-list');
  if (!listEl) return;

  if (_wcConversations.length === 0) {
    listEl.innerHTML = '<div class="lc-empty-state"><p>No webchat conversations yet</p><p class="text-sm text-neutral-400 mt-1">Conversations will appear when visitors use the webchat widget</p></div>';
    return;
  }

  listEl.innerHTML = _wcConversations.map(c => {
    const isActive = _wcActiveSession === c.sessionId;
    const timeStr = wcTimeAgo(c.lastMessageAt);
    const unreadBadge = c.unreadCount > 0
      ? `<span class="lc-unread-badge">${c.unreadCount}</span>`
      : '';
    const profileLabel = c.profileId ? `<span class="wc-profile-badge">${wcEsc(c.profileId)}</span>` : '';

    return `
      <div class="lc-conv-item ${isActive ? 'lc-conv-active' : ''}" onclick="wcOpenConversation('${wcAttr(c.sessionId)}')">
        <div class="lc-conv-avatar wc-avatar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 014-4h4a4 4 0 014 4v2"/>
          </svg>
        </div>
        <div class="lc-conv-info">
          <div class="lc-conv-top">
            <span class="lc-conv-name">${wcEsc(c.pushName || 'Web Visitor')}</span>
            <span class="lc-conv-time">${timeStr}</span>
          </div>
          <div class="lc-conv-bottom">
            <span class="lc-conv-preview">${wcEsc(c.lastMessage)}</span>
            ${unreadBadge}
          </div>
          <div class="wc-conv-meta">${profileLabel} <span class="wc-session-id">${wcEsc(c.sessionId.slice(0, 12))}...</span></div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Open Conversation ────────────────────────────────────────────

export async function openWebchatConversation(sessionId) {
  _wcActiveSession = sessionId;

  // Clear previous message polling
  if (_wcMsgInterval) { clearInterval(_wcMsgInterval); _wcMsgInterval = null; }

  // Show chat view, hide placeholder
  const placeholder = document.getElementById('wc-chat-placeholder');
  const chatView = document.getElementById('wc-chat-view');
  if (placeholder) placeholder.classList.add('hidden');
  if (chatView) chatView.classList.remove('hidden');

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

  // Re-render sidebar to highlight active
  renderWebchatSidebar();

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
      // Refresh messages immediately
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
