// goal-velocity-normalization.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findTier,
  normalizeVelocity,
  computePercentile,
  normalizeOne,
  normalizeFleet,
  formatNormalizedVelocity,
  DEFAULT_TIERS,
  type VelocityInput,
} from "./goal-velocity-normalization.js";

describe("findTier", () => {
  it("finds tier by name", () => {
    const tier = findTier("moderate");
    assert.ok(tier);
    assert.equal(tier.name, "moderate");
    assert.equal(tier.weight, 3);
  });

  it("case insensitive", () => {
    assert.ok(findTier("EPIC"));
    assert.ok(findTier("Trivial"));
  });

  it("returns null for unknown tier", () => {
    assert.equal(findTier("impossible"), null);
  });
});

describe("normalizeVelocity", () => {
  it("scores midpoint of tier as 50", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "moderate")!;
    const mid = (tier.minExpectedVelocityPctHr + tier.maxExpectedVelocityPctHr) / 2;
    const score = normalizeVelocity(mid, tier);
    assert.equal(score, 50);
  });

  it("scores 0 for zero velocity", () => {
    const tier = DEFAULT_TIERS[0];
    assert.equal(normalizeVelocity(0, tier), 0);
  });

  it("caps at 100", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "trivial")!;
    const score = normalizeVelocity(500, tier);
    assert.equal(score, 100);
  });

  it("fast trivial task scores high", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "trivial")!;
    const score = normalizeVelocity(100, tier);
    assert.ok(score >= 30);
  });

  it("slow epic task can still score reasonably", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "epic")!;
    const score = normalizeVelocity(3, tier);
    assert.ok(score >= 40);
  });
});

describe("computePercentile", () => {
  it("min of range = 0th percentile", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "moderate")!;
    const pct = computePercentile(tier.minExpectedVelocityPctHr, tier);
    assert.equal(pct, 0);
  });

  it("max of range = 100th percentile", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "moderate")!;
    const pct = computePercentile(tier.maxExpectedVelocityPctHr, tier);
    assert.equal(pct, 100);
  });

  it("midpoint = 50th percentile", () => {
    const tier = DEFAULT_TIERS.find((t) => t.name === "moderate")!;
    const mid = (tier.minExpectedVelocityPctHr + tier.maxExpectedVelocityPctHr) / 2;
    const pct = computePercentile(mid, tier);
    assert.equal(pct, 50);
  });

  it("clamps below 0", () => {
    const tier = DEFAULT_TIERS[0];
    assert.equal(computePercentile(0, tier), 0);
  });
});

describe("normalizeOne", () => {
  it("normalizes a single session", () => {
    const input: VelocityInput = {
      sessionTitle: "frontend",
      rawVelocityPctHr: 15,
      complexity: "moderate",
      elapsedHours: 2,
      progressPct: 30,
    };
    const result = normalizeOne(input);
    assert.equal(result.sessionTitle, "frontend");
    assert.ok(result.normalizedScore >= 0 && result.normalizedScore <= 100);
    assert.equal(result.complexityWeight, 3);
    assert.ok(result.weightedVelocity > 0);
    assert.ok(["excellent", "good", "normal", "slow", "stalled"].includes(result.rating));
  });

  it("falls back to moderate for unknown complexity", () => {
    const input: VelocityInput = {
      sessionTitle: "test",
      rawVelocityPctHr: 10,
      complexity: "unknown-tier",
      elapsedHours: 1,
      progressPct: 10,
    };
    const result = normalizeOne(input);
    assert.equal(result.complexityWeight, 3); // moderate default
  });

  it("rates excellent for high normalized score", () => {
    const input: VelocityInput = {
      sessionTitle: "fast",
      rawVelocityPctHr: 250,
      complexity: "trivial",
      elapsedHours: 0.3,
      progressPct: 90,
    };
    const result = normalizeOne(input);
    assert.equal(result.rating, "excellent");
  });

  it("rates stalled for zero velocity", () => {
    const input: VelocityInput = {
      sessionTitle: "stuck",
      rawVelocityPctHr: 0,
      complexity: "moderate",
      elapsedHours: 5,
      progressPct: 0,
    };
    const result = normalizeOne(input);
    assert.equal(result.rating, "stalled");
  });
});

describe("normalizeFleet", () => {
  it("normalizes multiple sessions", () => {
    const inputs: VelocityInput[] = [
      { sessionTitle: "fast-trivial", rawVelocityPctHr: 100, complexity: "trivial", elapsedHours: 0.5, progressPct: 50 },
      { sessionTitle: "slow-epic", rawVelocityPctHr: 2, complexity: "epic", elapsedHours: 10, progressPct: 20 },
      { sessionTitle: "moderate", rawVelocityPctHr: 15, complexity: "moderate", elapsedHours: 3, progressPct: 45 },
    ];
    const result = normalizeFleet(inputs);
    assert.equal(result.velocities.length, 3);
    assert.ok(result.fleetAvgNormalized > 0);
    assert.ok(result.topPerformer);
    assert.ok(result.bottomPerformer);
  });

  it("sorts by normalized score desc", () => {
    const inputs: VelocityInput[] = [
      { sessionTitle: "slow", rawVelocityPctHr: 1, complexity: "moderate", elapsedHours: 5, progressPct: 5 },
      { sessionTitle: "fast", rawVelocityPctHr: 25, complexity: "moderate", elapsedHours: 2, progressPct: 50 },
    ];
    const result = normalizeFleet(inputs);
    assert.equal(result.velocities[0].sessionTitle, "fast");
  });

  it("handles empty input", () => {
    const result = normalizeFleet([]);
    assert.equal(result.velocities.length, 0);
    assert.equal(result.fleetAvgNormalized, 0);
    assert.equal(result.topPerformer, null);
  });

  it("identifies top and bottom performers", () => {
    const inputs: VelocityInput[] = [
      { sessionTitle: "best", rawVelocityPctHr: 100, complexity: "trivial", elapsedHours: 1, progressPct: 100 },
      { sessionTitle: "worst", rawVelocityPctHr: 0, complexity: "epic", elapsedHours: 10, progressPct: 0 },
    ];
    const result = normalizeFleet(inputs);
    assert.equal(result.topPerformer, "best");
    assert.equal(result.bottomPerformer, "worst");
  });

  it("computes weighted velocity correctly", () => {
    const inputs: VelocityInput[] = [
      { sessionTitle: "epic", rawVelocityPctHr: 2, complexity: "epic", elapsedHours: 10, progressPct: 20 },
    ];
    const result = normalizeFleet(inputs);
    assert.equal(result.velocities[0].weightedVelocity, 10); // 2 * 5
  });
});

describe("formatNormalizedVelocity", () => {
  it("formats results for TUI", () => {
    const inputs: VelocityInput[] = [
      { sessionTitle: "frontend", rawVelocityPctHr: 20, complexity: "moderate", elapsedHours: 2, progressPct: 40 },
    ];
    const result = normalizeFleet(inputs);
    const lines = formatNormalizedVelocity(result);
    assert.ok(lines[0].includes("1 sessions"));
    assert.ok(lines.some((l) => l.includes("frontend")));
    assert.ok(lines.some((l) => l.includes("█")));
    assert.ok(lines.some((l) => l.includes("effective/hr")));
  });
});
