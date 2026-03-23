/**
 * Tests for intent classifier baseline accuracy tracking (US-098).
 *
 * Covers:
 * - Accuracy calculation on 100-message test set with ground-truth labels
 * - Per-profile isolation (Pelangi accuracy independent from Southern)
 * - Delta reporting and degradation detection
 */

import { describe, it, expect } from "vitest";
import {
  calculateAccuracy,
  generateDeltaReport,
  checkProfileIsolation,
  type IntentPredictionRecord,
  type BaselineAccuracy,
} from "../../src/lib/analytics/classifier-accuracy.js";

describe("Intent Classifier Baseline (US-098)", () => {
  describe("Accuracy Calculation", () => {
    it("should calculate accuracy correctly for a single profile/intent combo", () => {
      const predictions: IntentPredictionRecord[] = [
        { profileId: "pelangi", intentType: "booking", wasCorrect: true },
        { profileId: "pelangi", intentType: "booking", wasCorrect: true },
        { profileId: "pelangi", intentType: "booking", wasCorrect: false },
        { profileId: "pelangi", intentType: "booking", wasCorrect: true },
      ];

      const results = calculateAccuracy(predictions);

      expect(results).toHaveLength(1);
      expect(results[0]!.profileId).toBe("pelangi");
      expect(results[0]!.intentType).toBe("booking");
      expect(results[0]!.totalCount).toBe(4);
      expect(results[0]!.correctCount).toBe(3);
      expect(results[0]!.accuracyPct).toBeCloseTo(75, 1);
    });

    it("should calculate 100% accuracy when all predictions are correct", () => {
      const predictions: IntentPredictionRecord[] = [
        { profileId: "pelangi", intentType: "greeting", wasCorrect: true },
        { profileId: "pelangi", intentType: "greeting", wasCorrect: true },
        { profileId: "pelangi", intentType: "greeting", wasCorrect: true },
      ];

      const results = calculateAccuracy(predictions);

      expect(results[0]!.accuracyPct).toBe(100);
    });

    it("should calculate 0% accuracy when all predictions are wrong", () => {
      const predictions: IntentPredictionRecord[] = [
        { profileId: "pelangi", intentType: "booking", wasCorrect: false },
        { profileId: "pelangi", intentType: "booking", wasCorrect: false },
      ];

      const results = calculateAccuracy(predictions);

      expect(results[0]!.accuracyPct).toBe(0);
    });

    it("should handle 100-message test set correctly (50 per profile)", () => {
      // Pelangi: 47/50 correct = 94%
      const pelangiPredictions = Array(47)
        .fill(null)
        .map(() => ({
          profileId: "pelangi",
          intentType: "booking",
          wasCorrect: true,
        }))
        .concat(
          Array(3)
            .fill(null)
            .map(() => ({
              profileId: "pelangi",
              intentType: "booking",
              wasCorrect: false,
            }))
        );

      // Southern: 45/50 correct = 90%
      const southernPredictions = Array(45)
        .fill(null)
        .map(() => ({
          profileId: "southern",
          intentType: "booking",
          wasCorrect: true,
        }))
        .concat(
          Array(5)
            .fill(null)
            .map(() => ({
              profileId: "southern",
              intentType: "booking",
              wasCorrect: false,
            }))
        );

      const allPredictions = [
        ...pelangiPredictions,
        ...southernPredictions,
      ] as IntentPredictionRecord[];

      const results = calculateAccuracy(allPredictions);

      expect(results).toHaveLength(2);

      const pelangi = results.find(
        (r) => r.profileId === "pelangi" && r.intentType === "booking"
      )!;
      const southern = results.find(
        (r) => r.profileId === "southern" && r.intentType === "booking"
      )!;

      expect(pelangi.accuracyPct).toBeCloseTo(94, 1);
      expect(southern.accuracyPct).toBeCloseTo(90, 1);
      expect(pelangi.totalCount).toBe(50);
      expect(southern.totalCount).toBe(50);
    });
  });

  describe("Per-Profile Isolation", () => {
    it("should isolate Pelangi accuracy independent from Southern", () => {
      // Pelangi: 92.67% (47/50)
      const pelangiCorrect = Array(47)
        .fill({ profileId: "pelangi", intentType: "booking", wasCorrect: true })
        .concat(Array(3).fill({ profileId: "pelangi", intentType: "booking", wasCorrect: false }));

      // Southern: 90% (45/50)
      const southernCorrect = Array(45)
        .fill({ profileId: "southern", intentType: "booking", wasCorrect: true })
        .concat(Array(5).fill({ profileId: "southern", intentType: "booking", wasCorrect: false }));

      const allPredictions = [...pelangiCorrect, ...southernCorrect] as IntentPredictionRecord[];

      const results = calculateAccuracy(allPredictions);

      const pelangiAccuracy = results.find(
        (r) => r.profileId === "pelangi"
      )!.accuracyPct;
      const southernAccuracy = results.find(
        (r) => r.profileId === "southern"
      )!.accuracyPct;

      // Pelangi should be higher than Southern
      expect(pelangiAccuracy).toBeGreaterThan(southernAccuracy);
      expect(pelangiAccuracy).toBeCloseTo(94, 1);
      expect(southernAccuracy).toBeCloseTo(90, 1);
    });

    it("should not cross-contaminate profile data", () => {
      const predictions: IntentPredictionRecord[] = [
        { profileId: "pelangi", intentType: "booking", wasCorrect: true },
        { profileId: "pelangi", intentType: "checkin", wasCorrect: true },
        { profileId: "southern", intentType: "booking", wasCorrect: false },
        { profileId: "southern", intentType: "greeting", wasCorrect: true },
      ];

      const results = calculateAccuracy(predictions);

      expect(results).toHaveLength(4);

      const pelangiResults = results.filter((r) => r.profileId === "pelangi");
      const southernResults = results.filter((r) => r.profileId === "southern");

      expect(pelangiResults).toHaveLength(2);
      expect(southernResults).toHaveLength(2);

      expect(pelangiResults.map((r) => r.intentType)).toContain("booking");
      expect(pelangiResults.map((r) => r.intentType)).toContain("checkin");
      expect(southernResults.map((r) => r.intentType)).toContain("booking");
      expect(southernResults.map((r) => r.intentType)).toContain("greeting");
    });
  });

  describe("Delta Reporting", () => {
    it("should detect accuracy degradation > 5%", () => {
      const current = [
        {
          profileId: "pelangi",
          intentType: "booking",
          totalCount: 50,
          correctCount: 42,
          accuracyPct: 84,
        },
      ];

      const baselines: BaselineAccuracy[] = [
        {
          profileId: "pelangi",
          intentType: "booking",
          accuracyPct: 90,
          sampleCount: 100,
          baselineDate: new Date(),
        },
      ];

      const deltas = generateDeltaReport(current as any, baselines);

      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.status).toBe("degraded");
      expect(deltas[0]!.delta).toBe(-6);
    });

    it("should detect accuracy improvement > 5%", () => {
      const current = [
        {
          profileId: "pelangi",
          intentType: "booking",
          totalCount: 50,
          correctCount: 48,
          accuracyPct: 96,
        },
      ];

      const baselines: BaselineAccuracy[] = [
        {
          profileId: "pelangi",
          intentType: "booking",
          accuracyPct: 90,
          sampleCount: 100,
          baselineDate: new Date(),
        },
      ];

      const deltas = generateDeltaReport(current as any, baselines);

      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.status).toBe("improved");
      expect(deltas[0]!.delta).toBeCloseTo(6, 1);
    });

    it("should report pass status for minor changes", () => {
      const current = [
        {
          profileId: "pelangi",
          intentType: "booking",
          totalCount: 50,
          correctCount: 46,
          accuracyPct: 92,
        },
      ];

      const baselines: BaselineAccuracy[] = [
        {
          profileId: "pelangi",
          intentType: "booking",
          accuracyPct: 90,
          sampleCount: 100,
          baselineDate: new Date(),
        },
      ];

      const deltas = generateDeltaReport(current as any, baselines);

      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.status).toBe("pass");
      expect(deltas[0]!.delta).toBeCloseTo(2, 1);
    });

    it("should report new status for intents without baseline", () => {
      const current = [
        {
          profileId: "pelangi",
          intentType: "newfeature",
          totalCount: 20,
          correctCount: 18,
          accuracyPct: 90,
        },
      ];

      const baselines: BaselineAccuracy[] = [];

      const deltas = generateDeltaReport(current as any, baselines);

      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.status).toBe("new");
      expect(deltas[0]!.baselineAccuracy).toBe(0);
    });

    it("should apply custom degradation threshold", () => {
      const current = [
        {
          profileId: "pelangi",
          intentType: "booking",
          totalCount: 50,
          correctCount: 44,
          accuracyPct: 88,
        },
      ];

      const baselines: BaselineAccuracy[] = [
        {
          profileId: "pelangi",
          intentType: "booking",
          accuracyPct: 90,
          sampleCount: 100,
          baselineDate: new Date(),
        },
      ];

      const deltas = generateDeltaReport(current as any, baselines, -1);

      expect(deltas).toHaveLength(1);
      expect(deltas[0]!.status).toBe("degraded");
      expect(deltas[0]!.delta).toBeCloseTo(-2, 1);
    });
  });

  describe("Profile Isolation Check", () => {
    it("should confirm isolation when all records have profileId", () => {
      const predictions: IntentPredictionRecord[] = [
        { profileId: "pelangi", intentType: "booking", wasCorrect: true },
        { profileId: "southern", intentType: "booking", wasCorrect: true },
      ];

      const result = checkProfileIsolation(predictions);

      expect(result.isolated).toBe(true);
      expect(result.profileCount).toBe(2);
      expect(result.profiles).toContain("pelangi");
      expect(result.profiles).toContain("southern");
    });

    it("should fail isolation check if any record lacks profileId", () => {
      const predictions = [
        { profileId: "pelangi", intentType: "booking", wasCorrect: true },
        { profileId: "", intentType: "booking", wasCorrect: true },
      ] as IntentPredictionRecord[];

      const result = checkProfileIsolation(predictions);

      expect(result.isolated).toBe(false);
    });
  });
});
