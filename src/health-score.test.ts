import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeHealth, computeAllHealth, formatHealthReport } from "./health-score.js";
import type { TaskState } from "./types.js";

function makeTask(overrides?: Partial<TaskState>): TaskState {
  return {
    repo: "github/test",
    sessionTitle: "test-session",
    sessionMode: "auto",
    tool: "opencode",
    goal: "build things",
    status: "active",
    progress: [],
    ...overrides,
  };
}

describe("computeHealth", () => {
  it("returns 100 for completed tasks", () => {
    const h = computeHealth(makeTask({ status: "completed" }));
    assert.equal(h.score, 100);
    assert.equal(h.grade, "healthy");
  });

  it("returns 0 for failed tasks", () => {
    const h = computeHealth(makeTask({ status: "failed" }));
    assert.equal(h.score, 0);
    assert.equal(h.grade, "critical");
  });

  it("returns 30 for paused tasks", () => {
    const h = computeHealth(makeTask({ status: "paused" }));
    assert.equal(h.score, 30);
    assert.equal(h.grade, "degraded");
  });

  it("returns 50 for pending tasks", () => {
    const h = computeHealth(makeTask({ status: "pending" }));
    assert.equal(h.score, 50);
    assert.equal(h.grade, "inactive");
  });

  it("scores higher for recent progress", () => {
    const recent = computeHealth(makeTask({ lastProgressAt: Date.now() - 5 * 60_000 }));
    const old = computeHealth(makeTask({ lastProgressAt: Date.now() - 5 * 60 * 60_000 }));
    assert.ok(recent.score > old.score);
  });

  it("penalizes stuck nudges", () => {
    const clean = computeHealth(makeTask({ lastProgressAt: Date.now() - 5 * 60_000 }));
    const nudged = computeHealth(makeTask({ lastProgressAt: Date.now() - 5 * 60_000, stuckNudgeCount: 3 }));
    assert.ok(clean.score > nudged.score);
  });

  it("rewards high progress velocity", () => {
    const now = Date.now();
    const fast = computeHealth(makeTask({
      lastProgressAt: now - 5 * 60_000,
      progress: [
        { at: now - 60_000, summary: "a" },
        { at: now - 30_000, summary: "b" },
        { at: now - 10_000, summary: "c" },
      ],
    }));
    const slow = computeHealth(makeTask({ lastProgressAt: now - 5 * 60_000, progress: [] }));
    assert.ok(fast.score >= slow.score);
  });

  it("includes factors explaining the score", () => {
    const h = computeHealth(makeTask({ lastProgressAt: Date.now() - 2 * 60 * 60_000, stuckNudgeCount: 2 }));
    assert.ok(h.factors.length > 0);
    assert.ok(h.factors.some((f) => f.includes("stuck")));
  });

  it("scores 'no progress ever' worse than 'old progress'", () => {
    const neverProgressed = computeHealth(makeTask({ lastProgressAt: undefined, progress: [] }));
    const oldProgress = computeHealth(makeTask({ lastProgressAt: Date.now() - 8 * 60 * 60_000 }));
    assert.ok(neverProgressed.score <= oldProgress.score,
      `never (${neverProgressed.score}) should be <= old (${oldProgress.score})`);
  });
});

describe("computeAllHealth", () => {
  it("returns health for each task", () => {
    const tasks = [makeTask({ sessionTitle: "a" }), makeTask({ sessionTitle: "b" })];
    const healths = computeAllHealth(tasks);
    assert.equal(healths.length, 2);
    assert.equal(healths[0].session, "a");
    assert.equal(healths[1].session, "b");
  });
});

describe("formatHealthReport", () => {
  it("returns no-tasks message for empty array", () => {
    assert.ok(formatHealthReport([]).includes("no tasks"));
  });

  it("shows session names and scores", () => {
    const result = formatHealthReport([makeTask({ sessionTitle: "adventure" })]);
    assert.ok(result.includes("adventure"));
    assert.ok(result.includes("fleet average"));
  });

  it("shows health bar visualization", () => {
    const result = formatHealthReport([makeTask({ status: "completed" })]);
    assert.ok(result.includes("█"));
  });
});
