/**
 * template-linter-settings.js — Template Linter Config tab for Settings (US-1013)
 *
 * Renders the "Template Linter" sub-tab inside Settings.
 * Allows admins to view and edit the marketing keyword list used by the
 * real-time utility template linter in the WhatsApp Template Authoring tab.
 *
 * The linter rules are persisted server-side in settings.json under
 * settings.templateLinter.marketingKeywords (US-1013 AC #3).
 */

import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml as esc } from '../core/utils.js';

// ─── Main Renderer ─────────────────────────────────────────────────────────────

export async function renderTemplateLinterTab(container) {
  container.innerHTML =
    '<div class="bg-white border border-neutral-200 rounded-2xl p-6">' +
      '<div class="flex items-start justify-between mb-1">' +
        '<div>' +
          '<h3 class="font-semibold text-lg">Utility Template Linter</h3>' +
          '<p class="text-sm text-neutral-500 mt-0.5">Configure the marketing keyword list used by the real-time utility template linter. ' +
          'Phrases on this list trigger a warning when detected in a template categorised as <strong>Utility</strong>. ' +
          'Meta\'s July 2025 pricing update reclassifies utility templates containing promotional content as Marketing, doubling the per-message cost.</p>' +
        '</div>' +
      '</div>' +
      '<div id="template-linter-content" class="mt-5">' +
        '<div class="text-center py-8 text-neutral-400 text-sm">Loading linter config...</div>' +
      '</div>' +
    '</div>';

  try {
    const data = await api('/wa-templates/linter-config');
    renderLinterContent(data);
  } catch (e) {
    const content = document.getElementById('template-linter-content');
    if (content) {
      content.innerHTML = '<div class="text-red-500 text-sm">Failed to load linter config: ' + esc(String(e)) + '</div>';
    }
  }
}

// ─── Render content after data load ───────────────────────────────────────────

function renderLinterContent(data) {
  const content = document.getElementById('template-linter-content');
  if (!content) return;

  const enabled = data.enabled !== false;
  const keywords = Array.isArray(data.marketingKeywords) ? data.marketingKeywords : [];

  content.innerHTML =
    // Enable toggle
    '<div class="flex items-center justify-between p-4 bg-neutral-50 rounded-xl mb-5">' +
      '<div>' +
        '<p class="font-medium text-neutral-800 text-sm">Linter Enabled</p>' +
        '<p class="text-xs text-neutral-500 mt-0.5">When enabled, the authoring UI highlights marketing phrases in real time</p>' +
      '</div>' +
      '<label class="relative inline-flex items-center cursor-pointer">' +
        '<input type="checkbox" id="linter-enabled-toggle" class="sr-only peer" ' + (enabled ? 'checked' : '') + '>' +
        '<div class="w-11 h-6 bg-neutral-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary-400 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[\'\'] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary-600"></div>' +
      '</label>' +
    '</div>' +

    // Keyword list
    '<div class="mb-4">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<div>' +
          '<p class="font-medium text-neutral-800 text-sm">Marketing Keywords</p>' +
          '<p class="text-xs text-neutral-500 mt-0.5">' + keywords.length + ' phrase' + (keywords.length !== 1 ? 's' : '') + ' configured</p>' +
        '</div>' +
        '<button onclick="linterAddKeyword()" class="text-xs bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 rounded-lg transition">+ Add Phrase</button>' +
      '</div>' +
      '<div id="linter-keywords-list" class="space-y-1.5 max-h-72 overflow-y-auto pr-1">' +
        renderKeywordList(keywords) +
      '</div>' +
    '</div>' +

    // Add new keyword input (hidden by default)
    '<div id="linter-add-form" class="hidden mb-4 p-3 bg-neutral-50 rounded-xl border border-neutral-200">' +
      '<p class="text-xs font-medium text-neutral-700 mb-2">New Marketing Phrase</p>' +
      '<div class="flex gap-2">' +
        '<input type="text" id="linter-new-keyword" placeholder="e.g. limited time offer"' +
          ' class="flex-1 border border-neutral-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"' +
          ' onkeydown="linterNewKeywordKeydown(event)" />' +
        '<button onclick="linterConfirmAdd()" class="bg-primary-600 hover:bg-primary-700 text-white text-sm px-3 py-1.5 rounded-lg transition">Add</button>' +
        '<button onclick="linterCancelAdd()" class="text-sm text-neutral-500 px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition">Cancel</button>' +
      '</div>' +
    '</div>' +

    // Save button
    '<div class="flex items-center gap-3 pt-2 border-t border-neutral-100">' +
      '<button onclick="linterSaveConfig()" class="bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium px-5 py-2 rounded-xl transition">Save Changes</button>' +
      '<button onclick="linterResetDefaults()" class="text-sm text-neutral-500 hover:text-neutral-700 px-4 py-2 rounded-xl border border-neutral-200 hover:bg-neutral-50 transition">Reset to Defaults</button>' +
      '<span id="linter-save-status" class="text-xs text-neutral-400 ml-1"></span>' +
    '</div>';

  // Bind module-level functions into window scope
  window._linterKeywords = [...keywords];

  window.linterAddKeyword = function () {
    const form = document.getElementById('linter-add-form');
    const input = document.getElementById('linter-new-keyword');
    if (form) form.classList.remove('hidden');
    if (input) { input.value = ''; input.focus(); }
  };

  window.linterCancelAdd = function () {
    const form = document.getElementById('linter-add-form');
    if (form) form.classList.add('hidden');
  };

  window.linterNewKeywordKeydown = function (e) {
    if (e.key === 'Enter') window.linterConfirmAdd();
    if (e.key === 'Escape') window.linterCancelAdd();
  };

  window.linterConfirmAdd = function () {
    const input = document.getElementById('linter-new-keyword');
    const val = (input ? input.value : '').trim().toLowerCase();
    if (!val) return;
    if (window._linterKeywords.includes(val)) {
      toast('Phrase already in list', 'warning');
      return;
    }
    window._linterKeywords.push(val);
    const listEl = document.getElementById('linter-keywords-list');
    if (listEl) listEl.innerHTML = renderKeywordList(window._linterKeywords);
    window.linterCancelAdd();
    rebindRemoveButtons();
  };

  window.linterRemoveKeyword = function (idx) {
    window._linterKeywords.splice(idx, 1);
    const listEl = document.getElementById('linter-keywords-list');
    if (listEl) listEl.innerHTML = renderKeywordList(window._linterKeywords);
    rebindRemoveButtons();
  };

  window.linterSaveConfig = async function () {
    const enabledToggle = document.getElementById('linter-enabled-toggle');
    const enabled = enabledToggle ? enabledToggle.checked : true;
    const statusEl = document.getElementById('linter-save-status');

    if (statusEl) statusEl.textContent = 'Saving...';

    try {
      await api('/wa-templates/linter-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, marketingKeywords: window._linterKeywords }),
      });
      toast('Linter config saved', 'success');
      if (statusEl) {
        statusEl.textContent = 'Saved!';
        setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 3000);
      }
    } catch (e) {
      toast('Failed to save: ' + String(e), 'error');
      if (statusEl) statusEl.textContent = 'Save failed.';
    }
  };

  const DEFAULT_MARKETING_KEYWORDS = [
    'discount','offer','save','limited time','promocode','promo code',
    'voucher','cashback','free gift','buy now','shop now','order now','exclusive deal',
    'flash sale','sale','% off','act now','don\'t miss','hurry','expires soon','coupon',
    'redeem','win','contest','giveaway','click here','special offer','limited offer',
    'today only','best price'
  ];

  window.linterResetDefaults = async function () {
    if (!confirm('Reset to default marketing keywords? This will overwrite your current list.')) return;
    const statusEl = document.getElementById('linter-save-status');
    if (statusEl) statusEl.textContent = 'Resetting...';
    try {
      const data = await api('/wa-templates/linter-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketingKeywords: DEFAULT_MARKETING_KEYWORDS }),
      });
      const kws = Array.isArray(data.marketingKeywords) ? data.marketingKeywords : DEFAULT_MARKETING_KEYWORDS;
      window._linterKeywords = [...kws];
      const listEl = document.getElementById('linter-keywords-list');
      if (listEl) listEl.innerHTML = renderKeywordList(kws);
      rebindRemoveButtons();
      toast('Reset to defaults', 'success');
      if (statusEl) statusEl.textContent = '';
    } catch (e) {
      toast('Reset failed: ' + String(e), 'error');
      if (statusEl) statusEl.textContent = 'Reset failed.';
    }
  };

  rebindRemoveButtons();
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function renderKeywordList(keywords) {
  if (!keywords || keywords.length === 0) {
    return '<p class="text-xs text-neutral-400 italic py-2">No keywords configured.</p>';
  }
  return keywords.map(function (kw, idx) {
    return '<div class="flex items-center justify-between px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg">' +
      '<span class="text-xs text-neutral-700 font-mono">' + esc(kw) + '</span>' +
      '<button data-kw-idx="' + idx + '" onclick="linterRemoveKeyword(' + idx + ')" ' +
        'class="text-neutral-400 hover:text-red-500 text-xs px-1.5 transition" title="Remove">✕</button>' +
    '</div>';
  }).join('');
}

function rebindRemoveButtons() {
  // Buttons are rendered with inline onclick — no rebinding needed.
  // This function is kept as a no-op hook for future enhancement.
}
