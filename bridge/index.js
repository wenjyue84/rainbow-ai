/**
 * Rainbow Bridge — a DUMB WhatsApp (Baileys) relay.
 *
 * Responsibilities (and ONLY these):
 *   1. Connect to WhatsApp via Baileys.
 *   2. Relay every inbound message to the Go core (POST {CORE_URL}/inbound).
 *   3. Perform the sends the Go core asks for (POST /send on this server).
 *
 * ZERO business logic: no intent classification, no AI, no DB, no schedulers.
 * That all lives in the Go core. This process is small and stateless, so it can
 * be restarted at a memory cap WITHOUT losing business state.
 *
 * ── Anti-ban hardening (2026-08-08 R0 → R1) ─────────────────────────────────
 * R0 (initial hardening): 401 clear-and-QR, circuit breaker, getMessage store,
 *   paced send queue, pairing warm-up.
 * R5 (2026-08-09, post-ban hardening):
 *   1. scheduleReconnect QR-mode path now has its own budget: max 12 QR
 *      reconnects/hour with 30-min cooldown. Previously the !hasCreds() branch
 *      completely bypassed the circuit breaker, so 408 loops after a 401/clearAuth
 *      ran unbounded (logged: 2689 × 408 in the ban session). A fresh QR page
 *      needs reconnects to rotate the QR, but not hundreds of them.
 *   2. 408 connectionTimedOut / 503 unavailable are now logged with a WA-side
 *      pressure note so operators see the signal without log-diving.
 *   3. deploy/run-bridge-senai.sh template added with BRIDGE_EXEMPT_JIDS so
 *      self-pings and staff numbers are set at deploy time.
 *
 * R1 (2026-08-08, baseline 53/100 → target ≤20/100):
 *   1. shouldIgnoreJid → block Status/broadcast at socket layer (Issue #2309:
 *      processing status uploads on production servers confirmed permanent ban vector).
 *   2. Browser fingerprint → ['Ubuntu','Chrome','22.04.4'] (Ubuntu+Chrome = legitimate
 *      desktop session; old 'WhatsApp' device name + Chrome 120 were suspicious).
 *   3. keepAliveIntervalMs → 30 000ms (Baileys default; 25 s was non-standard).
 *   4. Hourly send cap (20/h sliding window) — daily cap alone allows blasting in
 *      minutes; hourly cap enforces a human-like send rhythm.
 *   5. Cold daily cap default lowered 40 → 20 — research: after a temporary
 *      restriction, first-week safe limit is 10-20 cold sends/day.
 *   6. 440 connectionReplaced → after 2 consecutive replacements clear auth and
 *      require QR re-pairing (fighting for the session loop is a ban vector).
 *   7. 403 forbidden → ACCOUNT BANNED; stop all reconnects permanently.
 *   8. 500 badSession / 411 multideviceMismatch → clear auth, QR mode (same as 401).
 *   9. Proportional typing duration — random 1.5–3.5 s regardless of message length
 *      was detectable; now scales with character count, capped at 5 s.
 */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidGroup,
  isJidBroadcast,
  isJidStatusBroadcast,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CORE_URL = process.env.CORE_URL || 'http://127.0.0.1:8090';
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '8788', 10);
const AUTH_DIR = process.env.BRIDGE_AUTH_DIR || './bridge-auth';
const INSTANCE_ID = process.env.BRIDGE_INSTANCE_ID || 'default';
const MEDIA_DIR = process.env.BRIDGE_MEDIA_DIR || './bridge-media';
// Base URL the Go core uses to fetch downloaded media (core + bridge co-located).
const MEDIA_BASE = process.env.BRIDGE_MEDIA_BASE || `http://127.0.0.1:${BRIDGE_PORT}`;

fs.mkdirSync(MEDIA_DIR, { recursive: true });

// R2: prune media files older than 24h to prevent unbounded disk growth.
function cleanupOldMedia() {
  try {
    const maxAgeMs = 24 * 60 * 60_000;
    const now = Date.now();
    let removed = 0;
    for (const file of fs.readdirSync(MEDIA_DIR)) {
      try {
        const fp = path.join(MEDIA_DIR, file);
        if (now - fs.statSync(fp).mtimeMs > maxAgeMs) { fs.unlinkSync(fp); removed++; }
      } catch (_) {}
    }
    if (removed > 0) console.log(`[bridge] media cleanup: removed ${removed} old files`);
  } catch (e) { console.warn('[bridge] media cleanup error:', e.message); }
}
cleanupOldMedia();
setInterval(cleanupOldMedia, 24 * 60 * 60_000);

const EXT_BY_MIME = {
  'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'application/pdf': 'pdf',
};

// downloadAndSave fetches a media message's bytes and returns a public URL.
async function downloadAndSave(msg, messageType, mimeType) {
  try {
    const buf = await downloadMediaMessage(msg, 'buffer', {});
    if (!buf || buf.length === 0) return '';
    const ext = EXT_BY_MIME[mimeType] || (messageType === 'audio' ? 'ogg' : 'bin');
    const id = (msg.key.id || `${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '');
    const file = `${id}.${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
    return `${MEDIA_BASE}/media/${file}`;
  } catch (err) {
    console.warn('[bridge] media download failed:', err.message);
    return '';
  }
}

let sock = null;
let connState = 'close';
let latestQR = null; // current WhatsApp pairing QR string (rotates ~every 20s)
const QR_TOKEN = process.env.BRIDGE_QR_TOKEN || ''; // gate /qr/<token> so the QR isn't public

// ── Persistent pacing state (survives restarts; NOT in AUTH_DIR, which gets
// cleared on 401) ───────────────────────────────────────────────────────────
const STATE_FILE = `${AUTH_DIR}.state.json`;
let pacingState = { pairedAt: 0, dayKey: '', sentToday: 0, coldSentToday: 0 };
try { pacingState = { ...pacingState, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; } catch (_) {}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(pacingState)); } catch (_) {}
}

// ── Send governor (anti-ban pacing, enforced bridge-side) ───────────────────
const PACING = {
  replyWindowMs: 15 * 60_000,             // inbound within this window => "reply"
  replyGapMs: [1_500, 4_000],             // gap between reply sends
  coldGapMs: [15_000, 45_000],            // gap between cold sends
  // R1: lowered from 40 → 20; research shows 10-20 cold/day is the safe ceiling
  // for the first week after a temporary restriction.
  coldDailyCap: parseInt(process.env.BRIDGE_COLD_DAILY_CAP || '20', 10),
  dailyCap: parseInt(process.env.BRIDGE_DAILY_CAP || '300', 10),
  // R1: hourly cap — daily-only allowed blasting 300 messages in minutes.
  hourlyCap: parseInt(process.env.BRIDGE_HOURLY_CAP || '20', 10),
  pairingWarmupMs: parseInt(process.env.BRIDGE_PAIRING_WARMUP_MIN || '10', 10) * 60_000,
};
// R4: staff/self numbers exempt from cold-send classification. Operator notifies
// and brief self-pings go to our own staff number, which never "replies" to the
// bot — so they'd classify as cold and (now that the cold cap is race-free)
// get blocked at 20/day. These are not cold outreach; treat them as replies so
// they bypass the cold cap + pairing warm-up. They STILL count toward the daily,
// hourly, and per-JID flood limits, which is the desired runaway protection.
const EXEMPT_JIDS = new Set(
  (process.env.BRIDGE_EXEMPT_JIDS || '')
    .split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean),
);
function isExempt(jid) {
  const digits = String(jid || '').split('@')[0].replace(/\D/g, '');
  return EXEMPT_JIDS.has(digits);
}
// Sliding window of send timestamps for hourly cap (not persisted; resets on restart).
let sendHourlyTimes = [];
// R2: Per-JID send history for per-contact rate limiting.
const jidSendTimes = new Map(); // jid -> ts[], pruned to 10-min window
function trackJidSend(jid) {
  const now = Date.now();
  const times = (jidSendTimes.get(jid) || []).filter((t) => now - t < 10 * 60_000);
  times.push(now);
  jidSendTimes.set(jid, times);
  if (jidSendTimes.size > 300) jidSendTimes.delete(jidSendTimes.keys().next().value);
}
const lastInboundByJid = new Map(); // jid -> ts, bounded
function noteInbound(jid) {
  lastInboundByJid.set(jid, Date.now());
  if (lastInboundByJid.size > 500) lastInboundByJid.delete(lastInboundByJid.keys().next().value);
}
function classify(jid) {
  if (isExempt(jid)) return 'reply'; // R4: staff/self self-pings are not cold outreach
  const ts = lastInboundByJid.get(jid) || 0;
  return Date.now() - ts <= PACING.replyWindowMs ? 'reply' : 'cold';
}
function rollDay() {
  const k = new Date().toISOString().slice(0, 10);
  if (k !== pacingState.dayKey) {
    pacingState.dayKey = k; pacingState.sentToday = 0; pacingState.coldSentToday = 0;
    saveState();
  }
}
const rand = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sendChain = Promise.resolve();
let lastPlannedSendAt = 0;
// R3: bounded queue depth — reject if more than MAX_SEND_QUEUE sends are pending.
// Without a bound, a flood of POST /send requests would grow the promise chain
// without limit and eventually exhaust memory.
let sendQueueDepth = 0;
const MAX_SEND_QUEUE = 50;

// queueMessageSend serializes every real message send through one paced queue.
// Presence updates (typing/paused) bypass the queue — they are not messages.
function queueMessageSend(jid, kind, sendFn, opts = {}) {
  if (sendQueueDepth >= MAX_SEND_QUEUE) {
    return Promise.resolve({ ok: false, error: `send queue full (${MAX_SEND_QUEUE} pending)`, reason: 'queue_full' });
  }
  sendQueueDepth++;
  const gap = kind === 'reply' ? rand(...PACING.replyGapMs) : rand(...PACING.coldGapMs);
  const scheduledAt = Math.max(lastPlannedSendAt, Date.now()) + gap;
  lastPlannedSendAt = scheduledAt;
  const waitMs = scheduledAt - Date.now();

  // R4: reserve pacing quota SYNCHRONOUSLY at enqueue — not after the paced send
  // completes. checkSendAllowed reads these counters; incrementing them only
  // post-send let a burst of concurrent /send requests all pass the gate before
  // any had completed (TOCTOU), blowing the cold/hourly/per-JID caps (observed:
  // 51 cold sends against a cap of 20). Committing here — before the first await
  // yields — means the next request's checkSendAllowed sees this reservation.
  // Rolled back below if the send ultimately fails.
  pacingState.sentToday++;
  if (kind === 'cold') pacingState.coldSentToday++;
  sendHourlyTimes.push(scheduledAt);
  if (sendHourlyTimes.length > PACING.hourlyCap * 2) {
    sendHourlyTimes = sendHourlyTimes.filter((t) => Date.now() - t < 3_600_000);
  }
  trackJidSend(jid);
  saveState();

  const task = sendChain.catch(() => {}).then(async () => {
    const delay = scheduledAt - Date.now();
    if (delay > 0) await sleep(delay);
    if (connState !== 'open') throw new Error('whatsapp disconnected while queued');
    if (opts.typing) {
      await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      // R1: proportional typing — scales with message length so short bursts don't
      // show an unnaturally long composing indicator, and long messages don't snap.
      // ~40ms per char, jitter ±20%, floor 1.5s, ceiling 5s.
      const baseMs = Math.max(1_500, (opts.textLen || 50) * 40);
      const typingMs = Math.min(baseMs + rand(-Math.floor(baseMs * 0.2), Math.floor(baseMs * 0.2)), 5_000);
      await sleep(typingMs);
    }
    const res = await sendFn();
    storeMessage(res?.key, res?.message);
    console.log(`[bridge] sent kind=${kind} to=${maskJid(jid)} gap=${gap}ms today=${pacingState.sentToday}/${PACING.dailyCap} cold=${pacingState.coldSentToday}/${PACING.coldDailyCap}`);
    return res;
  }).catch((e) => {
    // R4: send failed — release the quota reserved above so a transient failure
    // (e.g. bridge disconnected while queued) doesn't permanently consume the
    // daily/cold budget. Sliding-window timestamps expire on their own; leaving
    // one behind is fail-closed and harmless.
    pacingState.sentToday = Math.max(0, pacingState.sentToday - 1);
    if (kind === 'cold') pacingState.coldSentToday = Math.max(0, pacingState.coldSentToday - 1);
    saveState();
    throw e;
  }).finally(() => { sendQueueDepth = Math.max(0, sendQueueDepth - 1); });
  sendChain = task.catch(() => {});

  if (waitMs > 4_000) {
    // Long wait (cold pacing) — ack now, send in background so callers don't time out.
    task.catch((e) => console.warn(`[bridge] queued send failed to=${maskJid(jid)}: ${e.message}`));
    return Promise.resolve({ ok: true, queued: true, etaMs: waitMs, kind });
  }
  return task.then(() => ({ ok: true, sent: true, kind }))
    .catch((e) => ({ ok: false, error: e.message }));
}

// checkSendAllowed runs the cap/warm-up gates. Returns null if allowed, or an
// error result object if the send must be rejected.
function checkSendAllowed(kind, jid) {
  rollDay();
  if (pacingState.sentToday >= PACING.dailyCap) {
    return { ok: false, error: `daily send cap reached (${PACING.dailyCap})`, reason: 'daily_cap' };
  }
  // R1: hourly cap — prevents blasting 300 messages in one hour.
  sendHourlyTimes = sendHourlyTimes.filter((t) => Date.now() - t < 3_600_000);
  if (sendHourlyTimes.length >= PACING.hourlyCap) {
    const retryAfterMs = 3_600_000 - (Date.now() - sendHourlyTimes[0]) + 1_000;
    return { ok: false, error: `hourly send cap reached (${PACING.hourlyCap}/h)`, reason: 'hourly_cap', retryAfterMs };
  }
  // R2: per-JID rate limit — max 5 messages per 10 min per contact.
  if (jid) {
    const recentToJid = (jidSendTimes.get(jid) || []).filter((t) => Date.now() - t < 10 * 60_000);
    if (recentToJid.length >= 5) {
      return { ok: false, error: `per-contact rate limit (5 per 10min) for ${maskJid(jid)}`, reason: 'jid_rate_limit' };
    }
  }
  if (kind === 'cold') {
    const sincePair = Date.now() - (pacingState.pairedAt || 0);
    if (pacingState.pairedAt && sincePair < PACING.pairingWarmupMs) {
      const retryAfterMs = PACING.pairingWarmupMs - sincePair;
      return { ok: false, error: `fresh-pairing warm-up: cold sends blocked for ${Math.ceil(retryAfterMs / 60000)}m more (replies still allowed)`, reason: 'warmup', retryAfterMs };
    }
    if (pacingState.coldSentToday >= PACING.coldDailyCap) {
      return { ok: false, error: `cold-send daily cap reached (${PACING.coldDailyCap})`, reason: 'cold_cap' };
    }
  }
  return null;
}

// ── getMessage store — REQUIRED. Without it, a failed decrypt on the peer side
// makes Baileys re-request the proto; returning undefined every time triggers
// retry storms (blank messages, log spam, abnormal traffic). Bounded at 500. ──
const msgStore = new Map(); // msgId -> proto
function storeMessage(key, message) {
  if (!key?.id || !message) return;
  msgStore.set(key.id, message);
  if (msgStore.size > 500) msgStore.delete(msgStore.keys().next().value);
}

// ── Inbound dedup (Baileys can double-fire messages.upsert) ────────────────
const processed = new Map(); // msgId -> ts
const DEDUP_TTL = 60_000;
const DEDUP_MAX = 500;
function seen(id) {
  const now = Date.now();
  if (processed.has(id)) return true;
  processed.set(id, now);
  if (processed.size > DEDUP_MAX) {
    for (const [k, ts] of processed) if (now - ts > DEDUP_TTL) processed.delete(k);
  }
  return false;
}

// ── Logging helper ────────────────────────────────────────────────────────
// Masks a JID for logs: 6588329020@s.whatsapp.net -> 65***9020. Enough to
// correlate a complaint with a log line, without writing full numbers to disk.
function maskJid(jid) {
  if (!jid) return 'unknown';
  const digits = String(jid).split('@')[0].split(':')[0].replace(/\D/g, '');
  if (digits.length < 6) return digits || 'unknown';
  return `${digits.slice(0, 2)}***${digits.slice(-4)}`;
}

// ── Message extraction (mirrors lib/whatsapp/instance.ts, kept minimal) ────
function extract(msg) {
  const m = msg.message;
  if (!m) return null;
  let text = m.conversation || m.extendedTextMessage?.text || '';
  let messageType = 'text';
  let mediaMetadata;

  if (m.imageMessage) {
    messageType = 'image';
    text = m.imageMessage.caption || '';
    mediaMetadata = { mimeType: m.imageMessage.mimetype || 'image/jpeg' };
  } else if (m.audioMessage) {
    messageType = 'audio';
    mediaMetadata = { mimeType: m.audioMessage.mimetype || 'audio/ogg' };
  } else if (m.videoMessage) {
    messageType = 'video';
    text = m.videoMessage.caption || '';
    mediaMetadata = { mimeType: m.videoMessage.mimetype || 'video/mp4' };
  } else if (m.documentMessage) {
    messageType = 'document';
    text = m.documentMessage.caption || '';
    mediaMetadata = { mimeType: m.documentMessage.mimetype || 'application/octet-stream', fileName: m.documentMessage.fileName };
  } else if (m.stickerMessage) {
    messageType = 'sticker';
  } else if (m.listResponseMessage) {
    text = m.listResponseMessage.singleSelectReply?.selectedRowId || m.listResponseMessage.title || '';
  } else if (m.locationMessage || m.liveLocationMessage) {
    messageType = 'location';
    const loc = m.locationMessage || m.liveLocationMessage;
    if (loc?.degreesLatitude != null) text = `[Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}]`;
  }

  const remoteJid = msg.key.remoteJid || '';
  // Keep the FULL JID (incl. @lid / @s.whatsapp.net) so the core's reply routes back
  // to the exact origin. Stripping it broke delivery for @lid (privacy-ID) users.
  const from = remoteJid;

  return {
    from,
    text,
    pushName: msg.pushName || 'Unknown',
    messageId: msg.key.id || '',
    isGroup: isJidGroup(remoteJid) || remoteJid.endsWith('@g.us'),
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000),
    messageType,
    instanceId: INSTANCE_ID,
    ...(mediaMetadata ? { mediaMetadata } : {}),
  };
}

async function postCore(path, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${CORE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json().catch(() => ({}));
      console.warn(`[bridge] core ${path} -> ${res.status}`);
    } catch (err) {
      console.warn(`[bridge] core ${path} attempt ${i + 1} failed: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

// ── Baileys connection ─────────────────────────────────────────────────────
// Quiet no-op logger — Baileys' default dumps crypto session material to stdout.
const silentLogger = {
  level: 'silent',
  child: () => silentLogger,
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
};

// ── Reconnect circuit breaker ───────────────────────────────────────────────
// Hundreds of rapid reconnects is exactly what got this number restricted.
// Authenticated reconnects are budgeted per rolling hour; exceeding the budget
// opens a 30-minute cooldown.
//
// R5: QR-mode reconnects (no creds on disk) are also budgeted separately.
// Previously they bypassed the circuit breaker entirely, allowing a 401 →
// clearAuth → infinite 408-in-QR-mode loop. The 408 storm (2689 events in the
// ban session) happened exactly because !hasCreds() bypassed all guards.
// QR-mode gets a higher budget (12/h) since each QR rotation needs a new
// connection, but still has a 30-min cooldown to stop infinite 408 loops.
let reconnectCount = 0;          // backoff exponent, reset on 'open'
let reconnectTimes = [];         // authenticated reconnect timestamps (1h window)
let qrReconnectTimes = [];       // R5: QR-mode reconnect timestamps (1h window)
let cooldownUntil = 0;
let connectionReplacedCount = 0; // R1: track 440 repeats; 2 in a row = clear auth
const HOURLY_RECONNECT_BUDGET = 8;
const HOURLY_QR_RECONNECT_BUDGET = 12; // R5: higher than auth budget; QR rotates every ~20s
const COOLDOWN_MS = 30 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
let cachedWAVersion = null;
let versionFetchedAt = 0; // R2: track age so we refresh every 24h

function hasCreds() {
  try { return fs.existsSync(path.join(AUTH_DIR, 'creds.json')); } catch (_) { return false; }
}

function clearAuth(why) {
  try {
    fs.readdirSync(AUTH_DIR).filter((f) => f.endsWith('.json'))
      .forEach((f) => fs.unlinkSync(path.join(AUTH_DIR, f)));
    console.warn(`[bridge] auth cleared (${why}) — QR pairing required`);
  } catch (e) {
    console.error(`[bridge] clear auth failed: ${e.message}`);
  }
}

function scheduleReconnect(baseDelayMs) {
  const now = Date.now();
  if (!hasCreds()) {
    // R5: QR pairing mode — connections refresh the QR, but they must also be
    // budgeted. Without a budget, a 401 → clearAuth cycle caused 2689 × 408
    // reconnects (the proximate trigger for the account ban). QR gets a higher
    // hourly budget than authenticated mode (QR rotates ~every 20s) but still
    // has a 30-min cooldown to stop infinite loop storms.
    qrReconnectTimes = qrReconnectTimes.filter((t) => now - t < 3_600_000);
    if (now < cooldownUntil) {
      const leftMs = cooldownUntil - now;
      console.warn(`[bridge] QR-mode in cooldown — reconnecting in ${Math.ceil(leftMs / 60_000)}m`);
      setTimeout(() => connect(), leftMs + 5_000);
      return;
    }
    if (qrReconnectTimes.length >= HOURLY_QR_RECONNECT_BUDGET) {
      cooldownUntil = now + COOLDOWN_MS;
      connState = 'cooldown';
      console.warn(`[bridge] QR-mode reconnect budget exhausted (${HOURLY_QR_RECONNECT_BUDGET}/h) — 30m cooldown. Scan QR at the /qr/ page; don't restart PM2.`);
      setTimeout(() => connect(), COOLDOWN_MS + 5_000);
      return;
    }
    qrReconnectTimes.push(now);
    setTimeout(() => connect(), Math.max(baseDelayMs, 5_000));
    return;
  }
  reconnectTimes = reconnectTimes.filter((t) => now - t < 3_600_000);
  if (now < cooldownUntil) {
    const leftMs = cooldownUntil - now;
    console.warn(`[bridge] in cooldown — reconnecting in ${Math.ceil(leftMs / 60_000)}m`);
    setTimeout(() => connect(), leftMs + 5_000);
    return;
  }
  if (reconnectTimes.length >= HOURLY_RECONNECT_BUDGET) {
    cooldownUntil = now + COOLDOWN_MS;
    connState = 'cooldown';
    console.warn(`[bridge] reconnect budget exhausted (${HOURLY_RECONNECT_BUDGET}/h) — 30m cooldown to protect the account`);
    setTimeout(() => connect(), COOLDOWN_MS + 5_000);
    return;
  }
  reconnectTimes.push(now);
  setTimeout(() => connect(), baseDelayMs);
}

async function connect() {
  const freshPairing = !hasCreds(); // no creds now => if we reach 'open', it was a QR pairing
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  // R2: refresh Baileys version every 24h — WA servers can deprecate old client versions,
  // and sending a very stale version can trigger detection. First fetch on cold start.
  if (!cachedWAVersion || Date.now() - versionFetchedAt > 24 * 60 * 60_000) {
    try {
      const { version } = await fetchLatestBaileysVersion();
      cachedWAVersion = version;
      versionFetchedAt = Date.now();
    } catch (e) {
      if (!cachedWAVersion) throw e; // first fetch failed — can't proceed without a version
      console.warn('[bridge] version refresh failed, reusing cached:', e.message);
    }
  }
  sock = makeWASocket({
    version: cachedWAVersion,
    auth: state,
    logger: silentLogger,
    printQRInTerminal: false,
    keepAliveIntervalMs: 30_000, // R1: 30s is Baileys default; 25s was non-standard
    connectTimeoutMs: 60_000,
    retryRequestDelayMs: 2_000,
    maxRetries: 5,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,  // correct: continuous presence broadcasting flags automation
    generateHighQualityLinkPreview: false,
    // R1: 'Ubuntu'+'Chrome' = legitimate desktop session; old 'WhatsApp' device name
    // and Chrome 120 (Dec 2023) were suspicious. Version matches Browsers.ubuntu('Chrome').
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
    // R1: block Status/broadcast at the socket layer — Issue #2309 confirms
    // processing Status uploads on production servers can trigger permanent bans.
    shouldIgnoreJid: (jid) => isJidBroadcast(jid) || isJidStatusBroadcast(jid),
    // REQUIRED: without getMessage, peer-side decrypt failures cause endless
    // proto re-requests (retry storms) — a known Baileys ban vector.
    getMessage: async (key) => msgStore.get(key?.id),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      latestQR = qr;
      console.log('[bridge] Scan this QR to link WhatsApp (terminal or /qr page):');
      qrcode.generate(qr, { small: true });
    }
    if (connection) connState = connection;
    if (connection === 'open') {
      latestQR = null;
      reconnectCount = 0;
      reconnectTimes = [];
      qrReconnectTimes = []; // R5: reset QR budget on successful auth
      cooldownUntil = 0;
      connectionReplacedCount = 0; // R1: reset on clean connect
      if (freshPairing) {
        pacingState.pairedAt = Date.now();
        saveState();
        console.log(`[bridge] fresh pairing — warm-up active for ${PACING.pairingWarmupMs / 60_000}m (replies only, no cold sends)`);
      }
      console.log(`[bridge] WhatsApp connected (${sock.user?.id})`);
    } else if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        // 401: creds are dead. Retrying with them produced 500+ attempts and caused
        // the original restriction. Clear once, sit in QR mode, wait for a human.
        console.warn('[bridge] logged out (401) — creds are dead, switching to QR pairing mode');
        clearAuth('401 loggedOut');
        reconnectCount = 0;
        scheduleReconnect(5_000);
      } else if (code === DisconnectReason.forbidden) {
        // R1: 403 = account banned by WhatsApp. Any reconnect attempt just adds to
        // the evidence against the account. Stop permanently, require human action.
        connState = 'forbidden';
        console.error('[bridge] ACCOUNT FORBIDDEN (403) — WhatsApp has restricted/banned this number. Stop all activity and investigate.');
      } else if (code === DisconnectReason.badSession) {
        // R1: 500 = session file is corrupted. Same as 401: clear and QR mode.
        console.warn('[bridge] bad session (500) — clearing auth, QR pairing required');
        clearAuth('500 badSession');
        reconnectCount = 0;
        scheduleReconnect(5_000);
      } else if (code === DisconnectReason.multideviceMismatch) {
        // R1: 411 = multi-device session mismatch. Occurs when the phone app changes.
        // Clear auth and re-pair — connecting with mismatched creds is pointless.
        console.warn('[bridge] multidevice mismatch (411) — clearing auth, QR pairing required');
        clearAuth('411 multideviceMismatch');
        reconnectCount = 0;
        scheduleReconnect(5_000);
      } else if (code === DisconnectReason.connectionReplaced) {
        // R1: 440 = another session has claimed this connection. Reconnecting quickly
        // just fights the other session in an infinite loop. Allow one polite back-off
        // retry; if it happens again, give up and require QR re-pairing.
        connectionReplacedCount++;
        if (connectionReplacedCount >= 2) {
          console.error('[bridge] connection replaced (440) twice — unresolvable session conflict, clearing auth for QR re-pairing');
          clearAuth('440 repeated connectionReplaced');
          connectionReplacedCount = 0;
          reconnectCount = 0;
          scheduleReconnect(10_000);
        } else {
          console.warn(`[bridge] connection replaced (440) attempt ${connectionReplacedCount}/2 — backing off 90s before one retry`);
          reconnectCount++;
          scheduleReconnect(90_000);
        }
      } else if (code === DisconnectReason.restartRequired) {
        // 515: normal right after pairing — reconnect promptly.
        console.log('[bridge] restart required (515) — reconnecting');
        scheduleReconnect(2_000);
      } else {
        reconnectCount = Math.min(reconnectCount + 1, 6);
        const delay = Math.min(5_000 * 2 ** (reconnectCount - 1), MAX_BACKOFF_MS);
        // R5: 408 (connection timeout) and 503 (server unavailable) are WA-side
        // pressure signals — they often precede a restriction. Log them distinctly
        // so operators can spot a building storm before it becomes a ban.
        const pressureNote = (code === 408 || code === 503)
          ? ` ⚠️ WA-side pressure code (${code} storm = ban risk — check /health)`
          : '';
        console.warn(`[bridge] connection closed (code=${code}), reconnecting in ${Math.round(delay / 1000)}s${pressureNote}`);
        scheduleReconnect(delay);
      }
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    // Every drop path below logs. A guest message that vanishes without a trace
    // is undiagnosable after the fact — on 2026-07-30 we could not tell whether
    // a real guest's message ever reached the core, because nothing on the
    // inbound path wrote a line. Message bodies are never logged (PDPA); the
    // JID is masked to country code + last 4.
    // Process both 'notify' (new) and 'append' (device-sync / other-device reflections).
    // 'append' was silently dropped before 2026-07-31 and is the confirmed cause of at
    // least one missed guest message (+65***9020, 2026-07-30). Historical sync is blocked
    // at the Baileys layer (shouldSyncHistoryMessage: () => false + syncFullHistory: false);
    // outgoing reflections are caught by the fromMe check below; dedup covers the rest.
    if (upsert.type !== 'notify' && upsert.type !== 'append') {
      console.log(`[bridge] drop reason=upsert-type type=${upsert.type} n=${upsert.messages?.length ?? 0}`);
      return;
    }
    if (upsert.type !== 'notify') {
      console.log(`[bridge] upsert type=${upsert.type} n=${upsert.messages?.length ?? 0} (processing)`);
    }
    for (const msg of upsert.messages) {
      const jid = maskJid(msg?.key?.remoteJid);
      try {
        // Feed the getMessage store with everything (incl. our own reflections)
        // so peer-side decrypt retries can be answered.
        storeMessage(msg.key, msg.message);
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;
        // Mark this JID as warm: replies to them may go out fast.
        if (msg.key.remoteJid) noteInbound(msg.key.remoteJid);
        const id = msg.key.id;
        if (id && seen(id)) {
          console.log(`[bridge] drop reason=duplicate from=${jid} id=${id}`);
          continue;
        }
        const incoming = extract(msg);
        if (!incoming) {
          // Unrecognised message shape — the most dangerous silent drop: the
          // guest's phone shows "delivered" and no reply ever comes.
          console.warn(`[bridge] drop reason=unextractable from=${jid} id=${id} keys=${Object.keys(msg.message || {}).join(',') || 'none'}`);
          continue;
        }
        // Download media (esp. voice notes for transcription) → public URL for the core.
        if (['audio', 'image', 'video', 'document'].includes(incoming.messageType)) {
          incoming.mediaUrl = await downloadAndSave(msg, incoming.messageType, incoming.mediaMetadata?.mimeType);
        }
        if (!incoming.text && incoming.messageType === 'text') {
          console.warn(`[bridge] drop reason=empty-text from=${jid} id=${id}`);
          continue;
        }
        console.log(`[bridge] relay from=${jid} id=${id} type=${incoming.messageType} len=${(incoming.text || '').length}`);
        // R2: send read receipt after a human-like random delay (3-10s).
        // Skipping read receipts entirely is a detectable one-way-traffic pattern.
        setTimeout(() => {
          if (sock && connState === 'open') {
            sock.readMessages([msg.key]).catch(() => {});
          }
        }, rand(3_000, 10_000));
        // Fire to the core; the core owns all business logic + the reply.
        postCore('/inbound', incoming).catch((e) => console.warn(`[bridge] relay error from=${jid} id=${id}: ${e.message}`));
      } catch (err) {
        console.error(`[bridge] inbound error from=${jid}: ${err.message}`);
      }
    }
  });
}

// ── Outbound: HTTP /send the core calls ─────────────────────────────────────
function jidFor(phone) {
  if (phone.includes('@')) return phone;
  return `${phone.replace(/\D/g, '')}@s.whatsapp.net`;
}

async function handleSend(op) {
  if (!sock || connState !== 'open') {
    return { ok: false, error: 'whatsapp not connected', reason: 'no_instance' };
  }
  const jid = jidFor(op.phone);
  switch (op.op) {
    case 'send_typing':
      await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      return { ok: true };
    case 'send_paused':
      await sock.sendPresenceUpdate('paused', jid).catch(() => {});
      return { ok: true };
    case 'send_text': {
      const kind = classify(jid);
      const blocked = checkSendAllowed(kind, jid);
      if (blocked) return blocked;
      // Cold text sends get an automatic typing indicator (human-like).
      return queueMessageSend(jid, kind, () => sock.sendMessage(jid, { text: op.text }), { typing: kind === 'cold', textLen: op.text?.length || 0 });
    }
    case 'send_media': {
      const kind = classify(jid);
      const blocked = checkSendAllowed(kind, jid);
      if (blocked) return blocked;
      return queueMessageSend(jid, kind, async () => {
        const resp = await fetch(op.mediaUrl);
        const buf = Buffer.from(await resp.arrayBuffer());
        const mt = op.mimetype || 'application/octet-stream';
        let content;
        if (mt.startsWith('image/')) content = { image: buf, caption: op.caption, mimetype: mt };
        else if (mt.startsWith('video/')) content = { video: buf, caption: op.caption, mimetype: mt };
        else content = { document: buf, fileName: op.fileName || 'file', mimetype: mt };
        return sock.sendMessage(jid, content);
      });
    }
    case 'send_interactive': {
      const kind = classify(jid);
      const blocked = checkSendAllowed(kind, jid);
      if (blocked) return blocked;
      return queueMessageSend(jid, kind, () => sock.sendMessage(jid, op.payload));
    }
    default:
      return { ok: false, error: `unknown op ${op.op}` };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    rollDay();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'rainbow-bridge',
      whatsapp: connState,
      instanceId: INSTANCE_ID,
      pacing: {
        sentToday: pacingState.sentToday,
        coldSentToday: pacingState.coldSentToday,
        sentThisHour: sendHourlyTimes.filter((t) => Date.now() - t < 3_600_000).length,
        queueDepth: sendQueueDepth,
        dailyCap: PACING.dailyCap,
        coldDailyCap: PACING.coldDailyCap,
        hourlyCap: PACING.hourlyCap,
        warmupActive: !!(pacingState.pairedAt && Date.now() - pacingState.pairedAt < PACING.pairingWarmupMs),
        cooldownUntil: cooldownUntil || null,
      },
      // R5: reconnect circuit-breaker state — watch these during a 408 storm
      reconnect: {
        authedThisHour: reconnectTimes.filter((t) => Date.now() - t < 3_600_000).length,
        authedBudget: HOURLY_RECONNECT_BUDGET,
        qrThisHour: qrReconnectTimes.filter((t) => Date.now() - t < 3_600_000).length,
        qrBudget: HOURLY_QR_RECONNECT_BUDGET,
      },
    }));
    return;
  }
  // Token-gated QR page (auto-refreshes; the QR rotates ~every 20s).
  if (req.method === 'GET' && req.url.startsWith('/qr/')) {
    const token = decodeURIComponent(req.url.slice('/qr/'.length).split('?')[0]);
    if (!QR_TOKEN || token !== QR_TOKEN) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const page = (body) => `<!doctype html><html><head><meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>Rainbow Bridge — Link WhatsApp</title>
      <meta http-equiv="refresh" content="5"/>
      <style>body{font-family:sans-serif;text-align:center;padding:30px;background:#0b0b0f;color:#eee}
      img{width:320px;height:320px;background:#fff;padding:12px;border-radius:12px}
      .ok{color:#37d67a;font-size:22px}</style></head><body>${body}</body></html>`;
    if (connState === 'open') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(`<h2>✅ WhatsApp Connected</h2><p class="ok">${sock?.user?.id || ''}</p><p>You can close this page.</p>`));
      return;
    }
    if (!latestQR) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(`<h2>Waiting for QR…</h2><p>Status: <b>${connState}</b>. This page refreshes automatically.</p>`));
      return;
    }
    QRCode.toDataURL(latestQR, { width: 320, margin: 1 }, (err, dataUrl) => {
      if (err) { res.writeHead(500); res.end('qr error'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(`<h2>Scan to link the hostel WhatsApp</h2>
        <img src="${dataUrl}" alt="WhatsApp QR"/>
        <p>WhatsApp → <b>Linked Devices</b> → <b>Link a Device</b> → scan.</p>
        <p style="color:#888">Refreshes every 5s — the QR rotates, that's normal.</p>`));
    });
    return;
  }
  // Serve downloaded media so the Go core can fetch it (e.g. for transcription).
  if (req.method === 'GET' && req.url.startsWith('/media/')) {
    // path.basename strips any directory components → no path traversal.
    const name = path.basename(decodeURIComponent(req.url.slice('/media/'.length)));
    fs.readFile(path.join(MEDIA_DIR, name), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(data);
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const op = JSON.parse(body || '{}');
        const result = await handleSend(op);
        res.writeHead(result.ok ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/groups') {
    if (!sock) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not connected' }));
      return;
    }
    (async () => {
      try {
        const groups = await sock.groupFetchAllParticipating();
        const list = Object.entries(groups).map(([id, g]) => ({ id, subject: g.subject, size: g.size }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, groups: list }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(BRIDGE_PORT, () => {
  console.log(`[bridge] listening on :${BRIDGE_PORT} (core=${CORE_URL}, instance=${INSTANCE_ID})`);
});

// Boot failures (e.g. Baileys version CDN down) retry instead of exiting —
// process.exit + PM2 instant restart is the loop that got the number banned.
function boot() {
  connect().catch((err) => {
    console.error('[bridge] connect error, retrying in 30s:', err.message);
    setTimeout(boot, 30_000);
  });
}
boot();

process.on('uncaughtException', (e) => console.error('[bridge] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[bridge] unhandledRejection:', e));
