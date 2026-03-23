/**
 * US-213: Tests for suggest-keywords.ts
 *
 * Tests that TF-IDF keyword suggestions are derived from actual guest message
 * content, not generic terms, and that output schema is correct.
 */

import { describe, it, expect } from "vitest";
import {
  tokenize,
  computeTfIdf,
  analyzeEscalations,
  type EscalationRow,
} from "../suggest-keywords.js";

describe("tokenize", () => {
  it("returns lowercase alpha tokens of length >= 3", () => {
    const tokens = tokenize("Room 101 available Check-in at noon");
    expect(tokens).toContain("room");
    expect(tokens).toContain("available");
    expect(tokens).toContain("check");
    expect(tokens).not.toContain("101");
  });

  it("filters stop words", () => {
    const tokens = tokenize("I want to know if the room is available");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("is");
    expect(tokens).toContain("room");
    expect(tokens).toContain("available");
  });

  it("handles empty string", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("computeTfIdf", () => {
  it("returns suggestions from guest message content not generic terms", () => {
    const intentMessages = new Map([
      ["booking_inquiry", ["Can I book a room for 3 nights", "I want to make a booking for next week", "Booking available for March"]],
      ["wifi_help", ["What is the wifi password", "How do I connect to wifi", "Wifi not working in my room"]],
    ]);
    const existingKeywords = new Map();

    const suggestions = computeTfIdf(intentMessages, existingKeywords, 3);

    expect(suggestions.length).toBeGreaterThan(0);

    const bookingSuggestion = suggestions.find(s => s.intent_id === "booking_inquiry");
    if (bookingSuggestion) {
      const hasContentKeyword = bookingSuggestion.suggested_keywords.some(kw =>
        ["booking", "book", "room", "nights", "week", "march", "available"].includes(kw)
      );
      expect(hasContentKeyword).toBe(true);

      const hasStopWord = bookingSuggestion.suggested_keywords.some(kw =>
        ["the", "is", "for", "to"].includes(kw)
      );
      expect(hasStopWord).toBe(false);
    }
  });

  it("excludes terms that already exist as keywords", () => {
    const intentMessages = new Map([
      ["payment_inquiry", ["How do I pay the bill", "Payment methods accepted", "Can I pay by card"]],
    ]);
    const existingKeywords = new Map([
      ["payment_inquiry", new Set(["pay", "payment", "bill"])],
    ]);

    const suggestions = computeTfIdf(intentMessages, existingKeywords, 3);
    const paymentSuggestion = suggestions.find(s => s.intent_id === "payment_inquiry");

    if (paymentSuggestion) {
      expect(paymentSuggestion.suggested_keywords).not.toContain("pay");
      expect(paymentSuggestion.suggested_keywords).not.toContain("payment");
      expect(paymentSuggestion.suggested_keywords).not.toContain("bill");
    }
  });

  it("returns empty array when no messages provided", () => {
    const intentMessages = new Map();
    const existingKeywords = new Map();
    const suggestions = computeTfIdf(intentMessages, existingKeywords, 3);
    expect(suggestions).toEqual([]);
  });

  it("output schema matches required format", () => {
    const intentMessages = new Map([
      ["checkin_info", ["What time is check-in", "When can I check in", "Early check-in possible"]],
    ]);
    const existingKeywords = new Map();
    const suggestions = computeTfIdf(intentMessages, existingKeywords, 3);

    if (suggestions.length > 0) {
      const s = suggestions[0];
      expect(typeof s.intent_id).toBe("string");
      expect(typeof s.current_keyword_count).toBe("number");
      expect(Array.isArray(s.suggested_keywords)).toBe(true);
      expect(typeof s.estimated_accuracy_boost_percent).toBe("number");
      expect(s.suggested_keywords.length).toBeLessThanOrEqual(3);
    }
  });
});

describe("analyzeEscalations", () => {
  it("extracts keywords from actual guest message content", () => {
    const rows = [
      { original_intent: "breakfast_inquiry", message_preview: "Is breakfast included in the price", confidence_score: 0.3, profile: "pelangi", timestamp: new Date() },
      { original_intent: "breakfast_inquiry", message_preview: "What time does breakfast start", confidence_score: 0.25, profile: "pelangi", timestamp: new Date() },
      { original_intent: "breakfast_inquiry", message_preview: "Do you serve breakfast on weekdays", confidence_score: 0.2, profile: "pelangi", timestamp: new Date() },
      { original_intent: "parking_inquiry", message_preview: "Is there parking available near the hostel", confidence_score: 0.4, profile: "pelangi", timestamp: new Date() },
      { original_intent: "parking_inquiry", message_preview: "Where can I park my car", confidence_score: 0.35, profile: "pelangi", timestamp: new Date() },
    ];

    const existingKeywords = new Map();
    const suggestions = analyzeEscalations(rows, existingKeywords, 3);

    const intents = suggestions.map(s => s.intent_id);
    expect(intents).toContain("breakfast_inquiry");
    expect(intents).toContain("parking_inquiry");

    const breakfastSugg = suggestions.find(s => s.intent_id === "breakfast_inquiry");
    expect(breakfastSugg).toBeDefined();
    if (breakfastSugg) {
      const hasBreakfastTerm = breakfastSugg.suggested_keywords.some(kw =>
        ["breakfast", "included", "price", "time", "start", "weekdays", "serve"].includes(kw)
      );
      expect(hasBreakfastTerm).toBe(true);
    }
  });

  it("skips rows with null messagePreview", () => {
    const rows = [
      { original_intent: "test_intent", message_preview: null, confidence_score: 0.1, profile: "pelangi", timestamp: new Date() },
      { original_intent: "test_intent", message_preview: "Valid hostel content message here", confidence_score: 0.2, profile: "pelangi", timestamp: new Date() },
    ];

    const existingKeywords = new Map();
    const suggestions = analyzeEscalations(rows, existingKeywords, 3);
    const testSugg = suggestions.find(s => s.intent_id === "test_intent");
    expect(testSugg).toBeDefined();
  });

  it("returns empty array for all-null messages", () => {
    const rows = [
      { original_intent: "test_intent", message_preview: null, confidence_score: 0.1, profile: "pelangi", timestamp: new Date() },
    ];

    const existingKeywords = new Map();
    const suggestions = analyzeEscalations(rows, existingKeywords, 3);
    expect(suggestions).toEqual([]);
  });
});
