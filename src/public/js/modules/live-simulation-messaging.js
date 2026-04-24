// ═══════════════════════════════════════════════════════════════════
// Live Simulation Messaging — bulk fetch + trace merge
// ═══════════════════════════════════════════════════════════════════
//
// On conversation open, fires three parallel API calls and merges
// the responses into the shared state so the trace drawer can
// render with no extra round trips:
//
//   /conversations/:phone                       — message log
//   /admin/traces?jid=<phone>&limit=500         — pipeline traces
//   /admin/conversations/:jid/classification-trace?limit=100
//                                               — top-3 candidates

import { $ } from './live-simulation-state.js';

const api = window.api;

/** Build the lookup key used by the drawer. Pairs an assistant
 *  message (from /conversations) with its trace row by tightest
 *  timestamp match. */
function pairTracesToMessages(messages, traces) {
  const byKey = new Map();
  if (!Array.isArray(traces) || traces.length === 0) return byKey;

  // Sort traces by created_at ascending for two-pointer walk
  const sorted = traces.slice().sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return ta - tb;
  });
  let idx = 0;

  for (const msg of messages) {
    if (msg.role !== 'assistant' || msg.manual) continue;
    // Advance trace pointer until just past this message
    while (idx + 1 < sorted.length) {
      const next = new Date(sorted[idx + 1].created_at || 0).getTime();
      if (next > msg.timestamp + 60_000) break;
      idx++;
    }
    const candidate = sorted[idx];
    if (!candidate) continue;
    const candTime = new Date(candidate.created_at || 0).getTime();
    // Match if within ±60s (write race + clock skew tolerance)
    if (Math.abs(candTime - msg.timestamp) <= 60_000) {
      byKey.set(msg.role + ':' + msg.timestamp, candidate);
    }
  }
  return byKey;
}

/** Bulk-fetch conversation log + traces + classification candidates. */
export async function loadConversationBundle(phone) {
  const enc = encodeURIComponent(phone);
  // Best-effort — failures on optional sources don't block the message log
  const [log, tracesRes, classifRes] = await Promise.all([
    api('/conversations/' + enc),
    api('/admin/traces?jid=' + enc + '&limit=500').catch((e) => {
      console.warn('[LiveSim] traces fetch failed:', e && e.message);
      return { traces: [] };
    }),
    api('/admin/conversations/' + enc + '/classification-trace?limit=100').catch((e) => {
      console.warn('[LiveSim] classification-trace fetch failed:', e && e.message);
      return { traces: [] };
    }),
  ]);

  const messages = (log && log.messages) || [];
  const traces = (tracesRes && tracesRes.traces) || [];
  const classifTraces = (classifRes && classifRes.traces) || [];

  $.activePhone = phone;
  $.messages = messages;
  $.traceByMessageKey = pairTracesToMessages(messages, traces);
  $.classificationTraces = classifTraces;
  $.lastRefreshAt = Date.now();

  return { log, messages, traces, classifTraces };
}

/** Fetch a single trace by message — used by the drawer when the
 *  bulk pre-fetch missed the row (write race). Retries at 500ms
 *  and 2s before giving up. */
export async function fetchTraceForMessage(phone, msg) {
  const key = msg.role + ':' + msg.timestamp;
  const cached = $.traceByMessageKey.get(key);
  if (cached) return cached;

  const enc = encodeURIComponent(phone);
  const tryFetch = async () => {
    const res = await api('/admin/traces?jid=' + enc + '&limit=50').catch(() => null);
    const traces = (res && res.traces) || [];
    const merged = pairTracesToMessages($.messages, traces);
    const found = merged.get(key);
    if (found) $.traceByMessageKey.set(key, found);
    return found || null;
  };

  let found = await tryFetch();
  if (found) return found;
  await new Promise((r) => setTimeout(r, 500));
  found = await tryFetch();
  if (found) return found;
  await new Promise((r) => setTimeout(r, 2000));
  return await tryFetch();
}

/** Send a manual reply from the staff input bar to the active conversation. */
export async function sendLiveSimReply() {
  if (!$.activePhone) return;

  const input = document.getElementById('ls-reply-input');
  const message = input ? input.value.trim() : '';
  if (!message) return;

  const btn = document.getElementById('ls-reply-send-btn');
  if (btn) btn.disabled = true;

  try {
    const conv = $.conversations && $.conversations.find((c) => c.phone === $.activePhone);
    const instanceId = conv ? conv.instanceId : undefined;
    await api('/conversations/' + encodeURIComponent($.activePhone) + '/send', {
      method: 'POST',
      body: { message, instanceId, staffName: 'Staff', force: true },
    });
    if (input) {
      input.value = '';
      input.style.height = '';
    }
  } catch (err) {
    alert('Failed to send: ' + ((err && err.message) || 'Unknown error'));
  } finally {
    if (btn) btn.disabled = false;
    if (input) input.focus();
  }
}

/** Lazy-fetch routing config (intent → action map). Cached per session. */
export async function fetchRoutingConfig() {
  if ($.routingConfig) return $.routingConfig;
  const res = await api('/routing').catch(() => null);
  if (res) $.routingConfig = res;
  return res || null;
}

/** Lazy-fetch knowledge base (static reply templates). Cached per session. */
export async function fetchKnowledgeBase() {
  if ($.knowledgeBase) return $.knowledgeBase;
  const res = await api('/knowledge').catch(() => null);
  if (res) $.knowledgeBase = res;
  return res || null;
}

/** Find the closest classification-trace candidate set for a
 *  user message (the guest message that drove the classification
 *  for the next bot reply). */
export function findClassificationTraceForUserMessage(userMsg) {
  if (!userMsg || !$.classificationTraces || $.classificationTraces.length === 0) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const t of $.classificationTraces) {
    const ts = new Date(t.timestamp || 0).getTime();
    const d = Math.abs(ts - userMsg.timestamp);
    if (d < bestDelta) { bestDelta = d; best = t; }
  }
  // Match window: 5 minutes
  return bestDelta <= 5 * 60_000 ? best : null;
}
