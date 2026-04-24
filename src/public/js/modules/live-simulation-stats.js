// ═══════════════════════════════════════════════════════════════════
// Live Simulation Stats — sidebar aggregation + filter chips
// ═══════════════════════════════════════════════════════════════════
//
// Pure client-side aggregation: tier histogram, avg/p95 latency,
// token total, fallback rate, low-confidence count. Also renders
// the filter chip strip (tier / fallback-only / low-conf / has-error).

import { $ } from './live-simulation-state.js';
import { summariseMessage } from './live-simulation-badges.js';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** Collect summaries for assistant messages currently in $.messages. */
export function aggregateStats() {
  const summaries = [];
  for (const msg of $.messages) {
    const s = summariseMessage(msg, $.traceByMessageKey.get(msg.role + ':' + msg.timestamp));
    if (s) summaries.push(s);
  }

  const tierCounts = { T1: 0, T2: 0, T3: 0, T4: 0, unknown: 0 };
  const latencies = [];
  let tokenTotal = 0;
  let fallbackCount = 0;
  let lowConfCount = 0;
  let errorCount = 0;

  for (const s of summaries) {
    tierCounts[s.tier] = (tierCounts[s.tier] || 0) + 1;
    if (s.latency != null) latencies.push(s.latency);
    tokenTotal += s.tokens || 0;
    if (s.fallback) fallbackCount++;
    if (s.confidence != null && s.confidence < 0.6) lowConfCount++;
    if (s.hasError) errorCount++;
  }

  const total = summaries.length || 1;
  const avgLatency = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : 0;
  const p95Latency = percentile(latencies, 95);

  return {
    totalMessages: $.messages.length,
    botReplies: summaries.length,
    tierCounts,
    tierPct: {
      T1: Math.round((tierCounts.T1 / total) * 100),
      T2: Math.round((tierCounts.T2 / total) * 100),
      T3: Math.round((tierCounts.T3 / total) * 100),
      T4: Math.round((tierCounts.T4 / total) * 100),
    },
    avgLatency,
    p95Latency,
    tokenTotal,
    fallbackPct: Math.round((fallbackCount / total) * 100),
    lowConfCount,
    errorCount,
  };
}

function bar(pct) {
  const filled = Math.round(pct / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

/** Render the audit sidebar (filters + stats) into #ls-audit-sidebar. */
export function renderStatsSidebar() {
  const host = document.getElementById('ls-audit-sidebar');
  if (!host) return;
  const s = aggregateStats();
  const f = $.filters;

  const tiers = ['T1', 'T2', 'T3', 'T4'];
  const tierTooltips = {
    T1: 'Tier 1 — direct keyword match. Rule-based, fastest response.',
    T2: 'Tier 2 — fuzzy keyword match. Broader rule coverage.',
    T3: 'Tier 3 — AI intent classification. ML-based routing.',
    T4: 'Tier 4 — full LLM response. Slowest, most capable.',
  };
  const tierChips = tiers.map((t) =>
    '<button class="ls-chip ' + (f.tier.has(t) ? 'active' : '') + '" '
    + 'data-tooltip="' + tierTooltips[t] + '" '
    + 'onclick="window.toggleLiveSimTier(\'' + t + '\')">' + t + '</button>'
  ).join('');

  host.innerHTML = ''
    + '<div class="ls-audit-section">'
    + '  <h4>Filters</h4>'
    + '  <div class="ls-chip-row">'
    + '    <button class="ls-chip ' + (f.tier.size === 0 && !f.fallbackOnly && !f.lowConfOnly && !f.hasErrorOnly ? 'active' : '') + '" '
    + '      data-tooltip="Show all messages (clear all filters)" '
    + '      onclick="window.clearLiveSimFilters()">All</button>'
    + tierChips
    + '  </div>'
    + '  <div class="ls-chip-row">'
    + '    <button class="ls-chip ' + (f.fallbackOnly ? 'active' : '') + '" '
    + '      data-tooltip="Show only messages that triggered a fallback (no intent matched)" '
    + '      onclick="window.toggleLiveSimFlag(\'fallbackOnly\')">Fallback</button>'
    + '    <button class="ls-chip ' + (f.lowConfOnly ? 'active' : '') + '" '
    + '      data-tooltip="Show only messages where confidence score &lt; 0.6" '
    + '      onclick="window.toggleLiveSimFlag(\'lowConfOnly\')">LowConf</button>'
    + '    <button class="ls-chip ' + (f.hasErrorOnly ? 'active' : '') + '" '
    + '      data-tooltip="Show only messages that encountered a processing error" '
    + '      onclick="window.toggleLiveSimFlag(\'hasErrorOnly\')">HasError</button>'
    + '  </div>'
    + '</div>'
    + '<div class="ls-audit-section">'
    + '  <h4>Stats</h4>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="Total messages in this conversation (user + bot combined)">Msgs</span><span>' + s.totalMessages + '</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="Number of AI-generated bot responses">Bot replies</span><span>' + s.botReplies + '</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="Mean response time across all bot replies">Avg latency</span><span>' + s.avgLatency + ' ms</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="95th percentile response time — 95% of replies finished within this duration">p95 latency</span><span>' + (s.p95Latency >= 1000 ? (s.p95Latency / 1000).toFixed(1) + 's' : s.p95Latency + ' ms') + '</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="Total LLM tokens consumed across all bot replies">Tokens</span><span>' + (s.tokenTotal >= 1000 ? (s.tokenTotal / 1000).toFixed(1) + 'k' : s.tokenTotal) + '</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="% of bot replies that used a fallback response (no intent matched)">Fallback</span><span>' + s.fallbackPct + '%</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="Replies where intent confidence score was below 0.6 threshold">Low-conf</span><span>' + s.lowConfCount + '</span></div>'
    + '  <div class="ls-stat-row"><span class="ls-stat-label" data-tooltip="Replies that encountered a processing error">Errors</span><span>' + s.errorCount + '</span></div>'
    + '</div>'
    + '<div class="ls-audit-section">'
    + '  <h4>Tier mix</h4>'
    + tiers.map((t) =>
      '<div class="ls-tier-row"><span data-tooltip="' + tierTooltips[t] + '">' + t + '</span>'
      + '<span class="ls-tier-bar">' + bar(s.tierPct[t] || 0) + '</span>'
      + '<span>' + (s.tierPct[t] || 0) + '%</span></div>'
    ).join('')
    + '</div>';
}

/** Filter predicate — returns true if a message should be shown. */
export function passesFilter(msg) {
  const f = $.filters;
  if (msg.role === 'user') return true;
  if (msg.manual) {
    return !(f.tier.size > 0 || f.fallbackOnly || f.lowConfOnly || f.hasErrorOnly);
  }
  const summary = summariseMessage(msg, $.traceByMessageKey.get(msg.role + ':' + msg.timestamp));
  if (!summary) return true;
  if (f.tier.size > 0 && !f.tier.has(summary.tier)) return false;
  if (f.fallbackOnly && !summary.fallback) return false;
  if (f.lowConfOnly && !(summary.confidence != null && summary.confidence < 0.6)) return false;
  if (f.hasErrorOnly && !summary.hasError) return false;
  if (f.intent && summary.intent !== f.intent) return false;
  return true;
}
