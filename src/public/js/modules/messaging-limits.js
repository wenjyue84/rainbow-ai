/**
 * messaging-limits.js — WhatsApp Portfolio Messaging Limits (US-890)
 *
 * Renders the tier selector card in the Settings > Messaging Limits tab.
 * Only '10000', '100000', and 'unlimited' are valid after Meta's Q2 2026 update.
 */

import { api, toast } from '../core/utils.js';

// Tiers valid after Meta Q2 2026 (250 and 2000 removed)
const VALID_TIERS = [
  { value: '10000',   label: '10,000 / day',   desc: 'Standard verified business' },
  { value: '100000',  label: '100,000 / day',  desc: 'High-volume (Meta Q2 2026 default)' },
  { value: 'unlimited', label: 'Unlimited',    desc: 'Enterprise tier' },
];

let _currentData = null;

/**
 * Render the Messaging Limits tab into the given container.
 * @param {HTMLElement} container
 */
export async function renderMessagingLimitsTab(container) {
  container.innerHTML = '<div class="p-8 text-center"><div class="spinner mx-auto"></div><p class="text-sm text-neutral-500 mt-2">Loading messaging limits...</p></div>';

  try {
    const res = await api('/analytics/messaging-limits');
    _currentData = res.data || {};
    _render(container);
  } catch (err) {
    container.innerHTML = '<div class="p-6 text-danger-600 text-sm">Failed to load messaging limits: ' + (err.message || err) + '</div>';
  }
}

function _render(container) {
  const { tier = '100000', used24h = 0, limit, percentUsed = 0 } = _currentData;
  const limitStr = limit === 'unlimited' ? '∞' : (limit != null ? Number(limit).toLocaleString() : '—');
  const pct = Math.min(100, Math.round(percentUsed));
  const barColor = pct >= 90 ? 'bg-danger-500' : pct >= 75 ? 'bg-warning-500' : 'bg-success-500';

  container.innerHTML =
    '<div class="bg-white border rounded-2xl p-6 space-y-6">' +

      // Header
      '<div>' +
        '<h3 class="font-semibold text-lg text-neutral-800">WhatsApp Messaging Limits</h3>' +
        '<p class="text-sm text-neutral-500 mt-1">Meta removed the 250 and 2,000 tiers in Q2 2026. ' +
        'All verified businesses now receive 100,000/day by default.</p>' +
      '</div>' +

      // 24h usage bar
      '<div class="bg-neutral-50 border rounded-xl p-4">' +
        '<div class="flex items-center justify-between mb-2">' +
          '<span class="text-sm font-medium text-neutral-700">24-hour outbound usage</span>' +
          '<span class="text-sm font-mono text-neutral-600">' + used24h.toLocaleString() + ' / ' + limitStr + '</span>' +
        '</div>' +
        '<div class="w-full bg-neutral-200 rounded-full h-2">' +
          '<div class="' + barColor + ' h-2 rounded-full transition-all" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<p class="text-xs text-neutral-400 mt-1.5">' + pct + '% of daily limit used</p>' +
      '</div>' +

      // Tier selector
      '<div>' +
        '<label class="block text-sm font-bold text-neutral-800 mb-3">Portfolio Tier</label>' +
        '<select id="ml-tier-select" class="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white shadow-soft text-sm">' +
          VALID_TIERS.map(t =>
            '<option value="' + t.value + '"' + (t.value === tier ? ' selected' : '') + '>' +
            t.label + ' — ' + t.desc + '</option>'
          ).join('') +
        '</select>' +
        '<p class="text-xs text-neutral-400 mt-2">Tiers 250 and 2,000 were removed by Meta in Q2 2026 and are no longer selectable.</p>' +
      '</div>' +

      // Save button
      '<div class="flex items-center gap-3">' +
        '<button onclick="saveMessagingLimitsTier()" class="px-6 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition shadow-medium font-medium text-sm">' +
          'Save Tier' +
        '</button>' +
        '<span id="ml-save-status" class="text-sm text-neutral-500"></span>' +
      '</div>' +

    '</div>';
}

/**
 * Save the selected tier via PUT /analytics/messaging-limits/tier.
 */
export async function saveMessagingLimitsTier() {
  const select = document.getElementById('ml-tier-select');
  const statusEl = document.getElementById('ml-save-status');
  if (!select) return;

  const tier = select.value;
  if (statusEl) statusEl.textContent = 'Saving…';

  try {
    await api('/analytics/messaging-limits/tier', { method: 'PUT', body: { tier } });
    if (statusEl) { statusEl.textContent = '✓ Saved'; setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000); }
    toast('Messaging tier updated to ' + tier, 'success');
    if (_currentData) _currentData.tier = tier;
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Error: ' + (err.message || 'Save failed');
    toast('Failed to save tier: ' + (err.message || err), 'error');
  }
}
