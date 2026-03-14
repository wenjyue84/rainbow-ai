/**
 * Analytics KPIs Module (US-811)
 * Fetches and renders CSAT, resolution rate, handoff rate, fallback rate
 */

import { api } from '../core/utils.js';

/**
 * Fetch and render KPI metrics for the current profile and date range
 */
export async function refreshKpiMetrics() {
  const daysSelect = document.getElementById('kpi-days-select');
  const days = daysSelect ? daysSelect.value : '30';
  const profileId = (window.profileSwitcher && window.profileSwitcher.getActiveProfileId()) || undefined;

  const csatEl = document.getElementById('kpi-csat-value');
  const resolutionEl = document.getElementById('kpi-resolution-value');
  const handoffEl = document.getElementById('kpi-handoff-value');
  const fallbackEl = document.getElementById('kpi-fallback-value');

  // Show loading state
  [csatEl, resolutionEl, handoffEl, fallbackEl].forEach(el => {
    if (el) el.textContent = '...';
  });

  try {
    const params = new URLSearchParams({ days });
    if (profileId) params.set('profileId', profileId);
    const data = await api('/analytics/kpis?' + params.toString());
    if (!data || !data.kpis) return;

    const { kpis, alerts } = data;

    // CSAT
    if (csatEl) {
      csatEl.textContent = kpis.csat.score !== null ? kpis.csat.score + '%' : '-';
    }
    styleCard('kpi-card-csat', kpis.csat.alert, kpis.csat.score);

    // Resolution Rate
    if (resolutionEl) {
      resolutionEl.textContent = kpis.resolutionRate.rate !== null ? kpis.resolutionRate.rate + '%' : '-';
    }
    styleCard('kpi-card-resolution', kpis.resolutionRate.alert, kpis.resolutionRate.rate);

    // Handoff Rate
    if (handoffEl) {
      handoffEl.textContent = kpis.handoffRate.rate !== null ? kpis.handoffRate.rate + '%' : '-';
    }
    const handoffDetail = document.getElementById('kpi-handoff-detail');
    if (handoffDetail) {
      handoffDetail.textContent = kpis.handoffRate.totalEscalations + ' escalations';
    }
    styleCard('kpi-card-handoff', false, null);

    // Fallback Rate
    if (fallbackEl) {
      fallbackEl.textContent = kpis.fallbackRate.rate !== null ? kpis.fallbackRate.rate + '%' : '-';
    }
    const fallbackDetail = document.getElementById('kpi-fallback-detail');
    if (fallbackDetail) {
      fallbackDetail.textContent = kpis.fallbackRate.unknownMessages + ' / ' + kpis.fallbackRate.totalUserMessages + ' msgs';
    }
    styleCard('kpi-card-fallback', false, null);

    // Alerts banner
    renderAlertsBanner(alerts || []);
  } catch (err) {
    console.error('[KPIs] Failed to fetch:', err);
    [csatEl, resolutionEl, handoffEl, fallbackEl].forEach(el => {
      if (el) el.textContent = '-';
    });
  }
}

function styleCard(cardId, alert, value) {
  const card = document.getElementById(cardId);
  if (!card) return;

  // Reset
  card.classList.remove('border-red-400', 'bg-red-50', 'border-green-400', 'bg-green-50');
  card.classList.add('border-neutral-200');

  if (alert) {
    card.classList.remove('border-neutral-200');
    card.classList.add('border-red-400', 'bg-red-50');
  } else if (value !== null && value !== undefined) {
    card.classList.remove('border-neutral-200');
    card.classList.add('border-green-400', 'bg-green-50');
  }
}

function renderAlertsBanner(alerts) {
  const banner = document.getElementById('kpi-alerts-banner');
  if (!banner) return;

  if (alerts.length === 0) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  banner.classList.remove('hidden');
  banner.innerHTML = alerts.map(a =>
    '<div class="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg mb-1">' +
    '<span class="font-bold">!</span> ' +
    '<span>' + escapeText(a.message) + '</span>' +
    '</div>'
  ).join('');
}

function escapeText(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
