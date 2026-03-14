import makeWASocket, { DisconnectReason, isLidUser, jidNormalizedUser, fetchLatestWaWebVersion, type AnyMessageContent } from '@whiskeysockets/baileys';
import fs from 'fs';
import type { IncomingMessage, MessageType, MediaMetadata } from '../../assistant/types.js';
import { trackWhatsAppConnected, trackWhatsAppDisconnected, trackWhatsAppUnlinked } from '../activity-tracker.js';
import { notifyAdminDisconnection, notifyAdminReconnect } from '../admin-notifier.js';
import type { WhatsAppInstanceStatus, MessageHandler, MessageStatusHandler } from './types.js';
import { LidMapper } from './lid-mapper.js';
import { ensureAvatar } from './avatar-cache.js';
import { useDbAuthState, validateAuthState } from './db-auth-state.js';
import { notifyAdminAuthStateCorruption } from '../admin-notifier.js';

// US-830: Circuit breaker states for connection management
type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerState {
  state: CircuitState;
  consecutiveFailures: number;
  lastOpenedAt: number | null;   // Date.now() timestamp
  cooldownMs: number;            // 30 minutes default
  maxFailures: number;           // 5 consecutive failures to trip
}

// US-477: BSUID pattern — two-letter country code + dot + alphanumeric (up to 128 chars)
const BSUID_PATTERN = /^[A-Z]{2}\.[A-Za-z0-9]{1,125}$/;

/**
 * Check if a string matches the WhatsApp Business-Scoped User ID format.
 * Format: CC.BSUID where CC is a two-letter country code.
 */
export function isBsuid(value: string): boolean {
  return BSUID_PATTERN.test(value);
}

/**
 * Extract BSUID from a Baileys message if present.
 * Checks: msg.lid field, msg.key.participant, and the resolved `from` JID itself.
 */
function extractBsuid(msg: any, resolvedFrom: string): string | undefined {
  // 1. Check explicit lid field on the message (Baileys v7+)
  if (msg.lid && typeof msg.lid === 'string') {
    const raw = msg.lid.replace(/@.*$/, ''); // strip @lid or @s.whatsapp.net suffix
    if (isBsuid(raw)) return raw;
  }

  // 2. Check msg.key.participant (group messages or forwarded identity)
  if (msg.key?.participant && typeof msg.key.participant === 'string') {
    const raw = msg.key.participant.replace(/@.*$/, '');
    if (isBsuid(raw)) return raw;
  }

  // 3. Check if the resolved `from` JID itself is a BSUID (phone hidden)
  const fromStripped = resolvedFrom.replace(/@.*$/, '');
  if (isBsuid(fromStripped)) return fromStripped;

  return undefined;
}

export class WhatsAppInstance {
  id: string;
  label: string;
  authDir: string;
  sock: ReturnType<typeof makeWASocket> | null = null;
  state: string = 'close';
  qr: string | null = null;
  unlinkedFromWhatsApp: boolean = false;
  lastUnlinkedAt: string | null = null;
  lastConnectedAt: string | null = null;

  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts: number = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 3;
  private lastDisconnectCode: number | null = null;
  private lastDisconnectAt: string | null = null;

  // US-830: Circuit breaker — prevents rapid reconnect cycling that triggers WhatsApp bans
  private circuitBreaker: CircuitBreakerState = {
    state: 'closed',
    consecutiveFailures: 0,
    lastOpenedAt: null,
    cooldownMs: 30 * 60 * 1000,  // 30 minutes
    maxFailures: 5,
  };
  private cooldownTimeout: ReturnType<typeof setTimeout> | null = null;
  private messageHandler: MessageHandler | null = null;
  private messageStatusHandler: MessageStatusHandler | null = null;
  private lidMapper: LidMapper;
  private unlinkNotificationSent: boolean = false;
  private onFirstConnect: (() => void) | null = null;

  // Dedup: Baileys can fire messages.upsert multiple times for the same message
  private static readonly DEDUP_CACHE_SIZE = 500;
  private static readonly DEDUP_TTL_MS = 60_000; // 60 seconds
  private _processedMsgIds = new Map<string, number>(); // msgId → timestamp

  constructor(id: string, label: string, authDir: string) {
    this.id = id;
    this.label = label;
    this.authDir = authDir;
    this.lidMapper = new LidMapper(id);
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  setMessageStatusHandler(handler: MessageStatusHandler): void {
    this.messageStatusHandler = handler;
  }

  setOnFirstConnect(cb: () => void): void {
    this.onFirstConnect = cb;
  }

  /** Notify about unlinked instance via manager */
  private notifyUnlinked(notifyFn: (id: string, label: string) => Promise<void>): void {
    setTimeout(() => {
      notifyFn(this.id, this.label).catch(err => {
        console.error(`[Baileys:${this.id}] Failed to send unlink notification:`, err.message);
      });
    }, 1000);
  }

  async start(notifyUnlinkedFn: (id: string, label: string) => Promise<void>): Promise<void> {
    // Ensure auth dir exists (still needed for LID mapper cache files)
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    // Load existing LID→phone mappings from auth state files
    this.lidMapper.loadFromDisk(this.authDir);

    // US-842: Validate auth state before connecting — detect and clear corrupted credentials
    const validation = await validateAuthState(this.id);
    if (!validation.healthy) {
      console.warn(`[Baileys:${this.id}] Auth state was corrupted and cleared (${validation.clearedRows} rows). Initiating QR re-pair.`);
      notifyAdminAuthStateCorruption(this.id, validation.clearedRows).catch(err => {
        console.error(`[Baileys:${this.id}] Failed to send auth corruption notification:`, err.message);
      });
    }

    // US-480: DB-backed auth state replaces useMultiFileAuthState
    const { state, saveCreds } = await useDbAuthState(this.id);

    const { version } = await fetchLatestWaWebVersion();
    console.log(`[Baileys:${this.id}] Using WA Web version: ${version.join('.')}`);

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      keepAliveIntervalMs: 10_000, // 10s keepalives — prevents socket from appearing silent during idle periods
      browser: ['digiman', 'Chrome', '1.0.0']
    });

    this.sock.ev.on('creds.update', saveCreds);

    // ─── Connection Updates ─────────────────────────────────────────

    this.sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qr = qr;
        console.log(`[Baileys:${this.id}] QR code available. Visit /admin/rainbow/dashboard to scan.`);
      }

      if (connection) this.state = connection;

      if (connection === 'close') {
        this.handleDisconnect(lastDisconnect, notifyUnlinkedFn);
      } else if (connection === 'open') {
        this.handleConnected();
      }
    });

    // ─── LID Mapping Updates ────────────────────────────────────────

    // Track LID ↔ phone mappings from contacts (Baileys v7 uses @lid JIDs)
    this.sock.ev.on('contacts.upsert', (contacts: any[]) => {
      for (const contact of contacts) {
        if (contact.id && contact.lid) {
          const phoneJid = jidNormalizedUser(contact.id);
          const lidJid = jidNormalizedUser(contact.lid);
          this.lidMapper.add(lidJid, phoneJid);
        }
      }
    });

    // Extract mappings from history sync
    this.sock.ev.on('messaging-history.set' as any, (data: any) => {
      const contacts = data?.contacts;
      if (Array.isArray(contacts)) {
        let mapped = 0;
        for (const contact of contacts) {
          if (contact.id && contact.lid) {
            const phoneJid = jidNormalizedUser(contact.id);
            const lidJid = jidNormalizedUser(contact.lid);
            this.lidMapper.add(lidJid, phoneJid);
            mapped++;
          }
        }
        if (mapped > 0) {
          console.log(`[Baileys:${this.id}] History sync: ${mapped} LID→phone mappings loaded (total: ${this.lidMapper.size})`);
        }
      }
    });

    // ─── Incoming Messages ──────────────────────────────────────────

    this.sock.ev.on('messages.upsert', async (upsert: any) => {
      if (upsert.type !== 'notify') return;

      for (const msg of upsert.messages) {
        await this.handleIncomingMessage(msg);
      }
    });

    // ─── Read Receipts / Message Status (US-017) ────────────────────
    this.sock.ev.on('messages.update', (updates: any[]) => {
      if (!this.messageStatusHandler) return;

      for (const update of updates) {
        const key = update.key;
        const status = update.update?.status;
        if (!key || status == null) continue;

        const remoteJid = key.remoteJid || '';
        if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) continue;

        // Extract phone number from JID
        const phone = remoteJid.replace(/@s\.whatsapp\.net$/i, '').replace(/@lid$/i, '');
        if (!phone) continue;

        this.messageStatusHandler({
          phone,
          messageId: key.id || '',
          status: status as 0 | 1 | 2 | 3 | 4,
          instanceId: this.id,
        });
      }
    });
  }

  private handleDisconnect(lastDisconnect: any, notifyUnlinkedFn: (id: string, label: string) => Promise<void>): void {
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    // US-443: Track last disconnect metadata
    this.lastDisconnectCode = statusCode ?? null;
    this.lastDisconnectAt = new Date().toISOString();

    if (statusCode !== DisconnectReason.loggedOut) {
      // US-830: Circuit breaker — track consecutive failures
      this.circuitBreaker.consecutiveFailures++;
      this.reconnectAttempts++;

      // US-830: Check if circuit breaker should OPEN
      if (this.circuitBreaker.consecutiveFailures >= this.circuitBreaker.maxFailures) {
        this.circuitBreaker.state = 'open';
        this.circuitBreaker.lastOpenedAt = Date.now();

        const reason = `Circuit breaker OPEN — ${this.circuitBreaker.consecutiveFailures} consecutive failures. Cooling down for ${this.circuitBreaker.cooldownMs / 60000} min.`;
        console.warn(`[Baileys:${this.id}] ${reason}`);
        trackWhatsAppDisconnected(this.id, reason);

        // Admin notification
        notifyAdminDisconnection(this.id, this.label, reason).catch(err => {
          console.error(`[Baileys:${this.id}] Failed to notify admin of circuit breaker:`, err.message);
        });

        // Schedule HALF-OPEN transition after cooldown
        if (this.cooldownTimeout) clearTimeout(this.cooldownTimeout);
        this.cooldownTimeout = setTimeout(() => {
          this.cooldownTimeout = null;
          this.circuitBreaker.state = 'half-open';
          console.log(`[Baileys:${this.id}] Circuit breaker HALF-OPEN — attempting single reconnection`);
          this.reconnectAttempts = 0; // reset for the half-open attempt
          this.start(notifyUnlinkedFn);
        }, this.circuitBreaker.cooldownMs);

        this.reconnectTimeout = null;
        return;
      }

      // Circuit is closed or half-open — allow reconnect with backoff
      if (this.reconnectAttempts > WhatsAppInstance.MAX_RECONNECT_ATTEMPTS) {
        const reason = `code ${statusCode}, stopped after ${WhatsAppInstance.MAX_RECONNECT_ATTEMPTS} attempts`;
        console.warn(`[Baileys:${this.id}] ${reason}. Please visit dashboard to restart.`);
        notifyAdminDisconnection(this.id, this.label, reason).catch(err => {
          console.error(`[Baileys:${this.id}] Failed to notify admin of disconnection:`, err.message);
        });
        this.reconnectTimeout = null;
        return;
      }

      // 408 = request timeout — use longer delay to avoid rapid retry spam
      const is408 = statusCode === 408;
      const baseDelay = this.reconnectTimeout ? 5000 : (is408 ? 30000 : 2000);
      const delay = Math.min(baseDelay * this.reconnectAttempts, 60000);

      console.log(`[Baileys:${this.id}] Disconnected (code: ${statusCode}), reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${WhatsAppInstance.MAX_RECONNECT_ATTEMPTS})...`);
      trackWhatsAppDisconnected(this.id, `code ${statusCode}, reconnecting (${this.reconnectAttempts}/${WhatsAppInstance.MAX_RECONNECT_ATTEMPTS})`);

      if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null;
        this.start(notifyUnlinkedFn);
      }, delay);
    } else {
      console.error(`[Baileys:${this.id}] Logged out from WhatsApp (user unlinked). Remove auth dir and re-pair.`);
      trackWhatsAppUnlinked(this.id);

      // Mark as unlinked from WhatsApp side
      this.unlinkedFromWhatsApp = true;
      this.lastUnlinkedAt = new Date().toISOString();

      // Trigger notification to user (only once per unlink event)
      if (!this.unlinkNotificationSent) {
        this.notifyUnlinked(notifyUnlinkedFn);
        this.unlinkNotificationSent = true;
      }
    }
  }

  private handleConnected(): void {
    this.qr = null;
    const wasReconnecting = this.reconnectAttempts > 0;
    const wasHalfOpen = this.circuitBreaker.state === 'half-open';
    this.reconnectAttempts = 0;

    // US-830: Connection succeeded — close circuit breaker, reset failure count
    if (wasHalfOpen) {
      console.log(`[Baileys:${this.id}] Circuit breaker CLOSED — reconnection successful after cooldown`);
    }
    this.circuitBreaker.state = 'closed';
    this.circuitBreaker.consecutiveFailures = 0;
    if (this.cooldownTimeout) {
      clearTimeout(this.cooldownTimeout);
      this.cooldownTimeout = null;
    }

    // Clear unlinked status when reconnected
    this.unlinkedFromWhatsApp = false;
    this.lastUnlinkedAt = null;
    this.unlinkNotificationSent = false;

    // Update last connected timestamp
    this.lastConnectedAt = new Date().toISOString();
    this.onFirstConnect?.();

    const user = (this.sock as any)?.user;
    const userPhone = user?.id?.split(':')[0] || '?';
    console.log(`[Baileys:${this.id}] Connected: ${user?.name || 'Unknown'} (${userPhone})`);
    trackWhatsAppConnected(this.id, user?.name, userPhone);

    // Notify admin of reconnection (only if this was a reconnect, not initial connect)
    if (wasReconnecting) {
      notifyAdminReconnect(this.id, this.label, userPhone).catch(err => {
        console.error(`[Baileys:${this.id}] Failed to notify admin of reconnection:`, err.message);
      });
    }
  }

  private async handleIncomingMessage(msg: any): Promise<void> {
    try {
      if (msg.key.fromMe) return;
      if (msg.key.remoteJid === 'status@broadcast') return;

      // Dedup: skip if this message ID was already processed (Baileys double-fire)
      const msgId = msg.key.id;
      if (msgId && this._processedMsgIds.has(msgId)) {
        console.log(`[Baileys:${this.id}] Skipping duplicate message: ${msgId}`);
        return;
      }
      if (msgId) {
        this._processedMsgIds.set(msgId, Date.now());
        // Evict old entries to prevent memory leak
        if (this._processedMsgIds.size > WhatsAppInstance.DEDUP_CACHE_SIZE) {
          const now = Date.now();
          for (const [id, ts] of this._processedMsgIds) {
            if (now - ts > WhatsAppInstance.DEDUP_TTL_MS) {
              this._processedMsgIds.delete(id);
            }
          }
          // If still over limit after TTL eviction, remove oldest entries
          if (this._processedMsgIds.size > WhatsAppInstance.DEDUP_CACHE_SIZE) {
            const entries = [...this._processedMsgIds.entries()].sort((a, b) => a[1] - b[1]);
            const excess = entries.length - WhatsAppInstance.DEDUP_CACHE_SIZE;
            for (let i = 0; i < excess; i++) {
              this._processedMsgIds.delete(entries[i][0]);
            }
          }
        }
      }

      const m = msg.message;
      let text = m?.conversation || m?.extendedTextMessage?.text || '';
      let messageType: MessageType = 'text';
      let mediaMetadata: MediaMetadata | undefined;

      // Detect message type and extract media metadata (US-448)
      if (m?.imageMessage) {
        messageType = 'image';
        text = m.imageMessage.caption || '';
        mediaMetadata = {
          mimeType: m.imageMessage.mimetype || 'image/jpeg',
          fileSize: m.imageMessage.fileLength ? Number(m.imageMessage.fileLength) : undefined,
        };
      } else if (m?.audioMessage) {
        messageType = 'audio';
        mediaMetadata = {
          mimeType: m.audioMessage.mimetype || 'audio/ogg',
          fileSize: m.audioMessage.fileLength ? Number(m.audioMessage.fileLength) : undefined,
        };
      } else if (m?.videoMessage) {
        messageType = 'video';
        text = m.videoMessage.caption || '';
        mediaMetadata = {
          mimeType: m.videoMessage.mimetype || 'video/mp4',
          fileSize: m.videoMessage.fileLength ? Number(m.videoMessage.fileLength) : undefined,
        };
      } else if (m?.stickerMessage) {
        messageType = 'sticker';
      } else if (m?.documentMessage) {
        messageType = 'document';
        text = m.documentMessage.caption || '';
        mediaMetadata = {
          mimeType: m.documentMessage.mimetype || 'application/octet-stream',
          fileSize: m.documentMessage.fileLength ? Number(m.documentMessage.fileLength) : undefined,
          fileName: m.documentMessage.fileName || undefined,
        };
      } else if (m?.contactMessage || m?.contactsArrayMessage) {
        messageType = 'contact';
      } else if (m?.locationMessage || m?.liveLocationMessage) {
        messageType = 'location';
        const loc = m.locationMessage || m.liveLocationMessage;
        const lat = loc?.degreesLatitude;
        const lng = loc?.degreesLongitude;
        if (lat != null && lng != null) {
          text = `[Location: ${lat}, ${lng}] https://maps.google.com/maps?q=${lat},${lng}`;
        }
      }

      if (!text && messageType === 'text') return;

      const remoteJid = msg.key.remoteJid || '';
      const isGroup = remoteJid.endsWith('@g.us');

      // Resolve @lid JIDs to @s.whatsapp.net for reliable reply delivery
      const from = this.lidMapper.resolve(remoteJid, this.authDir);
      if (from !== remoteJid) {
        console.log(`[Baileys:${this.id}] Resolved LID: ${remoteJid} → ${from}`);
      } else if (isLidUser(remoteJid)) {
        console.warn(`[Baileys:${this.id}] Unresolved LID: ${remoteJid} (no phone mapping yet)`);
      }

      // US-477: Extract BSUID (Business-Scoped User ID) if present.
      // Baileys surfaces this as the `lid` field on messages. Format: CC.BSUID
      // where CC is a two-letter country code and BSUID is alphanumeric (up to 128 chars).
      const bsuid = extractBsuid(msg, from);

      // US-448: Pass rawMessage for all media types (not just audio) so pipeline can download
      const isMediaType = ['image', 'audio', 'video', 'document'].includes(messageType);

      const incoming: IncomingMessage = {
        from,
        text,
        pushName: msg.pushName || 'Unknown',
        messageId: msg.key.id || '',
        isGroup,
        timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Math.floor(Date.now() / 1000),
        messageType,
        instanceId: this.id,
        rawMessage: isMediaType ? msg : undefined,
        ...(mediaMetadata ? { mediaMetadata } : {}),
        ...(bsuid ? { bsuid } : {}),
      };

      if (!isGroup) ensureAvatar(from).catch(() => {}); // fire-and-forget

      if (this.messageHandler) {
        await this.messageHandler(incoming);
      }
    } catch (err: any) {
      console.error(`[Baileys:${this.id}] Error processing incoming message:`, err.message);
    }
  }

  /** US-443: Force reconnect — clears timeout, resets attempt counter, re-starts the instance. */
  async forceReconnect(notifyUnlinkedFn: (id: string, label: string) => Promise<void>): Promise<void> {
    // Clear any pending reconnect timeout to avoid double-start races
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // US-830: Reset circuit breaker on manual force reconnect
    if (this.cooldownTimeout) {
      clearTimeout(this.cooldownTimeout);
      this.cooldownTimeout = null;
    }
    this.circuitBreaker.state = 'closed';
    this.circuitBreaker.consecutiveFailures = 0;
    this.reconnectAttempts = 0;

    // Stop existing socket cleanly before restarting
    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.ev.removeAllListeners('messages.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.end(undefined);
      this.sock = null;
    }
    this.state = 'close';
    this.qr = null;

    await this.start(notifyUnlinkedFn);
  }

  async stop(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    // US-830: Clear cooldown timer on stop
    if (this.cooldownTimeout) {
      clearTimeout(this.cooldownTimeout);
      this.cooldownTimeout = null;
    }
    this.reconnectAttempts = 0;

    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.ev.removeAllListeners('messages.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.end(undefined);
      this.sock = null;
    }

    this.state = 'close';
    this.qr = null;
  }

  async logout(): Promise<void> {
    if (!this.sock) throw new Error(`Instance "${this.id}" socket not initialized`);
    await this.sock.logout();
    this.state = 'close';
    this.qr = null;
    console.log(`[Baileys:${this.id}] Logged out — session cleared`);
  }

  async sendTypingIndicator(jid: string): Promise<void> {
    if (!this.sock || this.state !== 'open') return;

    const resolvedJid = this.lidMapper.resolve(jid, this.authDir);

    try {
      await this.sock.sendPresenceUpdate('composing', resolvedJid);
    } catch (err: any) {
      // Non-fatal — typing indicator is best-effort
      console.warn(`[Baileys:${this.id}] Typing indicator failed for ${resolvedJid}: ${err.message}`);
    }
  }

  async sendPausedIndicator(jid: string): Promise<void> {
    if (!this.sock || this.state !== 'open') return;

    const resolvedJid = this.lidMapper.resolve(jid, this.authDir);

    try {
      await this.sock.sendPresenceUpdate('paused', resolvedJid);
    } catch {
      // Non-fatal — best-effort clear
    }
  }

  async sendMessage(jid: string, text: string): Promise<any> {
    if (!this.sock || this.state !== 'open') {
      throw new Error(`Instance "${this.id}" not connected`);
    }

    // Resolve @lid JID to phone JID for reliable delivery
    const resolvedJid = this.lidMapper.resolve(jid, this.authDir);
    if (resolvedJid !== jid) {
      console.log(`[Baileys:${this.id}] Send: resolved ${jid} → ${resolvedJid}`);
    }

    try {
      const result = await this.sock.sendMessage(resolvedJid, { text });
      console.log(`[Baileys:${this.id}] Sent to ${resolvedJid}: ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`);
      return result;
    } catch (err: any) {
      console.error(`[Baileys:${this.id}] SEND FAILED to ${resolvedJid}: ${err.message}`);

      // If we tried a @lid JID and it failed, the message won't be delivered
      if (isLidUser(resolvedJid)) {
        console.error(`[Baileys:${this.id}] Cannot deliver to @lid JID — no phone mapping available`);
      }
      throw err;
    }
  }

  async sendInteractiveMessage(jid: string, content: Record<string, any>): Promise<any> {
    if (!this.sock || this.state !== 'open') {
      throw new Error(`Instance "${this.id}" not connected`);
    }

    const resolvedJid = this.lidMapper.resolve(jid, this.authDir);
    if (resolvedJid !== jid) {
      console.log(`[Baileys:${this.id}] Send interactive: resolved ${jid} → ${resolvedJid}`);
    }

    try {
      const result = await this.sock.sendMessage(resolvedJid, content as AnyMessageContent);
      const type = 'listMessage' in content ? 'list' : 'buttonsMessage' in content ? 'buttons' : 'interactive';
      console.log(`[Baileys:${this.id}] Sent ${type} to ${resolvedJid}`);
      return result;
    } catch (err: any) {
      console.error(`[Baileys:${this.id}] SEND INTERACTIVE FAILED to ${resolvedJid}: ${err.message}`);
      throw err;
    }
  }

  async sendMedia(jid: string, buffer: Buffer, mimetype: string, fileName: string, caption?: string): Promise<any> {
    if (!this.sock || this.state !== 'open') {
      throw new Error(`Instance "${this.id}" not connected`);
    }

    const resolvedJid = this.lidMapper.resolve(jid, this.authDir);

    let content: any;
    if (mimetype.startsWith('image/')) {
      content = { image: buffer, caption: caption || undefined, mimetype };
    } else if (mimetype.startsWith('video/')) {
      content = { video: buffer, caption: caption || undefined, mimetype };
    } else {
      content = { document: buffer, fileName, mimetype };
    }

    try {
      const result = await this.sock.sendMessage(resolvedJid, content);
      const type = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document';
      console.log(`[Baileys:${this.id}] Sent ${type} to ${resolvedJid}: ${fileName}`);
      return result;
    } catch (err: any) {
      console.error(`[Baileys:${this.id}] SEND MEDIA FAILED to ${resolvedJid}: ${err.message}`);
      throw err;
    }
  }

  getStatus(): Omit<WhatsAppInstanceStatus, 'firstConnectedAt'> {
    const user = (this.sock as any)?.user;

    // US-830: Compute cooldown end timestamp for API consumers
    let cooldownEndsAt: string | null = null;
    if (this.circuitBreaker.state === 'open' && this.circuitBreaker.lastOpenedAt) {
      cooldownEndsAt = new Date(this.circuitBreaker.lastOpenedAt + this.circuitBreaker.cooldownMs).toISOString();
    }

    return {
      id: this.id,
      label: this.label,
      state: this.state,
      user: user ? { name: user.name, id: user.id, phone: user.id?.split(':')[0] } : null,
      authDir: this.authDir,
      qr: this.qr,
      unlinkedFromWhatsApp: this.unlinkedFromWhatsApp,
      lastUnlinkedAt: this.lastUnlinkedAt,
      lastConnectedAt: this.lastConnectedAt,
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: WhatsAppInstance.MAX_RECONNECT_ATTEMPTS,
      lastDisconnectCode: this.lastDisconnectCode,
      lastDisconnectAt: this.lastDisconnectAt,
      circuitBreaker: {
        state: this.circuitBreaker.state,
        consecutiveFailures: this.circuitBreaker.consecutiveFailures,
        lastOpenedAt: this.circuitBreaker.lastOpenedAt ? new Date(this.circuitBreaker.lastOpenedAt).toISOString() : null,
        cooldownEndsAt,
      },
    };
  }
}
