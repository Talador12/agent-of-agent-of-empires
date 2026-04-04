import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { analyzeCostOptimizations, formatCostOptimizer } from "./fleet-cost-optimizer.js";

describe("analyzeCostOptimizations", () => {
  it("recommends throttle for high-burn low-progress", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "expensive", costUsd: 20, burnRatePerHr: 10, progressPct: 20, idleMinutes: 0, status: "active" },
      { sessionTitle: "cheap", costUsd: 2, burnRatePerHr: 0.1, progressPct: 60, idleMinutes: 0, status: "active" },
      { sessionTitle: "cheap2", costUsd: 1, burnRatePerHr: 0.1, progressPct: 50, idleMinutes: 0, status: "active" },
    ]);
    assert.ok(r.recommendations.some((rec) => rec.sessionTitle === "expensive" && rec.action === "throttle"));
  });
  it("recommends pause for idle sessions", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "idle", costUsd: 5, burnRatePerHr: 2, progressPct: 40, idleMinutes: 30, status: "active" },
    ]);
    assert.ok(r.recommendations.some((rec) => rec.action === "pause"));
  });
  it("recommends complete-soon for near-done sessions", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "almost", costUsd: 15, burnRatePerHr: 3, progressPct: 90, idleMinutes: 0, status: "active" },
      { sessionTitle: "other", costUsd: 2, burnRatePerHr: 0.5, progressPct: 10, idleMinutes: 0, status: "active" },
    ]);
    assert.ok(r.recommendations.some((rec) => rec.action === "complete-soon"));
  });
  it("returns empty for efficient fleet", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "a", costUsd: 3, burnRatePerHr: 1, progressPct: 50, idleMinutes: 0, status: "active" },
    ]);
    // single session, avg burn = its own burn, so no throttle
    assert.equal(r.recommendations.filter((rec) => rec.action === "throttle").length, 0);
  });
  it("computes potential savings", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "idle", costUsd: 10, burnRatePerHr: 3, progressPct: 40, idleMinutes: 60, status: "active" },
    ]);
    assert.ok(r.potentialSavingsUsd > 0);
  });
  it("skips non-active sessions", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "done", costUsd: 50, burnRatePerHr: 10, progressPct: 100, idleMinutes: 0, status: "completed" },
    ]);
    assert.equal(r.recommendations.length, 0);
  });
  it("sorts by priority", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "expensive", costUsd: 20, burnRatePerHr: 8, progressPct: 10, idleMinutes: 45, status: "active" },
      { sessionTitle: "cheap", costUsd: 1, burnRatePerHr: 0.1, progressPct: 90, idleMinutes: 0, status: "active" },
    ]);
    if (r.recommendations.length >= 2) {
      const prio = { high: 0, medium: 1, low: 2 };
      assert.ok(prio[r.recommendations[0].priority] <= prio[r.recommendations[1].priority]);
    }
  });
});

describe("formatCostOptimizer", () => {
  it("shows efficient message when no recommendations", () => {
    const r = analyzeCostOptimizations([]);
    const lines = formatCostOptimizer(r);
    assert.ok(lines.some((l) => l.includes("efficient")));
  });
  it("shows recommendations", () => {
    const r = analyzeCostOptimizations([
      { sessionTitle: "idle", costUsd: 10, burnRatePerHr: 3, progressPct: 40, idleMinutes: 30, status: "active" },
    ]);
    const lines = formatCostOptimizer(r);
    assert.ok(lines[0].includes("Cost Optimizer"));
  });
});
