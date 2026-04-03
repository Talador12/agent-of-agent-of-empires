import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { estimateConfidence, estimateFleetConfidence, formatConfidence } from "./goal-confidence-estimator.js";
import type { ConfidenceInput } from "./goal-confidence-estimator.js";

function makeInput(overrides: Partial<ConfidenceInput> = {}): ConfidenceInput {
  return {
    sessionTitle: "alpha", goal: "build feature", progressPct: 50,
    velocityPctPerHr: 10, errorCount: 0, elapsedHours: 2,
    positiveSignals: 1, negativeSignals: 0, stuckTicks: 0,
    ...overrides,
  };
}

describe("estimateConfidence", () => {
  it("returns ~50% for baseline inputs", () => {
    const r = estimateConfidence(makeInput());
    assert.ok(r.confidence >= 40 && r.confidence <= 80);
  });

  it("boosts confidence with high progress", () => {
    const high = estimateConfidence(makeInput({ progressPct: 90 }));
    const low = estimateConfidence(makeInput({ progressPct: 10 }));
    assert.ok(high.confidence > low.confidence);
  });

  it("boosts confidence with positive velocity", () => {
    const fast = estimateConfidence(makeInput({ velocityPctPerHr: 20 }));
    const stagnant = estimateConfidence(makeInput({ velocityPctPerHr: 0, elapsedHours: 5 }));
    assert.ok(fast.confidence > stagnant.confidence);
  });

  it("penalizes errors", () => {
    const clean = estimateConfidence(makeInput({ errorCount: 0 }));
    const errors = estimateConfidence(makeInput({ errorCount: 3 }));
    assert.ok(clean.confidence > errors.confidence);
  });

  it("penalizes negative signals", () => {
    const good = estimateConfidence(makeInput({ positiveSignals: 3, negativeSignals: 0 }));
    const bad = estimateConfidence(makeInput({ positiveSignals: 0, negativeSignals: 3 }));
    assert.ok(good.confidence > bad.confidence);
  });

  it("penalizes stuck sessions", () => {
    const moving = estimateConfidence(makeInput({ stuckTicks: 0 }));
    const stuck = estimateConfidence(makeInput({ stuckTicks: 5 }));
    assert.ok(moving.confidence > stuck.confidence);
  });

  it("applies time pressure for slow old tasks", () => {
    const old = estimateConfidence(makeInput({ elapsedHours: 12, progressPct: 20 }));
    const fresh = estimateConfidence(makeInput({ elapsedHours: 1, progressPct: 20 }));
    assert.ok(fresh.confidence >= old.confidence);
  });

  it("clamps to 0-100", () => {
    const worst = estimateConfidence(makeInput({ progressPct: 0, errorCount: 10, negativeSignals: 5, stuckTicks: 10, velocityPctPerHr: 0, elapsedHours: 20 }));
    assert.ok(worst.confidence >= 0 && worst.confidence <= 100);
  });

  it("computes ETA from velocity", () => {
    const r = estimateConfidence(makeInput({ progressPct: 50, velocityPctPerHr: 10 }));
    assert.ok(r.etaHours !== null);
    assert.ok(r.etaHours! > 0);
  });

  it("returns null ETA for stagnant velocity", () => {
    const r = estimateConfidence(makeInput({ velocityPctPerHr: 0 }));
    assert.equal(r.etaHours, null);
  });

  it("determines trend from factor impacts", () => {
    const rising = estimateConfidence(makeInput({ progressPct: 80, velocityPctPerHr: 20, positiveSignals: 3 }));
    assert.equal(rising.trend, "rising");
    const falling = estimateConfidence(makeInput({ errorCount: 4, negativeSignals: 3, stuckTicks: 5 }));
    assert.equal(falling.trend, "falling");
  });
});

describe("estimateFleetConfidence", () => {
  it("sorts by confidence ascending (worst first)", () => {
    const results = estimateFleetConfidence([
      makeInput({ sessionTitle: "good", progressPct: 90 }),
      makeInput({ sessionTitle: "bad", progressPct: 10, errorCount: 5 }),
    ]);
    assert.equal(results[0].sessionTitle, "bad");
  });

  it("handles empty input", () => {
    assert.deepEqual(estimateFleetConfidence([]), []);
  });
});

describe("formatConfidence", () => {
  it("shows no-goals message when empty", () => {
    const lines = formatConfidence([]);
    assert.ok(lines[0].includes("no active goals"));
  });

  it("shows confidence with factors", () => {
    const results = estimateFleetConfidence([makeInput({ errorCount: 2 })]);
    const lines = formatConfidence(results);
    assert.ok(lines[0].includes("Goal Confidence"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("error")));
  });
});
