import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { FleetCostRegression, formatCostRegression } from "./fleet-cost-regression.js";

describe("FleetCostRegression", () => {
  it("starts with no tracked sessions", () => {
    const d = new FleetCostRegression();
    assert.equal(d.trackedSessions(), 0);
  });

  it("records samples and computes baseline", () => {
    const d = new FleetCostRegression();
    d.record("alpha", 2.0);
    d.record("alpha", 2.5);
    d.record("alpha", 3.0);
    const base = d.baseline("alpha");
    assert.ok(base !== null);
    assert.ok(Math.abs(base! - 2.5) < 0.01);
  });

  it("returns null baseline with < 3 samples", () => {
    const d = new FleetCostRegression();
    d.record("alpha", 2.0);
    d.record("alpha", 2.5);
    assert.equal(d.baseline("alpha"), null);
  });

  it("detects cost regression above warning threshold", () => {
    const d = new FleetCostRegression(30, 50, 100);
    for (let i = 0; i < 10; i++) d.record("alpha", 2.0);
    const alerts = d.detect(new Map([["alpha", 4.0]])); // 100% above baseline
    assert.ok(alerts.length > 0);
    assert.equal(alerts[0].severity, "critical"); // 100% ≥ critical threshold
  });

  it("no alert when within baseline", () => {
    const d = new FleetCostRegression(30, 50, 100);
    for (let i = 0; i < 10; i++) d.record("alpha", 2.0);
    const alerts = d.detect(new Map([["alpha", 2.2]])); // 10% above
    assert.equal(alerts.length, 0);
  });

  it("differentiates warning vs critical", () => {
    const d = new FleetCostRegression(30, 50, 100);
    for (let i = 0; i < 10; i++) d.record("alpha", 2.0);
    const warns = d.detect(new Map([["alpha", 3.2]])); // 60% above
    assert.equal(warns[0].severity, "warning");

    const crits = d.detect(new Map([["alpha", 5.0]])); // 150% above
    assert.equal(crits[0].severity, "critical");
  });

  it("sorts by deviation descending", () => {
    const d = new FleetCostRegression(30, 50, 100);
    for (let i = 0; i < 5; i++) { d.record("a", 2.0); d.record("b", 1.0); }
    const alerts = d.detect(new Map([["a", 4.0], ["b", 5.0]])); // b deviates more
    assert.ok(alerts.length >= 2);
    assert.ok(alerts[0].deviationPct >= alerts[1].deviationPct);
  });

  it("enforces max samples", () => {
    const d = new FleetCostRegression(5);
    for (let i = 0; i < 10; i++) d.record("a", i);
    assert.equal(d.sampleCount("a"), 5);
  });

  it("skips sessions with negligible baseline", () => {
    const d = new FleetCostRegression();
    for (let i = 0; i < 5; i++) d.record("a", 0.001);
    const alerts = d.detect(new Map([["a", 0.5]]));
    assert.equal(alerts.length, 0);
  });
});

describe("formatCostRegression", () => {
  it("shows within-baseline message when no alerts", () => {
    const d = new FleetCostRegression();
    const lines = formatCostRegression(d, new Map());
    assert.ok(lines.some((l) => l.includes("within")));
  });

  it("shows alert details", () => {
    const d = new FleetCostRegression(30, 50, 100);
    for (let i = 0; i < 5; i++) d.record("alpha", 2.0);
    const lines = formatCostRegression(d, new Map([["alpha", 5.0]]));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
