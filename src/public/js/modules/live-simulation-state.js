// ═══════════════════════════════════════════════════════════════════
// Live Simulation State — shared mutable store
// ═══════════════════════════════════════════════════════════════════
//
// Forked from real-chat for the developer audit view. Holds the
// active conversation, message list, decoded traces (keyed by
// timestamp + role for O(1) drawer lookup), filter state, and the
// SSE EventSource handle.

export const $ = {
  /** @type {Array<{phone:string,pushName:string,messageCount:number,lastMessage:string,lastMessageAt:number,lastMessageRole:string,instanceId?:string}>} */
  conversations: [],
  /** @type {string|null} */
  activePhone: null,
  /** @type {Array<any>} */
  messages: [],
  /** @type {Map<string, any>} key = `${role}:${timestamp}` → trace from /admin/traces */
  traceByMessageKey: new Map(),
  /** @type {Array<any>} raw classification-trace entries (top-3 candidates) */
  classificationTraces: [],
  /** @type {{tier:Set<string>,fallbackOnly:boolean,lowConfOnly:boolean,hasErrorOnly:boolean,intent:string|null}} */
  filters: {
    tier: new Set(),
    fallbackOnly: false,
    lowConfOnly: false,
    hasErrorOnly: false,
    intent: null,
  },
  /** @type {EventSource|null} */
  eventSource: null,
  /** @type {'all'|'whatsapp'|'webchat'} */
  channelFilter: 'all',
  /** @type {'all'|'unread'|'favourites'|'groups'} */
  activeFilter: 'all',
  /** @type {boolean} guards loadLiveSimulation against double-injection */
  injected: false,
  /** @type {number} ms since last successful refresh */
  lastRefreshAt: 0,
  /** @type {number|null} setInterval id for the timestamp updater */
  refreshTicker: null,
  /** @type {object|null} cached GET /routing result (intent → action map) */
  routingConfig: null,
  /** @type {{static: Array<{intent:string,response:{en:string,ms:string,zh:string}}>}|null} cached GET /knowledge result */
  knowledgeBase: null,
};

/** Reset state to initial — used on cleanup. */
export function resetState() {
  $.conversations = [];
  $.activePhone = null;
  $.messages = [];
  $.traceByMessageKey = new Map();
  $.classificationTraces = [];
  $.filters.tier = new Set();
  $.filters.fallbackOnly = false;
  $.filters.lowConfOnly = false;
  $.filters.hasErrorOnly = false;
  $.filters.intent = null;
  $.channelFilter = 'all';
  $.activeFilter = 'all';
  $.lastRefreshAt = 0;
  $.routingConfig = null;
  $.knowledgeBase = null;
}
