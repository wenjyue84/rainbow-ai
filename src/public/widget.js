/**
 * Rainbow AI Embeddable Chat Widget
 *
 * Usage:
 *   <script src="https://your-server/public/widget.js"
 *     data-profile="pelangi"
 *     data-color="#2563eb"
 *     data-label="Chat with us"
 *     data-subtitle="Ask me anything!"
 *     data-whatsapp="601234567890"
 *     data-position="right">
 *   </script>
 *
 * Config attributes (all optional):
 *   data-profile   — profile ID (default: "default")
 *   data-color     — accent hex color (default: "#2563eb")
 *   data-label     — button label text (default: "Chat")
 *   data-subtitle  — subtitle shown under title in chat header
 *   data-whatsapp  — phone number for WhatsApp CTA in header (e.g. "601234567890")
 *   data-position  — "right" or "left" (default: "right")
 *
 * Initialization: Deferred to requestIdleCallback (or 3s timeout) to avoid blocking LCP/INP.
 */
(function () {
  'use strict';

  function initWidget() {
    // ── Detect own script tag to derive server base URL ──────────────────────
    // Supports both synchronous (data-* attributes) and deferred/async loading
    // (window.__rbw config object, same pattern as GA4 gtag).
    var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
    var scriptConfig = window.__rbw || {};

    var BASE_URL    = script ? new URL(script.src).origin : (scriptConfig.base || window.location.origin);
    var profileId   = scriptConfig.profile   || (script && script.getAttribute('data-profile'))   || 'pelangi';
    // Normalize color: accept with or without leading '#'
    var _rawColor   = scriptConfig.color     || (script && script.getAttribute('data-color'))     || '';
    var accentColor = _rawColor ? (_rawColor.charAt(0) === '#' ? _rawColor : '#' + _rawColor) : '#2563eb';
    var buttonLabel = scriptConfig.label     || (script && script.getAttribute('data-label'))     || 'Chat';
    var subtitle    = scriptConfig.subtitle  || (script && script.getAttribute('data-subtitle'))  || '';
    var whatsapp    = scriptConfig.whatsapp  || (script && script.getAttribute('data-whatsapp'))  || '';
    var position    = scriptConfig.position  || (script && script.getAttribute('data-position'))  || 'right';

    var positionProp = position === 'left' ? 'left: 24px;' : 'right: 24px;';

    // ── Inject widget CSS ─────────────────────────────────────────────────────
    var css = [
      '#_rbw-btn {',
      '  position: fixed;',
      '  bottom: 24px;',
      '  ' + positionProp,
      '  z-index: 999998;',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 8px;',
      '  background: ' + _safeColor(accentColor) + ';',
      '  color: #fff;',
      '  border: none;',
      '  border-radius: 28px;',
      '  padding: 12px 20px 12px 16px;',
      '  font-size: 15px;',
      '  font-weight: 600;',
      '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
      '  cursor: pointer;',
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.18);',
      '  transition: transform 0.2s, box-shadow 0.2s, background 0.2s;',
      '  user-select: none;',
      '  line-height: 1;',
      '  position: relative;',
      '}',
      '#_rbw-btn:hover {',
      '  transform: scale(1.05);',
      '  box-shadow: 0 6px 24px rgba(0,0,0,0.24);',
      '}',
      '#_rbw-btn svg { flex-shrink: 0; }',
      '#_rbw-badge {',
      '  display: none;',
      '  position: absolute;',
      '  top: -3px;',
      '  right: -3px;',
      '  width: 12px;',
      '  height: 12px;',
      '  background: #ef4444;',
      '  border-radius: 50%;',
      '  border: 2px solid #fff;',
      '}',
      '#_rbw-panel {',
      '  position: fixed;',
      '  bottom: 90px;',
      '  ' + positionProp,
      '  z-index: 999999;',
      '  width: 380px;',
      '  height: 580px;',
      '  max-width: calc(100vw - 32px);',
      '  max-height: calc(100dvh - 120px);',
      '  border-radius: 16px;',
      '  overflow: hidden;',
      '  box-shadow: 0 8px 40px rgba(0,0,0,0.2);',
      '  transition: opacity 0.25s ease, transform 0.25s ease;',
      '  opacity: 0;',
      '  transform: translateY(16px) scale(0.97);',
      '  pointer-events: none;',
      '}',
      '#_rbw-panel.open {',
      '  opacity: 1;',
      '  transform: translateY(0) scale(1);',
      '  pointer-events: auto;',
      '}',
      '#_rbw-panel iframe {',
      '  width: 100%;',
      '  height: 100%;',
      '  border: none;',
      '  display: block;',
      '  border-radius: 16px;',
      '}',
      '@media (max-width: 440px) {',
      '  #_rbw-panel {',
      '    bottom: 0 !important;',
      '    right: 0 !important;',
      '    left: 0 !important;',
      '    width: 100% !important;',
      '    max-width: 100% !important;',
      '    height: 85dvh !important;',
      '    max-height: 85dvh !important;',
      '    border-radius: 16px 16px 0 0 !important;',
      '  }',
      '  #_rbw-panel iframe { border-radius: 0; }',
      '}',
    ].join('\n');

    var styleEl = document.createElement('style');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ── Create floating button ────────────────────────────────────────────────
    var btn = document.createElement('button');
    btn.id = '_rbw-btn';
    btn.setAttribute('aria-label', buttonLabel);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"' +
      ' fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      ' aria-hidden="true">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' +
      '</svg>' +
      '<span>' + _esc(buttonLabel) + '</span>';

    // Unread badge dot
    var badge = document.createElement('span');
    badge.id = '_rbw-badge';
    badge.setAttribute('aria-label', 'New message');
    btn.appendChild(badge);

    document.body.appendChild(btn);

    // ── Create panel container (iframe loaded lazily on first open) ───────────
    var panel = document.createElement('div');
    panel.id = '_rbw-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', buttonLabel);
    document.body.appendChild(panel);

    var iframeLoaded = false;
    var isOpen = false;

    function showBadge() { badge.style.display = 'block'; }
    function hideBadge() { badge.style.display = 'none'; }

    function openPanel() {
      if (!iframeLoaded) {
        var iframeParams = new URLSearchParams({
          embed: '1',
          color: accentColor.replace('#', ''),
          title: buttonLabel,
        });
        if (subtitle) iframeParams.set('subtitle', subtitle);
        if (whatsapp) iframeParams.set('whatsapp', whatsapp);

        var src = BASE_URL + '/chat/' + encodeURIComponent(profileId) + '?' + iframeParams.toString();
        var iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.title = buttonLabel;
        iframe.allow = 'autoplay; microphone';
        panel.appendChild(iframe);
        iframeLoaded = true;
      }
      panel.classList.add('open');
      isOpen = true;
      btn.setAttribute('aria-expanded', 'true');
      hideBadge();
    }

    function closePanel() {
      panel.classList.remove('open');
      isOpen = false;
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }

    btn.addEventListener('click', function () {
      if (isOpen) { closePanel(); } else { openPanel(); }
    });

    // Close on Escape key (also handles Escape sent from inside iframe via postMessage)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) { closePanel(); }
      // When panel is open and focus is on toggle button, Tab moves focus into iframe
      if (e.key === 'Tab' && !e.shiftKey && isOpen && document.activeElement === btn) {
        var iframe = panel.querySelector('iframe');
        if (iframe) {
          e.preventDefault();
          iframe.focus();
        }
      }
    });

    // ── Listen for postMessages from iframe ───────────────────────────────────
    window.addEventListener('message', function (e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'rainbow-close') {
        closePanel();
      } else if (e.data.type === 'rainbow-new-message') {
        if (!isOpen) { showBadge(); }
      } else if (e.data.type === 'rainbow-expand') {
        // Open full-page webchat in new tab — session continues via shared localStorage
        window.open(BASE_URL + '/chat/' + encodeURIComponent(profileId), '_blank', 'noopener,noreferrer');
      }
    });

    // ── Helpers ───────────────────────────────────────────────────────────────

    // Escape HTML entities for safe injection into innerHTML
    function _esc(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // Validate color looks like a hex/named color (basic sanity — no injection)
    function _safeColor(color) {
      if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
      if (/^[a-zA-Z]+$/.test(color)) return color; // named color
      return '#2563eb'; // fallback
    }
  }

  // ── Defer initialization to browser idle time ──────────────────────────────
  // requestIdleCallback defers until browser is idle; setTimeout(3s) fallback for
  // older browsers. This ensures the toggle bubble doesn't block LCP or INP.
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(initWidget);
  } else {
    setTimeout(initWidget, 3000);
  }
})();
