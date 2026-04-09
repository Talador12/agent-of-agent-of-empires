// fleet-priority-matrix.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeUrgency,
  computeImportance,
  classifyQuadrant,
  buildPriorityMatrix,
  formatPriorityMatrix,
  type MatrixInput,
} from "./fleet-priority-matrix.js";

const base: MatrixInput = {
  sessionTitle: "test",
  hasErrors: false,
  isStuck: false,
  stuckDurationMs: 0,
  nudgeCount: 0,
  healthScore: 80,
  priority: "normal",
  dependentCount: 0,
  costUsd: 0,
  progressPct: 0,
  isBlocking: false,
};

describe("computeUrgency", () => {
  it("returns low urgency for healthy session", () => {
    const score = computeUrgency(base);
    assert.ok(score < 20);
  });

  it("scores high for errors", () => {
    const score = computeUrgency({ ...base, hasErrors: true });
    assert.ok(score >= 30);
  });

  it("scores high for stuck + long duration", () => {
    const score = computeUrgency({ ...base, isStuck: true, stuckDurationMs: 2_000_000 });
    assert.ok(score >= 40);
  });

  it("scores high for deadline proximity", () => {
    const score = computeUrgency({ ...base, deadlineMs: 1_800_000 }); // 30 min
    assert.ok(score >= 20);
  });

  it("scores from nudge count", () => {
    const s1 = computeUrgency({ ...base, nudgeCount: 0 });
    const s2 = computeUrgency({ ...base, nudgeCount: 3 });
    assert.ok(s2 > s1);
  });

  it("caps at 100", () => {
    const score = computeUrgency({
      ...base,
      hasErrors: true,
      isStuck: true,
      stuckDurationMs: 5_000_000,
      nudgeCount: 5,
      healthScore: 10,
      deadlineMs: 300_000,
    });
    assert.ok(score <= 100);
  });
});

describe("computeImportance", () => {
  it("returns low for normal priority no deps", () => {
    const score = computeImportance(base);
    assert.ok(score <= 20);
  });

  it("scores high for critical priority", () => {
    const score = computeImportance({ ...base, priority: "critical" });
    assert.ok(score >= 40);
  });

  it("scores for blocking + dependents", () => {
    const score = computeImportance({ ...base, isBlocking: true, dependentCount: 3 });
    assert.ok(score >= 30);
  });

  it("scores for near-completion", () => {
    const s1 = computeImportance({ ...base, progressPct: 20 });
    const s2 = computeImportance({ ...base, progressPct: 90 });
    assert.ok(s2 > s1);
  });

  it("scores for high cost investment", () => {
    const s1 = computeImportance({ ...base, costUsd: 1 });
    const s2 = computeImportance({ ...base, costUsd: 25 });
    assert.ok(s2 > s1);
  });
});

describe("classifyQuadrant", () => {
  it("classifies high urgency + high importance as do-first", () => {
    assert.equal(classifyQuadrant(80, 70), "do-first");
  });

  it("classifies low urgency + high importance as schedule", () => {
    assert.equal(classifyQuadrant(20, 70), "schedule");
  });

  it("classifies high urgency + low importance as delegate", () => {
    assert.equal(classifyQuadrant(80, 10), "delegate");
  });

  it("classifies low urgency + low importance as eliminate", () => {
    assert.equal(classifyQuadrant(10, 10), "eliminate");
  });
});

describe("buildPriorityMatrix", () => {
  it("classifies multiple sessions", () => {
    const inputs: MatrixInput[] = [
      { ...base, sessionTitle: "urgent-important", hasErrors: true, isStuck: true, stuckDurationMs: 2_000_000, nudgeCount: 2, healthScore: 20, priority: "critical", isBlocking: true },
      { ...base, sessionTitle: "calm-important", priority: "high", dependentCount: 3 },
      { ...base, sessionTitle: "urgent-trivial", hasErrors: true, isStuck: true, stuckDurationMs: 2_000_000 },
      { ...base, sessionTitle: "calm-trivial" },
    ];
    const result = buildPriorityMatrix(inputs);
    assert.equal(result.entries.length, 4);
    assert.ok(result.quadrantCounts["do-first"] >= 1);

    // first entry should be do-first
    const first = result.entries[0];
    assert.equal(first.quadrant, "do-first");
    assert.ok(first.recommendation.length > 0);
  });

  it("computes averages", () => {
    const inputs: MatrixInput[] = [
      { ...base, sessionTitle: "a", hasErrors: true, priority: "critical" },
      { ...base, sessionTitle: "b" },
    ];
    const result = buildPriorityMatrix(inputs);
    assert.ok(result.avgUrgency > 0);
    assert.ok(result.avgImportance > 0);
  });

  it("handles empty input", () => {
    const result = buildPriorityMatrix([]);
    assert.equal(result.entries.length, 0);
    assert.equal(result.avgUrgency, 0);
  });

  it("sorts do-first before eliminate", () => {
    const inputs: MatrixInput[] = [
      { ...base, sessionTitle: "trivial" },
      { ...base, sessionTitle: "critical", hasErrors: true, priority: "critical", isBlocking: true },
    ];
    const result = buildPriorityMatrix(inputs);
    assert.equal(result.entries[0].sessionTitle, "critical");
  });

  it("generates recommendations", () => {
    const inputs: MatrixInput[] = [
      { ...base, sessionTitle: "stuck-critical", isStuck: true, stuckDurationMs: 600_000, priority: "critical", isBlocking: true },
    ];
    const result = buildPriorityMatrix(inputs);
    assert.ok(result.entries[0].recommendation.length > 0);
  });
});

describe("formatPriorityMatrix", () => {
  it("renders ASCII matrix", () => {
    const inputs: MatrixInput[] = [
      { ...base, sessionTitle: "a", hasErrors: true, priority: "critical" },
      { ...base, sessionTitle: "b" },
    ];
    const result = buildPriorityMatrix(inputs);
    const lines = formatPriorityMatrix(result);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("priority matrix"));
    assert.ok(lines.some((l) => l.includes("DO FIRST")));
    assert.ok(lines.some((l) => l.includes("SCHEDULE")));
    assert.ok(lines.some((l) => l.includes("DELEGATE")));
    assert.ok(lines.some((l) => l.includes("ELIMINATE")));
  });
});
