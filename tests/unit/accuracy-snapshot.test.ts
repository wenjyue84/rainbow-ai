/**
 * Tests for US-265: Intent Classification Accuracy Regression Detector
 *
 * Covers:
 * - Per-profile accuracy calculation from prediction rows
 * - 30-day rolling baseline computation
 * - Regression detection when accuracy drops >5% from baseline
 * - Alert message formatting
 * - Full orchestrator flow with injected adapter
 */

import { describe, it, expect, vi } from "vitest";
import {
  calculatePerProfileAccuracy,
  computeRollingBaseline,
  detectRegressions,
  formatAlertMessage,
  runAccuracySnapshot,
  type PredictionRow,
  type SnapshotRow,
  type AccuracySnapshot,
  type RegressionAlert,
  type AccuracySnapshotDbAdapter,
} from "../../src/assistant/jobs/accuracy-snapshot.js";

const TODAY = new Date("2026-03-23T00:00:00.000Z");

describe("Intent Accuracy Snapshot (US-265)", () => {
  // ─── AC1: Daily cron job calculates accuracy per profile ────────────

  describe("calculatePerProfileAccuracy", () => {
    it("should calculate accuracy per profile from prediction rows", () => {
      const predictions: PredictionRow[] = [
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: false },
        { profile: "pelangi", wasCorrect: true },
        { profile: "southern", wasCorrect: true },
        { profile: "southern", wasCorrect: false },
      ];

      const snapshots = calculatePerProfileAccuracy(predictions, TODAY);

      expect(snapshots).toHaveLength(2);

      const pelangi = snapshots.find((s) => s.profile === "pelangi")!;
      expect(pelangi).toBeDefined();
      expect(pelangi.accuracy).toBeCloseTo(75, 1); // 3/4 = 75%
      expect(pelangi.sampleCount).toBe(4);
      expect(pelangi.date).toEqual(TODAY);

      const southern = snapshots.find((s) => s.profile === "southern")!;
      expect(southern).toBeDefined();
      expect(southern.accuracy).toBeCloseTo(50, 1); // 1/2 = 50%
      expect(southern.sampleCount).toBe(2);
    });

    it("should return 100% when all predictions correct", () => {
      const predictions: PredictionRow[] = [
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
      ];

      const snapshots = calculatePerProfileAccuracy(predictions, TODAY);
      expect(snapshots[0]!.accuracy).toBe(100);
    });

    it("should return 0% when all predictions incorrect", () => {
      const predictions: PredictionRow[] = [
        { profile: "pelangi", wasCorrect: false },
        { profile: "pelangi", wasCorrect: false },
      ];

      const snapshots = calculatePerProfileAccuracy(predictions, TODAY);
      expect(snapshots[0]!.accuracy).toBe(0);
    });

    it("should return empty array for empty predictions", () => {
      const snapshots = calculatePerProfileAccuracy([], TODAY);
      expect(snapshots).toHaveLength(0);
    });

    it("should isolate profiles (pelangi accuracy independent from southern)", () => {
      // Pelangi: 9/10 correct = 90%
      const pelangiPreds: PredictionRow[] = Array(9)
        .fill(null)
        .map(() => ({ profile: "pelangi", wasCorrect: true }))
        .concat([{ profile: "pelangi", wasCorrect: false }]);

      // Southern: 7/10 correct = 70%
      const southernPreds: PredictionRow[] = Array(7)
        .fill(null)
        .map(() => ({ profile: "southern", wasCorrect: true }))
        .concat(
          Array(3)
            .fill(null)
            .map(() => ({ profile: "southern", wasCorrect: false }))
        );

      const snapshots = calculatePerProfileAccuracy(
        [...pelangiPreds, ...southernPreds],
        TODAY
      );

      const pelangi = snapshots.find((s) => s.profile === "pelangi")!;
      const southern = snapshots.find((s) => s.profile === "southern")!;

      expect(pelangi.accuracy).toBeCloseTo(90, 1);
      expect(southern.accuracy).toBeCloseTo(70, 1);
      // Profiles are independent
      expect(pelangi.accuracy).not.toBe(southern.accuracy);
    });
  });

  // ─── AC1: 30-day rolling baseline ──────────────────────────────────

  describe("computeRollingBaseline", () => {
    it("should compute average of prior snapshots", () => {
      const priorSnapshots: SnapshotRow[] = [
        { profile: "pelangi", date: new Date("2026-03-22"), accuracy: 90 },
        { profile: "pelangi", date: new Date("2026-03-21"), accuracy: 85 },
        { profile: "pelangi", date: new Date("2026-03-20"), accuracy: 95 },
      ];

      const baseline = computeRollingBaseline(priorSnapshots);

      expect(baseline).toBeCloseTo(90, 1); // (90 + 85 + 95) / 3 = 90
    });

    it("should return null when no prior snapshots", () => {
      const baseline = computeRollingBaseline([]);
      expect(baseline).toBeNull();
    });

    it("should limit to windowDays most recent entries", () => {
      // 5 entries but window = 3
      const priorSnapshots: SnapshotRow[] = [
        { profile: "pelangi", date: new Date("2026-03-22"), accuracy: 80 },
        { profile: "pelangi", date: new Date("2026-03-21"), accuracy: 85 },
        { profile: "pelangi", date: new Date("2026-03-20"), accuracy: 90 },
        { profile: "pelangi", date: new Date("2026-03-19"), accuracy: 50 },
        { profile: "pelangi", date: new Date("2026-03-18"), accuracy: 40 },
      ];

      const baseline = computeRollingBaseline(priorSnapshots, 3);

      // Only takes most recent 3: 80, 85, 90
      expect(baseline).toBeCloseTo(85, 1);
    });

    it("should handle single snapshot", () => {
      const priorSnapshots: SnapshotRow[] = [
        { profile: "pelangi", date: new Date("2026-03-22"), accuracy: 88.5 },
      ];

      const baseline = computeRollingBaseline(priorSnapshots);
      expect(baseline).toBeCloseTo(88.5, 1);
    });
  });

  // ─── AC2: Alert when accuracy drops >5% from baseline ──────────────

  describe("detectRegressions", () => {
    it("should detect regression when accuracy drops >5% from baseline", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 80,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);

      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.profile).toBe("pelangi");
      expect(alerts[0]!.currentAccuracy).toBe(80);
      expect(alerts[0]!.baseline).toBe(90);
      expect(alerts[0]!.drop).toBeCloseTo(10, 1);
    });

    it("should NOT trigger for minor drops <= 5%", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 86,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);
      expect(alerts).toHaveLength(0);
    });

    it("should NOT trigger for improvements", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 95,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);
      expect(alerts).toHaveLength(0);
    });

    it("should skip snapshots with null baseline", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 60,
          baseline: null,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);
      expect(alerts).toHaveLength(0);
    });

    it("should detect regressions independently per profile", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 82,
          baseline: 90,
          sampleCount: 50,
        },
        {
          profile: "southern",
          date: TODAY,
          accuracy: 88,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);

      // Only pelangi should trigger (drop = 8pp > 5pp)
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.profile).toBe("pelangi");
    });

    it("should use custom threshold", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 87,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      // Default threshold 5% → no alert (drop = 3pp)
      expect(detectRegressions(snapshots, 5)).toHaveLength(0);

      // Custom threshold 2% → alert (drop = 3pp > 2pp)
      expect(detectRegressions(snapshots, 2)).toHaveLength(1);
    });

    it("should handle exactly 5% drop as NOT a regression", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 85,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);
      expect(alerts).toHaveLength(0);
    });

    it("should trigger alert when drop is 5.1%", () => {
      const snapshots: AccuracySnapshot[] = [
        {
          profile: "pelangi",
          date: TODAY,
          accuracy: 84.9,
          baseline: 90,
          sampleCount: 50,
        },
      ];

      const alerts = detectRegressions(snapshots);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.drop).toBeCloseTo(5.1, 1);
    });
  });

  describe("formatAlertMessage", () => {
    it("should produce a readable alert message", () => {
      const alert: RegressionAlert = {
        profile: "pelangi",
        date: TODAY,
        currentAccuracy: 80,
        baseline: 90,
        drop: 10,
      };

      const msg = formatAlertMessage(alert);

      expect(msg).toContain("REGRESSION");
      expect(msg).toContain("pelangi");
      expect(msg).toContain("80.0%");
      expect(msg).toContain("90.0%");
      expect(msg).toContain("10.0pp");
      expect(msg).toContain("2026-03-23");
    });
  });

  // ─── AC1+AC2: Full orchestrator with mock adapter ──────────────────

  describe("runAccuracySnapshot (orchestrator)", () => {
    function createMockAdapter(overrides: Partial<AccuracySnapshotDbAdapter> = {}): AccuracySnapshotDbAdapter {
      return {
        fetchPredictions: vi.fn().mockResolvedValue([]),
        fetchPriorSnapshots: vi.fn().mockResolvedValue([]),
        upsertSnapshot: vi.fn().mockResolvedValue(undefined),
        logAlert: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it("should calculate accuracy, compute baselines, store snapshots, and detect regressions", async () => {
      const predictions: PredictionRow[] = [
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: false },
        { profile: "pelangi", wasCorrect: true },
      ];

      const priorSnapshots: SnapshotRow[] = [
        { profile: "pelangi", date: new Date("2026-03-22"), accuracy: 90 },
        { profile: "pelangi", date: new Date("2026-03-21"), accuracy: 92 },
      ];

      const adapter = createMockAdapter({
        fetchPredictions: vi.fn().mockResolvedValue(predictions),
        fetchPriorSnapshots: vi.fn().mockResolvedValue(priorSnapshots),
      });

      const { snapshots, alerts } = await runAccuracySnapshot(adapter, TODAY);

      // Accuracy should be 75% (3/4)
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.profile).toBe("pelangi");
      expect(snapshots[0]!.accuracy).toBeCloseTo(75, 1);

      // Baseline should be average of prior: (90 + 92) / 2 = 91
      expect(snapshots[0]!.baseline).toBeCloseTo(91, 1);

      // Drop = 91 - 75 = 16pp > 5pp → regression alert
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.drop).toBeCloseTo(16, 1);

      // upsertSnapshot should have been called
      expect(adapter.upsertSnapshot).toHaveBeenCalledOnce();

      // logAlert should have been called for the regression
      expect(adapter.logAlert).toHaveBeenCalledOnce();
    });

    it("should handle no predictions gracefully", async () => {
      const adapter = createMockAdapter();

      const { snapshots, alerts } = await runAccuracySnapshot(adapter, TODAY);

      expect(snapshots).toHaveLength(0);
      expect(alerts).toHaveLength(0);
      expect(adapter.upsertSnapshot).not.toHaveBeenCalled();
      expect(adapter.logAlert).not.toHaveBeenCalled();
    });

    it("should handle new profile with no baseline (no alert triggered)", async () => {
      const predictions: PredictionRow[] = [
        { profile: "makan", wasCorrect: true },
        { profile: "makan", wasCorrect: false },
      ];

      const adapter = createMockAdapter({
        fetchPredictions: vi.fn().mockResolvedValue(predictions),
        fetchPriorSnapshots: vi.fn().mockResolvedValue([]), // no prior data
      });

      const { snapshots, alerts } = await runAccuracySnapshot(adapter, TODAY);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.baseline).toBeNull();
      expect(alerts).toHaveLength(0);

      // Snapshot should still be stored
      expect(adapter.upsertSnapshot).toHaveBeenCalledOnce();
    });

    it("should process multiple profiles independently", async () => {
      const predictions: PredictionRow[] = [
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },
        { profile: "pelangi", wasCorrect: true },  // 5/5 = 100%
        { profile: "southern", wasCorrect: true },
        { profile: "southern", wasCorrect: false },
        { profile: "southern", wasCorrect: false },
        { profile: "southern", wasCorrect: false },
        { profile: "southern", wasCorrect: false }, // 1/5 = 20%
      ];

      const adapter = createMockAdapter({
        fetchPredictions: vi.fn().mockResolvedValue(predictions),
        fetchPriorSnapshots: vi.fn().mockImplementation(async (profile: string) => {
          if (profile === "pelangi") {
            return [{ profile: "pelangi", date: new Date("2026-03-22"), accuracy: 95 }];
          }
          if (profile === "southern") {
            return [{ profile: "southern", date: new Date("2026-03-22"), accuracy: 85 }];
          }
          return [];
        }),
      });

      const { snapshots, alerts } = await runAccuracySnapshot(adapter, TODAY);

      expect(snapshots).toHaveLength(2);

      const pelangi = snapshots.find((s) => s.profile === "pelangi")!;
      const southern = snapshots.find((s) => s.profile === "southern")!;

      expect(pelangi.accuracy).toBe(100);
      expect(southern.accuracy).toBe(20);

      // Southern has regression: 85 - 20 = 65pp drop
      // Pelangi has improvement: 100 > 95
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.profile).toBe("southern");
    });
  });
});
