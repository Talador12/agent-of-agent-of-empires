import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { recommendScaling, formatScalingRecommendation } from "./predictive-scaling.js";

describe("recommendScaling", () => {
  it("recommends scale-up when highly utilized with pending tasks", () => {
    const rec = recommendScaling({ currentPoolSize: 5, activeSessions: 5, pendingTasks: 3, recentUtilizationPct: 90, peakUtilizationPct: 100, averageTaskDurationMs: 3_600_000 });
    assert.equal(rec.action, "scale-up");
    assert.ok(rec.recommendedPoolSize > 5);
  });

  it("recommends scale-down when underutilized", () => {
    const rec = recommendScaling({ currentPoolSize: 10, activeSessions: 2, pendingTasks: 0, recentUtilizationPct: 15, peakUtilizationPct: 30, averageTaskDurationMs: 3_600_000 });
    assert.equal(rec.action, "scale-down");
    assert.ok(rec.recommendedPoolSize < 10);
  });

  it("recommends maintain for normal utilization", () => {
    const rec = recommendScaling({ currentPoolSize: 5, activeSessions: 3, pendingTasks: 0, recentUtilizationPct: 60, peakUtilizationPct: 70, averageTaskDurationMs: 3_600_000 });
    assert.equal(rec.action, "maintain");
    assert.equal(rec.recommendedPoolSize, 5);
  });

  it("scale-up on saturated pool with pending", () => {
    const rec = recommendScaling({ currentPoolSize: 3, activeSessions: 3, pendingTasks: 5, recentUtilizationPct: 70, peakUtilizationPct: 100, averageTaskDurationMs: 1_800_000 });
    assert.equal(rec.action, "scale-up");
  });

  it("never scales below 2", () => {
    const rec = recommendScaling({ currentPoolSize: 5, activeSessions: 0, pendingTasks: 0, recentUtilizationPct: 0, peakUtilizationPct: 0, averageTaskDurationMs: 0 });
    assert.ok(rec.recommendedPoolSize >= 2);
  });
});

describe("formatScalingRecommendation", () => {
  it("shows action and reason", () => {
    const rec = recommendScaling({ currentPoolSize: 5, activeSessions: 5, pendingTasks: 3, recentUtilizationPct: 90, peakUtilizationPct: 100, averageTaskDurationMs: 3_600_000 });
    const lines = formatScalingRecommendation(rec);
    assert.ok(lines[0].includes("scale-up"));
    assert.ok(lines[1].includes("pending"));
  });
});
