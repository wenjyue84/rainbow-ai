// ═══════════════════════════════════════════════════════════════════
// Live Simulation Replay — modal that drives /admin/replay-classification
// ═══════════════════════════════════════════════════════════════════
//
// Modal overlay: text input + profile selector + Run. POSTs to the
// new dry-run endpoint and paints a per-stage timeline. Includes
// "Copy as cURL" and "Copy JSON" helpers.

import { $ } from './live-simulation-state.js';

const api = window.api;

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ensureModal() {
  let host = document.getElementById('ls-replay-modal');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'ls-replay-modal';
  host.className = 'ls-modal';
  host.style.display = 'none';
  document.body.appendChild(host);
  return host;
}

function getProfileId() {
  if (window.profileSwitcher && typeof window.profileSwitcher.getActiveProfileId === 'function') {
    return window.profileSwitcher.getActiveProfileId() || 'pelangi';
  }
  return 'pelangi';
}

export function openReplayModal() {
  const host = ensureModal();
  host.style.display = 'flex';
  host.innerHTML = ''
    + '<div class="ls-modal-backdrop" onclick="window.closeLiveSimReplay()"></div>'
    + '<div class="ls-modal-card">'
    + '  <div class="ls-modal-header">'
    + '    <h3>Replay Classification</h3>'
    + '    <button class="ls-drawer-close" onclick="window.closeLiveSimReplay()">&times;</button>'
    + '  </div>'
    + '  <div class="ls-modal-body">'
    + '    <label class="ls-modal-label">Message text</label>'
    + '    <textarea id="ls-replay-text" rows="3" placeholder="berapa rate tonight"></textarea>'
    + '    <div class="ls-modal-row">'
    + '      <label class="ls-modal-label">Profile</label>'
    + '      <input type="text" id="ls-replay-profile" value="' + esc(getProfileId()) + '">'
    + '      <label class="ls-modal-label">Conversation</label>'
    + '      <input type="text" id="ls-replay-convo" value="' + esc($.activePhone || '') + '" placeholder="(optional)">'
    + '    </div>'
    + '    <div class="ls-modal-actions">'
    + '      <button class="ls-btn primary" onclick="window.runLiveSimReplay()">Run</button>'
    + '      <button class="ls-btn" onclick="window.copyLiveSimReplayCurl()">Copy as cURL</button>'
    + '      <button class="ls-btn" onclick="window.copyLiveSimReplayJson()">Copy JSON</button>'
    + '    </div>'
    + '    <div id="ls-replay-result" class="ls-replay-result"></div>'
    + '  </div>'
    + '</div>';
}

export function closeReplayModal() {
  const host = document.getElementById('ls-replay-modal');
  if (host) host.style.display = 'none';
}

let _lastPayload = null;
let _lastResponse = null;

function buildPayload() {
  const text = (document.getElementById('ls-replay-text') || {}).value || '';
  const profile = (document.getElementById('ls-replay-profile') || {}).value || 'pelangi';
  const convo = (document.getElementById('ls-replay-convo') || {}).value || '';
  const payload = { text: text.trim(), profile: profile.trim(), dryRun: true };
  if (convo.trim()) payload.conversationId = convo.trim();
  return payload;
}

function renderStage(name, label, data) {
  if (!data) return '';
  const ms = data.ms != null ? '<span class="ls-stage-ms">' + data.ms + ' ms</span>' : '';
  const summary = (() => {
    if (name === 'inputNormalizer') return esc(data.normalized || '');
    if (name === 'manglishNormalizer') return esc(data.out || '');
    if (name === 'summarization') return (data.reducedCount || 0) + ' msgs context';
    if (name === 'kbLoading') return (data.topicFiles || []).join(', ') || 'no topic files';
    if (name === 'tierClassification') return esc(data.tier + ' / ' + data.intent + ' (' +
      (data.confidence != null ? (data.confidence * 100).toFixed(0) + '%' : '?') + ')');
    if (name === 'layer2Fallback') return data.triggered
      ? esc(data.beforeIntent + ' → ' + data.afterIntent)
      : 'not triggered';
    if (name === 'routing') return esc(data.intent + ' → ' + data.routedAction);
    return '';
  })();
  return '<div class="ls-stage-row">'
    + '<span class="ls-stage-name">' + esc(label) + '</span>'
    + '<span class="ls-stage-summary">' + summary + '</span>'
    + ms
    + '</div>';
}

function renderResult(res) {
  if (!res) return '';
  if (res.error && !res.stages) {
    return '<div class="ls-replay-error">Error: ' + esc(res.error) + '</div>';
  }
  const s = res.stages || {};
  let html = '';
  html += renderStage('inputNormalizer', '1. Input Normalizer', s.inputNormalizer);
  html += renderStage('manglishNormalizer', '2. Manglish Normalizer', s.manglishNormalizer);
  html += renderStage('summarization', '3. Summarization', s.summarization);
  html += renderStage('kbLoading', '4. KB Loading', s.kbLoading);
  html += renderStage('tierClassification', '5. Tier Classification', s.tierClassification);
  html += renderStage('layer2Fallback', '6. Layer-2 Fallback', s.layer2Fallback);
  html += renderStage('routing', '7. Routing', s.routing);
  html += '<div class="ls-replay-summary">'
    + 'Final intent: <strong>' + esc(res.finalIntent || '') + '</strong> · '
    + 'Total: <strong>' + (res.totalMs || 0) + ' ms</strong>'
    + (res.modelUsed ? ' · Model: <strong>' + esc(res.modelUsed) + '</strong>' : '')
    + '</div>';
  return html;
}

export async function runReplay() {
  const out = document.getElementById('ls-replay-result');
  if (!out) return;
  const payload = buildPayload();
  if (!payload.text) {
    out.innerHTML = '<div class="ls-replay-error">Enter some text first.</div>';
    return;
  }
  _lastPayload = payload;
  out.innerHTML = '<div class="ls-replay-loading">Running pipeline…</div>';
  try {
    const res = await api('/admin/replay-classification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    _lastResponse = res;
    out.innerHTML = renderResult(res);
  } catch (err) {
    _lastResponse = null;
    out.innerHTML = '<div class="ls-replay-error">Request failed: ' + esc(err && err.message) + '</div>';
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
}

export function copyAsCurl() {
  const payload = _lastPayload || buildPayload();
  const url = window.location.origin + '/api/rainbow/admin/replay-classification';
  const cmd = 'curl -X POST ' + url
    + ' \\\n  -H "Content-Type: application/json"'
    + ' \\\n  -d \'' + JSON.stringify(payload).replace(/'/g, "'\\''") + "'";
  copyToClipboard(cmd);
}

export function copyAsJson() {
  const data = _lastResponse || _lastPayload || buildPayload();
  copyToClipboard(JSON.stringify(data, null, 2));
}
