/**
 * Tests for US-587: Fallback Response Pipeline for Knowledge Base Retrieval Failures
 *
 * Covers:
 * - AC1: KnowledgeRetriever catches retrieval timeout (>5s) and returns fallback response from intent-specific template
 * - AC2: Fallback response uses profile's fallback-templates.json matching classified intent and language
 * - AC3: Test verifies fallback response is language-aware and profile-specific when KB retrieval fails
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KnowledgeBaseInstance } from '../knowledge-base-instance.js';
import type { ConfigStore } from '../config-store.js';
import type { RetrievalResult } from '../rag/hybrid-retriever.js';
import {
  retrieveWithFallback,
  retrieve,
  isFallbackResponse,
  getFallbackContent,
  type FallbackResponse
} from '../knowledge-retriever.js';

// ─── AC1: Timeout Handling ─────────────────────────────────────────────

describe('retrieveWithFallback - Timeout Handling', () => {
  let mockKB: KnowledgeBaseInstance;
  let mockConfigStore: ConfigStore;

  beforeEach(() => {
    // Create mock KB that times out
    mockKB = {
      retrieveContext: vi.fn(async () => {
        // Simulate timeout by never resolving
        return new Promise(() => {
          // Never resolves
        });
      })
    } as any;

    // Create mock ConfigStore with fallback templates
    mockConfigStore = {
      getTemplates: vi.fn(() => ({
        checkin_info: {
          en: 'I\'m unable to retrieve check-in details at the moment. Please contact our front desk for check-in information.',
          ms: 'Saya tidak dapat mengambil maklumat check-in pada masa ini. Sila hubungi meja hadapan kami untuk maklumat check-in.',
          zh: '我目前无法检索入住信息。请联系我们的前台了解入住信息。',
          ta: 'நான் இப்போது செக்-இன் விவரங்களை பெற முடியவில்லை। செக்-இன் தகவலுக்கு தயவுசெய்து எங்கள் முன்புற நிலையைத் தொடர்பு கொள்ளவும்.'
        },
        kb_retrieval_failed: {
          en: 'I\'m unable to find detailed information at the moment. Please contact our staff for more help.',
          ms: 'Saya tidak dapat mencari maklumat terperinci pada masa ini. Sila hubungi kakitangan kami untuk bantuan lanjut.',
          zh: '我目前无法找到详细信息。请联系我们的员工获取更多帮助。',
          ta: 'நான் இப்போது விஸ்தாரமான தகவல்களைக் கண்டுபிடிக்க முடியவில்லை। கூடுதல் உதவிக்கு தயவுசெய்து எங்கள் பணியாளர்களைத் தொடர்பு கொள்ளவும்.'
        }
      }))
    } as any;
  });

  test('AC1: Returns fallback response when KB retrieval times out (>5s)', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Can I check in early?',
      'checkin_info',
      'en',
      mockConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.reason).toContain('timeout');
    expect(result.content).toContain('check-in details');
    expect(result.chunks).toEqual([]);
    expect(result.hasRelevantContext).toBe(false);
  });

  test('AC1: Fallback latency is recorded', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'What\'s the WiFi password?',
      'wifi',
      'en',
      mockConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.retrievalLatencyMs).toBeDefined();
    expect(result.retrievalLatencyMs).toBeGreaterThanOrEqual(5000);
  });
});

// ─── AC2: Intent-Specific Fallback Templates ──────────────────────────

describe('retrieveWithFallback - Intent-Specific Templates', () => {
  let mockKB: KnowledgeBaseInstance;
  let mockConfigStore: ConfigStore;

  beforeEach(() => {
    mockKB = {
      retrieveContext: vi.fn(async () => {
        return new Promise(() => {}); // Never resolves (timeout)
      })
    } as any;

    mockConfigStore = {
      getTemplates: vi.fn(() => ({
        checkin_info: {
          en: 'I\'m unable to retrieve check-in details at the moment.',
          ms: 'Saya tidak dapat mengambil maklumat check-in pada masa ini.',
          zh: '我目前无法检索入住信息。',
          ta: 'நான் இப்போது செக்-இன் விவரங்களை பெற முடியவில்லை।'
        },
        wifi: {
          en: 'I\'m unable to retrieve WiFi details at the moment.',
          ms: 'Saya tidak dapat mengambil maklumat WiFi pada masa ini.',
          zh: '我目前无法检索WiFi信息。',
          ta: 'நான் இப்போது WiFi விவரங்களை பெற முடியவில்லை।'
        },
        booking: {
          en: 'I\'m unable to process your booking at the moment.',
          ms: 'Saya tidak dapat memproses tempahan anda pada masa ini.',
          zh: '我目前无法处理您的预订。',
          ta: 'நான் இப்போது உங்கள் முன்பதிவை செயல்படுத்த முடியவில்லை।'
        },
        kb_retrieval_failed: {
          en: 'Generic fallback for KB retrieval.',
          ms: 'Fallback umum untuk pengambilan KB.',
          zh: 'KB检索的通用回退。',
          ta: 'KB பெறல் சாதாரணமான fallback.'
        }
      }))
    } as any;
  });

  test('AC2: Uses intent-specific template for checkin_info', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'How do I check in?',
      'checkin_info',
      'en',
      mockConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('check-in details');
    expect(result.content).not.toContain('WiFi');
  });

  test('AC2: Uses intent-specific template for wifi', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'What is the WiFi password?',
      'wifi',
      'en',
      mockConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('WiFi details');
    expect(result.content).not.toContain('check-in');
  });

  test('AC2: Uses intent-specific template for booking', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Can I book a room?',
      'booking',
      'en',
      mockConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('booking');
    expect(result.content).not.toContain('WiFi');
  });

  test('AC2: Falls back to generic template when intent template not found', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Unknown intent?',
      'unknown_intent_xyz',
      'en',
      mockConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('KB retrieval');
  });
});

// ─── AC3: Language-Aware and Profile-Specific ─────────────────────────

describe('retrieveWithFallback - Language and Profile Awareness', () => {
  let mockKB: KnowledgeBaseInstance;
  let pelangConfigStore: ConfigStore;
  let makanConfigStore: ConfigStore;

  beforeEach(() => {
    mockKB = {
      retrieveContext: vi.fn(async () => {
        return new Promise(() => {}); // Timeout
      })
    } as any;

    // Pelangi profile templates (hostel-specific)
    pelangConfigStore = {
      getTemplates: vi.fn(() => ({
        checkin_info: {
          en: 'I\'m unable to retrieve check-in details at the moment. Please contact our front desk for check-in information.',
          ms: 'Saya tidak dapat mengambil maklumat check-in pada masa ini. Sila hubungi meja hadapan kami untuk maklumat check-in.',
          zh: '我目前无法检索入住信息。请联系我们的前台了解入住信息。',
          ta: 'நான் இப்போது செக்-இன் விவரங்களை பெற முடியவில்லை। செக்-இன் தகவலுக்கு தயவுசெய்து எங்கள் முன்புற நிலையைத் தொடர்பு கொள்ளவும்.'
        }
      }))
    } as any;

    // Makan profile templates (cafe-specific)
    makanConfigStore = {
      getTemplates: vi.fn(() => ({
        menu: {
          en: 'I\'m unable to retrieve menu details at the moment. Please ask our cafe staff about our menu.',
          ms: 'Saya tidak dapat mengambil butiran menu pada masa ini. Sila tanya kakitangan kafe kami tentang menu kami.',
          zh: '我目前无法检索菜单详情。请向我们的咖啡馆员工询问我们的菜单。',
          ta: 'நான் இப்போது மெனு விவரங்களை பெற முடியவில்லை। எங்கள் மெனு பற்றி தயவுசெய்து எங்கள் கேஃபு பணியாளர்களிடம் கேளுங்கள்.'
        }
      }))
    } as any;
  });

  test('AC3: Returns English fallback for English language', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'How do I check in?',
      'checkin_info',
      'en',
      pelangConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('front desk');
    expect(result.content).not.toMatch(/中文|Malay|Tamil/);
  });

  test('AC3: Returns Tamil fallback for Tamil language', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Check in எப்படி செய்வது?',
      'checkin_info',
      'ta',
      pelangConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('முன்புற நிலை');
    expect(result.content).toContain('செக்-இன்');
  });

  test('AC3: Returns Chinese fallback for Chinese language', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      '办理入住？',
      'checkin_info',
      'zh',
      pelangConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('前台');
    expect(result.content).toContain('入住');
  });

  test('AC3: Returns Malay fallback for Malay language', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Bagaimana saya check in?',
      'checkin_info',
      'ms',
      pelangConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('meja hadapan');
    expect(result.content).toContain('check-in');
  });

  test('AC3: Profile-specific fallback (Pelangi hostel-focused)', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Tell me about facilities',
      'facilities',
      'en',
      pelangConfigStore
    );

    expect(result.isFallback).toBe(true);
    // Should contain hostel-related language if available
    expect(result.content).toBeDefined();
  });

  test('AC3: Profile-specific fallback (Makan cafe-focused)', { timeout: 10000 }, async () => {
    const result = await retrieveWithFallback(
      mockKB,
      'Show me the menu',
      'menu',
      'en',
      makanConfigStore
    );

    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('cafe staff');
  });
});

// ─── Helper Functions ─────────────────────────────────────────────────

describe('Helper Functions', () => {
  test('isFallbackResponse correctly identifies fallback responses', () => {
    const fallback: FallbackResponse & RetrievalResult = {
      content: 'Fallback message',
      isFallback: true,
      chunks: [],
      hasRelevantContext: false,
      latencyMs: 5100
    };

    const regular: RetrievalResult = {
      chunks: [],
      hasRelevantContext: false,
      latencyMs: 100
    };

    expect(isFallbackResponse(fallback)).toBe(true);
    expect(isFallbackResponse(regular)).toBe(false);
  });

  test('getFallbackContent extracts content from fallback response', () => {
    const fallback: FallbackResponse & Partial<RetrievalResult> = {
      content: 'Test fallback content',
      isFallback: true
    };

    expect(getFallbackContent(fallback)).toBe('Test fallback content');
  });

  test('getFallbackContent handles missing content', () => {
    const fallback: FallbackResponse & Partial<RetrievalResult> = {
      isFallback: true
    };

    expect(getFallbackContent(fallback)).toBe('');
  });
});

// ─── Legacy API ────────────────────────────────────────────────────────

describe('retrieve - Legacy API', () => {
  let mockKB: KnowledgeBaseInstance;

  beforeEach(() => {
    mockKB = {
      retrieveContext: vi.fn(async () => {
        return new Promise(() => {}); // Timeout
      })
    } as any;
  });

  test('retrieve returns empty result on timeout', { timeout: 10000 }, async () => {
    const result = await retrieve(mockKB, 'test query');

    expect(result.chunks).toEqual([]);
    expect(result.hasRelevantContext).toBe(false);
    expect(result.latencyMs).toBe(0);
  });

  test('retrieve returns successful result when KB retrieves successfully', async () => {
    const successKB = {
      retrieveContext: vi.fn(async () => ({
        chunks: [{ chunk: { content: 'Test content' } }],
        hasRelevantContext: true,
        latencyMs: 100
      }))
    } as any;

    const result = await retrieve(successKB, 'test query');

    expect(result.chunks).toHaveLength(1);
    expect(result.hasRelevantContext).toBe(true);
    expect(result.latencyMs).toBe(100);
  });
});
