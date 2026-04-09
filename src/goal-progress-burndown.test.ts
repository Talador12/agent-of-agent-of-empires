// goal-progress-burndown.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createBurndown,
  recordProgress,
  analyzeBurndown,
  renderBurndownChart,
  formatBurndown,
} from "./goal-progress-burndown.js";

describe("createBurndown", () => {
  it("creates initial state at 100% remaining", () => {
    const state = createBurndown("frontend", 1000);
    assert.equal(state.sessionTitle, "frontend");
    assert.equal(state.samples.length, 1);
    assert.equal(state.samples[0].remainingPct, 100);
    assert.equal(state.startedAt, 1000);
    assert.equal(state.scopeChanges, 0);
  });
});

describe("recordProgress", () => {
  it("adds samples with remaining pct", () => {
    const state = createBurndown("test", 1000);
    recordProgress(state, 25, 2000); // 25% done = 75% remaining
    assert.equal(state.samples.length, 2);
    assert.equal(state.samples[1].remainingPct, 75);
  });

  it("detects scope increases", () => {
    const state = createBurndown("test", 1000);
    recordProgress(state, 30, 2000); // 70% remaining
    recordProgress(state, 20, 3000); // 80% remaining — scope went UP
    assert.equal(state.scopeChanges, 1);
  });

  it("clamps remaining to 0-100", () => {
    const state = createBurndown("test", 1000);
    recordProgress(state, 110, 2000);
    assert.equal(state.samples[1].remainingPct, 0);
    recordProgress(state, -10, 3000);
    assert.equal(state.samples[2].remainingPct, 100);
  });

  it("caps samples at 500", () => {
    const state = createBurndown("test", 1000);
    for (let i = 0; i < 600; i++) {
      recordProgress(state, i % 100, 1000 + i);
    }
    assert.ok(state.samples.length <= 500);
  });
});

describe("analyzeBurndown", () => {
  it("computes velocity and projection", () => {
    const state = createBurndown("test", 0);
    recordProgress(state, 50, 3_600_000); // 50% in 1 hour
    const analysis = analyzeBurndown(state, undefined, 3_600_000);
    assert.equal(analysis.currentRemainingPct, 50);
    assert.equal(analysis.velocityPctPerHour, 50);
    assert.ok(analysis.projectedCompletionMs); // should have ETA
    assert.equal(analysis.elapsedHours, 1);
  });

  it("detects ahead of schedule", () => {
    const state = createBurndown("test", 0);
    recordProgress(state, 80, 3_600_000); // 80% in 1 hour
    const analysis = analyzeBurndown(state, 4 * 3_600_000, 3_600_000);
    assert.equal(analysis.status, "ahead");
  });

  it("detects behind schedule", () => {
    const state = createBurndown("test", 0);
    recordProgress(state, 5, 3_600_000); // only 5% in 1 hour
    const analysis = analyzeBurndown(state, 2 * 3_600_000, 3_600_000);
    assert.equal(analysis.status, "behind");
  });

  it("detects stalled", () => {
    const state = createBurndown("test", 0);
    recordProgress(state, 0, 3_600_000); // zero progress in 1 hour
    const analysis = analyzeBurndown(state, undefined, 3_600_000);
    assert.equal(analysis.status, "stalled");
  });

  it("detects scope creep", () => {
    const state = createBurndown("test", 0);
    recordProgress(state, 30, 1_000_000);
    recordProgress(state, 20, 2_000_000); // went back
    recordProgress(state, 35, 3_000_000);
    recordProgress(state, 25, 4_000_000); // went back again
    recordProgress(state, 40, 5_000_000);
    recordProgress(state, 30, 6_000_000); // went back third time
    const analysis = analyzeBurndown(state, undefined, 6_000_000);
    assert.equal(analysis.status, "scope-creep");
    assert.equal(analysis.scopeChanges, 3);
  });

  it("handles zero elapsed time", () => {
    const state = createBurndown("test", 1000);
    const analysis = analyzeBurndown(state, undefined, 1000);
    assert.equal(analysis.velocityPctPerHour, 0);
    assert.equal(analysis.projectedCompletionMs, null);
  });

  it("returns null projection when stalled", () => {
    const state = createBurndown("test", 0);
    recordProgress(state, 0, 7_200_000); // 0% in 2 hours
    const analysis = analyzeBurndown(state, undefined, 7_200_000);
    assert.equal(analysis.projectedCompletionMs, null);
  });
});

describe("renderBurndownChart", () => {
  it("renders chart with actual + ideal lines", () => {
    const state = createBurndown("test", 0);
    for (let i = 1; i <= 10; i++) {
      recordProgress(state, i * 10, i * 360_000);
    }
    const lines = renderBurndownChart(state, { width: 20, height: 5 });
    assert.ok(lines.length > 0);
    assert.ok(lines.some((l) => l.includes("█"))); // actual
    assert.ok(lines.some((l) => l.includes("·"))); // ideal
    assert.ok(lines.some((l) => l.includes("time")));
  });

  it("handles insufficient data", () => {
    const state = createBurndown("test", 0);
    const lines = renderBurndownChart(state);
    assert.ok(lines[0].includes("insufficient data"));
  });
});

describe("formatBurndown", () => {
  it("formats multiple burndowns for TUI", () => {
    const s1 = createBurndown("frontend", 0);
    recordProgress(s1, 40, 1_800_000);
    const s2 = createBurndown("backend", 0);
    recordProgress(s2, 20, 1_800_000);
    const lines = formatBurndown([s1, s2]);
    assert.ok(lines[0].includes("2 sessions"));
    assert.ok(lines.some((l) => l.includes("frontend")));
    assert.ok(lines.some((l) => l.includes("backend")));
    assert.ok(lines.some((l) => l.includes("velocity")));
  });

  it("handles empty input", () => {
    const lines = formatBurndown([]);
    assert.ok(lines[0].includes("0 sessions"));
  });
});
