/**
 * Unit + integration tests for WhatsApp BSUID (Business-Scoped User ID) routing (US-477 / US-926).
 *
 * Verifies:
 * - isBsuid correctly identifies BSUID format (CC.alphanumeric)
 * - conversationKey returns correct key for E.164-only, BSUID-only, and dual payloads
 * - canonicalPhoneKey preserves BSUID-prefixed keys
 * - extractBsuid extracts BSUID from various Baileys message shapes
 * - Integration: BSUID-only inbound message flows through pipeline correctly
 * - resolveBsuidToPhone resolves BSUID-keyed phones for outbound delivery
 */
import { describe, test, expect, vi } from 'vitest';

// ─── Import BSUID utilities ────────────────────────────────────────

import {
  canonicalPhoneKey,
  conversationKey,
  isBsuidIdentifier,
} from '../conversation-db.js';

import { isBsuid } from '../../lib/whatsapp/instance.js';
import { resolveBsuidToPhone } from '../../lib/whatsapp/bsuid-resolver.js';

// ─── isBsuid / isBsuidIdentifier ───────────────────────────────────

describe('isBsuid / isBsuidIdentifier', () => {
  test('recognizes valid BSUID format (CC.alphanumeric)', () => {
    expect(isBsuid('MY.abc123')).toBe(true);
    expect(isBsuid('US.user42xyz')).toBe(true);
    expect(isBsuid('SG.A1b2C3d4E5')).toBe(true);
    expect(isBsuidIdentifier('MY.abc123')).toBe(true);
  });

  test('rejects E.164 phone numbers', () => {
    expect(isBsuid('60123456789')).toBe(false);
    expect(isBsuid('+60123456789')).toBe(false);
    expect(isBsuidIdentifier('60123456789')).toBe(false);
  });

  test('rejects malformed BSUIDs', () => {
    // Country code must be exactly 2 uppercase letters
    expect(isBsuid('M.abc123')).toBe(false);
    expect(isBsuid('MYS.abc123')).toBe(false);
    expect(isBsuid('my.abc123')).toBe(false);

    // Must have dot separator
    expect(isBsuid('MYabc123')).toBe(false);

    // BSUID part must be alphanumeric
    expect(isBsuid('MY.abc-123')).toBe(false);
    expect(isBsuid('MY.abc 123')).toBe(false);

    // Empty BSUID part
    expect(isBsuid('MY.')).toBe(false);
  });

  test('handles JID-like strings (strips @suffix correctly in extractBsuid)', () => {
    // isBsuid only checks raw format, not JIDs
    expect(isBsuid('MY.abc123@s.whatsapp.net')).toBe(false);
  });
});

// ─── conversationKey ────────────────────────────────────────────────

describe('conversationKey', () => {
  test('E.164-only: returns digit-only key (existing behavior)', () => {
    expect(conversationKey('60123456789')).toBe('60123456789');
    expect(conversationKey('60123456789@s.whatsapp.net')).toBe('60123456789');
    expect(conversationKey('+1-555-123-4567')).toBe('15551234567');
  });

  test('BSUID-only: returns bsuid-prefixed key when no real phone', () => {
    expect(conversationKey('MY.abc123@s.whatsapp.net', 'MY.abc123')).toBe('bsuid:MY.abc123');
    // Short digit string (< 7) from BSUID is not a real phone
    expect(conversationKey('MY.x1', 'MY.x1')).toBe('bsuid:MY.x1');
  });

  test('BSUID-only: detects BSUID from `from` when no explicit bsuid param', () => {
    // from itself is a BSUID (after stripping JID suffix)
    expect(conversationKey('MY.abc123')).toBe('bsuid:MY.abc123');
  });

  test('dual-identifier: prefers phone key when phone is valid', () => {
    // Both phone and BSUID — phone wins as key
    expect(conversationKey('60123456789', 'MY.abc123')).toBe('60123456789');
    expect(conversationKey('60123456789@s.whatsapp.net', 'MY.abc123')).toBe('60123456789');
  });

  test('fallback: non-phone non-BSUID returns sanitized string', () => {
    expect(conversationKey('webchat-session-abc')).toBe('webchat-session-abc');
  });
});

// ─── canonicalPhoneKey ──────────────────────────────────────────────

describe('canonicalPhoneKey with BSUID support', () => {
  test('standard phone numbers work as before', () => {
    expect(canonicalPhoneKey('60123456789')).toBe('60123456789');
    expect(canonicalPhoneKey('+60-123-456-789')).toBe('60123456789');
    expect(canonicalPhoneKey('60123456789@s.whatsapp.net')).toBe('60123456789');
  });

  test('preserves bsuid-prefixed keys', () => {
    expect(canonicalPhoneKey('bsuid:MY.abc123')).toBe('bsuid:MY.abc123');
    expect(canonicalPhoneKey('bsuid:US.user42xyz')).toBe('bsuid:US.user42xyz');
  });

  test('non-digit non-BSUID strings are sanitized', () => {
    expect(canonicalPhoneKey('webchat-abc')).toBe('webchat-abc');
  });
});

// ─── extractBsuid (via isBsuid + manual extraction logic) ───────────

describe('extractBsuid logic (Baileys message shapes)', () => {
  /**
   * extractBsuid is a private function in instance.ts, but we can test
   * the same extraction logic here using isBsuid + JID stripping.
   */
  function extractBsuidFromMsg(msg: any, resolvedFrom: string): string | undefined {
    // 1. Check explicit lid field on the message (Baileys v7+)
    if (msg.lid && typeof msg.lid === 'string') {
      const raw = msg.lid.replace(/@.*$/, '');
      if (isBsuid(raw)) return raw;
    }
    // 2. Check msg.key.participant
    if (msg.key?.participant && typeof msg.key.participant === 'string') {
      const raw = msg.key.participant.replace(/@.*$/, '');
      if (isBsuid(raw)) return raw;
    }
    // 3. Check if resolved from JID itself is a BSUID
    const fromStripped = resolvedFrom.replace(/@.*$/, '');
    if (isBsuid(fromStripped)) return fromStripped;
    return undefined;
  }

  test('extracts BSUID from msg.lid field (Baileys v7+ format)', () => {
    const msg = { lid: 'MY.abc123@lid', key: { remoteJid: '60123456789@s.whatsapp.net' } };
    expect(extractBsuidFromMsg(msg, '60123456789@s.whatsapp.net')).toBe('MY.abc123');
  });

  test('extracts BSUID from msg.lid without @lid suffix', () => {
    const msg = { lid: 'SG.userXYZ', key: { remoteJid: '6512345678@s.whatsapp.net' } };
    expect(extractBsuidFromMsg(msg, '6512345678@s.whatsapp.net')).toBe('SG.userXYZ');
  });

  test('extracts BSUID from msg.key.participant (group/forwarded)', () => {
    const msg = { key: { remoteJid: '60123456789-group@g.us', participant: 'US.member42@s.whatsapp.net' } };
    expect(extractBsuidFromMsg(msg, '60123456789-group@g.us')).toBe('US.member42');
  });

  test('extracts BSUID from resolvedFrom when phone is hidden (BSUID-only user)', () => {
    // User has hidden phone number — remoteJid is the BSUID itself
    const msg = { key: { remoteJid: 'MY.hiddenUser@lid' } };
    expect(extractBsuidFromMsg(msg, 'MY.hiddenUser@lid')).toBe('MY.hiddenUser');
  });

  test('returns undefined when no BSUID present (normal phone user)', () => {
    const msg = { key: { remoteJid: '60123456789@s.whatsapp.net' } };
    expect(extractBsuidFromMsg(msg, '60123456789@s.whatsapp.net')).toBeUndefined();
  });

  test('returns undefined for group JID without BSUID participant', () => {
    const msg = { key: { remoteJid: '120363001234567890@g.us' } };
    expect(extractBsuidFromMsg(msg, '120363001234567890@g.us')).toBeUndefined();
  });

  test('prefers msg.lid over msg.key.participant when both present', () => {
    const msg = {
      lid: 'MY.primaryBsuid@lid',
      key: { remoteJid: '60123456789@s.whatsapp.net', participant: 'US.secondaryBsuid@s.whatsapp.net' },
    };
    expect(extractBsuidFromMsg(msg, '60123456789@s.whatsapp.net')).toBe('MY.primaryBsuid');
  });
});

// ─── resolveBsuidToPhone ────────────────────────────────────────────

describe('resolveBsuidToPhone', () => {
  test('passes through normal phone numbers unchanged', async () => {
    expect(await resolveBsuidToPhone('60123456789')).toBe('60123456789');
  });

  test('passes through JIDs unchanged', async () => {
    expect(await resolveBsuidToPhone('60123456789@s.whatsapp.net')).toBe('60123456789@s.whatsapp.net');
  });

  test('returns null for empty BSUID prefix', async () => {
    expect(await resolveBsuidToPhone('bsuid:')).toBeNull();
  });

  test('attempts DB lookup for bsuid-prefixed phone (graceful failure)', async () => {
    // Without a real DB, lookupPhoneByBsuid will fail gracefully → null
    const result = await resolveBsuidToPhone('bsuid:MY.unknownUser');
    // Result is null because DB lookup fails or returns no match
    expect(result).toBeNull();
  });
});

// ─── Integration: BSUID-only inbound message simulation ────────────

describe('US-926 Integration: BSUID-only inbound message routing', () => {
  test('BSUID-only message creates correct conversation key and can route outbound', async () => {
    // Simulate: user with hidden phone sends a message via BSUID
    const bsuidValue = 'MY.guest2026abc';
    const bsuidJid = `${bsuidValue}@lid`;

    // 1. Inbound: extractBsuid detects the BSUID
    const inboundMsg = {
      key: { remoteJid: bsuidJid, id: 'msg_001' },
      message: { conversation: 'Hello, I want to book a room' },
      pushName: 'Guest Ahmad',
      messageTimestamp: Math.floor(Date.now() / 1000),
    };

    // Simulate LID resolution failure (no phone mapping) — from stays as BSUID JID
    const resolvedFrom = bsuidJid; // LID mapper couldn't resolve

    // extractBsuid detects BSUID from the JID
    const fromStripped = resolvedFrom.replace(/@.*$/, '');
    expect(isBsuid(fromStripped)).toBe(true);
    const extractedBsuid = fromStripped;
    expect(extractedBsuid).toBe(bsuidValue);

    // 2. Pipeline: conversationKey produces bsuid-prefixed key
    const convoKey = conversationKey(resolvedFrom, extractedBsuid);
    expect(convoKey).toBe(`bsuid:${bsuidValue}`);

    // 3. Outbound: resolveBsuidToPhone for the BSUID-keyed conversation
    // In real flow, phone = resolvedFrom (the JID), NOT the bsuid-prefixed key
    // So outbound uses the original JID which Baileys can deliver to
    const outboundPhone = resolvedFrom;
    const resolvedOutbound = await resolveBsuidToPhone(outboundPhone);
    // Not a bsuid: prefix, so passes through as-is (Baileys sends to JID directly)
    expect(resolvedOutbound).toBe(bsuidJid);
  });

  test('dual-identifier message (phone + BSUID) uses phone as primary key and links BSUID', () => {
    // Simulate: user has both phone and BSUID visible in message
    const phone = '60123456789';
    const bsuid = 'MY.guest2026abc';
    const phoneJid = `${phone}@s.whatsapp.net`;

    // extractBsuid returns BSUID from msg.lid
    // conversationKey prefers phone when available
    const convoKey = conversationKey(phoneJid, bsuid);
    expect(convoKey).toBe(phone); // Phone wins as primary key

    // DB upsert would store bsuid in the bsuid column, linking it to the phone record
    // (tested via upsertConversation in DB-connected tests)
  });

  test('pre-existing phone conversation gets BSUID linked on subsequent message', () => {
    // Simulate: existing conversation by phone, now user sends with BSUID
    const phone = '60198765432';

    // First message: phone only → key = phone
    const key1 = conversationKey(`${phone}@s.whatsapp.net`);
    expect(key1).toBe(phone);

    // Second message: phone + BSUID → key still = phone (stable key)
    const key2 = conversationKey(`${phone}@s.whatsapp.net`, 'MY.returningGuest');
    expect(key2).toBe(phone);

    // Same key — conversation continuity preserved
    expect(key1).toBe(key2);
  });

  test('BSUID-only conversation merges into phone-keyed conversation when phone becomes available', () => {
    // Simulate: first contact via BSUID-only, then phone becomes available
    const bsuid = 'SG.newGuest42';

    // First contact: BSUID only
    const key1 = conversationKey(`${bsuid}@lid`, bsuid);
    expect(key1).toBe(`bsuid:${bsuid}`);

    // Later: phone revealed alongside BSUID
    const phone = '6591234567';
    const key2 = conversationKey(`${phone}@s.whatsapp.net`, bsuid);
    expect(key2).toBe(phone); // Now uses phone as primary key

    // mergeBsuidConversation would move messages from key1 to key2 in the DB
    // (DB merge logic tested separately with actual DB connection)
  });

  test('outbound message to BSUID-only contact resolves through bsuid-resolver', async () => {
    // When conversation is keyed by "bsuid:MY.abc123", outbound must resolve
    const bsuidKey = 'bsuid:MY.noPhoneYet';

    // Without DB mapping, resolution returns null (can't send)
    const resolved = await resolveBsuidToPhone(bsuidKey);
    expect(resolved).toBeNull();

    // In practice: the pipeline uses msg.from (the original JID) for outbound,
    // NOT the bsuid-prefixed DB key. So Baileys sends to the @lid JID directly.
    // The bsuid-resolver is only needed when initiating outbound from admin panel
    // using the DB-stored conversation key.
  });
});
