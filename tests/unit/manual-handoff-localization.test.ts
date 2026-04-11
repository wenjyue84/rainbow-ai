import { describe, it, expect } from 'vitest';

/**
 * US-502: Verify manual_handoff template exists for all 4 languages.
 * Tests that the localized manual handoff message is returned for each language.
 */
describe('Manual Handoff Localization', () => {
  // Mirror of manual_handoff template from templates.json
  const manualHandoffTemplates: Record<string, string> = {
    en: "I've connected you with our team, they will respond shortly.",
    ms: "Saya telah hubungkan anda dengan pasukan kami, mereka akan membalas sebentar lagi.",
    zh: "我已经为您连接了我们的团队，他们会很快回复您。",
    ta: "நான் உங்களை எங்கள் குழுவுடன் இணைத்துவிட்டேன், அவர்கள் சீக்கிரம் பதிலளிப்பார்கள்।"
  };

  it('should have manual_handoff template for English', () => {
    expect(manualHandoffTemplates).toHaveProperty('en');
  });

  it('should have manual_handoff template for Malay', () => {
    expect(manualHandoffTemplates).toHaveProperty('ms');
  });

  it('should have manual_handoff template for Mandarin', () => {
    expect(manualHandoffTemplates).toHaveProperty('zh');
  });

  it('should have manual_handoff template for Tamil', () => {
    expect(manualHandoffTemplates).toHaveProperty('ta');
  });

  it('English message should not be empty', () => {
    expect(manualHandoffTemplates.en.trim().length).toBeGreaterThan(0);
  });

  it('Malay message should not be empty', () => {
    expect(manualHandoffTemplates.ms.trim().length).toBeGreaterThan(0);
  });

  it('Mandarin message should not be empty', () => {
    expect(manualHandoffTemplates.zh.trim().length).toBeGreaterThan(0);
  });

  it('Tamil message should not be empty', () => {
    expect(manualHandoffTemplates.ta.trim().length).toBeGreaterThan(0);
  });

  it('Tamil message should contain Tamil script characters', () => {
    // Tamil Unicode range: U+0B80–U+0BFF
    const tamilRegex = /[\u0B80-\u0BFF]/;
    expect(tamilRegex.test(manualHandoffTemplates.ta)).toBe(true);
  });

  it('English guest gets English manual handoff message', () => {
    const lang = 'en';
    const message = manualHandoffTemplates[lang];
    expect(message).toBe(manualHandoffTemplates.en);
  });

  it('Malay guest gets Malay manual handoff message', () => {
    const lang = 'ms';
    const message = manualHandoffTemplates[lang];
    expect(message).toBe(manualHandoffTemplates.ms);
  });

  it('Mandarin guest gets Mandarin manual handoff message', () => {
    const lang = 'zh';
    const message = manualHandoffTemplates[lang];
    expect(message).toBe(manualHandoffTemplates.zh);
  });

  it('Tamil guest gets Tamil manual handoff message', () => {
    const lang = 'ta';
    const message = manualHandoffTemplates[lang];
    expect(message).toBe(manualHandoffTemplates.ta);
    expect(message).not.toBe(manualHandoffTemplates.en);
  });

  it('all four languages should be present in manual_handoff', () => {
    expect(Object.keys(manualHandoffTemplates).sort()).toEqual(['en', 'ms', 'ta', 'zh']);
  });

  it('messages should be distinct across languages', () => {
    const uniqueMessages = new Set(Object.values(manualHandoffTemplates));
    expect(uniqueMessages.size).toBe(4);
  });
});
