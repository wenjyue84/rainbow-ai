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

// Search + filter state
let _wcSearchQuery = '';
let _wcFilter = 'all'; // 'all' | 'unread'
let _wcSearchDebounceTimer = null;

// Message search state
let _wcMsgSearchMatches = [];
let _wcMsgSearchIndex = -1;

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

// Generate a stable WhatsApp-style avatar color from a session ID
function wcAvatarColor(sessionId) {
  const colors = [
    '#00a884','#25d366','#128c7e','#075e54',
    '#34b7f1','#0084ff','#7b68ee','#e91e8c',
    '#ff7043','#ff9800','#66bb6a','#26c6da',
  ];
  let hash = 0;
  for (let i = 0; i < (sessionId || '').length; i++) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
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

  // Update preview link to reflect the active profile
  const pid = window.profileSwitcher ? window.profileSwitcher.getActiveProfileId() : 'pelangi';
  const previewLink = document.getElementById('wc-preview-link');
  if (previewLink) {
    previewLink.href = '/chat/' + pid;
    previewLink.title = 'Guest webchat link — open or share with guests: /chat/' + pid;
  }

  await fetchWebchatList();
  _wcListInterval = setInterval(fetchWebchatList, WC_LIST_POLL_MS);
}

async function fetchWebchatList() {
  try {
    const headers = { 'Cache-Control': 'no-cache' };
    const profileId = window.profileSwitcher ? window.profileSwitcher.getActiveProfileId() : null;
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

  // Hide skeleton once we have data (or confirmed empty)
  const skeleton = document.getElementById('wc-skeleton-wrap');
  if (skeleton) skeleton.remove();

  // Apply search + filter
  const q = _wcSearchQuery.toLowerCase();
  let filtered = _wcConversations;

  if (_wcFilter === 'unread') {
    filtered = filtered.filter(c => c.unreadCount > 0);
  }

  if (q) {
    filtered = filtered.filter(c => {
      const name = (c.pushName || 'Web Visitor').toLowerCase();
      const preview = (c.lastMessage || '').toLowerCase();
      const sid = (c.sessionId || '').toLowerCase();
      return name.includes(q) || preview.includes(q) || sid.includes(q);
    });
  }

  if (filtered.length === 0) {
    const emptyMsg = _wcFilter === 'unread'
      ? 'No unread conversations'
      : (q ? 'No sessions match your search' : 'No webchat conversations yet');
    const emptyHint = _wcFilter === 'all' && !q
      ? '<p class="text-sm text-neutral-400 mt-1">Conversations will appear when visitors use the webchat widget</p>'
      : '';
    listEl.innerHTML = `<div class="lc-empty-state"><p>${emptyMsg}</p>${emptyHint}</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(c => {
    const isActive = _wcActiveSession === c.sessionId;
    const timeStr = wcTimeAgo(c.lastMessageAt);
    const unreadBadge = c.unreadCount > 0
      ? `<span class="lc-unread-badge">${c.unreadCount}</span>`
      : '';
    const avatarColor = wcAvatarColor(c.sessionId);

    return `
      <div class="lc-conv-item ${isActive ? 'lc-conv-active' : ''}" onclick="wcOpenConversation('${wcAttr(c.sessionId)}')">
        <div class="lc-conv-avatar" style="background:${avatarColor};">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2">
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
        </div>
      </div>
    `;
  }).join('');
}

// ─── Search + Filter ──────────────────────────────────────────────

export function wcSetFilter(filter) {
  _wcFilter = filter;
  // Update chip styles
  document.querySelectorAll('#wc-filter-chips .lc-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  renderWebchatSidebar();
}

export function wcDebouncedSearch() {
  clearTimeout(_wcSearchDebounceTimer);
  _wcSearchDebounceTimer = setTimeout(() => {
    const input = document.getElementById('wc-search');
    _wcSearchQuery = input ? input.value.trim() : '';
    renderWebchatSidebar();
  }, 200);
}

// ─── Sidebar 3-dot Menu ───────────────────────────────────────────

export function wcToggleSidebarMenu() {
  const dd = document.getElementById('wc-sidebar-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener('click', wcCloseSidebarMenuOnOutside, { once: true });
    }, 0);
  }
}

function wcCloseSidebarMenuOnOutside(e) {
  const dd = document.getElementById('wc-sidebar-dropdown');
  const btn = document.querySelector('#wc-sidebar .lc-sidebar-menu-btn');
  if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
    dd.style.display = 'none';
  }
}

export async function wcMarkAllRead() {
  const dd = document.getElementById('wc-sidebar-dropdown');
  if (dd) dd.style.display = 'none';

  const unread = _wcConversations.filter(c => c.unreadCount > 0);
  if (unread.length === 0) return;

  const headers = { 'Content-Type': 'application/json' };
  const profileId = window.profileSwitcher ? window.profileSwitcher.getActiveProfileId() : null;
  if (profileId) headers['x-profile-id'] = profileId;

  await Promise.all(unread.map(c =>
    fetch(`/api/rainbow/webchat/conversations/${encodeURIComponent(c.sessionId)}/read`, {
      method: 'PATCH', headers
    }).catch(() => {})
  ));

  await fetchWebchatList();
}

// ─── Open Conversation ────────────────────────────────────────────

export async function openWebchatConversation(sessionId) {
  _wcActiveSession = sessionId;

  // Reset message search
  _wcMsgSearchMatches = [];
  _wcMsgSearchIndex = -1;
  const searchBar = document.getElementById('wc-msg-search-bar');
  if (searchBar) searchBar.style.display = 'none';
  const searchInput = document.getElementById('wc-msg-search-input');
  if (searchInput) searchInput.value = '';
  const searchCount = document.getElementById('wc-msg-search-count');
  if (searchCount) searchCount.textContent = '';

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
    const profileId = window.profileSwitcher ? window.profileSwitcher.getActiveProfileId() : null;
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
    const profileId = window.profileSwitcher ? window.profileSwitcher.getActiveProfileId() : null;
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
  if (headerMeta) headerMeta.textContent = `${data.profileId ? data.profileId + ' \u00B7 ' : ''}${data.sessionId}`;
  // Apply matching avatar color to header
  const headerAvatar = document.querySelector('#wc-chat-view .lc-chat-header-avatar');
  if (headerAvatar) headerAvatar.style.background = wcAvatarColor(data.sessionId);

  const container = document.getElementById('wc-messages');
  if (!container) return;

  // Re-apply message search highlight if active
  const searchInput = document.getElementById('wc-msg-search-input');
  const activeQuery = searchInput ? searchInput.value.trim() : '';

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

  // Re-apply search highlights if search is active
  if (activeQuery) {
    wcApplyMsgSearch(activeQuery);
  } else {
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }
}

// ─── Chat Header Menu ─────────────────────────────────────────────

export function wcToggleHeaderMenu() {
  const dd = document.getElementById('wc-header-dropdown');
  if (!dd) return;
  const isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener('click', wcCloseHeaderMenuOnOutside, { once: true });
    }, 0);
  }
}

function wcCloseHeaderMenuOnOutside(e) {
  const dd = document.getElementById('wc-header-dropdown');
  const btn = document.getElementById('wc-header-menu-btn');
  if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
    dd.style.display = 'none';
  }
}

export async function wcRefresh() {
  const dd = document.getElementById('wc-header-dropdown');
  if (dd) dd.style.display = 'none';
  if (_wcActiveSession) {
    await fetchWebchatMessages(_wcActiveSession);
  }
}

// ─── Message Search ───────────────────────────────────────────────

export function wcToggleMsgSearch() {
  const bar = document.getElementById('wc-msg-search-bar');
  if (!bar) return;
  const isHidden = bar.style.display === 'none';
  bar.style.display = isHidden ? 'flex' : 'none';
  if (isHidden) {
    const input = document.getElementById('wc-msg-search-input');
    if (input) { input.value = ''; input.focus(); }
    const count = document.getElementById('wc-msg-search-count');
    if (count) count.textContent = '';
    _wcMsgSearchMatches = [];
    _wcMsgSearchIndex = -1;
  } else {
    // Clear highlights when closing
    wcClearMsgSearchHighlights();
    const container = document.getElementById('wc-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function wcClearMsgSearchHighlights() {
  document.querySelectorAll('#wc-messages .lc-bubble').forEach(el => {
    el.classList.remove('wc-msg-search-match', 'wc-msg-search-current');
  });
  _wcMsgSearchMatches = [];
  _wcMsgSearchIndex = -1;
}

function wcApplyMsgSearch(query) {
  wcClearMsgSearchHighlights();
  const count = document.getElementById('wc-msg-search-count');
  if (!query) {
    if (count) count.textContent = '';
    const container = document.getElementById('wc-messages');
    if (container) container.scrollTop = container.scrollHeight;
    return;
  }

  const q = query.toLowerCase();
  const bubbles = Array.from(document.querySelectorAll('#wc-messages .lc-msg'));
  const matches = [];

  bubbles.forEach(msgEl => {
    const textEl = msgEl.querySelector('.lc-bubble-text');
    const bubble = msgEl.querySelector('.lc-bubble');
    if (!textEl || !bubble) return;
    if (textEl.textContent.toLowerCase().includes(q)) {
      bubble.classList.add('wc-msg-search-match');
      matches.push(bubble);
    }
  });

  _wcMsgSearchMatches = matches;
  _wcMsgSearchIndex = matches.length > 0 ? matches.length - 1 : -1;

  if (matches.length > 0) {
    matches[_wcMsgSearchIndex].classList.add('wc-msg-search-current');
    matches[_wcMsgSearchIndex].scrollIntoView({ block: 'nearest' });
  }

  if (count) {
    count.textContent = matches.length > 0
      ? `${_wcMsgSearchIndex + 1} / ${matches.length}`
      : 'No matches';
  }
}

export function wcMsgSearchInput() {
  const input = document.getElementById('wc-msg-search-input');
  wcApplyMsgSearch(input ? input.value.trim() : '');
}

export function wcMsgSearchNav(dir) {
  if (_wcMsgSearchMatches.length === 0) return;
  _wcMsgSearchMatches[_wcMsgSearchIndex].classList.remove('wc-msg-search-current');
  _wcMsgSearchIndex = (_wcMsgSearchIndex + dir + _wcMsgSearchMatches.length) % _wcMsgSearchMatches.length;
  _wcMsgSearchMatches[_wcMsgSearchIndex].classList.add('wc-msg-search-current');
  _wcMsgSearchMatches[_wcMsgSearchIndex].scrollIntoView({ block: 'nearest' });
  const count = document.getElementById('wc-msg-search-count');
  if (count) count.textContent = `${_wcMsgSearchIndex + 1} / ${_wcMsgSearchMatches.length}`;
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
    const profileId = window.profileSwitcher ? window.profileSwitcher.getActiveProfileId() : null;
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
window.wcSetFilter = wcSetFilter;
window.wcDebouncedSearch = wcDebouncedSearch;
window.wcToggleSidebarMenu = wcToggleSidebarMenu;
window.wcMarkAllRead = wcMarkAllRead;
window.wcToggleHeaderMenu = wcToggleHeaderMenu;
window.wcRefresh = wcRefresh;
window.wcToggleMsgSearch = wcToggleMsgSearch;
window.wcMsgSearchInput = wcMsgSearchInput;
window.wcMsgSearchNav = wcMsgSearchNav;
window.wcMsgSearchKeydown = function (e) {
  if (e.key === 'Enter') wcMsgSearchNav(e.shiftKey ? -1 : 1);
  if (e.key === 'Escape') wcToggleMsgSearch();
};
