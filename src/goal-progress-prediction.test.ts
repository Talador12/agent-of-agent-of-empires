import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { GoalProgressPredictor, formatPredictions } from "./goal-progress-prediction.js";

describe("GoalProgressPredictor", () => {
  it("starts with no samples", () => {
    const p = new GoalProgressPredictor();
    assert.equal(p.sampleCount(), 0);
  });

  it("uses linear extrapolation with insufficient data", () => {
    const p = new GoalProgressPredictor();
    const r = p.predict({ sessionTitle: "a", goal: "build", currentProgressPct: 50, elapsedHours: 2, errorCount: 0 });
    assert.equal(r.method, "linear-extrapolation");
    assert.ok(r.predictedEtaHours > 0);
  });

  it("uses historical prediction with enough samples", () => {
    const p = new GoalProgressPredictor();
    for (let i = 0; i < 5; i++) p.recordCompletion(4 + i, 40, 0);
    const r = p.predict({ sessionTitle: "a", goal: "build", currentProgressPct: 50, elapsedHours: 3, errorCount: 0 });
    assert.equal(r.method, "historical");
    assert.ok(r.confidence > 20);
  });

  it("returns insufficient-data for zero progress", () => {
    const p = new GoalProgressPredictor();
    const r = p.predict({ sessionTitle: "a", goal: "build", currentProgressPct: 0, elapsedHours: 0, errorCount: 0 });
    assert.equal(r.method, "insufficient-data");
  });

  it("records completions", () => {
    const p = new GoalProgressPredictor();
    p.recordCompletion(5, 45, 1);
    p.recordCompletion(3, 50, 0);
    assert.equal(p.sampleCount(), 2);
  });

  it("enforces max samples", () => {
    const p = new GoalProgressPredictor(5);
    for (let i = 0; i < 10; i++) p.recordCompletion(i, 40, 0);
    assert.equal(p.sampleCount(), 5);
  });

  it("higher confidence with more progress", () => {
    const p = new GoalProgressPredictor();
    for (let i = 0; i < 5; i++) p.recordCompletion(4, 50, 0);
    const early = p.predict({ sessionTitle: "a", goal: "g", currentProgressPct: 10, elapsedHours: 1, errorCount: 0 });
    const late = p.predict({ sessionTitle: "b", goal: "g", currentProgressPct: 80, elapsedHours: 3, errorCount: 0 });
    assert.ok(late.confidence > early.confidence);
  });

  it("computes percentile", () => {
    const p = new GoalProgressPredictor();
    for (let i = 1; i <= 10; i++) p.recordCompletion(i, 50, 0);
    const r = p.predict({ sessionTitle: "a", goal: "g", currentProgressPct: 50, elapsedHours: 5, errorCount: 0 });
    assert.ok(r.percentile >= 0 && r.percentile <= 100);
  });

  it("blends linear and historical estimates", () => {
    const p = new GoalProgressPredictor();
    for (let i = 0; i < 5; i++) p.recordCompletion(8, 50, 0);
    const r = p.predict({ sessionTitle: "a", goal: "g", currentProgressPct: 50, elapsedHours: 4, errorCount: 0 });
    assert.ok(r.predictedDurationHours > 0);
    assert.ok(r.predictedEtaHours >= 0);
  });
});

describe("formatPredictions", () => {
  it("shows no-goals message when empty", () => {
    const lines = formatPredictions([]);
    assert.ok(lines[0].includes("no active goals"));
  });

  it("shows predictions", () => {
    const p = new GoalProgressPredictor();
    const r = p.predict({ sessionTitle: "alpha", goal: "build", currentProgressPct: 50, elapsedHours: 2, errorCount: 0 });
    const lines = formatPredictions([r]);
    assert.ok(lines[0].includes("Goal Progress"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
