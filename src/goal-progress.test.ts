import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { estimateProgress, formatProgressEstimates } from "./goal-progress.js";
import type { TaskState } from "./types.js";

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    repo: "test", sessionTitle: "test", sessionMode: "auto", tool: "opencode",
    goal: "implement the feature", status: "active", progress: [],
    ...overrides,
  };
}

describe("estimateProgress", () => {
  it("returns 100% for completed tasks", () => {
    const task = makeTask({ status: "completed" });
    const est = estimateProgress(task);
    assert.equal(est.percentComplete, 100);
    assert.equal(est.confidence, "high");
  });

  it("returns 0% with no data", () => {
    const task = makeTask();
    const est = estimateProgress(task);
    assert.equal(est.percentComplete, 0);
    assert.equal(est.confidence, "low");
  });

  it("increases estimate with progress entries", () => {
    const task = makeTask({
      progress: [
        { at: Date.now() - 60_000, summary: "started implementation" },
        { at: Date.now() - 30_000, summary: "added tests" },
        { at: Date.now(), summary: "fixed linting" },
      ],
    });
    const est = estimateProgress(task);
    assert.ok(est.percentComplete > 0);
    assert.ok(est.percentComplete <= 95);
  });

  it("boosts estimate when git push detected in output", () => {
    const task = makeTask({ progress: [{ at: Date.now(), summary: "done" }] });
    const output = "abc1234..def5678  main -> main";
    const est = estimateProgress(task, output);
    assert.ok(est.percentComplete >= 50);
  });

  it("estimates from bullet-point goal items", () => {
    const task = makeTask({
      goal: "- implement auth\n- add tests\n- update docs\n- deploy",
      progress: [
        { at: Date.now(), summary: "implemented auth module" },
        { at: Date.now(), summary: "added test suite" },
      ],
    });
    const est = estimateProgress(task);
    assert.ok(est.percentComplete > 20); // 2/4 items matched
  });

  it("caps failed tasks at 80%", () => {
    const task = makeTask({
      status: "failed",
      progress: Array.from({ length: 20 }, (_, i) => ({ at: Date.now(), summary: `step ${i}` })),
    });
    const est = estimateProgress(task);
    assert.ok(est.percentComplete <= 80);
  });

  it("includes time elapsed as a factor", () => {
    const task = makeTask({
      createdAt: Date.now() - 2 * 3_600_000, // 2 hours ago
      progress: [{ at: Date.now(), summary: "working" }],
    });
    const est = estimateProgress(task);
    assert.ok(est.factors.some((f) => f.includes("elapsed")));
  });

  it("generates a valid progress bar", () => {
    const task = makeTask({ progress: [{ at: Date.now(), summary: "x" }] });
    const est = estimateProgress(task);
    assert.ok(est.progressBar.includes("█") || est.progressBar.includes("░"));
    assert.ok(est.progressBar.includes("%"));
  });
});

describe("formatProgressEstimates", () => {
  it("shows no-data message for empty", () => {
    const lines = formatProgressEstimates([]);
    assert.ok(lines[0].includes("no task progress"));
  });

  it("formats with progress bar and factors", () => {
    const est = estimateProgress(makeTask({
      progress: [{ at: Date.now(), summary: "started" }],
    }));
    const lines = formatProgressEstimates([est]);
    assert.ok(lines.length >= 1);
    assert.ok(lines[0].includes("test"));
  });
});
