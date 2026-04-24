// ═══════════════════════════════════════════════════════════════════
// Live Simulation Badges — pure inline-badge renderer
// ═══════════════════════════════════════════════════════════════════
//
// Renders the colour-coded chip strip that sits below every bot
// reply: tier, messageType, intent, routedAction, model, latency,
// confidence, KB files, fallback / error flags.
// Uses window.MetadataBadges when available (shared component) so
// that live-simulation matches quick-test badge styling exactly.

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tiny fallback chip — used only when MetadataBadges is not yet loaded. */
function chip(text, opts) {
  const bg = opts && opts.bg ? opts.bg : '#f3f4f6';
  const fg = opts && opts.fg ? opts.fg : '#374151';
  const title = opts && opts.title ? ' title="' + esc(opts.title) + '"' : '';
  return '<span class="ls-badge" style="background:' + bg + ';color:' + fg + ';"' + title + '>'
    + esc(text) + '</span>';
}

/** Map devMetadata.source string → tier label. Mirrors deriveTier in trace-collector. */
export function deriveTierFromSource(source) {
  if (!source) return 'unknown';
  const s = String(source).toLowerCase();
  if (s === 'regex') return 'T1';
  if (s.startsWith('fuzzy')) return 'T2';
  if (s.startsWith('semantic') || s === 'split-model-fast') return 'T3';
  return 'T4';
}

/**
 * Render the inline-badge strip for one assistant message.
 * Mirrors the quick-test badge layout: tier | messageType | intent |
 * routedAction | model | responseTime | confidence | KB files | flags.
 *
 * @param {object} msg  conversation message (from /conversations/:phone)
 * @param {object} [trace]  optional /admin/traces row matched to this msg
 * @returns {string} HTML
 */
export function renderInlineBadges(msg, trace) {
  if (!msg || msg.role !== 'assistant' || msg.manual) return '';

  const MB = window.MetadataBadges;

  // Resolve source — prefer stored msg.source, fall back to trace tier
  const source = msg.source || (trace && trace.tier);
  const model = msg.model || (trace && trace.model);
  const latency = msg.responseTime != null
    ? msg.responseTime
    : (trace && trace.stage_latencies ? trace.stage_latencies.total_ms : null);

  // ── Use shared MetadataBadges component when available ──────────
  if (MB) {
    const meta = {
      source:          source,
      messageType:     msg.messageType,
      intent:          msg.intent,
      routedAction:    msg.routedAction || msg.action,
      model:           model,
      responseTime:    latency,
      confidence:      msg.confidence,
      kbFiles:         msg.kbFiles,
    };
    const { inline, kbFiles } = MB.getMetadataBadges(meta, { showLanguage: false, showOverride: false });

    const extras = [];

    // Fallback flag
    if (source && /fallback/i.test(String(source))) {
      extras.push('<span class="rb-badge px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium text-xs" title="Layer-2 fallback engaged">fallback</span>');
    }

    // Error flag from trace
    if (trace && trace.error) {
      extras.push('<span class="rb-badge px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-medium text-xs" title="' + esc(trace.error) + '">error</span>');
    }

    return '<div class="ls-badges">' + inline + extras.join('') + '</div>' + (kbFiles || '');
  }

  // ── Fallback renderer (MetadataBadges not yet loaded) ───────────
  const parts = [];

  // Tier (plain chip)
  if (source) {
    const TIER_COLOURS = {
      regex:    { bg: '#fef2f2', fg: '#b91c1c' },
      fuzzy:    { bg: '#fefce8', fg: '#a16207' },
      semantic: { bg: '#f5f3ff', fg: '#6d28d9' },
      llm:      { bg: '#eff6ff', fg: '#1d4ed8' },
    };
    const col = TIER_COLOURS[source] || { bg: '#e5e7eb', fg: '#374151' };
    const TIER_LABELS = { regex: '🚨 Priority Keywords', fuzzy: '⚡ Smart Matching', semantic: '📚 Learning Examples', llm: '🤖 AI Fallback' };
    parts.push(chip(TIER_LABELS[source] || source, { ...col, title: 'Detection: ' + source }));
  }

  if (msg.messageType) parts.push(chip(msg.messageType, { bg: '#f0fdf4', fg: '#166534', title: 'Message type' }));
  if (msg.intent) parts.push(chip(msg.intent, { bg: '#ede9fe', fg: '#5b21b6', title: 'Intent' }));
  if (msg.routedAction || msg.action) parts.push(chip(msg.routedAction || msg.action, { bg: '#f0fdf4', fg: '#15803d', title: 'Routed to' }));
  if (model) parts.push(chip(model, { bg: '#f5f3ff', fg: '#6d28d9', title: 'LLM model' }));

  if (latency != null) {
    let bg = '#f0fdf4', fg = '#166534';
    if (latency > 2000) { bg = '#fef2f2'; fg = '#991b1b'; }
    else if (latency > 800) { bg = '#fefce8'; fg = '#92400e'; }
    const txt = latency >= 1000 ? (latency / 1000).toFixed(1) + 's' : latency + 'ms';
    parts.push(chip(txt, { bg, fg, title: 'End-to-end latency' }));
  }

  if (msg.confidence != null) {
    const pct = Math.round(msg.confidence * 100);
    let bg = '#f0fdf4', fg = '#166534';
    if (pct < 60) { bg = '#fef2f2'; fg = '#991b1b'; }
    else if (pct < 80) { bg = '#fefce8'; fg = '#92400e'; }
    parts.push(chip(pct + '%', { bg, fg, title: 'Classification confidence' }));
  }

  if (msg.kbFiles && msg.kbFiles.length > 0) {
    parts.push(chip('kb:' + msg.kbFiles.length, { bg: '#ecfeff', fg: '#155e75', title: msg.kbFiles.join(', ') }));
  }

  if (source && /fallback/i.test(String(source))) {
    parts.push(chip('fallback', { bg: '#fde68a', fg: '#78350f', title: 'Layer-2 fallback engaged' }));
  }
  if (trace && trace.error) {
    parts.push(chip('error', { bg: '#fecaca', fg: '#7f1d1d', title: trace.error }));
  }

  return '<div class="ls-badges">' + parts.join('') + '</div>';
}

/** Stat helper for sidebar — derive {tier:source} with no chip rendering. */
export function summariseMessage(msg, trace) {
  if (!msg || msg.role !== 'assistant' || msg.manual) return null;
  const source = msg.source || (trace && trace.tier);
  return {
    tier: trace && trace.tier ? trace.tier : deriveTierFromSource(source),
    intent: msg.intent || null,
    confidence: msg.confidence != null ? msg.confidence : null,
    latency: msg.responseTime != null ? msg.responseTime
      : (trace && trace.stage_latencies ? trace.stage_latencies.total_ms : null),
    tokens: trace && (trace.prompt_tokens || trace.completion_tokens)
      ? (trace.prompt_tokens || 0) + (trace.completion_tokens || 0)
      : (msg.usage && msg.usage.total_tokens) || 0,
    fallback: !!(source && /fallback/i.test(String(source))),
    hasError: !!(trace && trace.error),
  };
}
