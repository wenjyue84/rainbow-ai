/**
 * wa-badge.js — single owner of the header WhatsApp status pill (#wa-badge).
 *
 * Before this file the pill was only ever updated by the dashboard / status
 * tabs, so any deep link (e.g. #settings/senai-app) left it stuck on
 * "Connecting..." forever even though /api/rainbow/status said "open".
 *
 * Classic script (global scope). Exposes:
 *   window.updateWaBadge(statusData)  — render from a /status payload
 *   window.refreshWaBadge()           — fetch /status (with the active profile
 *                                        header) and render; safe to call often
 */
(function () {
  var _pageLoadTime = Date.now();
  var INIT_WINDOW_MS = 30000;

  function updateWaBadge(statusData) {
    var badge = document.getElementById('wa-badge');
    if (!badge) return;
    var base = 'text-xs px-2.5 py-1 rounded-full border font-medium ';
    if (!statusData) {
      badge.textContent = 'status unavailable';
      badge.className = base + 'bg-neutral-100 text-neutral-500 border-neutral-200';
      badge.title = 'Could not reach /api/rainbow/status';
      return;
    }
    var waInstances = statusData.whatsappInstances || [];
    var connected = waInstances.filter(function (i) { return i.state === 'open'; }).length;
    var total = waInstances.length;
    if (total === 0 && (Date.now() - _pageLoadTime) < INIT_WINDOW_MS) {
      badge.textContent = 'initializing…';
      badge.className = base + 'bg-primary-100 text-primary-600 border-primary-200 animate-pulse';
    } else if (total === 0) {
      badge.textContent = 'no instances';
      badge.className = base + 'bg-neutral-200 text-neutral-600 border-neutral-300';
    } else if (total === 1) {
      badge.textContent = connected === 1 ? 'Connected' : 'Disconnected';
      badge.className = base + (connected === 1
        ? 'bg-success-100 text-success-700 border-success-200'
        : 'bg-danger-100 text-danger-700 border-danger-200');
    } else {
      badge.textContent = connected + '/' + total + ' connected';
      badge.className = base + (connected === total ? 'bg-success-100 text-success-700 border-success-200'
        : connected > 0 ? 'bg-warning-100 text-warning-700 border-warning-200'
          : 'bg-danger-100 text-danger-700 border-danger-200');
    }
    var label = waInstances.map(function (i) { return (i.label || i.id) + ': ' + i.state; }).join(', ');
    badge.title = label || 'No WhatsApp instance reported by the bridge';
  }

  function refreshWaBadge() {
    var headers = { 'Content-Type': 'application/json' };
    if (window.__ADMIN_KEY__) headers['x-admin-key'] = window.__ADMIN_KEY__;
    if (window.profileSwitcher && typeof window.profileSwitcher.getHeaders === 'function') {
      var ph = window.profileSwitcher.getHeaders();
      for (var k in ph) headers[k] = ph[k];
    }
    return fetch('/api/rainbow/status', { cache: 'no-store', headers: headers })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(updateWaBadge)
      .catch(function () { updateWaBadge(null); });
  }

  window.updateWaBadge = updateWaBadge;
  window.refreshWaBadge = refreshWaBadge;
})();
