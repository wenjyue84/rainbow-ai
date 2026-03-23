/**
 * US-232: Confidence-Based Response Routing with Escalation Suggestions
 *
 * Tests:
 * 1. Confidence 0.25 (low) returns escalation template with staff WhatsApp contact
 * 2. Confidence 0.50 (medium) returns inquiry template
 * 3. Confidence 0.75 (high) returns the original AI response
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  evaluateResponseConfidence,
  clearTemplateCache,
  loadEscalationTemplates,
  type ConfidenceRoutingResult,
} from '../assistant/pipeline/fallback.js';

beforeEach(() => {
  clearTemplateCache();
});

describe('US-232: evaluateResponseConfidence', () => {
  // ─── Scenario 1: Low confidence (<0.35) → escalation with staff contact ──

  it('confidence 0.25 returns escalation template with staff WhatsApp contact', () => {
    const result: ConfidenceRoutingResult = evaluateResponseConfidence(
      0.25,
      'pelangi',
      'booking.inquiry',
      'en',
      'Some AI response that should not be used',
    );

    expect(result.band).toBe('low');
    expect(result.shouldEscalate).toBe(true);
    expect(result.staffContact).toBeTruthy();
    // Staff contact should be a phone number string
    expect(result.staffContact).toMatch(/^\d+$/);
    // Response should contain the staff contact number for WhatsApp
    expect(result.response).toContain(result.staffContact!);
    // Response should NOT be the original AI response
    expect(result.response).not.toBe('Some AI response that should not be used');
  });

  // ─── Scenario 2: Medium confidence (0.35–0.60) → polite inquiry ──────────

  it('confidence 0.50 returns inquiry template', () => {
    const result: ConfidenceRoutingResult = evaluateResponseConfidence(
      0.50,
      'pelangi',
      'booking.inquiry',
      'en',
      'Some AI response',
    );

    expect(result.band).toBe('medium');
    expect(result.shouldEscalate).toBe(false);
    expect(result.staffContact).toBeNull();
    // Response should be an inquiry/clarification message, not the AI response
    expect(result.response).not.toBe('Some AI response');
    expect(result.response.length).toBeGreaterThan(10);
  });

  // ─── Scenario 3: High confidence (>0.60) → original AI response ─────────

  it('confidence 0.75 returns the original AI response', () => {
    const aiResponse = 'Check-in is at 2:00 PM. Door password is 1270#.';
    const result: ConfidenceRoutingResult = evaluateResponseConfidence(
      0.75,
      'pelangi',
      'checkin_info',
      'en',
      aiResponse,
    );

    expect(result.band).toBe('high');
    expect(result.shouldEscalate).toBe(false);
    expect(result.staffContact).toBeNull();
    expect(result.response).toBe(aiResponse);
  });

  // ─── Boundary tests ─────────────────────────────────────────────────────

  it('confidence exactly 0.35 is classified as medium', () => {
    const result = evaluateResponseConfidence(0.35, 'pelangi', 'unknown', 'en', 'resp');
    expect(result.band).toBe('medium');
    expect(result.shouldEscalate).toBe(false);
  });

  it('confidence exactly 0.60 is classified as medium', () => {
    const result = evaluateResponseConfidence(0.60, 'pelangi', 'unknown', 'en', 'resp');
    expect(result.band).toBe('medium');
    expect(result.shouldEscalate).toBe(false);
  });

  it('confidence 0.61 is classified as high', () => {
    const result = evaluateResponseConfidence(0.61, 'pelangi', 'unknown', 'en', 'resp');
    expect(result.band).toBe('high');
  });

  it('confidence 0.34 is classified as low', () => {
    const result = evaluateResponseConfidence(0.34, 'pelangi', 'unknown', 'en', 'resp');
    expect(result.band).toBe('low');
    expect(result.shouldEscalate).toBe(true);
  });

  it('confidence 0 is classified as low', () => {
    const result = evaluateResponseConfidence(0, 'pelangi', 'unknown', 'en');
    expect(result.band).toBe('low');
    expect(result.shouldEscalate).toBe(true);
    expect(result.staffContact).toBeTruthy();
  });

  it('confidence 1.0 is classified as high', () => {
    const result = evaluateResponseConfidence(1.0, 'pelangi', 'unknown', 'en', 'sure thing');
    expect(result.band).toBe('high');
    expect(result.response).toBe('sure thing');
  });

  // ─── Profile-specific templates ──────────────────────────────────────────

  it('loads profile-specific escalation templates for pelangi', () => {
    const templates = loadEscalationTemplates('pelangi');
    expect(templates).not.toBeNull();
    expect(templates!.staff_whatsapp).toBeTruthy();
    expect(templates!.templates).toBeDefined();
    expect(templates!.templates['booking.inquiry']).toBeDefined();
  });

  it('loads profile-specific escalation templates for makan', () => {
    const templates = loadEscalationTemplates('makan');
    expect(templates).not.toBeNull();
    expect(templates!.staff_whatsapp).toBeTruthy();
  });

  it('loads profile-specific escalation templates for southern', () => {
    const templates = loadEscalationTemplates('southern');
    expect(templates).not.toBeNull();
    expect(templates!.staff_whatsapp).toBeTruthy();
  });

  it('different profiles may have different staff contacts', () => {
    const pelangi = loadEscalationTemplates('pelangi');
    const southern = loadEscalationTemplates('southern');
    expect(pelangi).not.toBeNull();
    expect(southern).not.toBeNull();
    // Southern has a different staff contact than pelangi
    expect(southern!.staff_whatsapp).toBe('60167620815');
    expect(pelangi!.staff_whatsapp).toBe('60127088789');
  });

  it('uses intent-specific template when available', () => {
    const result = evaluateResponseConfidence(0.20, 'pelangi', 'booking.inquiry', 'en');
    // Should use the booking.inquiry-specific template, not the default
    expect(result.response).toContain('booking');
    expect(result.response).toContain(result.staffContact!);
  });

  it('falls back to default template for unknown intents', () => {
    const result = evaluateResponseConfidence(0.20, 'pelangi', 'some_unknown_intent', 'en');
    expect(result.band).toBe('low');
    expect(result.shouldEscalate).toBe(true);
    expect(result.response).toContain(result.staffContact!);
  });

  // ─── Language support ────────────────────────────────────────────────────

  it('returns Malay response when lang is ms', () => {
    const result = evaluateResponseConfidence(0.25, 'pelangi', 'booking.inquiry', 'ms');
    expect(result.band).toBe('low');
    // Response should be in Malay (contains "tempahan" or similar)
    expect(result.response.length).toBeGreaterThan(10);
    expect(result.response).toContain(result.staffContact!);
  });

  it('returns Chinese response when lang is zh', () => {
    const result = evaluateResponseConfidence(0.50, 'pelangi', 'unknown', 'zh');
    expect(result.band).toBe('medium');
    expect(result.response.length).toBeGreaterThan(5);
  });

  // ─── Graceful degradation ───────────────────────────────────────────────

  it('handles missing profile templates gracefully (uses fallback)', () => {
    const result = evaluateResponseConfidence(0.20, 'nonexistent-profile', 'unknown', 'en');
    expect(result.band).toBe('low');
    expect(result.shouldEscalate).toBe(true);
    // Should still have a staff contact (fallback)
    expect(result.staffContact).toBeTruthy();
    expect(result.response.length).toBeGreaterThan(10);
  });

  it('cache clearing allows re-loading templates', () => {
    // Load once
    const first = loadEscalationTemplates('pelangi');
    expect(first).not.toBeNull();

    // Clear and reload
    clearTemplateCache();
    const second = loadEscalationTemplates('pelangi');
    expect(second).not.toBeNull();
    expect(second!.staff_whatsapp).toBe(first!.staff_whatsapp);
  });
});
