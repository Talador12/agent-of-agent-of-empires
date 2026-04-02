import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeStats, zScore, detectAnomalies, formatAnomalies } from "./anomaly-detector.js";
import type { SessionMetrics } from "./anomaly-detector.js";

describe("computeStats", () => {
  it("handles empty array", () => {
    const s = computeStats([]);
    assert.equal(s.mean, 0);
    assert.equal(s.stdDev, 0);
  });
  it("handles single value", () => {
    const s = computeStats([5]);
    assert.equal(s.mean, 5);
    assert.equal(s.stdDev, 0);
  });
  it("computes correct mean and stddev", () => {
    const s = computeStats([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.equal(s.mean, 5);
    assert.ok(Math.abs(s.stdDev - 2) < 0.1);
  });
});

describe("zScore", () => {
  it("returns 0 for mean value", () => { assert.equal(zScore(5, 5, 2), 0); });
  it("returns 0 for zero stddev", () => { assert.equal(zScore(10, 5, 0), 0); });
  it("returns 1 for one stddev above", () => { assert.equal(zScore(7, 5, 2), 1); });
  it("returns -1 for one stddev below", () => { assert.equal(zScore(3, 5, 2), -1); });
});

describe("detectAnomalies", () => {
  function makeMetrics(title: string, overrides: Partial<SessionMetrics> = {}): SessionMetrics {
    return { sessionTitle: title, costRatePerHour: 1, activityEventsPerHour: 10, errorCount: 0, idleDurationMs: 60_000, ...overrides };
  }

  it("returns empty for fewer than 3 sessions", () => {
    const sessions = [makeMetrics("a"), makeMetrics("b")];
    assert.deepEqual(detectAnomalies(sessions), []);
  });

  it("detects high cost outlier", () => {
    const sessions = [
      makeMetrics("normal1", { costRatePerHour: 1 }),
      makeMetrics("normal2", { costRatePerHour: 1.2 }),
      makeMetrics("normal3", { costRatePerHour: 0.8 }),
      makeMetrics("normal4", { costRatePerHour: 1.1 }),
      makeMetrics("normal5", { costRatePerHour: 0.9 }),
      makeMetrics("expensive", { costRatePerHour: 50 }),
    ];
    const anomalies = detectAnomalies(sessions);
    assert.ok(anomalies.some((a) => a.sessionTitle === "expensive" && a.metric === "cost_rate"));
  });

  it("detects high error count", () => {
    const sessions = [
      makeMetrics("ok1", { errorCount: 0 }),
      makeMetrics("ok2", { errorCount: 1 }),
      makeMetrics("ok3", { errorCount: 0 }),
      makeMetrics("ok4", { errorCount: 1 }),
      makeMetrics("ok5", { errorCount: 0 }),
      makeMetrics("broken", { errorCount: 50 }),
    ];
    const anomalies = detectAnomalies(sessions);
    assert.ok(anomalies.some((a) => a.sessionTitle === "broken" && a.metric === "error_rate"));
  });

  it("returns empty when all sessions are similar", () => {
    const sessions = [makeMetrics("a"), makeMetrics("b"), makeMetrics("c")];
    assert.equal(detectAnomalies(sessions).length, 0);
  });

  it("respects custom threshold", () => {
    const sessions = [
      makeMetrics("a", { costRatePerHour: 1 }),
      makeMetrics("b", { costRatePerHour: 1 }),
      makeMetrics("c", { costRatePerHour: 1 }),
      makeMetrics("d", { costRatePerHour: 3 }),
    ];
    const strict = detectAnomalies(sessions, 1.0);
    const loose = detectAnomalies(sessions, 5.0);
    assert.ok(strict.length >= loose.length);
  });
});

describe("formatAnomalies", () => {
  it("shows clean message when none", () => {
    const lines = formatAnomalies([]);
    assert.ok(lines[0].includes("no anomalies"));
  });
  it("shows anomaly details", () => {
    const signals = [{
      sessionTitle: "hot", metric: "cost_rate" as const, value: 50, fleetMean: 1, fleetStdDev: 1, zScore: 49, anomalous: true, detail: "cost_rate: 50.00 is 49.0σ above fleet mean (1.00)",
    }];
    const lines = formatAnomalies(signals);
    assert.ok(lines.some((l) => l.includes("hot")));
    assert.ok(lines.some((l) => l.includes("49.0σ")));
  });
});
