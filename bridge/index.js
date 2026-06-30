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
 */
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  isJidGroup,
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

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({
    version,
    auth: state,
    logger: silentLogger,
    printQRInTerminal: false,
    keepAliveIntervalMs: 30_000,
    connectTimeoutMs: 60_000,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    browser: ['RainbowBridge', 'Chrome', '1.0.0'],
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
      console.log(`[bridge] WhatsApp connected (${sock.user?.id})`);
    } else if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      console.warn(`[bridge] connection closed (code=${code}), ${loggedOut ? 'logged out' : 'reconnecting'}`);
      if (!loggedOut) setTimeout(connect, 2000);
    }
  });

  sock.ev.on('messages.upsert', async (upsert) => {
    if (upsert.type !== 'notify') return;
    for (const msg of upsert.messages) {
      try {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;
        const id = msg.key.id;
        if (id && seen(id)) continue;
        const incoming = extract(msg);
        if (!incoming) continue;
        // Download media (esp. voice notes for transcription) → public URL for the core.
        if (['audio', 'image', 'video', 'document'].includes(incoming.messageType)) {
          incoming.mediaUrl = await downloadAndSave(msg, incoming.messageType, incoming.mediaMetadata?.mimeType);
        }
        if (!incoming.text && incoming.messageType === 'text') continue;
        // Fire to the core; the core owns all business logic + the reply.
        postCore('/inbound', incoming).catch((e) => console.warn('[bridge] relay error', e.message));
      } catch (err) {
        console.error('[bridge] inbound error:', err.message);
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
    case 'send_text':
      await sock.sendMessage(jid, { text: op.text });
      return { ok: true, sent: true };
    case 'send_typing':
      await sock.sendPresenceUpdate('composing', jid).catch(() => {});
      return { ok: true };
    case 'send_paused':
      await sock.sendPresenceUpdate('paused', jid).catch(() => {});
      return { ok: true };
    case 'send_media': {
      const resp = await fetch(op.mediaUrl);
      const buf = Buffer.from(await resp.arrayBuffer());
      const mt = op.mimetype || 'application/octet-stream';
      let content;
      if (mt.startsWith('image/')) content = { image: buf, caption: op.caption, mimetype: mt };
      else if (mt.startsWith('video/')) content = { video: buf, caption: op.caption, mimetype: mt };
      else content = { document: buf, fileName: op.fileName || 'file', mimetype: mt };
      await sock.sendMessage(jid, content);
      return { ok: true, sent: true };
    }
    case 'send_interactive':
      await sock.sendMessage(jid, op.payload);
      return { ok: true, sent: true };
    default:
      return { ok: false, error: `unknown op ${op.op}` };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'rainbow-bridge', whatsapp: connState, instanceId: INSTANCE_ID }));
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
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(BRIDGE_PORT, () => {
  console.log(`[bridge] listening on :${BRIDGE_PORT} (core=${CORE_URL}, instance=${INSTANCE_ID})`);
});

connect().catch((err) => {
  console.error('[bridge] fatal connect error:', err);
  process.exit(1);
});

process.on('uncaughtException', (e) => console.error('[bridge] uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('[bridge] unhandledRejection:', e));
