/**
 * US-430: Interactive WhatsApp Messages
 *
 * Tests for buildListMessage, buildButtonMessage, text fallbacks,
 * and the greeting menu integration.
 */
import { describe, it, expect } from 'vitest';
import {
  buildListMessage,
  buildButtonMessage,
  listMessageToText,
  buttonMessageToText,
  type ListSection,
  type ListMessagePayload,
  type ButtonMessagePayload,
} from '../formatter.js';

describe('buildListMessage', () => {
  const sections: ListSection[] = [
    {
      title: 'I can help with',
      rows: [
        { rowId: 'checkin', title: 'Check-in / Check-out', description: 'Arrival & departure info' },
        { rowId: 'pricing', title: 'Pricing & Availability', description: 'Rates and room options' },
        { rowId: 'location', title: 'Location & Directions' },
        { rowId: 'facilities', title: 'Facilities & WiFi', description: 'Amenities info' },
      ],
    },
  ];

  it('constructs a valid Baileys listMessage payload', () => {
    const payload = buildListMessage('Rainbow AI', 'How can I help?', 'View Options', sections);

    // Top-level key must be listMessage
    expect(payload).toHaveProperty('listMessage');
    const lm = payload.listMessage;

    // Required Baileys fields
    expect(lm.title).toBe('Rainbow AI');
    expect(lm.description).toBe('How can I help?');
    expect(lm.buttonText).toBe('View Options');
    expect(lm.listType).toBe(1); // SINGLE_SELECT
    expect(lm.sections).toHaveLength(1);
    expect(lm.sections[0].rows).toHaveLength(4);
  });

  it('includes row descriptions when provided', () => {
    const payload = buildListMessage('Title', 'Desc', 'Btn', sections);
    const rows = payload.listMessage.sections[0].rows;

    expect(rows[0].description).toBe('Arrival & departure info');
    expect(rows[2]).not.toHaveProperty('description'); // rowId: 'location' — no description
  });

  it('includes footerText when provided', () => {
    const payload = buildListMessage('T', 'D', 'B', sections, 'Powered by Rainbow AI');
    expect(payload.listMessage.footerText).toBe('Powered by Rainbow AI');
  });

  it('omits footerText when not provided', () => {
    const payload = buildListMessage('T', 'D', 'B', sections);
    expect(payload.listMessage).not.toHaveProperty('footerText');
  });

  it('throws when total rows exceed 10', () => {
    const bigSection: ListSection = {
      title: 'Too many',
      rows: Array.from({ length: 11 }, (_, i) => ({ rowId: `r${i}`, title: `Row ${i}` })),
    };
    expect(() => buildListMessage('T', 'D', 'B', [bigSection])).toThrow('max 10 rows');
  });

  it('throws when sections array is empty', () => {
    expect(() => buildListMessage('T', 'D', 'B', [])).toThrow('at least one section');
  });
});

describe('buildButtonMessage', () => {
  const buttons = [
    { id: 'yes', text: 'Yes' },
    { id: 'no', text: 'No' },
  ];

  it('constructs a valid Baileys buttonsMessage payload', () => {
    const payload = buildButtonMessage('Would you like to proceed?', buttons);

    expect(payload).toHaveProperty('buttonsMessage');
    const bm = payload.buttonsMessage;

    expect(bm.text).toBe('Would you like to proceed?');
    expect(bm.buttons).toHaveLength(2);
    expect(bm.buttons[0].buttonId).toBe('yes');
    expect(bm.buttons[0].buttonText.displayText).toBe('Yes');
    expect(bm.buttons[0].type).toBe(1); // QUICK_REPLY
    expect(bm.headerType).toBe(1); // TEXT
  });

  it('throws when buttons exceed 3', () => {
    const tooMany = [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
      { id: 'd', text: 'D' },
    ];
    expect(() => buildButtonMessage('body', tooMany)).toThrow('max 3 buttons');
  });

  it('throws when buttons array is empty', () => {
    expect(() => buildButtonMessage('body', [])).toThrow('at least one button');
  });
});

describe('listMessageToText (fallback)', () => {
  it('converts list payload to numbered plain text', () => {
    const payload: ListMessagePayload = {
      listMessage: {
        title: 'Rainbow AI',
        description: 'How can I help?',
        buttonText: 'View Options',
        sections: [{
          title: 'Services',
          rows: [
            { title: 'Check-in', rowId: 'ci', description: 'Arrival info' },
            { title: 'Pricing', rowId: 'pr' },
          ],
        }],
        listType: 1,
      },
    };

    const text = listMessageToText(payload);
    expect(text).toContain('*Rainbow AI*');
    expect(text).toContain('How can I help?');
    expect(text).toContain('*Services*');
    expect(text).toContain('1. Check-in — Arrival info');
    expect(text).toContain('2. Pricing');
    expect(text).not.toContain('View Options'); // buttonText not in fallback
  });
});

describe('buttonMessageToText (fallback)', () => {
  it('converts buttons payload to numbered plain text', () => {
    const payload: ButtonMessagePayload = {
      buttonsMessage: {
        text: 'Confirm booking?',
        buttons: [
          { buttonId: 'yes', buttonText: { displayText: 'Yes' }, type: 1 },
          { buttonId: 'no', buttonText: { displayText: 'No' }, type: 1 },
        ],
        headerType: 1,
      },
    };

    const text = buttonMessageToText(payload);
    expect(text).toContain('Confirm booking?');
    expect(text).toContain('1. Yes');
    expect(text).toContain('2. No');
  });
});
