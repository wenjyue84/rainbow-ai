/**
 * Integration tests for US-926: BSUID in inbound webhooks and conversation routing.
 *
 * Verifies:
 * - Meta Cloud API webhook parser extracts BSUID (user_id) and phone (wa_id)
 * - BSUID-only messages are parsed correctly when phone is absent
 * - Dual-identifier payloads prefer phone as primary `from`
 * - Outbound BSUID resolver returns phone for normal numbers and null for unmapped BSUIDs
 * - Message types (text, image, interactive) are handled in Cloud API format
 */
import { describe, test, expect } from 'vitest';
import { parseCloudApiMessages } from '../../routes/webhooks/meta-messages.js';
import { resolveBsuidToPhone } from '../../lib/whatsapp/bsuid-resolver.js';

// ─── Helper: Build a Cloud API webhook payload ─────────────────────

function buildCloudApiPayload(options: {
  waId?: string;
  userId?: string;
  from: string;
  msgId?: string;
  msgType?: string;
  textBody?: string;
  pushName?: string;
  phoneNumberId?: string;
}) {
  const contact: Record<string, any> = {
    profile: { name: options.pushName ?? 'Test User' },
  };
  if (options.waId) contact.wa_id = options.waId;
  if (options.userId) contact.user_id = options.userId;

  const message: Record<string, any> = {
    from: options.from,
    id: options.msgId ?? 'wamid.test123',
    timestamp: '1719849600',
    type: options.msgType ?? 'text',
  };
  if (options.msgType === 'text' || !options.msgType) {
    message.text = { body: options.textBody ?? 'Hello' };
  }

  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_123',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '60123456789',
            phone_number_id: options.phoneNumberId ?? 'PHONE_ID_1',
          },
          contacts: [contact],
          messages: [message],
        },
      }],
    }],
  };
}

// ─── Cloud API webhook parser tests ─────────────────────────────────

describe('parseCloudApiMessages — US-926 BSUID webhook parsing', () => {
  test('parses standard phone-only payload (pre-BSUID)', () => {
    const payload = buildCloudApiPayload({
      waId: '60123456789',
      from: '60123456789',
      textBody: 'Hi there',
    });

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe('60123456789');
    expect(msgs[0].bsuid).toBeUndefined();
    expect(msgs[0].text).toBe('Hi there');
    expect(msgs[0].messageType).toBe('text');
    expect(msgs[0].pushName).toBe('Test User');
    expect(msgs[0].instanceId).toBe('cloud:PHONE_ID_1');
  });

  test('parses dual-identifier payload (phone + BSUID) — phone takes priority', () => {
    const payload = buildCloudApiPayload({
      waId: '60123456789',
      userId: 'MY.user42abc',
      from: '60123456789',
      textBody: 'Dual mode',
    });

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe('60123456789');
    expect(msgs[0].bsuid).toBe('MY.user42abc');
  });

  test('parses BSUID-only payload (phone hidden) — BSUID becomes from', () => {
    const payload = buildCloudApiPayload({
      userId: 'MY.user42abc',
      from: 'MY.user42abc',
      textBody: 'Username only',
    });

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].from).toBe('MY.user42abc');
    expect(msgs[0].bsuid).toBe('MY.user42abc');
    expect(msgs[0].text).toBe('Username only');
  });

  test('links BSUID to existing phone conversation when both present', () => {
    const payload = buildCloudApiPayload({
      waId: '60199887766',
      userId: 'MY.returning123',
      from: '60199887766',
      textBody: 'I am back',
    });

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    // Phone is primary key
    expect(msgs[0].from).toBe('60199887766');
    // BSUID is attached for DB linking
    expect(msgs[0].bsuid).toBe('MY.returning123');
  });

  test('handles image message type in Cloud API format', () => {
    const payload = buildCloudApiPayload({
      waId: '60123456789',
      from: '60123456789',
      msgType: 'image',
    });
    // Add image field
    (payload.entry[0].changes[0].value!.messages![0] as any).image = {
      caption: 'Check this out',
      mime_type: 'image/png',
    };

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageType).toBe('image');
    expect(msgs[0].text).toBe('Check this out');
    expect(msgs[0].mediaMetadata?.mimeType).toBe('image/png');
  });

  test('handles interactive button_reply in Cloud API format', () => {
    const payload = buildCloudApiPayload({
      waId: '60123456789',
      from: '60123456789',
      msgType: 'interactive',
    });
    (payload.entry[0].changes[0].value!.messages![0] as any).interactive = {
      type: 'button_reply',
      button_reply: { id: 'add_to_cart:NASI001', title: 'Add to cart' },
    };

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageType).toBe('text');
    expect(msgs[0].text).toBe('Add to cart');
  });

  test('skips non-whatsapp_business_account objects', () => {
    const payload = { object: 'page', entry: [] };
    expect(parseCloudApiMessages(payload)).toHaveLength(0);
  });

  test('skips entries with no messages field', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          field: 'account_update',
          value: { event: 'SOME_EVENT' },
        }],
      }],
    };
    expect(parseCloudApiMessages(payload)).toHaveLength(0);
  });

  test('handles empty/null body gracefully', () => {
    expect(parseCloudApiMessages(null)).toHaveLength(0);
    expect(parseCloudApiMessages(undefined)).toHaveLength(0);
    expect(parseCloudApiMessages({})).toHaveLength(0);
  });

  test('parses multiple messages in a single webhook delivery', () => {
    const contact = {
      profile: { name: 'Multi User' },
      wa_id: '60111222333',
      user_id: 'MY.multi1',
    };
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA_456',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '60123456789', phone_number_id: 'PID_2' },
            contacts: [contact],
            messages: [
              { from: '60111222333', id: 'msg1', timestamp: '1719849600', type: 'text', text: { body: 'First' } },
              { from: '60111222333', id: 'msg2', timestamp: '1719849601', type: 'text', text: { body: 'Second' } },
            ],
          },
        }],
      }],
    };

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toBe('First');
    expect(msgs[1].text).toBe('Second');
    expect(msgs[0].bsuid).toBe('MY.multi1');
  });

  test('BSUID-only with location message', () => {
    const payload = buildCloudApiPayload({
      userId: 'SG.loc456',
      from: 'SG.loc456',
      msgType: 'location',
    });
    (payload.entry[0].changes[0].value!.messages![0] as any).location = {
      latitude: 1.3521,
      longitude: 103.8198,
    };

    const msgs = parseCloudApiMessages(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageType).toBe('location');
    expect(msgs[0].text).toContain('1.3521');
    expect(msgs[0].bsuid).toBe('SG.loc456');
  });
});

// ─── BSUID outbound resolver tests ──────────────────────────────────

describe('resolveBsuidToPhone — US-926 outbound routing', () => {
  test('passes through normal phone numbers unchanged', async () => {
    expect(await resolveBsuidToPhone('60123456789')).toBe('60123456789');
  });

  test('passes through full JIDs unchanged', async () => {
    expect(await resolveBsuidToPhone('60123456789@s.whatsapp.net')).toBe('60123456789@s.whatsapp.net');
  });

  test('returns null for unmapped BSUID (no DB)', async () => {
    // In test environment, DB is not available so lookupPhoneByBsuid will fail/return null
    const result = await resolveBsuidToPhone('bsuid:MY.unknownUser');
    expect(result).toBeNull();
  });

  test('passes through webchat session IDs unchanged', async () => {
    expect(await resolveBsuidToPhone('webchat-abc-123')).toBe('webchat-abc-123');
  });

  test('returns null for empty BSUID prefix', async () => {
    expect(await resolveBsuidToPhone('bsuid:')).toBeNull();
  });
});
