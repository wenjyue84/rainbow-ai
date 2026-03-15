/**
 * meta-messages.ts — Parse Meta Cloud API webhook payloads into IncomingMessage objects (US-926).
 *
 * Extracts user_id (BSUID) and wa_id (phone) from Cloud API webhook payloads,
 * supporting the June 2026 BSUID rollout where phone numbers become optional.
 *
 * Cloud API payload shape:
 *   entry[].changes[].field = 'messages'
 *   entry[].changes[].value.contacts[].wa_id   = phone (may be absent)
 *   entry[].changes[].value.contacts[].user_id = BSUID (new)
 *   entry[].changes[].value.messages[].from     = phone or BSUID
 *   entry[].changes[].value.messages[].type      = 'text' | 'image' | 'audio' | ...
 */

import type { IncomingMessage, MessageType } from '../../assistant/types.js';
import { isBsuid } from '../../lib/whatsapp/instance.js';

// ─── Cloud API payload types ────────────────────────────────────────

interface CloudApiContact {
  profile?: { name?: string };
  wa_id?: string;
  user_id?: string;
}

interface CloudApiMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: { caption?: string; mime_type?: string };
  audio?: { mime_type?: string };
  video?: { caption?: string; mime_type?: string };
  document?: { caption?: string; filename?: string; mime_type?: string };
  location?: { latitude: number; longitude: number };
  button?: { text: string; payload: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

interface CloudApiValue {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: CloudApiContact[];
  messages?: CloudApiMessage[];
}

interface CloudApiChange {
  field?: string;
  value?: CloudApiValue;
}

interface CloudApiEntry {
  id?: string;
  changes?: CloudApiChange[];
}

interface CloudApiWebhookBody {
  object?: string;
  entry?: CloudApiEntry[];
}

// ─── Parser ─────────────────────────────────────────────────────────

/**
 * Parse a Meta Cloud API webhook body into IncomingMessage objects.
 * Handles the BSUID rollout: extracts user_id (BSUID) when present,
 * falls back to wa_id (phone) as the primary `from` field.
 */
export function parseCloudApiMessages(body: unknown): IncomingMessage[] {
  const payload = body as CloudApiWebhookBody;
  if (payload?.object !== 'whatsapp_business_account') return [];

  const results: IncomingMessage[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;

      const value = change.value;
      if (!value?.messages?.length) continue;

      // Build contact lookup: index by `from` field for name/BSUID resolution
      const contactMap = new Map<string, CloudApiContact>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id) contactMap.set(contact.wa_id, contact);
        if (contact.user_id) contactMap.set(contact.user_id, contact);
      }

      for (const msg of value.messages) {
        const parsed = parseOneMessage(msg, contactMap, value.metadata?.phone_number_id);
        if (parsed) results.push(parsed);
      }
    }
  }

  return results;
}

function parseOneMessage(
  msg: CloudApiMessage,
  contactMap: Map<string, CloudApiContact>,
  phoneNumberId?: string
): IncomingMessage | null {
  // Resolve contact for this message
  const contact = contactMap.get(msg.from) ?? {};
  const pushName = contact.profile?.name ?? 'Unknown';

  // US-926: Determine from (phone) and bsuid
  // - wa_id is the phone number, user_id is the BSUID
  // - msg.from may be either phone or BSUID depending on rollout state
  const waId = contact.wa_id;
  const userId = contact.user_id;

  // Primary identifier: prefer phone if available, else use BSUID
  let from: string;
  let bsuid: string | undefined;

  if (waId && waId.replace(/\D/g, '').length >= 7) {
    // Phone is available — use it as primary
    from = waId.replace(/\D/g, '');
    bsuid = userId && isBsuid(userId) ? userId : undefined;
  } else if (userId && isBsuid(userId)) {
    // BSUID-only (phone hidden) — use BSUID as from
    from = userId;
    bsuid = userId;
  } else {
    // Fallback to msg.from
    from = msg.from;
    if (isBsuid(msg.from)) bsuid = msg.from;
  }

  // Parse message type and text
  const { text, messageType, mediaMetadata } = extractContent(msg);

  // Skip empty text messages
  if (!text && messageType === 'text') return null;

  return {
    from,
    text,
    pushName,
    messageId: msg.id,
    isGroup: false, // Cloud API webhook messages are 1:1
    timestamp: parseInt(msg.timestamp, 10) || Math.floor(Date.now() / 1000),
    messageType,
    instanceId: phoneNumberId ? `cloud:${phoneNumberId}` : 'cloud-api',
    ...(bsuid ? { bsuid } : {}),
    ...(mediaMetadata ? { mediaMetadata } : {}),
  };
}

function extractContent(msg: CloudApiMessage): {
  text: string;
  messageType: MessageType;
  mediaMetadata?: { mimeType: string; fileName?: string };
} {
  switch (msg.type) {
    case 'text':
      return { text: msg.text?.body ?? '', messageType: 'text' };

    case 'image':
      return {
        text: msg.image?.caption ?? '',
        messageType: 'image',
        mediaMetadata: { mimeType: msg.image?.mime_type ?? 'image/jpeg' },
      };

    case 'audio':
      return {
        text: '',
        messageType: 'audio',
        mediaMetadata: { mimeType: msg.audio?.mime_type ?? 'audio/ogg' },
      };

    case 'video':
      return {
        text: msg.video?.caption ?? '',
        messageType: 'video',
        mediaMetadata: { mimeType: msg.video?.mime_type ?? 'video/mp4' },
      };

    case 'document':
      return {
        text: msg.document?.caption ?? '',
        messageType: 'document',
        mediaMetadata: {
          mimeType: msg.document?.mime_type ?? 'application/octet-stream',
          fileName: msg.document?.filename,
        },
      };

    case 'location':
      if (msg.location) {
        const { latitude, longitude } = msg.location;
        return {
          text: `[Location: ${latitude}, ${longitude}] https://maps.google.com/maps?q=${latitude},${longitude}`,
          messageType: 'location',
        };
      }
      return { text: '', messageType: 'location' };

    case 'button':
      return { text: msg.button?.text ?? msg.button?.payload ?? '', messageType: 'text' };

    case 'interactive': {
      const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      return { text: reply?.title ?? reply?.id ?? '', messageType: 'text' };
    }

    case 'sticker':
      return { text: '', messageType: 'sticker' };

    case 'contacts':
      return { text: '', messageType: 'contact' };

    default:
      return { text: '', messageType: 'text' };
  }
}
