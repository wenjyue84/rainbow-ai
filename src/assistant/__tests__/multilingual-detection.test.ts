/**
 * US-874: Automatic language detection and response in Chinese (Mandarin) and Tamil
 *
 * Integration tests verifying the full multilingual pipeline:
 * 1. Language detection (ELD + pattern) for en/ms/zh/ta
 * 2. Per-JID language preference persistence
 * 3. System prompt language injection
 * 4. Language override via confidence thresholds
 * 5. Performance (<200ms latency)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { LanguageRouter } from '../language-router.js';
import { loadKnowledgeBase } from '../pipeline/stages/kb-loading.js';
import { resolveResponseLanguage } from '../pipeline/stages/routing.js';
import { detectLanguage, detectFullLanguage } from '../formatter.js';
import type { PipelineState } from '../pipeline/types.js';
import type { IPipelineContext } from '../pipeline/pipeline-context.js';

const router = new LanguageRouter();

// ─── AC1: Language detection for all 4 supported languages ──────────

describe('US-874: Language Detection — All Supported Languages', () => {
  const cases: [string, string, 'en' | 'ms' | 'zh' | 'ta'][] = [
    // English
    ['hello', 'English greeting', 'en'],
    ['What is the wifi password?', 'English question', 'en'],
    ['I want to book a room for tonight', 'English booking', 'en'],

    // Malay
    ['terima kasih', 'Malay thanks', 'ms'],
    ['Berapa harga untuk sehari?', 'Malay price question', 'ms'],
    ['assalamualaikum', 'Malay greeting', 'ms'],

    // Chinese (Simplified)
    ['你好', 'Chinese greeting', 'zh'],
    ['多少钱一天？', 'Chinese price question', 'zh'],
    ['我想订房间', 'Chinese booking', 'zh'],
    ['wifi密码是什么？', 'Chinese wifi question', 'zh'],

    // Tamil
    ['வணக்கம்', 'Tamil greeting', 'ta'],
    ['நன்றி', 'Tamil thanks', 'ta'],
    ['அறை எவ்வளவு?', 'Tamil room price', 'ta'],
    ['wifi கடவுச்சொல் என்ன?', 'Tamil wifi question', 'ta'],
  ];

  test.each(cases)('detects "%s" (%s) as %s', (text, _desc, expected) => {
    const detected = router.detectLanguage(text);
    expect(detected).toBe(expected);
  });
});

// ─── AC2: detectLanguage wrapper defaults unknown to 'en' ───────────

describe('US-874: detectLanguage wrapper (formatter)', () => {
  test('returns en/ms/zh/ta for known languages', () => {
    expect(detectLanguage('hello')).toBe('en');
    expect(detectLanguage('terima kasih')).toBe('ms');
    expect(detectLanguage('你好')).toBe('zh');
    expect(detectLanguage('வணக்கம்')).toBe('ta');
  });

  test('defaults to en for unknown/ambiguous input', () => {
    expect(detectLanguage('123')).toBe('en');
    expect(detectLanguage('???')).toBe('en');
  });
});

// ─── AC3: Tamil is NOT treated as foreign language ──────────────────

describe('US-874: Tamil excluded from foreign-language translation', () => {
  test('detectFullLanguage returns null for Tamil (handled natively)', () => {
    expect(detectFullLanguage('வணக்கம்')).toBeNull();
    expect(detectFullLanguage('அறை எவ்வளவு?')).toBeNull();
  });

  test('detectFullLanguage still detects other scripts as foreign', () => {
    expect(detectFullLanguage('สวัสดี')).toBe('Thai');
    expect(detectFullLanguage('こんにちは')).toBe('Japanese');
    expect(detectFullLanguage('안녕하세요')).toBe('Korean');
  });
});

// ─── AC4: Language override (resolveResponseLanguage) ───────────────

describe('US-874: Language override via resolveResponseLanguage', () => {
  test('high confidence Tamil detection overrides English conversation state', () => {
    expect(resolveResponseLanguage('ta', 'en', 0.95)).toBe('ta');
  });

  test('high confidence Chinese detection overrides Malay conversation state', () => {
    expect(resolveResponseLanguage('zh', 'ms', 0.9)).toBe('zh');
  });

  test('low confidence detection falls back to conversation state', () => {
    expect(resolveResponseLanguage('ta', 'en', 0.5)).toBe('en');
    expect(resolveResponseLanguage('zh', 'ms', 0.4)).toBe('ms');
  });

  test('user switching from Tamil to English mid-conversation', () => {
    expect(resolveResponseLanguage('en', 'ta', 0.9)).toBe('en');
  });

  test('user switching from English to Chinese mid-conversation', () => {
    expect(resolveResponseLanguage('zh', 'en', 0.85)).toBe('zh');
  });
});

// ─── AC5: System prompt language injection ──────────────────────────

describe('US-874: System prompt adapted to detected language', () => {
  function createMockContext(): IPipelineContext {
    return {
      guessTopicFiles: () => [],
      buildSystemPrompt: (persona: string) => `Base prompt: ${persona}`,
      getSettings: () => ({
        system_prompt: 'You are Rainbow',
        languageDetection: { enabled: true },
      }),
      getRouting: () => ({}),
    } as unknown as IPipelineContext;
  }

  function createMockState(lang: 'en' | 'ms' | 'zh' | 'ta'): PipelineState {
    return {
      processText: 'test',
      lang,
      devMetadata: { kbFiles: [], source: 'test', routedAction: 'test' },
      phone: '+60123456789',
    } as unknown as PipelineState;
  }

  test('injects English language instruction', () => {
    const result = loadKnowledgeBase(createMockState('en'), createMockContext());
    expect(result.systemPrompt).toContain('LANGUAGE INSTRUCTION: Always reply in English');
  });

  test('injects Malay language instruction', () => {
    const result = loadKnowledgeBase(createMockState('ms'), createMockContext());
    expect(result.systemPrompt).toContain('LANGUAGE INSTRUCTION: Always reply in Malay');
  });

  test('injects Chinese language instruction', () => {
    const result = loadKnowledgeBase(createMockState('zh'), createMockContext());
    expect(result.systemPrompt).toContain('LANGUAGE INSTRUCTION: Always reply in Chinese');
  });

  test('injects Tamil language instruction', () => {
    const result = loadKnowledgeBase(createMockState('ta'), createMockContext());
    expect(result.systemPrompt).toContain('LANGUAGE INSTRUCTION: Always reply in Tamil');
  });
});

// ─── AC6: Performance — detection under 200ms ───────────────────────

describe('US-874: Language detection latency', () => {
  test('1000 detections complete under 200ms (0.2ms per message)', () => {
    const samples = [
      'hello how are you',
      'terima kasih banyak',
      '你好，请问wifi密码是什么',
      'வணக்கம், அறை இருக்கிறதா?',
      'I want to check in now',
      'Berapa harga bilik',
      '多少钱一天',
      'நன்றி மிகவும்',
    ];

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      router.detectLanguage(samples[i % samples.length]);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200); // <0.2ms per detection
  });

  test('detectWithConfidence also meets latency requirement', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      router.detectWithConfidence('வணக்கம் wifi கடவுச்சொல் என்ன');
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
  });
});

// ─── Confidence thresholds for all languages ────────────────────────

describe('US-874: Confidence scoring for all languages', () => {
  test('Chinese script gets >= 0.95 confidence', () => {
    const result = router.detectWithConfidence('你好吗');
    expect(result.language).toBe('zh');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  test('Tamil script gets >= 0.95 confidence', () => {
    const result = router.detectWithConfidence('வணக்கம்');
    expect(result.language).toBe('ta');
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
  });

  test('clear English gets reasonable confidence', () => {
    const result = router.detectWithConfidence('hello how are you today');
    expect(result.language).toBe('en');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('clear Malay gets reasonable confidence', () => {
    const result = router.detectWithConfidence('Selamat pagi, apa khabar hari ini');
    expect(result.language).toBe('ms');
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});
