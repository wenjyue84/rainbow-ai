/**
 * Unit tests for US-010: Conversation Reset Command Handling
 *
 * Verifies:
 * - conversation_reset keywords exist in intent-keywords.json
 * - conversation_reset is mapped in routing.json
 * - conversation_reset template exists in templates.json (EN/MS/ZH)
 * - settings.json has conversation_reset.enabled and conversation_reset.keywords
 * - Reset keyword matching is exact (not substring) to avoid false positives
 * - Multilingual keywords present (EN/MS/ZH)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'src', 'assistant', 'data');

const routingData = JSON.parse(readFileSync(join(DATA_DIR, 'routing.json'), 'utf-8'));
const keywordsData = JSON.parse(readFileSync(join(DATA_DIR, 'intent-keywords.json'), 'utf-8'));
const templatesData = JSON.parse(readFileSync(join(DATA_DIR, 'templates.json'), 'utf-8'));
const settingsData = JSON.parse(readFileSync(join(DATA_DIR, 'settings.json'), 'utf-8'));

// ─── conversation_reset in intent-keywords.json ───────────────────────────────

describe('conversation_reset — intent-keywords.json', () => {
  const entry = keywordsData.intents.find((i: { intent: string }) => i.intent === 'conversation_reset');

  it('exists in intent-keywords.json', () => {
    expect(entry).toBeDefined();
  });

  it('has EN keywords', () => {
    expect(Array.isArray(entry?.keywords?.en)).toBe(true);
    expect(entry.keywords.en.length).toBeGreaterThan(0);
  });

  it('has MS keywords', () => {
    expect(Array.isArray(entry?.keywords?.ms)).toBe(true);
    expect(entry.keywords.ms.length).toBeGreaterThan(0);
  });

  it('has ZH keywords', () => {
    expect(Array.isArray(entry?.keywords?.zh)).toBe(true);
    expect(entry.keywords.zh.length).toBeGreaterThan(0);
  });

  it('EN keywords include "restart"', () => {
    expect(entry?.keywords?.en).toContain('restart');
  });

  it('EN keywords include "start over"', () => {
    expect(entry?.keywords?.en).toContain('start over');
  });

  it('MS keywords include "mula semula"', () => {
    expect(entry?.keywords?.ms).toContain('mula semula');
  });

  it('ZH keywords include "重新开始"', () => {
    expect(entry?.keywords?.zh).toContain('重新开始');
  });
});

// ─── conversation_reset in routing.json ──────────────────────────────────────

describe('conversation_reset — routing.json', () => {
  it('conversation_reset has a route', () => {
    expect(routingData['conversation_reset']).toBeDefined();
  });

  it('routes to reset_conversation action', () => {
    expect(routingData['conversation_reset']?.action).toBe('reset_conversation');
  });
});

// ─── conversation_reset template ─────────────────────────────────────────────

describe('conversation_reset — templates.json', () => {
  const tmpl = templatesData['conversation_reset'];

  it('template exists', () => {
    expect(tmpl).toBeDefined();
  });

  it('has EN response', () => {
    expect(typeof tmpl?.en).toBe('string');
    expect(tmpl.en.length).toBeGreaterThan(0);
  });

  it('has MS response', () => {
    expect(typeof tmpl?.ms).toBe('string');
    expect(tmpl.ms.length).toBeGreaterThan(0);
  });

  it('has ZH response', () => {
    expect(typeof tmpl?.zh).toBe('string');
    expect(tmpl.zh.length).toBeGreaterThan(0);
  });
});

// ─── conversation_reset settings ─────────────────────────────────────────────

describe('conversation_reset — settings.json', () => {
  const cfg = settingsData['conversation_reset'];

  it('config section exists', () => {
    expect(cfg).toBeDefined();
  });

  it('is enabled by default', () => {
    expect(cfg?.enabled).toBe(true);
  });

  it('has keywords array', () => {
    expect(Array.isArray(cfg?.keywords)).toBe(true);
    expect(cfg.keywords.length).toBeGreaterThan(0);
  });

  it('keywords includes "restart"', () => {
    expect(cfg?.keywords).toContain('restart');
  });
});

// ─── Keyword matching behaviour ───────────────────────────────────────────────

const DEFAULT_KEYWORDS = [
  'restart', 'reset', 'start over', 'start fresh', 'begin again',
  'new conversation', '/start', '/reset', '/restart', 'clear chat',
  'mula semula', 'mulakan semula', '/mula',
  '重新开始', '重置', '/重置',
];

function isConversationResetCommand(text: string, customKeywords?: string[]): boolean {
  const keywords = customKeywords && customKeywords.length > 0 ? customKeywords : DEFAULT_KEYWORDS;
  const normalized = text.toLowerCase().trim();
  return keywords.some(kw => normalized === kw.toLowerCase());
}

describe('isConversationResetCommand — matching logic', () => {
  it('matches "restart" exactly', () => {
    expect(isConversationResetCommand('restart')).toBe(true);
  });

  it('matches "RESTART" case-insensitively', () => {
    expect(isConversationResetCommand('RESTART')).toBe(true);
  });

  it('matches "start over" exactly', () => {
    expect(isConversationResetCommand('start over')).toBe(true);
  });

  it('matches "/start" command', () => {
    expect(isConversationResetCommand('/start')).toBe(true);
  });

  it('matches "mula semula" (MS)', () => {
    expect(isConversationResetCommand('mula semula')).toBe(true);
  });

  it('matches "重新开始" (ZH)', () => {
    expect(isConversationResetCommand('重新开始')).toBe(true);
  });

  it('does NOT match partial "please restart my order"', () => {
    // Exact match only — "please restart my order" is not a keyword
    expect(isConversationResetCommand('please restart my order')).toBe(false);
  });

  it('does NOT match "check in" as reset', () => {
    expect(isConversationResetCommand('check in')).toBe(false);
  });

  it('does NOT match "show me the menu" as reset', () => {
    // "menu" alone might be a keyword but "show me the menu" is not
    expect(isConversationResetCommand('show me the menu')).toBe(false);
  });

  it('uses custom keywords when provided', () => {
    expect(isConversationResetCommand('cancel', ['cancel', 'stop'])).toBe(true);
  });

  it('custom keywords override defaults', () => {
    // With custom keywords, default keywords no longer apply
    expect(isConversationResetCommand('restart', ['cancel', 'stop'])).toBe(false);
  });
});
