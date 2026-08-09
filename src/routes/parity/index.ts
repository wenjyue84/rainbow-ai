/**
 * parity/index.ts — Periskope-parity REST API routes.
 *
 * READ routes: query parity SQLite tables directly (no WhatsApp calls).
 * WRITE routes: call WhatsApp sock + reflect change in DB.
 *
 * Multi-account: use ?account=<instanceId> or X-Account header.
 * Default for writes: first connected instance.
 *
 * Webhook CRUD is at /api/bridge/webhooks (not /api/webhooks) to avoid
 * conflicting with existing Meta webhook handler routes.
 */
import { Router, type Request, type Response } from 'express';
import { whatsappManager } from '../../../src/lib/baileys-client.js';
import * as parityDb from '../../lib/parity-db.js';
import { emitParityEvent } from '../../lib/webhook-worker.js';

const router = Router();

// ── Account resolution ────────────────────────────────────────────────────

function resolveInstance(req: Request): any {
  const accountId = (req.query.account as string) || req.headers['x-account'] as string || undefined;
  return (whatsappManager as any).getInstance(accountId);
}

function requireInstance(req: Request, res: Response): any {
  const inst = resolveInstance(req);
  if (!inst || inst.state !== 'open') {
    res.status(503).json({ error: 'No WhatsApp instance connected. Check ?account= param.' });
    return null;
  }
  return inst;
}

// ── Helpers ───────────────────────────────────────────────────────────────

// Jitter delay before every WA write (ban guard)
const jitter = () => new Promise(r => setTimeout(r, 100 + Math.random() * 400));

// ══════════════════════════════════════════════════════════════════════════
// READ ROUTES
// ══════════════════════════════════════════════════════════════════════════

// GET /api/bridge/status
router.get('/bridge/status', (req, res) => {
  const statuses = (whatsappManager as any).getAllStatuses?.() ?? [];
  const accountId = (req.query.account as string) || undefined;
  const target = accountId ? statuses.find((s: any) => s.id === accountId) : statuses[0];
  if (!target) {
    res.json({ connected: false, instances: statuses.length });
    return;
  }
  res.json({ connected: target.state === 'open', state: target.state, user: target.user, id: target.id });
});

// GET /api/chats
router.get('/chats', (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    const sortBy = (req.query.sort_by as string) || 'last_message_at';
    const sortOrder = (req.query.sort_order as string) || 'desc';
    const unreadOnly = req.query.unread === '1';
    res.json(parityDb.listChats({ offset, limit, sortBy, sortOrder, unreadOnly }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chats/search
router.get('/chats/search', (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q) { res.json([]); return; }
  try {
    res.json(parityDb.searchChats(q));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chats/:jid
router.get('/chats/:jid', (req, res) => {
  try {
    const chat = parityDb.getChat(decodeURIComponent(req.params.jid));
    if (!chat) { res.status(404).json({ error: 'Chat not found' }); return; }
    res.json(chat);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chats/:jid/messages
router.get('/chats/:jid/messages', (req, res) => {
  try {
    const jid = decodeURIComponent(req.params.jid);
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    const startTime = req.query.start_time ? parseInt(req.query.start_time as string) : undefined;
    const endTime = req.query.end_time ? parseInt(req.query.end_time as string) : undefined;
    res.json(parityDb.listMessages(jid, { offset, limit, startTime, endTime }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/recent
router.get('/messages/recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    res.json(parityDb.getRecentMessages(limit));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/:id
router.get('/messages/:id', (req, res) => {
  try {
    const includeRaw = req.query.raw === '1';
    const msg = parityDb.getMessage(req.params.id, includeRaw);
    if (!msg) { res.status(404).json({ error: 'Message not found' }); return; }
    res.json(msg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/search
router.get('/search', (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q) { res.json([]); return; }
  try {
    const startTime = req.query.start_time ? parseInt(req.query.start_time as string) : undefined;
    const endTime = req.query.end_time ? parseInt(req.query.end_time as string) : undefined;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(parityDb.searchMessages(q, { startTime, endTime, limit }));
  } catch (err: any) {
    // FTS5 syntax errors should return 400 not 500
    res.status(400).json({ error: `Search error: ${err.message}` });
  }
});

// GET /api/contacts
router.get('/contacts', (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(parityDb.listContacts({ offset, limit }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/search
router.get('/contacts/search', (req, res) => {
  const q = (req.query.q as string) || '';
  if (!q) { res.json([]); return; }
  try {
    res.json(parityDb.searchContacts(q));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contacts/:jid
router.get('/contacts/:jid', (req, res) => {
  try {
    const contact = parityDb.getContact(decodeURIComponent(req.params.jid));
    if (!contact) { res.status(404).json({ error: 'Contact not found' }); return; }
    res.json(contact);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/labels
router.get('/labels', (_req, res) => {
  try {
    res.json(parityDb.listLabels());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets
router.get('/tickets', (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(parityDb.listTickets({ offset, limit }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tickets/:id
router.get('/tickets/:id', (req, res) => {
  try {
    const ticket = parityDb.getTicket(req.params.id);
    if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
    res.json(ticket);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bridge/webhooks
router.get('/bridge/webhooks', (req, res) => {
  try {
    const offset = parseInt(req.query.offset as string) || 0;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(parityDb.listWebhooks({ offset, limit }));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// WRITE ROUTES
// ══════════════════════════════════════════════════════════════════════════

// POST /api/messages — send text
router.post('/messages', async (req, res) => {
  const { jid, text } = req.body || {};
  if (!jid || !text) { res.status(400).json({ error: 'jid and text required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    const result = await inst.sock.sendMessage(jid, { text });
    res.json({ ok: true, messageId: result?.key?.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/media — send media
router.post('/messages/media', async (req, res) => {
  const { jid, base64, mime, filename, caption } = req.body || {};
  if (!jid || !base64 || !mime) { res.status(400).json({ error: 'jid, base64, mime required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    const buf = Buffer.from(base64, 'base64');
    await inst.sendMedia(jid, buf, mime, filename || 'file', caption);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/:id/react
router.post('/messages/:id/react', async (req, res) => {
  const { jid, emoji } = req.body || {};
  const msgId = req.params.id;
  if (!jid || emoji == null) { res.status(400).json({ error: 'jid and emoji required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    await inst.sock.sendMessage(jid, {
      react: { text: emoji, key: { remoteJid: jid, id: msgId, fromMe: false } },
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/messages/:id — edit
router.patch('/messages/:id', async (req, res) => {
  const { jid, text } = req.body || {};
  const msgId = req.params.id;
  if (!jid || !text) { res.status(400).json({ error: 'jid and text required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    await inst.sock.sendMessage(jid, {
      edit: { remoteJid: jid, id: msgId, fromMe: true },
      text,
    } as any);
    parityDb.updateMessageEdited(msgId, text);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages/:id — revoke
router.delete('/messages/:id', async (req, res) => {
  const { jid, forEveryone } = req.body || {};
  const msgId = req.params.id;
  if (!jid) { res.status(400).json({ error: 'jid required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    await inst.sock.sendMessage(jid, {
      delete: { remoteJid: jid, id: msgId, fromMe: true },
    } as any);
    if (forEveryone !== false) parityDb.markMessageDeleted(msgId);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/:id/forward
router.post('/messages/:id/forward', async (req, res) => {
  const { fromJid, toJid } = req.body || {};
  const msgId = req.params.id;
  if (!fromJid || !toJid) { res.status(400).json({ error: 'fromJid and toJid required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    // Fetch the original message from parity DB to get raw_json
    const origRaw = (parityDb as any).getMessage(msgId, true)?.raw_json;
    if (!origRaw) { res.status(404).json({ error: 'Original message not in parity DB' }); return; }
    const origMsg = JSON.parse(origRaw);
    await inst.sock.sendMessage(toJid, { forward: origMsg, force: true } as any);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chats/:jid/read
router.post('/chats/:jid/read', async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { messageIds } = req.body || {};
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    const keys = (messageIds || []).map((id: string) => ({ remoteJid: jid, id, fromMe: false }));
    await inst.sock.readMessages(keys);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/chats/:jid — update CRM fields
router.patch('/chats/:jid', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { assigned_to, custom_properties, mute_until } = req.body || {};
  try {
    parityDb.patchChat(jid, { assigned_to, custom_properties, mute_until });
    emitParityEvent('chat.custom-properties.updated', { jid, assigned_to, custom_properties, mute_until });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/chats/:jid/labels
router.put('/chats/:jid/labels', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { label_ids } = req.body || {};
  if (!Array.isArray(label_ids)) { res.status(400).json({ error: 'label_ids array required' }); return; }
  try {
    parityDb.setChatLabels(jid, label_ids);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/contacts/:jid
router.patch('/contacts/:jid', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { name } = req.body || {};
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  try {
    parityDb.renameContact(jid, name);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contacts/:jid/labels
router.put('/contacts/:jid/labels', (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { label_ids } = req.body || {};
  if (!Array.isArray(label_ids)) { res.status(400).json({ error: 'label_ids array required' }); return; }
  try {
    parityDb.setContactLabels(jid, label_ids);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/labels
router.post('/labels', (req, res) => {
  const { name, color } = req.body || {};
  if (!name) { res.status(400).json({ error: 'name required' }); return; }
  try {
    const label = parityDb.createLabel(name, color);
    res.status(201).json(label);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/labels/:id
router.delete('/labels/:id', (req, res) => {
  try {
    parityDb.deleteLabel(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tickets
router.post('/tickets', (req, res) => {
  const { chat_jid, title, status, priority, assigned_to } = req.body || {};
  if (!chat_jid || !title) { res.status(400).json({ error: 'chat_jid and title required' }); return; }
  try {
    const ticket = parityDb.createTicket(chat_jid, title, { status, priority, assigned_to });
    emitParityEvent('ticket.created', { id: ticket.id, chat_jid, title, status, priority, assigned_to });
    res.status(201).json(ticket);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/tickets/:id
router.patch('/tickets/:id', (req, res) => {
  const { status, priority, assigned_to, title } = req.body || {};
  try {
    parityDb.patchTicket(req.params.id, { status, priority, assigned_to, title });
    emitParityEvent('ticket.updated', { id: req.params.id, status, priority, assigned_to, title });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tickets/:id
router.delete('/tickets/:id', (req, res) => {
  try {
    parityDb.deleteTicket(req.params.id);
    emitParityEvent('ticket.deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups
router.post('/groups', async (req, res) => {
  const { subject, participants } = req.body || {};
  if (!subject || !Array.isArray(participants)) { res.status(400).json({ error: 'subject and participants[] required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    const result = await inst.sock.groupCreate(subject, participants);
    res.status(201).json({ ok: true, jid: result?.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:jid/participants
router.post('/groups/:jid/participants', async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { action, participants } = req.body || {};
  if (!action || !Array.isArray(participants)) { res.status(400).json({ error: 'action and participants[] required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    await inst.sock.groupParticipantsUpdate(jid, participants, action);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/groups/:jid/settings
router.patch('/groups/:jid/settings', async (req, res) => {
  const jid = decodeURIComponent(req.params.jid);
  const { name, description, announce, restrict, ephemeral } = req.body || {};
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await jitter();
    if (name != null) await inst.sock.groupUpdateSubject(jid, name);
    if (description != null) await inst.sock.groupUpdateDescription(jid, description);
    if (announce != null) await inst.sock.groupSettingUpdate(jid, announce ? 'announcement' : 'not_announcement');
    if (restrict != null) await inst.sock.groupSettingUpdate(jid, restrict ? 'locked' : 'unlocked');
    if (ephemeral != null) await inst.sock.groupToggleEphemeral(jid, ephemeral ? 86400 : 0);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/presence
router.post('/presence', async (req, res) => {
  const { jid, type } = req.body || {};
  if (!jid || !type) { res.status(400).json({ error: 'jid and type required' }); return; }
  const inst = requireInstance(req, res);
  if (!inst) return;
  try {
    await inst.sock.sendPresenceUpdate(type, jid);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bridge/webhooks
router.post('/bridge/webhooks', (req, res) => {
  const { hookUrl, integrationName, name } = req.body || {};
  if (!hookUrl || !integrationName) { res.status(400).json({ error: 'hookUrl and integrationName required' }); return; }
  try {
    const wh = parityDb.createWebhook(hookUrl, integrationName, name);
    res.status(201).json(wh);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/bridge/webhooks/:id
router.patch('/bridge/webhooks/:id', (req, res) => {
  const { hook_url, integration_name, name, is_subscribed } = req.body || {};
  try {
    parityDb.patchWebhook(req.params.id, { hook_url, integration_name, name, is_subscribed });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bridge/webhooks/:id
router.delete('/bridge/webhooks/:id', (req, res) => {
  try {
    parityDb.deleteWebhook(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
