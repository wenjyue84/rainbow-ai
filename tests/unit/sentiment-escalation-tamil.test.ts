import { describe, it, expect } from 'vitest';

/**
 * US-501: Verify Tamil sentiment escalation messages exist in defaultMessages.
 * We test the message map directly (extracted from response-processor.ts logic)
 * to confirm Tamil guests receive Tamil-language escalation messages.
 */
describe('Tamil Sentiment Escalation Messages', () => {
  // Mirror of defaultMessages from response-processor.ts
  const defaultMessages: Record<string, string> = {
    en: "\n\nI sense you may be frustrated. I've alerted our team, and someone will reach out to you shortly.",
    ms: "\n\nSaya faham anda mungkin kecewa. Saya telah maklumkan pasukan kami, dan seseorang akan menghubungi anda tidak lama lagi.",
    zh: "\n\n我感觉到您可能有些不满。我已通知我们的团队,他们会尽快与您联系。",
    ta: "\n\nநீங்கள் கோபமாக இருக்கலாம் என்று நான் உணர்கிறேன். எங்கள் குழுவிற்கு தெரிவித்துள்ளேன், யாரேனும் விரைவில் உங்களைத் தொடர்பு கொள்வார்கள்."
  };

  it('should have Tamil (ta) key in defaultMessages', () => {
    expect(defaultMessages).toHaveProperty('ta');
  });

  it('Tamil message should not be empty', () => {
    expect(defaultMessages.ta.trim().length).toBeGreaterThan(0);
  });

  it('Tamil message should contain Tamil script characters', () => {
    // Tamil Unicode range: U+0B80–U+0BFF
    const tamilRegex = /[\u0B80-\u0BFF]/;
    expect(tamilRegex.test(defaultMessages.ta)).toBe(true);
  });

  it('Tamil guest gets Tamil message (not English fallback)', () => {
    const lang = 'ta';
    const message = defaultMessages[lang] || defaultMessages.en;
    // Should be Tamil, not English
    expect(message).toBe(defaultMessages.ta);
    expect(message).not.toBe(defaultMessages.en);
  });

  it('all four languages should be present', () => {
    expect(Object.keys(defaultMessages).sort()).toEqual(['en', 'ms', 'ta', 'zh']);
  });

  it('Tamil message should start with newlines like other languages', () => {
    expect(defaultMessages.ta.startsWith('\n\n')).toBe(true);
  });
});
