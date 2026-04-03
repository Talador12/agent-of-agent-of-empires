import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeHealthScore, formatHealthScore } from "./daemon-health-score.js";

const HEALTHY: Parameters<typeof computeHealthScore>[0] = {
  watchdogStalled: false, slaHealthPct: 95, errorRatePct: 2,
  cacheHitRatePct: 80, avgSessionHealthPct: 85, stallCount: 0,
  unresolvedIncidents: 0, complianceViolations: 0,
};

describe("computeHealthScore", () => {
  it("returns high score for healthy daemon", () => {
    const r = computeHealthScore(HEALTHY);
    assert.ok(r.overallScore >= 85);
    assert.equal(r.grade, "A");
  });

  it("returns low score when watchdog stalled", () => {
    const r = computeHealthScore({ ...HEALTHY, watchdogStalled: true });
    assert.ok(r.overallScore < HEALTHY.slaHealthPct);
    const wd = r.components.find((c) => c.name === "watchdog");
    assert.equal(wd!.score, 0);
  });

  it("degrades on high error rate", () => {
    const r = computeHealthScore({ ...HEALTHY, errorRatePct: 50 });
    assert.ok(r.overallScore < 85);
  });

  it("degrades on low SLA health", () => {
    const r = computeHealthScore({ ...HEALTHY, slaHealthPct: 30 });
    const healthy = computeHealthScore(HEALTHY);
    assert.ok(r.overallScore < healthy.overallScore);
  });

  it("degrades on unresolved incidents", () => {
    const r = computeHealthScore({ ...HEALTHY, unresolvedIncidents: 5 });
    const inc = r.components.find((c) => c.name === "incidents");
    assert.ok(inc!.score < 100);
  });

  it("degrades on compliance violations", () => {
    const r = computeHealthScore({ ...HEALTHY, complianceViolations: 3 });
    const comp = r.components.find((c) => c.name === "compliance");
    assert.ok(comp!.score < 100);
  });

  it("assigns correct grades", () => {
    assert.equal(computeHealthScore(HEALTHY).grade, "A");
    const degraded = computeHealthScore({ ...HEALTHY, slaHealthPct: 50, errorRatePct: 20 });
    assert.ok(["B", "C"].includes(degraded.grade)); // moderate degradation
    const bad = computeHealthScore({ ...HEALTHY, watchdogStalled: true, slaHealthPct: 20, errorRatePct: 80, avgSessionHealthPct: 10 });
    assert.ok(["D", "F"].includes(bad.grade));
  });

  it("has 7 components", () => {
    assert.equal(computeHealthScore(HEALTHY).components.length, 7);
  });

  it("scores between 0 and 100", () => {
    const worst = computeHealthScore({
      watchdogStalled: true, slaHealthPct: 0, errorRatePct: 100,
      cacheHitRatePct: 0, avgSessionHealthPct: 0, stallCount: 50,
      unresolvedIncidents: 10, complianceViolations: 10,
    });
    assert.ok(worst.overallScore >= 0);
    assert.ok(worst.overallScore <= 100);
  });
});

describe("formatHealthScore", () => {
  it("shows grade and score", () => {
    const r = computeHealthScore(HEALTHY);
    const lines = formatHealthScore(r);
    assert.ok(lines[0].includes("Grade A"));
    assert.ok(lines[0].includes("/100"));
  });

  it("shows component bars", () => {
    const r = computeHealthScore(HEALTHY);
    const lines = formatHealthScore(r);
    assert.ok(lines.some((l) => l.includes("watchdog")));
    assert.ok(lines.some((l) => l.includes("█")));
  });
});
