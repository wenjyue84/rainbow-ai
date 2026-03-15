/**
 * messaging-limits.js — Messaging Limits tab for Settings page (US-890)
 *
 * Displays current WhatsApp Business Portfolio messaging tier and 24-hour usage.
 * Allows admins to update the tier (only valid tiers: 10000, 100000, unlimited).
 * Meta removed 250 and 2000 tiers in Q2 2026; this UI enforces the new model.
 */
import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

// Valid tiers per US-890 (250 and 2000 removed)
const VALID_TIERS = [
  { value: '10000', label: '10,000 / day' },
  { value: '100000', label: '100,000 / day' },
  { value: 'unlimited', label: 'Unlimited' },
];

// ─── Main Renderer ─────────────────────────────────────────────────

export async function renderMessagingLimitsTab(container) {
  container.innerHTML =
    '<div class="bg-white border rounded-2xl p-6">' +
      '<div class="flex items-start justify-between mb-1">' +
        '<div>' +
          '<h3 class="font-semibold text-lg">Messaging Limits</h3>' +
          '<p class="text-sm text-neutral-500 mt-0.5 font-medium">WhatsApp Business Portfolio daily messaging tier. Meta removed the 250 and 2,000 tiers in Q2 2026 — all verified businesses now start at 10K/day.</p>' +
        '</div>' +
      '</div>' +
      '<div id="messaging-limits-content" class="mt-5">' +
        '<div class="p-8 text-center"><div class="spinner mx-auto"></div><p class="text-sm text-neutral-500 mt-2">Loading...</p></div>' +
      '</div>' +
    '</div>';

  try {
    const result = await api('/analytics/messaging-limits');
    const d = result.data || result;
    renderContent(d);
  } catch (e) {
    const el = document.getElementById('messaging-limits-content');
    if (el) el.innerHTML = '<div class="p-4 text-red-600 text-sm">Failed to load messaging limits: ' + esc(String(e.message || e)) + '</div>';
  }
}
window.renderMessagingLimitsTab = renderMessagingLimitsTab;

function renderContent(d) {
  const el = document.getElementById('messaging-limits-content');
  if (!el) return;

  const tier = d.tier || '100000';
  const used24h = d.used24h || 0;
  const limit = d.limit === 'unlimited' ? Infinity : Number(d.limit || 100000);
  const percentUsed = d.percentUsed || 0;
  const pacingPaused = d.pacingPaused || false;

  const limitLabel = limit === Infinity ? 'Unlimited' : limit.toLocaleString();
  const barWidth = limit === Infinity ? 0 : Math.min(percentUsed, 100);
  const barColor = percentUsed >= 90 ? 'bg-red-500' : percentUsed >= 70 ? 'bg-amber-500' : 'bg-green-500';

  const pacingBanner = pacingPaused
    ? '<div class="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 flex items-start gap-2">' +
        '<svg class="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"/></svg>' +
        '<span><strong>Pacing paused</strong> — Meta has temporarily slowed delivery for this campaign due to delivery issues.</span>' +
      '</div>'
    : '';

  const tierOptions = VALID_TIERS.map(t =>
    '<option value="' + esc(t.value) + '"' + (t.value === tier ? ' selected' : '') + '>' + esc(t.label) + '</option>'
  ).join('');

  el.innerHTML =
    pacingBanner +

    // Usage card
    '<div class="p-4 bg-neutral-50 border rounded-xl mb-5">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<span class="text-sm font-medium text-neutral-700">24-hour outbound messages</span>' +
        '<span class="text-sm font-bold text-neutral-900">' + used24h.toLocaleString() + ' / ' + limitLabel + '</span>' +
      '</div>' +
      '<div class="w-full bg-neutral-200 rounded-full h-2">' +
        '<div class="' + barColor + ' h-2 rounded-full transition-all" style="width:' + barWidth + '%"></div>' +
      '</div>' +
      (limit !== Infinity ? '<p class="text-xs text-neutral-400 mt-1">' + percentUsed + '% used</p>' : '') +
    '</div>' +

    // Tier selector
    '<div class="border rounded-xl p-5">' +
      '<label class="block text-sm font-bold text-neutral-800 mb-1">Portfolio Messaging Tier</label>' +
      '<p class="text-xs text-neutral-500 mb-3">Update this when Meta upgrades your account tier. Only the current Meta Q2 2026 tiers are shown (250 and 2,000 were removed).</p>' +
      '<div class="flex items-center gap-3">' +
        '<select id="messaging-tier-select" class="px-3 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition">' +
          tierOptions +
        '</select>' +
        '<button onclick="saveMessagingLimitsTier()" class="px-5 py-2 bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition font-bold text-sm shadow-sm">' +
          'Save Tier' +
        '</button>' +
      '</div>' +
    '</div>';
}

// ─── Save Handler ───────────────────────────────────────────────────

export async function saveMessagingLimitsTier() {
  const select = document.getElementById('messaging-tier-select');
  if (!select) return;

  const tier = select.value;

  try {
    await api('/analytics/messaging-limits/tier', { method: 'PUT', body: JSON.stringify({ tier }) });
    toast('Messaging tier updated to ' + tier, 'success');
  } catch (e) {
    toast('Failed to update tier: ' + String(e.message || e), 'error');
  }
}
window.saveMessagingLimitsTier = saveMessagingLimitsTier;
