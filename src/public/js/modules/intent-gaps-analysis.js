/**
 * Intent Coverage Gap Analysis (US-824)
 *
 * Loads top unmatched message patterns (keyword clusters) and renders
 * an "Intent Gaps" section in the Performance tab.
 *
 * Each cluster shows: keyword, message count in last N days, an example
 * message, and a "Create Intent" shortcut that pre-fills the intent dialog.
 */

import { api } from '../core/utils.js';

let _lastGapDays = 30;

/**
 * Fetch and render the intent coverage gap analysis.
 * @param {number} [days=30] - Lookback window in days
 */
export async function loadIntentGapsAnalysis(days) {
  _lastGapDays = days || 30;
  const profileId = (window.profileSwitcher && window.profileSwitcher.getActiveProfileId()) || undefined;
  const container = document.getElementById('intent-gaps-container');
  const loading = document.getElementById('intent-gaps-loading');
  const empty = document.getElementById('intent-gaps-empty');

  if (!container) return;

  if (loading) loading.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');
  container.innerHTML = '';

  try {
    const params = new URLSearchParams({ days: String(_lastGapDays) });
    if (profileId) params.set('profileId', profileId);

    const data = await api('/analytics/intent-gaps?' + params.toString());
    if (loading) loading.classList.add('hidden');

    if (!data || !data.success) {
      renderError(container, 'Failed to load gap analysis.');
      return;
    }

    const { gaps, totalUnmatched, days: actualDays } = data;

    // Summary header
    const summaryEl = document.getElementById('intent-gaps-summary');
    if (summaryEl) {
      summaryEl.textContent = `${totalUnmatched} unmatched messages in last ${actualDays} days`;
    }

    if (!gaps || gaps.length === 0) {
      if (empty) empty.classList.remove('hidden');
      return;
    }

    // Render gap clusters
    container.innerHTML = gaps.map((gap, i) => `
      <div class="bg-white rounded-xl border p-3 hover:border-primary-300 transition-colors">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-xs font-mono bg-primary-50 text-primary-700 border border-primary-200 rounded px-2 py-0.5">${escHtml(gap.keyword)}</span>
              <span class="text-xs text-neutral-500">${gap.messageCount} message${gap.messageCount !== 1 ? 's' : ''}</span>
            </div>
            <p class="text-xs text-neutral-600 truncate" title="${escHtml(gap.exampleMessage)}">${escHtml(gap.exampleMessage)}</p>
          </div>
          <button
            class="flex-shrink-0 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-lg transition font-medium whitespace-nowrap"
            onclick="window.openCreateIntentFromGap(${JSON.stringify(escHtml(gap.sampleUtterance))})"
            title="Open intent editor pre-filled with this example"
          >
            + Create Intent
          </button>
        </div>
      </div>
    `).join('');

  } catch (err) {
    if (loading) loading.classList.add('hidden');
    console.error('[IntentGaps] Failed to load:', err);
    renderError(container, err.message || 'Error loading gap analysis.');
  }
}

function renderError(container, message) {
  container.innerHTML = `<div class="text-sm text-red-600 p-3 bg-red-50 rounded-lg border border-red-200">${escHtml(message)}</div>`;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Open the "Add Intent" dialog pre-filled with a sample utterance from a gap cluster.
 * Navigates to the Intents tab first, then opens the modal.
 *
 * @param {string} sampleUtterance - Example message to pre-fill in the patterns field
 */
window.openCreateIntentFromGap = function openCreateIntentFromGap(sampleUtterance) {
  // Navigate to Intents tab
  const intentsTabBtn = document.querySelector('[data-tab="intents"]');
  if (intentsTabBtn) {
    intentsTabBtn.click();
  }

  // Wait a tick for the tab to render, then open the add-intent modal
  setTimeout(() => {
    if (typeof window.showAddIntent === 'function') {
      window.showAddIntent();

      // Pre-fill the patterns textarea with the sample utterance
      const patternsEl = document.getElementById('add-i-patterns');
      if (patternsEl) {
        patternsEl.value = sampleUtterance || '';
      }
    } else {
      console.warn('[IntentGaps] showAddIntent not available');
    }
  }, 150);
};

// Expose for global use in performance tab
window.loadIntentGapsAnalysis = loadIntentGapsAnalysis;
