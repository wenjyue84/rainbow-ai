import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { listConversations, searchConversations, getConversation, deleteConversation, getResponseTimeStats, togglePin, toggleFavourite, markConversationAsRead, updateConversationMode } from '../../assistant/conversation-logger.js';
import type { ConversationLog, LoggedMessage } from '../../assistant/conversation-logger.js';
import { whatsappManager } from '../../lib/baileys-client.js';
import { pool } from '../../lib/db.js';
import { sessionWindowActive, logSessionExpired } from '../../lib/session-window.js';
import { ok, badRequest, notFound, serverError } from './http-utils.js';
import contactsRouter from './conversations-contacts.js';
import sseRouter from './conversations-sse.js';

// ─── Message Metadata Store (pin/star per message) ────────────────────
interface MessageMetadata {
  pinned: Record<string, string[]>;   // phone -> array of message indices (as strings)
  starred: Record<string, string[]>;  // phone -> array of message indices (as strings)
}

const METADATA_PATH = path.join(process.cwd(), 'data', 'message-metadata.json');

function loadMetadata(): MessageMetadata {
  try {
    if (fs.existsSync(METADATA_PATH)) {
      return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'));
    }
  } catch (err) {
    console.warn('[Metadata] Failed to load message-metadata.json, using empty:', (err as Error).message);
  }
  return { pinned: {}, starred: {} };
}

function saveMetadata(data: MessageMetadata): void {
  const dir = path.dirname(METADATA_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = METADATA_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpPath, METADATA_PATH);
}

let metadata: MessageMetadata = loadMetadata();

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// ─── Mount sub-routers (contacts, SSE/translate) ─────────────────────
router.use(contactsRouter);
router.use(sseRouter);

// Express 5: async errors auto-propagate to error-handling middleware

// ─── Response time aggregate (must be before /:phone to avoid matching "stats") ───
router.get('/conversations/stats/response-time', async (_req: Request, res: Response) => {
  const stats = await getResponseTimeStats();
  ok(res, { avgResponseTimeMs: stats.avgMs, count: stats.count });
});

// ─── Conversation History (Real Chat) ─────────────────────────────────

// US-818: Full-text search across message content (must be before /:phone)
router.get('/conversations/search', async (req: Request, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    ok(res, []);
    return;
  }
  const profileId = (req.query.profileId as string) || res.locals.profileId as string | undefined;
  const conversations = await searchConversations(q, profileId);
  res.json(conversations);
});

router.get('/conversations/unified', async (req: Request, res: Response) => {
  const profileId = res.locals.profileId as string | undefined;

  // 1. WhatsApp conversations
  const waConvos = await listConversations(profileId);

  // 2. Webchat conversations (phones matching 'webchat-%')
  let webchatConvos: any[] = [];
  try {
    const profileFilter = profileId ? `AND c.profile_id = '${profileId}'` : '';
    const result = await pool.query(`
      WITH ranked_msgs AS (
        SELECT phone, content, role, timestamp,
          ROW_NUMBER() OVER (PARTITION BY phone ORDER BY timestamp DESC) AS rn
        FROM rainbow_messages
      )
      SELECT
        c.phone, c.push_name, c.pinned, c.last_read_at, c.created_at, c.status,
        lm.content AS last_msg_content,
        lm.role    AS last_msg_role,
        lm.timestamp AS last_msg_at,
        COALESCE((SELECT COUNT(*) FROM rainbow_messages WHERE phone = c.phone), 0) AS message_count,
        COALESCE((SELECT COUNT(*) FROM rainbow_messages WHERE phone = c.phone AND role = 'user' AND (c.last_read_at IS NULL OR timestamp > c.last_read_at)), 0) AS unread_count
      FROM rainbow_conversations c
      JOIN ranked_msgs lm ON lm.phone = c.phone AND lm.rn = 1
      WHERE c.phone LIKE 'webchat-%'
        AND lm.content IS NOT NULL
        ${profileFilter}
      ORDER BY lm.timestamp DESC
    `);

    webchatConvos = result.rows.map((r: any) => ({
      phone: r.phone,
      pushName: r.push_name || 'Web Guest',
      lastMessage: (r.last_msg_content || '').slice(0, 100),
      lastMessageRole: r.last_msg_role as 'user' | 'assistant',
      lastMessageAt: r.last_msg_at instanceof Date
        ? r.last_msg_at.getTime()
        : new Date(r.last_msg_at).getTime(),
      messageCount: Number(r.message_count ?? 0),
      unreadCount: Number(r.unread_count ?? 0),
      pinned: r.pinned ?? false,
      favourite: false,
      createdAt: r.created_at instanceof Date
        ? r.created_at.getTime()
        : new Date(r.created_at).getTime(),
      sessionActive: true,
      channel: 'webchat',
    }));
  } catch (err) {
    console.warn('[Unified] Webchat query failed:', (err as Error).message);
  }

  // 3. Merge + sort by lastMessageAt DESC
  const merged = [...waConvos, ...webchatConvos]
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

  res.json(merged);
});

router.get('/conversations', async (req: Request, res: Response) => {
  const profileId = res.locals.profileId as string | undefined;
  const conversations = await listConversations(profileId);
  res.json(conversations);
});

// ─── Pin & Favourite ─────────────────────────────────────────────────

router.patch('/conversations/:phone/pin', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  const pinned = await togglePin(phone);
  ok(res, { pinned });
});

router.patch('/conversations/:phone/favourite', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  const favourite = await toggleFavourite(phone);
  ok(res, { favourite });
});

router.patch('/conversations/:phone/read', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  await markConversationAsRead(phone);
  ok(res);
});

// ─── Conversation Export (US-817) ─────────────────────────────────────

function maskPhone(phone: string): string {
  return phone.length > 4 ? phone.slice(0, -4) + 'xxxx' : 'xxxx';
}

function buildConversationHtml(log: ConversationLog, profileId?: string): string {
  const exportDate = new Date().toLocaleString();
  const maskedPhone = maskPhone(log.phone);

  const rows = log.messages.map((m: LoggedMessage) => {
    const isUser = m.role === 'user';
    const timeStr = new Date(m.timestamp).toLocaleString();
    const intentBadge = m.intent ? ` <span class="intent">[${m.intent}]</span>` : '';
    const sender = isUser
      ? log.pushName
      : (m.manual && m.staffName ? `Staff: ${m.staffName}` : 'AI Assistant');
    const bubbleClass = isUser ? 'bubble user-bubble' : 'bubble assistant-bubble';
    const rowClass = isUser ? 'msg-row user-row' : 'msg-row asst-row';
    const content = m.content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return `<div class="${rowClass}"><div class="${bubbleClass}"><div class="meta">${sender}${intentBadge}</div><div class="body">${content}</div><div class="ts">${timeStr}</div></div></div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Conversation Export — ${maskedPhone}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f4;padding:20px;color:#1a1a1a}
.wrap{max-width:780px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.hdr{background:#1e3a5f;color:#fff;padding:18px 22px}
.hdr h1{font-size:17px;margin-bottom:6px}
.hdr p{font-size:12px;opacity:.82;margin-top:2px}
.chat{padding:16px}
.msg-row{display:flex;margin-bottom:10px}
.user-row{justify-content:flex-end}
.asst-row{justify-content:flex-start}
.bubble{max-width:72%;padding:9px 13px;border-radius:12px;word-break:break-word}
.user-bubble{background:#dcf8c6;border-bottom-right-radius:3px}
.asst-bubble{background:#e8e8e8;border-bottom-left-radius:3px}
.meta{font-size:11px;font-weight:600;color:#555;margin-bottom:3px}
.body{font-size:13.5px;line-height:1.5;white-space:pre-wrap}
.ts{font-size:10px;color:#999;margin-top:4px;text-align:right}
.intent{color:#2563eb;font-weight:400}
.ftr{text-align:center;font-size:11px;color:#aaa;padding:12px;border-top:1px solid #eee}
@media print{body{background:#fff;padding:0}.wrap{box-shadow:none;border-radius:0}.hdr{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <h1>Rainbow AI — Conversation Export</h1>
    <p>Phone: ${maskedPhone} &nbsp;|&nbsp; Guest: ${log.pushName} &nbsp;|&nbsp; Profile: ${profileId || 'default'}</p>
    <p>Messages: ${log.messages.length} &nbsp;|&nbsp; Exported: ${exportDate}</p>
  </div>
  <div class="chat">
${rows}
  </div>
  <div class="ftr">Rainbow AI Conversation Export &mdash; ${exportDate}</div>
</div>
</body>
</html>`;
}

// Export endpoint must be placed BEFORE /:phone to avoid being swallowed by that route
router.get('/conversations/:phone/export', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const format = ((req.query.format as string) || 'json').toLowerCase();
    const profileId = res.locals.profileId as string | undefined;

    // US-908: Pass tenantId to enforce tenant isolation in export
    const tenantId = res.locals.tenantId as string | undefined;
    const log = await getConversation(phone, tenantId);
    if (!log) {
      notFound(res, 'Conversation');
      return;
    }

    const maskedPhone = maskPhone(phone);
    const dateStr = new Date().toISOString().slice(0, 10);
    const baseFilename = `conv_${maskedPhone}_${dateStr}`;

    if (format === 'json') {
      const exportData = {
        exportedAt: new Date().toISOString(),
        phone: log.phone,
        pushName: log.pushName,
        profileId: profileId || 'default',
        status: log.responseMode || 'active',
        createdAt: new Date(log.createdAt).toISOString(),
        updatedAt: new Date(log.updatedAt).toISOString(),
        // US-910: Include referral attribution if present
        leadSource: log.referral ? {
          ctwaClid: log.referral.ctwaClid ?? null,
          sourceId: log.referral.sourceId ?? null,
          sourceType: log.referral.sourceType ?? null,
          headline: log.referral.headline ?? null,
          body: log.referral.body ?? null,
        } : null,
        messages: log.messages.map((m: LoggedMessage) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp).toISOString(),
          intent: m.intent ?? null,
          confidence: m.confidence ?? null,
          action: m.action ?? null,
          manual: m.manual ?? false,
          staffName: m.staffName ?? null,
          model: m.model ?? null,
        })),
      };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.json"`);
      res.json(exportData);
    } else if (format === 'pdf') {
      // HTML with print CSS — admin can File > Print > Save as PDF
      const html = buildConversationHtml(log, profileId);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.html"`);
      res.send(html);
    } else {
      badRequest(res, 'format must be "json" or "pdf"');
    }
  } catch (err: any) {
    console.error('[Admin] Export failed:', err);
    serverError(res, err);
  }
});

router.get('/conversations/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  // US-908: Pass tenantId to enforce tenant isolation — prevents cross-property data leakage
  const tenantId = res.locals.tenantId as string | undefined;
  const log = await getConversation(phone, tenantId);
  if (!log) {
    notFound(res, 'Conversation');
    return;
  }
  res.json(log);
});

router.delete('/conversations/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  // US-908: Verify tenant ownership before deleting
  const tenantId = res.locals.tenantId as string | undefined;
  if (tenantId) {
    const log = await getConversation(phone, tenantId);
    if (!log) {
      notFound(res, 'Conversation');
      return;
    }
  }
  const deleted = await deleteConversation(phone);
  res.json({ ok: deleted });
});

router.post('/conversations/:phone/clear', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  const { clearConversationMessages } = await import('../../assistant/conversation-logger.js');
  await clearConversationMessages(phone);
  ok(res, { cleared: true });
});

// ─── Message-Level Pin & Star ─────────────────────────────────────────

// Get pinned/starred message indices for a conversation
router.get('/conversations/:phone/message-metadata', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  const pinned = metadata.pinned[phone] || [];
  const starred = metadata.starred[phone] || [];
  res.json({ pinned, starred });
});

// Toggle pin on a specific message
router.post('/conversations/:phone/messages/:msgIdx/pin', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const msgIdx = req.params.msgIdx as string;

    if (!metadata.pinned[phone]) metadata.pinned[phone] = [];
    const arr = metadata.pinned[phone];
    const idx = arr.indexOf(msgIdx);
    if (idx >= 0) {
      arr.splice(idx, 1);
      saveMetadata(metadata);
      ok(res, { pinned: false, msgIdx });
    } else {
      arr.push(msgIdx);
      saveMetadata(metadata);
      ok(res, { pinned: true, msgIdx });
    }
  } catch (err: any) {
    serverError(res, err);
  }
});

// Toggle star on a specific message
router.post('/conversations/:phone/messages/:msgIdx/star', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const msgIdx = req.params.msgIdx as string;

    if (!metadata.starred[phone]) metadata.starred[phone] = [];
    const arr = metadata.starred[phone];
    const idx = arr.indexOf(msgIdx);
    if (idx >= 0) {
      arr.splice(idx, 1);
      saveMetadata(metadata);
      ok(res, { starred: false, msgIdx });
    } else {
      arr.push(msgIdx);
      saveMetadata(metadata);
      ok(res, { starred: true, msgIdx });
    }
  } catch (err: any) {
    serverError(res, err);
  }
});

// Send a reaction to a message via WhatsApp
router.post('/conversations/:phone/messages/:msgIdx/react', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const { emoji, instanceId } = req.body;

    if (!emoji || typeof emoji !== 'string') {
      badRequest(res, 'emoji (string) required');
      return;
    }

    // Reactions are best-effort via WhatsApp — we log success regardless
    // In a full implementation, we'd look up the actual WhatsApp message key
    // For now, we acknowledge the reaction in the dashboard
    console.log(`[Admin] Reaction ${emoji} on message ${req.params.msgIdx} for ${phone}`);
    ok(res, { emoji, msgIdx: req.params.msgIdx });
  } catch (err: any) {
    serverError(res, err);
  }
});

// Send manual message to guest
router.post('/conversations/:phone/send', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const { message, instanceId, staffName } = req.body;

    if (!message || typeof message !== 'string') {
      badRequest(res, 'message (string) required');
      return;
    }

    const log = await getConversation(phone);
    const pushName = log?.pushName || 'Guest';

    let targetInstanceId = instanceId;
    if (instanceId) {
      const status = whatsappManager.getInstanceStatus(instanceId);
      if (!status || status.state !== 'open') {
        console.warn(`[Admin] Instance "${instanceId}" not connected, finding fallback...`);
        const instances = whatsappManager.getAllStatuses();
        const connectedInstance = instances.find(i => i.state === 'open');
        if (connectedInstance) {
          targetInstanceId = connectedInstance.id;
          console.log(`[Admin] Using fallback instance: ${targetInstanceId}`);
        } else {
          res.status(503).json({ error: 'No WhatsApp instances connected. Please check WhatsApp connection.' });
          return;
        }
      }
    }

    // US-815: Check 24-hour session window before sending
    // US-908: Pass tenantId to scope session window check to the correct property
    const tenantId = res.locals.tenantId as string | undefined;
    const sessionActive = await sessionWindowActive(phone, tenantId);
    if (!sessionActive) {
      logSessionExpired(phone, 'admin-manual-send', message);
      res.status(422).json({
        error: 'session_expired',
        message: 'Cannot send free-form message — no user message in the last 24 hours. Use a Message Template instead.',
        sessionActive: false,
      });
      return;
    }

    const { sendWhatsAppMessage } = await import('../../lib/baileys-client.js');
    await sendWhatsAppMessage(phone, message, targetInstanceId);

    const senderName = (typeof staffName === 'string' && staffName.trim()) ? staffName.trim() : 'Staff';
    const { logMessage } = await import('../../assistant/conversation-logger.js');
    await logMessage(phone, pushName, 'assistant', message, { manual: true, instanceId: targetInstanceId, staffName: senderName });

    // US-836: Mark SLA timer as resolved (human responded)
    const { markHumanResponded } = await import('../../lib/handoff-sla.js');
    markHumanResponded(phone).catch(() => {});

    console.log(`[Admin] Manual message sent by ${senderName} to ${phone} via ${targetInstanceId || 'default'}: ${message.substring(0, 50)}...`);
    ok(res, { message: 'Message sent successfully', usedInstance: targetInstanceId, staffName: senderName });
  } catch (err: any) {
    console.error('[Admin] Failed to send manual message:', err);
    serverError(res, err);
  }
});

// Send media (image/video/document) to guest
router.post('/conversations/:phone/send-media', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const file = req.file;
    const caption = req.body.caption || '';
    const instanceId = req.body.instanceId;

    if (!file) {
      badRequest(res, 'file required (multipart/form-data)');
      return;
    }

    const log = await getConversation(phone);
    const pushName = log?.pushName || 'Guest';

    // Find connected instance (same logic as send text)
    let targetInstanceId = instanceId;
    if (instanceId) {
      const status = whatsappManager.getInstanceStatus(instanceId);
      if (!status || status.state !== 'open') {
        const instances = whatsappManager.getAllStatuses();
        const connectedInstance = instances.find(i => i.state === 'open');
        if (connectedInstance) {
          targetInstanceId = connectedInstance.id;
        } else {
          res.status(503).json({ error: 'No WhatsApp instances connected.' });
          return;
        }
      }
    }

    const { sendWhatsAppMedia } = await import('../../lib/baileys-client.js');
    await sendWhatsAppMedia(phone, file.buffer, file.mimetype, file.originalname, caption || undefined, targetInstanceId);

    // Log a placeholder message so it shows in conversation history
    const mediaType = file.mimetype.startsWith('image/') ? 'photo' : file.mimetype.startsWith('video/') ? 'video' : 'document';
    const logText = caption
      ? `[${mediaType}: ${file.originalname}] ${caption}`
      : `[${mediaType}: ${file.originalname}]`;

    const { logMessage } = await import('../../assistant/conversation-logger.js');
    await logMessage(phone, pushName, 'assistant', logText, { manual: true, instanceId: targetInstanceId });

    console.log(`[Admin] Sent ${mediaType} to ${phone}: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`);
    ok(res, { mediaType, fileName: file.originalname, size: file.size });
  } catch (err: any) {
    // US-834: Return 422 for media validation errors
    if (err?.code === 'MEDIA_VALIDATION_FAILED') {
      res.status(422).json({ error: err.reason, ...err.toJSON() });
      return;
    }
    console.error('[Admin] Failed to send media:', err);
    serverError(res, err);
  }
});

// Trigger a workflow for a specific contact (US-016: // command palette)
router.post('/conversations/:phone/trigger-workflow', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const { workflowId, instanceId, staffName } = req.body;

    if (!workflowId || typeof workflowId !== 'string') {
      badRequest(res, 'workflowId (string) required');
      return;
    }

    // Load workflow definition (profile-aware)
    const { getStore } = await import('./http-utils.js');
    const workflows = getStore(res).getWorkflows();
    const workflow = workflows.workflows.find((w: any) => w.id === workflowId);
    if (!workflow) {
      notFound(res, `Workflow "${workflowId}"`);
      return;
    }

    // Create workflow state and execute first step
    const { createWorkflowState, executeWorkflowStep } = await import('../../assistant/workflow-executor.js');
    const { updateWorkflowState } = await import('../../assistant/conversation.js');

    const log = await getConversation(phone);
    const pushName = log?.pushName || 'Guest';

    // Resolve connected WhatsApp instance
    let targetInstanceId = instanceId;
    if (instanceId) {
      const status = whatsappManager.getInstanceStatus(instanceId);
      if (!status || status.state !== 'open') {
        const instances = whatsappManager.getAllStatuses();
        const connectedInstance = instances.find(i => i.state === 'open');
        if (connectedInstance) {
          targetInstanceId = connectedInstance.id;
        } else {
          res.status(503).json({ error: 'No WhatsApp instances connected.' });
          return;
        }
      }
    }

    const workflowState = createWorkflowState(workflowId);
    const result = await executeWorkflowStep(workflowState, null, {
      language: 'en',
      phone,
      pushName,
      instanceId: targetInstanceId,
    });

    // Send the first workflow message
    if (result.response) {
      const { sendWhatsAppMessage } = await import('../../lib/baileys-client.js');
      await sendWhatsAppMessage(phone, result.response, targetInstanceId);

      const senderName = (typeof staffName === 'string' && staffName.trim()) ? staffName.trim() : 'Staff';
      const { logMessage } = await import('../../assistant/conversation-logger.js');
      await logMessage(phone, pushName, 'assistant', result.response, {
        manual: false,
        instanceId: targetInstanceId,
        staffName: senderName,
        workflowId,
      });
    }

    // Store workflow state so subsequent replies continue the workflow
    if (result.newState) {
      updateWorkflowState(phone, result.newState);
    }

    const sn = (typeof staffName === 'string' && staffName.trim()) ? staffName.trim() : 'Staff';
    console.log(`[Admin] Workflow "${workflow.name}" triggered by ${sn} for ${phone}`);
    ok(res, {
      workflowId,
      workflowName: workflow.name,
      firstMessage: result.response,
      hasMoreSteps: !!result.newState,
    });
  } catch (err: any) {
    console.error('[Admin] Failed to trigger workflow:', err);
    serverError(res, err);
  }
});

// ─── RESPONSE MODES (Autopilot/Copilot/Manual) ─────────────────────────

// Get pending approvals for a conversation
router.get('/conversations/:phone/approvals', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  const { getApprovalsByPhone } = await import('../../assistant/approval-queue.js');
  const approvals = getApprovalsByPhone(phone);
  res.json({ approvals });
});

// Approve and send a queued response
router.post('/conversations/:phone/approvals/:id/approve', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const id = req.params.id as string;
    const { editedResponse } = req.body;

    const { approveAndSend, getApproval } = await import('../../assistant/approval-queue.js');
    const approval = getApproval(id);

    if (!approval) {
      notFound(res, 'Approval');
      return;
    }

    const finalResponse = editedResponse || approval.suggestedResponse;

    // Send to guest
    const { sendWhatsAppMessage } = await import('../../lib/baileys-client.js');
    const log = await getConversation(phone);
    const instanceId = log?.instanceId;
    await sendWhatsAppMessage(phone, finalResponse, instanceId);

    // Log as sent
    const { logMessage } = await import('../../assistant/conversation-logger.js');
    await logMessage(phone, approval.pushName, 'assistant', finalResponse, {
      manual: false,
      approved_from_queue: true,
      approval_id: id,
      was_edited: !!editedResponse,
      instanceId
    });

    // Remove from queue
    approveAndSend(id, editedResponse);

    console.log(`[Copilot] Approved and sent response for ${phone} (approval: ${id})`);
    ok(res, { sent: finalResponse });
  } catch (err: any) {
    console.error('[Copilot] Approval failed:', err);
    serverError(res, err);
  }
});

// Reject a queued response
router.post('/conversations/:phone/approvals/:id/reject', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { rejectApproval } = await import('../../assistant/approval-queue.js');

  if (!rejectApproval(id)) {
    notFound(res, 'Approval');
    return;
  }

  console.log(`[Copilot] Rejected approval: ${id}`);
  ok(res);
});

// US-090: Generate AI notes summary from conversation
router.post('/conversations/:phone/generate-notes', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const log = await getConversation(phone);
    if (!log || !log.messages || log.messages.length === 0) {
      badRequest(res, 'No messages to summarize');
      return;
    }

    // Take last 20 messages
    const recentMessages = log.messages.slice(-20);
    const transcript = recentMessages.map((m: any) => {
      const role = m.role === 'user' ? 'Guest' : 'AI';
      return `${role}: ${m.content}`;
    }).join('\n');

    const { chatWithFallback } = await import('../../assistant/ai-provider-manager.js');

    const messages = [
      {
        role: 'system' as const,
        content: 'You are a hotel staff assistant. Summarize the following guest conversation in 2-5 sentences. Focus on: guest preferences, specific requests, issues raised, overall mood, and any important details staff should know. Be concise and practical.'
      },
      {
        role: 'user' as const,
        content: `Summarize this conversation:\n\n${transcript}`
      }
    ];

    const { content } = await chatWithFallback(messages, 600, 0.5);

    if (!content) {
      serverError(res, 'AI generation failed');
      return;
    }

    console.log(`[Admin] Generated AI notes for ${phone}`);
    res.json({ notes: content.trim() });
  } catch (err: any) {
    console.error('[Admin] AI notes generation failed:', err);
    serverError(res, err);
  }
});

// Generate AI suggestion without sending (Manual mode)
router.post('/conversations/:phone/suggest', async (req: Request, res: Response) => {
  try {
    const phone = decodeURIComponent(req.params.phone as string);
    const { context } = req.body; // Optional: staff can provide context

    const log = await getConversation(phone);
    if (!log) {
      notFound(res, 'Conversation');
      return;
    }

    // Get conversation history
    const { getMessages, getOrCreate } = await import('../../assistant/conversation.js');
    const convo = getOrCreate(phone, log.pushName);
    const messages = getMessages(phone);

    // Get last user message
    const lastUserMsg = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMsg) {
      badRequest(res, 'No user message to respond to');
      return;
    }

    // Generate AI suggestion using existing KB + AI logic (profile-aware)
    const { guessTopicFiles, buildSystemPrompt } = await import('../../assistant/knowledge-base.js');
    const { chatWithFallback } = await import('../../assistant/ai-provider-manager.js');
    const { getStore } = await import('./http-utils.js');

    const store = getStore(res);
    const settings = store.getSettings();
    const topicFiles = guessTopicFiles(lastUserMsg.content);
    const systemPrompt = buildSystemPrompt(settings.system_prompt, topicFiles);

    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.slice(-5).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(context ? [{ role: 'system' as const, content: `Staff context: ${context}` }] : []),
    ];

    const result = await chatWithFallback(chatMessages, 600, 0.7);

    console.log(`[Manual Mode] Generated AI suggestion for ${phone}`);
    res.json({
      suggestion: result.content,
      metadata: {
        provider: result.provider?.name ?? null,
        model: result.provider?.model ?? null,
        kbFiles: topicFiles
      }
    });
  } catch (err: any) {
    console.error('[Manual Mode] Suggestion failed:', err);
    serverError(res, err);
  }
});

// Set response mode for a conversation (US-410: also accepts PATCH)
const handleSetMode = async (req: Request, res: Response) => {
  const phone = decodeURIComponent(req.params.phone as string);
  const { mode, setAsGlobalDefault } = req.body;

  if (!['autopilot', 'copilot', 'manual'].includes(mode)) {
    badRequest(res, 'Invalid mode. Must be: autopilot, copilot, or manual');
    return;
  }

  // If setting as global default, update settings.json (profile-aware)
  if (setAsGlobalDefault) {
    const { getStore } = await import('./http-utils.js');
    const configStore = getStore(res);
    const settings = configStore.getSettings();

    // Ensure settings object exists
    if (!settings) {
      serverError(res, 'Settings not loaded');
      return;
    }

    // Initialize response_modes if it doesn't exist
    const modes = (settings as any).response_modes;
    if (!modes) {
      (settings as any).response_modes = {
        default_mode: mode,
        description: 'Global default response mode: autopilot (AI auto-sends), copilot (AI suggests, staff approves), or manual (staff writes, AI helps on request)',
        copilot: {
          auto_approve_confidence: 0.95,
          auto_approve_intents: ['greeting', 'thanks', 'wifi'],
          queue_timeout_minutes: 30,
          description: 'Auto-approve high-confidence responses for simple intents'
        },
        manual: {
          show_ai_suggestions: true,
          ai_help_provider: 'groq-llama',
          description: "Show AI suggestions when 'Help me' clicked"
        }
      };
    } else {
      modes.default_mode = mode;
    }

    configStore.setSettings(settings);
    console.log(`[Mode Change] Set global default to ${mode} mode`);
  }

  // Always update per-conversation mode (in-memory + disk)
  const { getOrCreate, updateSlots } = await import('../../assistant/conversation.js');
  const log = await getConversation(phone);
  const convo = getOrCreate(phone, log?.pushName || 'Guest');

  updateSlots(phone, { responseMode: mode });
  // Persist to disk so mode survives navigation and restarts
  await updateConversationMode(phone, mode);

  // US-410: If resolving from manual to autopilot, mark handoff as resolved
  if (mode === 'autopilot') {
    const { resolveHandoff } = await import('../../assistant/escalation.js');
    await resolveHandoff(phone);
  }

  console.log(`[Mode Change] Set ${phone} to ${mode} mode${setAsGlobalDefault ? ' (and global default)' : ''}`);
  ok(res, { mode, globalDefaultUpdated: !!setAsGlobalDefault });
};
router.post('/conversations/:phone/mode', handleSetMode);
router.patch('/conversations/:phone/mode', handleSetMode); // US-410: PATCH alias

export default router;
