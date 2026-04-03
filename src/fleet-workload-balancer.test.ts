import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeLoadScore, analyzeBalance, formatBalanceReport } from "./fleet-workload-balancer.js";
import type { SessionLoad } from "./fleet-workload-balancer.js";

function makeSession(overrides: Partial<SessionLoad> = {}): SessionLoad {
  return { sessionTitle: "alpha", activeTasks: 2, burnRatePerHr: 1.0, healthScore: 80, repo: "github/app", ...overrides };
}

describe("computeLoadScore", () => {
  it("scores higher for more tasks", () => {
    const heavy = computeLoadScore(makeSession({ activeTasks: 5 }));
    const light = computeLoadScore(makeSession({ activeTasks: 1 }));
    assert.ok(heavy > light);
  });

  it("scores higher for higher burn rate", () => {
    const expensive = computeLoadScore(makeSession({ burnRatePerHr: 5.0 }));
    const cheap = computeLoadScore(makeSession({ burnRatePerHr: 0.5 }));
    assert.ok(expensive > cheap);
  });

  it("scores higher for lower health", () => {
    const unhealthy = computeLoadScore(makeSession({ healthScore: 20 }));
    const healthy = computeLoadScore(makeSession({ healthScore: 90 }));
    assert.ok(unhealthy > healthy);
  });
});

describe("analyzeBalance", () => {
  it("reports balanced for similar loads", () => {
    const sessions = [
      makeSession({ sessionTitle: "a", activeTasks: 2 }),
      makeSession({ sessionTitle: "b", activeTasks: 2 }),
    ];
    const report = analyzeBalance(sessions);
    assert.ok(report.balanced);
  });

  it("detects imbalanced fleet", () => {
    const sessions = [
      makeSession({ sessionTitle: "heavy", activeTasks: 10, burnRatePerHr: 5 }),
      makeSession({ sessionTitle: "light", activeTasks: 1, burnRatePerHr: 0.1 }),
    ];
    const report = analyzeBalance(sessions, 50);
    assert.ok(!report.balanced);
    assert.ok(report.recommendations.length > 0);
  });

  it("classifies sessions as overloaded/underloaded", () => {
    const sessions = [
      makeSession({ sessionTitle: "heavy", activeTasks: 8 }),
      makeSession({ sessionTitle: "light", activeTasks: 1 }),
    ];
    const report = analyzeBalance(sessions, 50);
    assert.ok(report.sessionLoads.some((s) => s.classification === "overloaded"));
    assert.ok(report.sessionLoads.some((s) => s.classification === "underloaded"));
  });

  it("suggests move recommendations", () => {
    const sessions = [
      makeSession({ sessionTitle: "heavy", activeTasks: 8 }),
      makeSession({ sessionTitle: "light", activeTasks: 1 }),
    ];
    const report = analyzeBalance(sessions, 50);
    assert.ok(report.recommendations.some((r) => r.action === "move"));
  });

  it("handles single session", () => {
    const report = analyzeBalance([makeSession()]);
    assert.ok(report.balanced);
    assert.equal(report.recommendations.length, 0);
  });

  it("handles empty input", () => {
    const report = analyzeBalance([]);
    assert.ok(report.balanced);
  });

  it("sorts by load score descending", () => {
    const sessions = [
      makeSession({ sessionTitle: "light", activeTasks: 1 }),
      makeSession({ sessionTitle: "heavy", activeTasks: 5 }),
    ];
    const report = analyzeBalance(sessions);
    assert.equal(report.sessionLoads[0].sessionTitle, "heavy");
  });
});

describe("formatBalanceReport", () => {
  it("shows balanced status", () => {
    const report = analyzeBalance([makeSession({ sessionTitle: "a" }), makeSession({ sessionTitle: "b" })]);
    const lines = formatBalanceReport(report);
    assert.ok(lines[0].includes("BALANCED"));
  });

  it("shows imbalanced with recommendations", () => {
    const sessions = [
      makeSession({ sessionTitle: "heavy", activeTasks: 8 }),
      makeSession({ sessionTitle: "light", activeTasks: 1 }),
    ];
    const report = analyzeBalance(sessions, 50);
    const lines = formatBalanceReport(report);
    assert.ok(lines[0].includes("IMBALANCED"));
    assert.ok(lines.some((l) => l.includes("Recommendation")));
  });
});
