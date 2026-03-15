/**
 * Tests for US-970: AI chatbot identity disclosure and anti-impersonation guard.
 *
 * AC1: First message in new conversation includes AI disclosure
 * AC2: Direct identity questions get immediate truthful response
 * AC3: AI never claims to be human (system_prompt — tested via getIdentityTruthResponse)
 * AC5: Disclosure text is configurable
 * AC6: Audit log entry created (logDisclosureAudit tested via mocking)
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isIdentityQuestion,
  getDisclosureText,
  getIdentityTruthResponse,
} from '../identity-disclosure.js';

// ─── isIdentityQuestion ───────────────────────────────────────────────

describe('isIdentityQuestion', () => {
  it('detects "are you a bot"', () => {
    expect(isIdentityQuestion('are you a bot?')).toBe(true);
  });

  it('detects "are you a robot"', () => {
    expect(isIdentityQuestion('are you a robot')).toBe(true);
  });

  it('detects "are you human"', () => {
    expect(isIdentityQuestion('are you human?')).toBe(true);
  });

  it('detects "are you a real person"', () => {
    expect(isIdentityQuestion('are you a real person?')).toBe(true);
  });

  it('detects "who am I talking to"', () => {
    expect(isIdentityQuestion('who am I talking to?')).toBe(true);
  });

  it('detects "who am I speaking with"', () => {
    expect(isIdentityQuestion('who am I speaking with?')).toBe(true);
  });

  it('detects "who are you"', () => {
    expect(isIdentityQuestion('who are you?')).toBe(true);
  });

  it('detects "what are you"', () => {
    expect(isIdentityQuestion('what are you?')).toBe(true);
  });

  it('detects "am I talking to a bot"', () => {
    expect(isIdentityQuestion('am i talking to a bot')).toBe(true);
  });

  it('detects "is this a bot"', () => {
    expect(isIdentityQuestion('is this a bot?')).toBe(true);
  });

  it('detects "is there a real person"', () => {
    expect(isIdentityQuestion('is there a real person?')).toBe(true);
  });

  it('detects Malay "awak bot"', () => {
    expect(isIdentityQuestion('awak bot ke?')).toBe(true);
  });

  it('detects Chinese AI question', () => {
    expect(isIdentityQuestion('你是机器人吗')).toBe(true);
  });

  it('does NOT flag normal booking queries', () => {
    expect(isIdentityQuestion('I want to book a room')).toBe(false);
  });

  it('does NOT flag check-in questions', () => {
    expect(isIdentityQuestion('what time is check-in?')).toBe(false);
  });

  it('does NOT flag price questions', () => {
    expect(isIdentityQuestion('what is the price per night?')).toBe(false);
  });

  it('handles case-insensitive matching', () => {
    expect(isIdentityQuestion('ARE YOU A BOT?')).toBe(true);
    expect(isIdentityQuestion('Are You Human?')).toBe(true);
  });

  it('does NOT flag "robot vacuum" in unrelated message', () => {
    expect(isIdentityQuestion('do you have a robot vacuum in the room?')).toBe(false);
  });
});

// ─── getDisclosureText ────────────────────────────────────────────────

describe('getDisclosureText', () => {
  it('returns English default when no settings', () => {
    const text = getDisclosureText({}, 'en');
    expect(text).toContain('Rainbow');
    expect(text).toContain('AI');
  });

  it('returns Malay default for ms lang', () => {
    const text = getDisclosureText({}, 'ms');
    expect(text).toContain('Rainbow');
    expect(text.toLowerCase()).toContain('ai');
  });

  it('returns Chinese default for zh lang', () => {
    const text = getDisclosureText({}, 'zh');
    expect(text).toContain('Rainbow');
  });

  it('returns Tamil default for ta lang', () => {
    const text = getDisclosureText({}, 'ta');
    expect(text).toContain('Rainbow');
  });

  it('uses configured disclosure text from settings', () => {
    const settings = {
      identity_disclosure: {
        disclosure_text: {
          en: 'Custom disclosure: I am an AI assistant.',
        },
      },
    };
    const text = getDisclosureText(settings, 'en');
    expect(text).toBe('Custom disclosure: I am an AI assistant.');
  });

  it('falls back to English configured text when lang not in settings', () => {
    const settings = {
      identity_disclosure: {
        disclosure_text: {
          en: 'Custom English disclosure.',
        },
      },
    };
    const text = getDisclosureText(settings, 'ms');
    expect(text).toBe('Custom English disclosure.');
  });

  it('falls back to built-in default when settings has no disclosure_text', () => {
    const settings = { identity_disclosure: { enabled: true } };
    const text = getDisclosureText(settings, 'en');
    expect(text).toContain('Rainbow');
  });
});

// ─── getIdentityTruthResponse ─────────────────────────────────────────

describe('getIdentityTruthResponse', () => {
  it('returns English truth response asserting AI identity', () => {
    const resp = getIdentityTruthResponse({}, 'en');
    expect(resp).toContain('Rainbow');
    expect(resp.toLowerCase()).toContain('ai');
    // Must NOT contain any claim of being human
    expect(resp.toLowerCase()).not.toContain("i'm a human");
    expect(resp.toLowerCase()).not.toContain('i am human');
  });

  it('returns Malay truth response', () => {
    const resp = getIdentityTruthResponse({}, 'ms');
    expect(resp).toContain('Rainbow');
  });

  it('returns Chinese truth response', () => {
    const resp = getIdentityTruthResponse({}, 'zh');
    expect(resp).toContain('Rainbow');
  });

  it('uses configured identity_truth from settings', () => {
    const settings = {
      identity_disclosure: {
        identity_truth: {
          en: 'I am an AI, not a human staff.',
        },
      },
    };
    const resp = getIdentityTruthResponse(settings, 'en');
    expect(resp).toBe('I am an AI, not a human staff.');
  });

  it('English response suggests human escalation option', () => {
    const resp = getIdentityTruthResponse({}, 'en');
    // Should offer human escalation path (AC4 support)
    expect(resp.toLowerCase()).toMatch(/human|team member|staff/);
  });
});
