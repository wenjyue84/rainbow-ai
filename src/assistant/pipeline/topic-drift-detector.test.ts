/**
 * Unit tests for topic drift detector (US-093)
 */

import { describe, it, expect } from 'vitest';
import { detectTopicDrift, getTopicRefocusPrompt } from './topic-drift-detector.js';
import type { ChatMessage } from '../types.js';

describe('Topic Drift Detector', () => {
  // ─── Basic Detection Tests ─────────────────────────────────────

  it('detects drift: booking → general_question → booking sequence', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to book a room for 3 nights', timestamp: 1000 },
      { role: 'assistant', content: 'Great! What dates are you looking for?', timestamp: 2000 },
      { role: 'user', content: 'What is the weather like tomorrow?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('detects recovery when returning to booking topic', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to book a room', timestamp: 1000 },
      { role: 'assistant', content: 'How many nights?', timestamp: 2000 },
      { role: 'user', content: 'What is the weather?', timestamp: 3000 },
      { role: 'assistant', content: 'Let me help with your booking', timestamp: 4000 },
      { role: 'user', content: 'I want to check in on March 25', timestamp: 5000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    // After recovery, coherence should be higher (less drift)
    expect(result.drifted).toBe(false);
  });

  it('no drift when conversation stays on booking topic', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Can I book a capsule?', timestamp: 1000 },
      { role: 'assistant', content: 'Yes, how many nights?', timestamp: 2000 },
      { role: 'user', content: 'I need 5 nights starting tomorrow', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(false);
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('no drift when conversation stays on inquiry topic', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What are your facilities?', timestamp: 1000 },
      { role: 'assistant', content: 'We have AC, WiFi, and hot showers', timestamp: 2000 },
      { role: 'user', content: 'Do you have a shared kitchen?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(false);
    expect(result.confidence).toBeLessThan(0.7);
  });

  // ─── Edge Cases ──────────────────────────────────────────────

  it('handles very short conversations (no drift possible)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hi there', timestamp: 1000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('handles empty message history', () => {
    const messages: ChatMessage[] = [];
    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('handles messages with no user messages', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', content: 'How can I help?', timestamp: 1000 },
      { role: 'assistant', content: 'Still here?', timestamp: 2000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(false);
    expect(result.confidence).toBe(0);
  });

  // ─── Threshold Tests ──────────────────────────────────────────

  it('respects custom threshold parameter', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to book', timestamp: 1000 },
      { role: 'assistant', content: 'When?', timestamp: 2000 },
      { role: 'user', content: 'What is the weather?', timestamp: 3000 },
    ];

    const result1 = detectTopicDrift(messages, 0.5);
    const result2 = detectTopicDrift(messages, 0.9);

    expect(result1.drifted).toBe(true);
    expect(result2.drifted).toBe(false); // Doesn't drift with high threshold
  });

  // ─── Confidence Score Tests ───────────────────────────────────

  it('returns confidence score between 0 and 1', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Book a room', timestamp: 1000 },
      { role: 'assistant', content: 'How many nights?', timestamp: 2000 },
      { role: 'user', content: 'Weather today?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('higher confidence for completely unrelated topics', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to book a capsule', timestamp: 1000 },
      { role: 'assistant', content: 'Sure, when?', timestamp: 2000 },
      { role: 'user', content: 'Tell me about quantum physics', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  // ─── Booking ↔ Inquiry Topic Relationship Tests ────────────────

  it('handles transition from booking to inquiry (related topics)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Can I reserve a room?', timestamp: 1000 },
      { role: 'assistant', content: 'Yes, what dates?', timestamp: 2000 },
      { role: 'user', content: 'What are the facilities and rules?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    // Inquiry and booking are related, so drift should be lower
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('handles transition from inquiry to booking (related topics)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What facilities do you have?', timestamp: 1000 },
      { role: 'assistant', content: 'We have AC, WiFi, and more', timestamp: 2000 },
      { role: 'user', content: 'I want to book for 2 nights', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    // Transition between related topics = moderate coherence
    expect(result.drifted).toBe(false);
  });

  // ─── Multi-turn Conversation Tests ────────────────────────────

  it('maintains coherence across multiple booking steps', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to book', timestamp: 1000 },
      { role: 'assistant', content: 'How many nights?', timestamp: 2000 },
      { role: 'user', content: 'Three nights', timestamp: 3000 },
      { role: 'assistant', content: 'What dates?', timestamp: 4000 },
      { role: 'user', content: 'March 25 to 28', timestamp: 5000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(false);
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('detects drift after multiple on-topic turns', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'I want to book', timestamp: 1000 },
      { role: 'assistant', content: 'How many nights?', timestamp: 2000 },
      { role: 'user', content: 'Three nights', timestamp: 3000 },
      { role: 'assistant', content: 'What dates?', timestamp: 4000 },
      { role: 'user', content: 'March 25 to 28', timestamp: 5000 },
      { role: 'assistant', content: 'Great!', timestamp: 6000 },
      { role: 'user', content: 'By the way, do you like pizza?', timestamp: 7000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  // ─── Keyword Matching Tests ───────────────────────────────────

  it('detects booking keywords correctly', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'check-in date is tomorrow', timestamp: 1000 },
      { role: 'assistant', content: 'Got it', timestamp: 2000 },
      { role: 'user', content: 'Can I play video games?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(true);
  });

  it('detects inquiry keywords correctly', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'tell me information about amenities', timestamp: 1000 },
      { role: 'assistant', content: 'Sure', timestamp: 2000 },
      { role: 'user', content: 'What color is your roof?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages, 0.7);
    expect(result.drifted).toBe(true);
  });

  // ─── Default Threshold Test ───────────────────────────────────

  it('uses default threshold of 0.7 when not specified', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Book a room', timestamp: 1000 },
      { role: 'assistant', content: 'When?', timestamp: 2000 },
      { role: 'user', content: 'What is 2+2?', timestamp: 3000 },
    ];

    const result = detectTopicDrift(messages);
    expect(result.drifted).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);
  });
});

describe('Topic Refocus Prompt', () => {
  it('returns English prompt', () => {
    const prompt = getTopicRefocusPrompt('en');
    expect(prompt).toContain('booking');
    expect(prompt).toContain('Pelangi');
  });

  it('returns Malay prompt', () => {
    const prompt = getTopicRefocusPrompt('ms');
    expect(prompt).toContain('tempahan');
    expect(prompt).toContain('Pelangi');
  });

  it('returns Chinese prompt', () => {
    const prompt = getTopicRefocusPrompt('zh');
    expect(prompt).toContain('预订');
    expect(prompt).toContain('彩虹');
  });

  it('returns Tamil prompt', () => {
    const prompt = getTopicRefocusPrompt('ta');
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(0);
  });

  it('defaults to English for unknown language', () => {
    const prompt = getTopicRefocusPrompt('unknown' as any);
    expect(prompt).toContain('booking');
  });
});
