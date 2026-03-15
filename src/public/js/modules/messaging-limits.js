/**
 * Messaging Limits Tier Selector (US-890)
 *
 * Admin UI for viewing and changing the WhatsApp Business Portfolio
 * messaging tier. Only shows valid tiers after Meta Q2 2026 flat-cap migration.
 */

import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

const api = window.api;

const VALID_TIERS = [
  { value: '10000', label: '10,000 / day' },
  { value: '100000', label: '100,000 / day' },
  { value: 'unlimited', label: 'Unlimited' },
];

/**
 * Render the Messaging Limits settings tab.
 */
export function renderMessagingLimitsTab(container) {
  container.innerHTML =
    '<div class="bg-white border rounded-2xl p-6">' +
      '<h3 class="font-semibold text-lg mb-1">Messaging Limits</h3>' +
      '<p class="text-sm text-neutral-500 mb-5">WhatsApp Business Portfolio messaging tier (Meta Q2 2026 flat-cap model).</p>' +
      '<div id="messaging-limits-content">' +
        '<div class="p-8 text-center"><div class="spinner mx-auto"></div>' +
        '<p class="text-sm text-neutral-500 mt-2">Loading current tier...</p></div>' +
      '</div>' +
    '</div>';

  loadMessagingLimits();
}

async function loadMessagingLimits() {
  const wrapper = document.getElementById('messaging-limits-content');
  if (!wrapper) return;

  try {
    const result = await api('/analytics/messaging-limits');
    const data = result.data || result;

    const options = VALID_TIERS.map(t => {
      const selected = t.value === String(data.tier) ? ' selected' : '';
      return '<option value="' + esc(t.value) + '"' + selected + '>' + esc(t.label) + '</option>';
    }).join('');

    const used = data.used24h != null ? Number(data.used24h).toLocaleString() : '—';
    const limit = data.limit === 'unlimited' ? 'Unlimited' : (data.limit != null ? Number(data.limit).toLocaleString() : '—');
    const pct = data.percentUsed != null ? data.percentUsed + '%' : '—';

    wrapper.innerHTML =
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-6">' +
        // Current usage card
        '<div class="border rounded-xl p-4">' +
          '<h4 class="text-sm font-bold text-neutral-700 mb-3">24h Usage</h4>' +
          '<div class="space-y-2 text-sm">' +
            '<div class="flex justify-between"><span class="text-neutral-500">Messages sent</span><span class="font-mono font-bold">' + used + '</span></div>' +
            '<div class="flex justify-between"><span class="text-neutral-500">Tier limit</span><span class="font-mono font-bold">' + limit + '</span></div>' +
            '<div class="flex justify-between"><span class="text-neutral-500">Used</span><span class="font-mono font-bold">' + pct + '</span></div>' +
          '</div>' +
        '</div>' +
        // Tier selector card
        '<div class="border rounded-xl p-4">' +
          '<h4 class="text-sm font-bold text-neutral-700 mb-3">Portfolio Tier</h4>' +
          '<select id="messaging-limits-tier-select" class="w-full px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition">' +
            options +
          '</select>' +
          '<p class="text-xs text-neutral-400 mt-2">Meta removed the 250 and 2,000 tiers in Q2 2026. All verified businesses start at 100K.</p>' +
          '<button onclick="saveMessagingLimitsTier()" class="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition font-bold text-sm shadow-medium">Save Tier</button>' +
        '</div>' +
      '</div>';
  } catch (err) {
    wrapper.innerHTML = '<div class="text-red-600 text-sm p-4">Failed to load messaging limits: ' + esc(err.message || err) + '</div>';
  }
}

/**
 * Save the selected tier via PUT.
 */
export async function saveMessagingLimitsTier() {
  const select = document.getElementById('messaging-limits-tier-select');
  if (!select) return;

  const tier = select.value;
  try {
    await api('/analytics/messaging-limits/tier', {
      method: 'PUT',
      body: JSON.stringify({ tier }),
    });
    toast('Messaging tier updated to ' + tier);
    loadMessagingLimits(); // Refresh display
  } catch (err) {
    toast('Failed to save tier: ' + (err.message || err), 'error');
  }
}
