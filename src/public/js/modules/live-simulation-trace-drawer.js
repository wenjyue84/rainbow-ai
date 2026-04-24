// ═══════════════════════════════════════════════════════════════════
// Live Simulation Trace Drawer — right-slide audit overlay
// ═══════════════════════════════════════════════════════════════════
//
// 480px overlay that surfaces every persisted detail of one bot
// reply: top-3 classification candidates, pipeline timings, LLM
// usage, KB files, routing, and a raw JSON toggle.

import { $ } from './live-simulation-state.js';
import { fetchTraceForMessage, findClassificationTraceForUserMessage, fetchRoutingConfig, fetchKnowledgeBase } from './live-simulation-messaging.js';
import { deriveTierFromSource } from './live-simulation-badges.js';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function row(label, value, mono) {
  if (value == null || value === '') return '';
  const v = mono
    ? '<code style="font-family:ui-monospace,Menlo,monospace;font-size:11px;">' + esc(value) + '</code>'
    : esc(value);
  return '<div class="ls-tr-row"><span class="ls-tr-label">' + esc(label) + '</span>'
    + '<span class="ls-tr-val">' + v + '</span></div>';
}

function section(title, body) {
  return '<div class="ls-tr-section"><h4>' + esc(title) + '</h4>' + body + '</div>';
}

function deriveReplyType(msg) {
  if (!msg) return null;
  const action = (msg.action || '').toLowerCase();
  const mt = (msg.messageType || '').toLowerCase();
  if (action === 'quick_reply')    return 'Quick Reply';
  if (action === 'workflow')       return 'Workflow';
  if (action === 'knowledge_base') return 'KB Lookup';
  if (action === 'llm')            return 'LLM';
  if (/fallback/i.test(action) || /fallback/i.test(mt)) return 'Fallback';
  if (mt) return msg.messageType;
  return null;
}

function renderSummaryBar(msg, trace, classifTrace) {
  const TIER_LABELS = {
    regex: '🚨 Priority Keywords', fuzzy: '⚡ Smart Matching',
    semantic: '📚 Learning Examples', llm: '🤖 AI Fallback'
  };

  const parts = [];

  // Detection
  const source = msg.source || (trace && trace.tier);
  const tier = source ? deriveTierFromSource(source) : null;
  const tierLabel = tier ? (TIER_LABELS[source] || source) : '?';
  parts.push('Detection: <b>' + esc(tierLabel) + '</b>');

  // Lang
  const lang = classifTrace && classifTrace.detected_language;
  const LANG_MAP = { en: 'EN', ms: 'BM', zh: 'ZH', ta: 'TA' };
  parts.push('Lang: <b>' + (lang ? (LANG_MAP[lang] || lang.toUpperCase()) : '–') + '</b>');

  // Intent
  parts.push('Intent: <b>' + esc(msg.intent || '–') + '</b>');

  // Routed to
  parts.push('Routed to: <b>' + esc(msg.routedAction || msg.action || '–') + '</b>');

  // Type
  if (msg.messageType) parts.push('Type: <b>' + esc(msg.messageType) + '</b>');

  // Model
  const model = (trace && trace.model) || msg.model;
  if (model) parts.push('Model: <b>' + esc(model) + '</b>');

  // Time
  const latency = (trace && trace.stage_latencies && trace.stage_latencies.total_ms != null)
    ? trace.stage_latencies.total_ms
    : msg.responseTime;
  if (latency != null) {
    const timeStr = latency >= 1000 ? (latency / 1000).toFixed(1) + 's' : latency + 'ms';
    parts.push('Time: <b>' + timeStr + '</b>');
  }

  // Confidence
  if (msg.confidence != null && msg.confidence > 0) {
    parts.push('Confidence: <b>' + Math.round(msg.confidence * 100) + '%</b>');
  }

  // Tokens
  const pt = trace ? trace.prompt_tokens : (msg.usage && msg.usage.prompt_tokens);
  const ct = trace ? trace.completion_tokens : (msg.usage && msg.usage.completion_tokens);
  if (pt != null && ct != null) {
    parts.push('Tokens: <b>' + pt + 'p + ' + ct + 'c</b>');
  }

  return '<div class="ls-tr-summary-bar">' + parts.join(' | ') + '</div>';
}

function ensureDrawerHost() {
  let host = document.getElementById('ls-trace-drawer');
  if (host) return host;
  host = document.createElement('div');
  host.id = 'ls-trace-drawer';
  host.className = 'ls-drawer';
  host.style.display = 'none';
  document.body.appendChild(host);
  return host;
}

function renderClassification(classifTrace, msg, trace) {
  const TIER_LABELS = { T1: '🚨 T1 — Regex', T2: '⚡ T2 — Fuzzy', T3: '📚 T3 — Semantic', T4: '🤖 T4 — LLM' };
  let body = '';

  // Always-available: persisted on every message row
  if (msg) {
    const tier = (trace && trace.tier) || (msg.source ? deriveTierFromSource(msg.source) : null);
    if (tier) body += row('Tier', TIER_LABELS[tier] || tier);
    body += row('Source / method', msg.source);
    body += row('Intent', msg.intent);
    if (msg.confidence != null && msg.confidence > 0) {
      body += row('Confidence', Math.round(msg.confidence * 100) + '%');
    }
  }

  // Extra: only when in-memory classifTrace exists
  if (classifTrace) {
    body += row('Input text', classifTrace.input_text, true);
    body += row('Detected language', classifTrace.detected_language);
    body += row('Tie-break reason', classifTrace.tie_break_reason);
    const cands = Array.isArray(classifTrace.candidates) ? classifTrace.candidates : [];
    if (cands.length > 0) {
      body += '<div class="ls-tr-row"><span class="ls-tr-label">Top candidates</span></div>';
      body += '<table class="ls-tr-table"><thead><tr><th>#</th><th>Intent</th><th>Confidence</th><th>Source</th></tr></thead><tbody>';
      cands.slice(0, 3).forEach((c, i) => {
        body += '<tr>'
          + '<td>' + (i + 1) + '</td>'
          + '<td>' + esc(c.intent) + '</td>'
          + '<td>' + (c.confidence != null ? (c.confidence * 100).toFixed(1) + '%' : '') + '</td>'
          + '<td>' + esc(c.source || '') + '</td>'
          + '</tr>';
      });
      body += '</tbody></table>';
    }
  }

  if (!body) body = '<p class="ls-tr-empty">No classification data available.</p>';
  return section('Classification', body);
}

function renderTimings(trace, msg) {
  let body = '';
  if (trace && trace.stage_latencies) {
    body += row('Total', trace.stage_latencies.total_ms != null ? trace.stage_latencies.total_ms + ' ms' : '');
    body += row('Classification', trace.stage_latencies.classification_ms != null ? trace.stage_latencies.classification_ms + ' ms' : '');
    body += row('LLM', trace.stage_latencies.llm_ms != null ? trace.stage_latencies.llm_ms + ' ms' : '');
  } else if (msg && msg.responseTime != null) {
    body += row('End-to-end', msg.responseTime + ' ms');
  } else {
    body = '<p class="ls-tr-empty">No timing data.</p>';
  }
  return section('Pipeline timings', body);
}

function renderLLM(trace, msg) {
  const provider = trace ? trace.llm_provider : null;
  const model = (trace && trace.model) || (msg && msg.model);
  const promptT = trace ? trace.prompt_tokens : (msg && msg.usage && msg.usage.prompt_tokens);
  const compT = trace ? trace.completion_tokens : (msg && msg.usage && msg.usage.completion_tokens);
  let body = '';
  body += row('Provider', provider);
  body += row('Model', model);
  body += row('Prompt tokens', promptT);
  body += row('Completion tokens', compT);
  if (promptT != null && compT != null) {
    body += row('Total tokens', (promptT || 0) + (compT || 0));
  }
  return section('LLM', body || '<p class="ls-tr-empty">No LLM data.</p>');
}

function renderKB(msg) {
  const files = (msg && msg.kbFiles) || [];
  if (files.length === 0) {
    return section('Knowledge base', '<p class="ls-tr-empty">No KB files attributed.</p>');
  }
  const chips = files.map((f) => '<span class="ls-tr-kb-chip">' + esc(f) + '</span>').join('');
  return section('Knowledge base', '<div class="ls-tr-kbwrap">' + chips + '</div>');
}

function renderIntentRouter(msg, routingRule) {
  const ACTION_LABELS = {
    static_reply:   'Static Reply',
    llm_reply:      'LLM Reply',
    workflow:       'Workflow',
    quick_reply:    'Quick Reply',
    knowledge_base: 'KB Lookup',
  };
  let body = '';
  const action = (routingRule && routingRule.action) || (msg && msg.action);
  const actionLabel = ACTION_LABELS[action] || action;
  const workflowId = (routingRule && routingRule.workflow_id) || (msg && msg.workflowId);

  body += row('Intent', msg && msg.intent);
  body += row('Action', actionLabel);
  if (workflowId) body += row('Workflow', workflowId);
  if (msg && msg.stepId) body += row('Step', msg.stepId);
  if (msg && msg.messageType) body += row('Message type', msg.messageType);

  return section('Intent Router', body || '<p class="ls-tr-empty">No routing data.</p>');
}

function renderResponseTemplate(knowledgeEntry, msg) {
  const action = (msg && msg.action) || '';
  let body = '';

  // Always show actual bot reply
  if (msg && msg.content) {
    const truncated = msg.content.length > 200
      ? msg.content.slice(0, 200) + '\u2026' : msg.content;
    body += row('Actual reply', truncated);
  }

  if (!knowledgeEntry) {
    let note = '';
    if (/llm/i.test(action))           note = 'AI-generated (no fixed template)';
    else if (/workflow/i.test(action)) note = 'Workflow (reply set by step logic)';
    else if (!action)                  note = 'No template data.';
    else                               note = 'No template found for this intent.';
    return section('Response Template', body + '<p class="ls-tr-empty">' + esc(note) + '</p>');
  }

  const r = knowledgeEntry.response || {};
  body += row('Intent', knowledgeEntry.intent);
  if (r.en) body += row('EN', r.en);
  if (r.ms) body += row('MS', r.ms);
  if (r.zh) body += row('ZH', r.zh);
  if (knowledgeEntry.imageUrl) body += row('Image', knowledgeEntry.imageUrl);

  // Mismatch check — word-overlap instead of strict substring
  if (msg && msg.content) {
    const variants = [r.en, r.ms, r.zh].filter(Boolean);
    const replyWords = new Set(msg.content.toLowerCase().split(/\s+/));
    const matched = variants.some(v => {
      const tplWords = v.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      if (tplWords.length === 0) return true;
      const hits = tplWords.filter(w => replyWords.has(w)).length;
      return hits / tplWords.length >= 0.4;
    });
    if (!matched && variants.length > 0) {
      body += '<p style="color:#6b7280;font-size:11px;margin-top:4px;">'
        + '\u2139 Response was enhanced by AI \u2014 differs from base template.</p>';
    }
  }

  return section('Response Template', body);
}

function renderFaithfulness(trace) {
  if (!trace || trace.faithfulness == null) {
    return section('Faithfulness', '<p class="ls-tr-empty">Not scored.</p>');
  }
  return section('Faithfulness', row('Score', trace.faithfulness));
}

function renderRawJson(payload) {
  const id = 'ls-tr-raw-' + Math.random().toString(36).slice(2, 8);
  return section('Raw JSON',
    '<button class="ls-tr-rawtoggle" onclick="(function(b){var p=document.getElementById(\'' + id + '\');p.style.display=p.style.display===\'none\'?\'block\':\'none\';b.textContent=p.style.display===\'none\'?\'Show\':\'Hide\';})(this)">Show</button>'
    + '<pre id="' + id + '" class="ls-tr-rawpre" style="display:none;">' + esc(JSON.stringify(payload, null, 2)) + '</pre>');
}

function patchEl(parent, id, html) {
  const el = parent.querySelector('#' + id);
  if (el) el.innerHTML = html;
}

function loadingPlaceholder(id) {
  return '<div id="' + id + '"><p class="ls-tr-empty">Loading\u2026</p></div>';
}

/** Open the drawer for one assistant message bubble. */
export async function openTraceDrawer(messageIndex) {
  const idx = parseInt(messageIndex, 10);
  if (isNaN(idx)) return;
  const msg = $.messages[idx];
  if (!msg) return;

  const host = ensureDrawerHost();
  host.dataset.messageIdx = String(idx);
  host.style.display = 'block';
  host.innerHTML = '<div class="ls-drawer-inner">'
    + '<div class="ls-drawer-header">'
    + '<h3>Trace</h3>'
    + '<button class="ls-drawer-close" onclick="(function(h){h.style.display=\'none\';})(document.getElementById(\'ls-trace-drawer\'))">&times;</button>'
    + '</div>'
    + '<div class="ls-drawer-body"></div>'
    + '</div>';

  // ── Phase 1: synchronous data ──
  let classifTrace = null;
  for (let i = idx - 1; i >= 0; i--) {
    if ($.messages[i].role === 'user') {
      classifTrace = findClassificationTraceForUserMessage($.messages[i]);
      break;
    }
  }

  const intent = msg && msg.intent;
  const cachedRouting = $.routingConfig || null;
  const cachedKB = $.knowledgeBase || null;
  const routingRule = intent && cachedRouting ? cachedRouting[intent] : null;
  const knowledgeEntry = intent && cachedKB
    ? (cachedKB.static || []).find(k => k.intent === intent) || null
    : null;

  const body = host.querySelector('.ls-drawer-body');
  if (!body) return;

  // Render everything available synchronously; placeholders for async sections
  body.innerHTML =
    '<div id="ls-tr-summary">' + renderSummaryBar(msg, null, classifTrace) + '</div>'
    + renderClassification(classifTrace, msg, null)
    + renderIntentRouter(msg, routingRule)
    + '<div id="ls-tr-template">' + renderResponseTemplate(knowledgeEntry, msg) + '</div>'
    + loadingPlaceholder('ls-tr-timings')
    + loadingPlaceholder('ls-tr-llm')
    + renderKB(msg)
    + loadingPlaceholder('ls-tr-faith')
    + loadingPlaceholder('ls-tr-raw-json');

  // ── Phase 2: async data ──
  const [trace, routingConfig, knowledgeData] = await Promise.all([
    fetchTraceForMessage($.activePhone, msg),
    fetchRoutingConfig(),
    fetchKnowledgeBase(),
  ]);

  // Staleness check: user closed drawer or opened a different message
  if (host.style.display === 'none' || host.dataset.messageIdx !== String(idx)) return;

  // Patch summary bar with trace-enriched data
  patchEl(body, 'ls-tr-summary', renderSummaryBar(msg, trace, classifTrace));

  // Patch async sections
  patchEl(body, 'ls-tr-timings', renderTimings(trace, msg));
  patchEl(body, 'ls-tr-llm', renderLLM(trace, msg));
  patchEl(body, 'ls-tr-faith', renderFaithfulness(trace));
  patchEl(body, 'ls-tr-raw-json', renderRawJson({ message: msg, trace, classificationTrace: classifTrace }));

  // Re-patch routing/template if they were null in Phase 1 but now available
  if (!cachedRouting && routingConfig && intent) {
    const freshRule = routingConfig[intent] || null;
    if (freshRule) {
      const routerSection = body.querySelectorAll('.ls-tr-section')[2]; // Intent Router is 3rd section
      if (routerSection) routerSection.outerHTML = renderIntentRouter(msg, freshRule);
    }
  }
  if (!cachedKB && knowledgeData && intent) {
    const freshEntry = (knowledgeData.static || []).find(k => k.intent === intent) || null;
    if (freshEntry) {
      patchEl(body, 'ls-tr-template', renderResponseTemplate(freshEntry, msg));
    }
  }

  // Add no-trace note if applicable
  if (!trace && !classifTrace) {
    const note = '<p style="color:#6b7280;font-size:12px;padding:8px 0 4px;">\u2139\uFE0F No pipeline trace recorded \u2014 showing message metadata only.</p>';
    const summaryEl = body.querySelector('#ls-tr-summary');
    if (summaryEl) summaryEl.insertAdjacentHTML('afterend', note);
  }
}

export function closeTraceDrawer() {
  const host = document.getElementById('ls-trace-drawer');
  if (host) host.style.display = 'none';
}
