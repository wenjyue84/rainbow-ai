/**
 * confusion-matrix-generator.test.ts
 *
 * Unit tests for the confusion matrix generator.
 * No database required — tests pure logic only.
 */

import { describe, it, expect } from "vitest";
import {
  buildConfusionMatrix,
  calculateAccuracy,
  formatAsCSV,
  type ConfusionMatrixResult,
} from "./confusion-matrix-generator.js";

// ── buildConfusionMatrix ──────────────────────────────────────────────

describe("buildConfusionMatrix", () => {
  it("returns empty array for empty input", () => {
    const result = buildConfusionMatrix([]);
    expect(result).toEqual([]);
  });

  it("counts single misclassified pair correctly", () => {
    const rows = [
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "check_in", actualIntent: "check_out" },
    ];
    const result = buildConfusionMatrix(rows, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ predictedIntent: "check_in", actualIntent: "check_out", count: 3 });
  });

  it("returns top N pairs sorted by count descending", () => {
    const rows = [
      { predictedIntent: "booking_inquiry", actualIntent: "pricing" },
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "greeting", actualIntent: "booking_inquiry" },
      { predictedIntent: "greeting", actualIntent: "booking_inquiry" },
    ];
    const result = buildConfusionMatrix(rows, 2);
    expect(result).toHaveLength(2);
    expect(result[0].count).toBeGreaterThanOrEqual(result[1].count);
    expect(result[0]).toMatchObject({ predictedIntent: "check_in", actualIntent: "check_out", count: 3 });
    expect(result[1]).toMatchObject({ predictedIntent: "greeting", actualIntent: "booking_inquiry", count: 2 });
  });

  it("handles multiple distinct predicted intents", () => {
    const rows = [
      { predictedIntent: "A", actualIntent: "B" },
      { predictedIntent: "A", actualIntent: "C" },
      { predictedIntent: "B", actualIntent: "A" },
      { predictedIntent: "B", actualIntent: "A" },
      { predictedIntent: "C", actualIntent: "A" },
    ];
    const result = buildConfusionMatrix(rows, 10);
    expect(result).toHaveLength(4); // A->B, A->C, B->A(x2), C->A
    const bToA = result.find((r) => r.predictedIntent === "B" && r.actualIntent === "A");
    expect(bToA?.count).toBe(2);
  });

  it("correctly limits results to topN", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      predictedIntent: `intent_${i}`,
      actualIntent: `other_${i}`,
    }));
    const result = buildConfusionMatrix(rows, 5);
    expect(result).toHaveLength(5);
  });
});

// ── calculateAccuracy ─────────────────────────────────────────────────

describe("calculateAccuracy", () => {
  it("returns 0 for zero evaluated messages", () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
  });

  it("returns 100 for zero misclassifications", () => {
    expect(calculateAccuracy(100, 0)).toBe(100);
  });

  it("returns 0 for all misclassified", () => {
    expect(calculateAccuracy(100, 100)).toBe(0);
  });

  it("calculates 95% accuracy correctly", () => {
    expect(calculateAccuracy(100, 5)).toBe(95);
  });

  it("calculates 80% accuracy correctly", () => {
    expect(calculateAccuracy(50, 10)).toBe(80);
  });

  it("rounds to 2 decimal places", () => {
    // 2/3 correct → 66.67%
    expect(calculateAccuracy(3, 1)).toBe(66.67);
  });
});

// ── 95% Accuracy Detection ────────────────────────────────────────────

describe("confusion matrix correctly identifies test dataset with 95% accuracy", () => {
  /**
   * AC3: Unit test asserting confusion matrix correctly identifies test dataset
   * intent pairs with 95% accuracy.
   *
   * Strategy: Build a dataset of 100 messages where 95 are correctly classified
   * (not included in misclassified rows) and 5 are misclassified. The confusion
   * matrix should correctly identify all 5 misclassified pairs.
   */
  it("detects all misclassified pairs in a 95%-accurate dataset", () => {
    // 5 misclassified out of 100 total evaluated → 95% accuracy
    const misclassifiedRows = [
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "check_in", actualIntent: "check_out" },
      { predictedIntent: "booking_inquiry", actualIntent: "pricing" },
      { predictedIntent: "greeting", actualIntent: "booking_inquiry" },
      { predictedIntent: "amenities", actualIntent: "wifi_password" },
    ];

    const totalEvaluated = 100;
    const accuracy = calculateAccuracy(totalEvaluated, misclassifiedRows.length);

    // AC3: 95% accuracy threshold met
    expect(accuracy).toBeGreaterThanOrEqual(95);

    const topPairs = buildConfusionMatrix(misclassifiedRows, 5);

    // All 3 distinct pairs captured
    expect(topPairs.length).toBeGreaterThanOrEqual(3);

    // Top pair is check_in → check_out (count=2)
    expect(topPairs[0]).toMatchObject({
      predictedIntent: "check_in",
      actualIntent: "check_out",
      count: 2,
    });

    // All misclassified pair combinations accounted for
    const totalInMatrix = topPairs.reduce((sum, p) => sum + p.count, 0);
    expect(totalInMatrix).toBe(misclassifiedRows.length);
  });

  it("reports accuracy of 95% correctly", () => {
    const accuracy = calculateAccuracy(200, 10); // 190/200 = 95%
    expect(accuracy).toBe(95);
    expect(accuracy).toBeGreaterThanOrEqual(95);
  });
});

// ── formatAsCSV ───────────────────────────────────────────────────────

describe("formatAsCSV", () => {
  const sampleResult: ConfusionMatrixResult = {
    profile: "pelangi",
    days: 7,
    totalEvaluated: 100,
    totalMisclassified: 5,
    overallAccuracy: 95,
    topPairs: [
      { predictedIntent: "check_in", actualIntent: "check_out", count: 3, percentage: 60 },
      { predictedIntent: "greeting", actualIntent: "booking_inquiry", count: 2, percentage: 40 },
    ],
  };

  it("includes CSV header row", () => {
    const csv = formatAsCSV(sampleResult);
    expect(csv).toContain("predicted_intent,actual_intent,count,percentage");
  });

  it("includes summary comments", () => {
    const csv = formatAsCSV(sampleResult);
    expect(csv).toContain("profile=pelangi");
    expect(csv).toContain("days=7");
    expect(csv).toContain("95%");
  });

  it("formats each pair as a CSV row", () => {
    const csv = formatAsCSV(sampleResult);
    expect(csv).toContain("check_in,check_out,3,60");
    expect(csv).toContain("greeting,booking_inquiry,2,40");
  });

  it("handles empty topPairs gracefully", () => {
    const empty: ConfusionMatrixResult = { ...sampleResult, topPairs: [] };
    const csv = formatAsCSV(empty);
    expect(csv).toContain("predicted_intent,actual_intent,count,percentage");
    // No data rows after header
    const lines = csv.split("\n").filter((l) => !l.startsWith("#") && l.trim());
    expect(lines).toHaveLength(1); // only header
  });
});
