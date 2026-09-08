// ═══════════════════════════════════════════════════════════════════
// Live Chat Features - Translation, header menu, message search
// ═══════════════════════════════════════════════════════════════════

import { $ } from './live-chat-state.js';
import { refreshChat, renderChat, hasSystemContent, getUserMessage, formatSystemContent, getNonTextPlaceholder, highlightText } from './live-chat-core.js';
import { updateMessageIndicators } from './live-chat-actions.js';
import { toggleContactPanel } from './live-chat-panels.js';

var api = window.api;

// ─── Translation ─────────────────────────────────────────────────

var LANG_FLAGS = { en: '\u{1F1EC}\u{1F1E7}', ms: '\u{1F1F2}\u{1F1FE}', zh: '\u{1F1E8}\u{1F1F3}', id: '\u{1F1EE}\u{1F1E9}', th: '\u{1F1F9}\u{1F1ED}', vi: '\u{1F1FB}\u{1F1F3}' };

export function toggleTranslate() {
  $.translateMode = !$.translateMode;
  var btn = document.getElementById('lc-translate-toggle');
  var flagWrap = document.getElementById('lc-flag-selector-wrap');
  if ($.translateMode) {
    if (btn) btn.classList.add('active');
    if (flagWrap) flagWrap.style.display = '';
    updateFlagIcon($.translateLang);
  } else {
    if (btn) btn.classList.remove('active');
    if (flagWrap) flagWrap.style.display = 'none';
    closeFlagMenu();
    hideTranslatePreview();
  }
}

export function toggleFlagMenu() {
  var dd = document.getElementById('lc-flag-dropdown');
  if (!dd) return;
  var isOpen = dd.style.display !== 'none';
  dd.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    var opts = dd.querySelectorAll('.lc-flag-option');
    opts.forEach(function(o) {
      o.classList.toggle('active', o.getAttribute('data-lang') === $.translateLang);
    });
  }
}

function closeFlagMenu() {
  var dd = document.getElementById('lc-flag-dropdown');
  if (dd) dd.style.display = 'none';
}

function updateFlagIcon(lang) {
  var icon = document.getElementById('lc-flag-icon');
  if (icon) icon.textContent = LANG_FLAGS[lang] || LANG_FLAGS.en;
}

export function selectLang(lang) {
  $.translateLang = lang;
  var selector = document.getElementById('lc-lang-selector');
  if (selector) selector.value = lang;
  updateFlagIcon(lang);
  closeFlagMenu();
  clearTimeout($.translateDebounce);
  $.translateDebounce = null;
  hideTranslatePreview();
}

export function handleLangChange() {
  $.translateLang = document.getElementById('lc-lang-selector').value;
  updateFlagIcon($.translateLang);
  clearTimeout($.translateDebounce);
  $.translateDebounce = null;
  hideTranslatePreview();
}

function getTranslateLangLabel(lang) {
  var labels = { en: 'English', ms: 'Malay', zh: 'Chinese', id: 'Indonesian', th: 'Thai', vi: 'Vietnamese' };
  return labels[lang] || lang;
}

export function showTranslatePreview(data) {
  $.translatePreview = data;
  var el = document.getElementById('lc-translate-preview');
  var langEl = document.getElementById('lc-translate-preview-lang');
  var textEl = document.getElementById('lc-translate-preview-text');
  if (el && langEl && textEl) {
    langEl.textContent = 'Translation (' + getTranslateLangLabel(data.targetLang) + ')';
    textEl.textContent = data.translated;
    el.style.display = '';
  }
}

export function hideTranslatePreview() {
  $.translatePreview = null;
  var el = document.getElementById('lc-translate-preview');
  if (el) el.style.display = 'none';
}

export function onInputTranslate() {
  if (!$.translateMode || $.translateLang === 'en') {
    hideTranslatePreview();
    return;
  }
  var input = document.getElementById('lc-input-box');
  var text = (input ? input.value : '').trim();
  if (!text) {
    hideTranslatePreview();
    return;
  }
  clearTimeout($.translateDebounce);
  $.translateDebounce = setTimeout(function () {
    var textToTranslate = (document.getElementById('lc-input-box') && document.getElementById('lc-input-box').value.trim()) || '';
    var langAtRequest = $.translateLang;
    if (!textToTranslate) {
      hideTranslatePreview();
      return;
    }
    if (!api) {
      hideTranslatePreview();
      if (typeof window !== 'undefined' && window.toast) window.toast('Translation not available', 'error');
      return;
    }
    api('/translate', { method: 'POST', body: { text: textToTranslate, targetLang: langAtRequest } })
      .then(function (result) {
        var current = (document.getElementById('lc-input-box') && document.getElementById('lc-input-box').value.trim()) || '';
        if (current !== textToTranslate) return;
        if (langAtRequest !== $.translateLang) return;
        var translated = result && (result.translated != null) ? String(result.translated) : '';
        if (!translated) {
          hideTranslatePreview();
          if (typeof window !== 'undefined' && window.toast) window.toast('Translation failed', 'error');
          return;
        }
        showTranslatePreview({
          original: textToTranslate,
          translated: translated,
          targetLang: langAtRequest
        });
      })
      .catch(function (err) {
        hideTranslatePreview();
        if (typeof window !== 'undefined' && window.toast) window.toast('Translation failed: ' + (err && err.message ? err.message : 'network error'), 'error');
      });
  }, 400);
}

export async function sendTranslated() {
  if (!$.activePhone || !$.translatePreview) return;
  var btn = document.getElementById('lc-send-btn');
  var input = document.getElementById('lc-input-box');
  btn.disabled = true;
  try {
    var log = $.conversations.find(function (c) { return c.phone === $.activePhone; });
    var instanceId = log ? log.instanceId : undefined;
    await api('/conversations/' + encodeURIComponent($.activePhone) + '/send', {
      method: 'POST',
      body: { message: $.translatePreview.translated, instanceId: instanceId }
    });
    if (input) { input.value = ''; input.style.height = '42px'; }
    hideTranslatePreview();
    await refreshChat();
  } catch (err) {
    (window.toast ? window.toast('Failed to send message: ' + (err.message || 'Unknown error'), 'error') : alert('Failed to send message: ' + (err.message || 'Unknown error')));
  } finally {
    btn.disabled = false;
    if (input) input.focus();
  }
}

export async function sendOriginal() {
  if (!$.activePhone || !$.translatePreview) return;
  var btn = document.getElementById('lc-send-btn');
  var input = document.getElementById('lc-input-box');
  btn.disabled = true;
  try {
    var log = $.conversations.find(function (c) { return c.phone === $.activePhone; });
    var instanceId = log ? log.instanceId : undefined;
    await api('/conversations/' + encodeURIComponent($.activePhone) + '/send', {
      method: 'POST',
      body: { message: $.translatePreview.original, instanceId: instanceId }
    });
    if (input) { input.value = ''; input.style.height = '42px'; }
    hideTranslatePreview();
    await refreshChat();
  } catch (err) {
    (window.toast ? window.toast('Failed to send message: ' + (err.message || 'Unknown error'), 'error') : alert('Failed to send message: ' + (err.message || 'Unknown error')));
  } finally {
    btn.disabled = false;
    if (input) input.focus();
  }
}

export function showTranslateModal() {
  if (!$.pendingTranslation) return;
  document.getElementById('lc-translate-original').textContent = $.pendingTranslation.original;
  document.getElementById('lc-translate-translated').textContent = $.pendingTranslation.translated;
  document.getElementById('lc-translate-lang-label').textContent = $.pendingTranslation.targetLang.toUpperCase();
  document.getElementById('lc-translate-modal').style.display = 'flex';
}

export function closeTranslateModal() {
  document.getElementById('lc-translate-modal').style.display = 'none';
  $.pendingTranslation = null;
  document.getElementById('lc-send-btn').disabled = false;
  document.getElementById('lc-input-box').focus();
}

export async function confirmTranslation() {
  if (!$.pendingTranslation || !$.activePhone) {
    closeTranslateModal();
    return;
  }

  var confirmBtn = document.querySelector('#lc-translate-modal .lc-modal-btn-send');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Sending...';

  try {
    var log = $.conversations.find(function (c) { return c.phone === $.activePhone; });
    var instanceId = log ? log.instanceId : undefined;

    await api('/conversations/' + encodeURIComponent($.activePhone) + '/send', {
      method: 'POST',
      body: { message: $.pendingTranslation.translated, instanceId: instanceId }
    });

    document.getElementById('lc-input-box').value = '';
    document.getElementById('lc-input-box').style.height = '42px';
    closeTranslateModal();
    await refreshChat();
  } catch (err) {
    (window.toast ? window.toast('Failed to send message: ' + (err.message || 'Unknown error'), 'error') : alert('Failed to send message: ' + (err.message || 'Unknown error')));
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Send Translation';
  }
}

// ─── Header 3-dot menu ──────────────────────────────────────────

export function closeHeaderMenu() {
  var dropdown = document.getElementById('lc-header-dropdown');
  var btn = document.getElementById('lc-header-menu-btn');
  if (dropdown) dropdown.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

export function toggleHeaderMenu() {
  var dropdown = document.getElementById('lc-header-dropdown');
  var btn = document.getElementById('lc-header-menu-btn');
  if (!dropdown || !btn) return;
  var isOpen = dropdown.classList.toggle('open');
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

export function updateHeaderMenuActive() {
  var btn = document.getElementById('lc-header-menu-btn');
  if (!btn) return;
  if ($.searchOpen || $.contactPanelOpen) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

export function onMenuContactInfo() {
  closeHeaderMenu();
  toggleContactPanel();
}

export function onMenuSearch() {
  closeHeaderMenu();
  toggleSearch();
}

export function onMenuTranslate() {
  closeHeaderMenu();
  toggleTranslate();
  updateTranslateIndicator();
}

export function updateTranslateIndicator() {
  var indicator = document.getElementById('lc-menu-translate-indicator');
  if (!indicator) return;
  if ($.translateMode) {
    indicator.textContent = 'ON';
    indicator.classList.add('active');
  } else {
    indicator.textContent = 'OFF';
    indicator.classList.remove('active');
  }
}

export function onMenuMode(event) {
  event.stopPropagation();
  var submenu = document.getElementById('lc-mode-submenu');
  if (!submenu) return;
  var isOpen = submenu.style.display !== 'none';
  submenu.style.display = isOpen ? 'none' : '';
  if (!isOpen) {
    updateModeSubmenuUI();
  }
}

export function updateModeSubmenuUI() {
  var submenu = document.getElementById('lc-mode-submenu');
  if (!submenu) return;
  var items = submenu.querySelectorAll('.lc-header-dropdown-item');
  var modes = ['autopilot', 'copilot', 'manual'];
  for (var i = 0; i < items.length; i++) {
    if (modes[i] === $.currentMode) {
      items[i].classList.add('active-mode');
    } else {
      items[i].classList.remove('active-mode');
    }
  }
  var currentLabel = document.getElementById('lc-menu-mode-current');
  if (currentLabel) {
    var labels = { autopilot: 'Autopilot', copilot: 'Copilot', manual: 'Manual' };
    currentLabel.textContent = labels[$.currentMode] || $.currentMode;
  }
}

// ─── Message Search ──────────────────────────────────────────────

export function toggleSearch() {
  $.searchOpen = !$.searchOpen;
  var bar = document.getElementById('lc-msg-search-bar');
  if (!bar) return;

  if ($.searchOpen) {
    bar.style.display = '';
    var input = document.getElementById('lc-msg-search-input');
    if (input) { input.value = ''; input.focus(); }
    $.searchQuery = '';
    $.searchMatches = [];
    $.searchCurrent = -1;
    updateSearchCount();
  } else {
    bar.style.display = 'none';
    $.searchQuery = '';
    $.searchMatches = [];
    $.searchCurrent = -1;
    rerenderMessages();
  }
  updateHeaderMenuActive();
}

export function msgSearchInput() {
  clearTimeout($.searchDebounce);
  $.searchDebounce = setTimeout(function () {
    var input = document.getElementById('lc-msg-search-input');
    $.searchQuery = (input ? input.value : '').trim();
    executeSearch();
  }, 200);
}

export function executeSearch() {
  $.searchMatches = [];
  $.searchCurrent = -1;
  var query = $.searchQuery.toLowerCase();

  if (query.length > 0) {
    for (var i = 0; i < $.lastMessages.length; i++) {
      var content = ($.lastMessages[i].content || '').toLowerCase();
      if (content.includes(query)) {
        $.searchMatches.push(i);
      }
    }
    if ($.searchMatches.length > 0) {
      $.searchCurrent = $.searchMatches.length - 1;
    }
  }

  updateSearchCount();
  rerenderMessages();
}

export function msgSearchNav(direction) {
  if ($.searchMatches.length === 0) return;
  $.searchCurrent += direction;
  if ($.searchCurrent < 0) $.searchCurrent = $.searchMatches.length - 1;
  if ($.searchCurrent >= $.searchMatches.length) $.searchCurrent = 0;
  updateSearchCount();
  rerenderMessages();
}

export function msgSearchKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    msgSearchNav(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    toggleSearch();
  }
}

export function updateSearchCount() {
  var el = document.getElementById('lc-msg-search-count');
  if (!el) return;
  if (!$.searchQuery || $.searchMatches.length === 0) {
    el.textContent = $.searchQuery ? 'No results' : '';
  } else {
    el.textContent = ($.searchCurrent + 1) + ' of ' + $.searchMatches.length;
  }
}

export function scrollToMatch(msgIdx) {
  var container = document.getElementById('lc-messages');
  if (!container) return;
  var el = container.querySelector('[data-msg-idx="' + msgIdx + '"]');
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

export function rerenderMessages() {
  // Delegate to the single renderer so search highlighting, quote blocks,
  // bot-avatar prefix and grouping never drift between search and normal view.
  if (!$.lastMessages.length) return;
  var cached = $.activePhone ? $.conversationCache.get($.activePhone) : null;
  var nameEl = document.getElementById('lc-header-name');
  var log = cached ? cached.log : { phone: $.activePhone, pushName: nameEl ? nameEl.textContent : '', messages: $.lastMessages };
  renderChat(log);
  updateMessageIndicators();
}
