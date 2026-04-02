import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { detectCompletionSignals, aggregateConfidence, shouldAutoComplete } from "./goal-detector.js";
import type { TaskState } from "./types.js";

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    repo: "github/test",
    sessionTitle: "test",
    sessionMode: "auto",
    tool: "opencode",
    goal: "do the thing",
    status: "active",
    progress: [],
    ...overrides,
  };
}

describe("detectCompletionSignals", () => {
  it("returns empty for empty lines", () => {
    const signals = detectCompletionSignals([], makeTask());
    assert.equal(signals.length, 0);
  });

  it("detects explicit done messages", () => {
    const lines = ["all tasks done", "nothing else happening"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "explicit_done"));
  });

  it("detects nothing left to do", () => {
    const lines = ["There is nothing left to do for this feature."];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "explicit_done"));
  });

  it("detects AI completion message", () => {
    const lines = ["I've completed all the requested changes"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "explicit_done"));
  });

  it("detects git push", () => {
    const lines = ["   abc1234..def5678  main -> main"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "commit_pushed"));
  });

  it("detects tests passing (node:test)", () => {
    const lines = ["ℹ tests 2708", "ℹ pass 2708", "ℹ fail 0"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "tests_passed"));
  });

  it("detects tests passing (jest)", () => {
    const lines = ["Tests:  104 passed, 104 total"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "tests_passed"));
  });

  it("does NOT detect partial jest pass as full pass", () => {
    const lines = ["Tests:  98 passed, 104 total"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(!signals.some((s) => s.type === "tests_passed"));
  });

  it("detects version bump", () => {
    const lines = ["v0.196.0"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "version_bumped"));
  });

  it("detects all todos done", () => {
    const lines = ["[✓] fix bug", "[✓] add tests", "[✓] update docs"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "all_todos_done"));
  });

  it("does NOT flag todos as done when pending remain", () => {
    const lines = ["[✓] fix bug", "[ ] add tests"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(!signals.some((s) => s.type === "all_todos_done"));
  });

  it("detects idle after progress", () => {
    const now = Date.now();
    const task = makeTask({
      lastProgressAt: now - 20 * 60 * 1000, // 20 minutes ago
      progress: [
        { at: now - 30 * 60 * 1000, summary: "first" },
        { at: now - 25 * 60 * 1000, summary: "second" },
        { at: now - 20 * 60 * 1000, summary: "third" },
      ],
    });
    const signals = detectCompletionSignals([], task, now);
    assert.ok(signals.some((s) => s.type === "idle_after_progress"));
  });

  it("does NOT detect idle when progress is recent", () => {
    const now = Date.now();
    const task = makeTask({
      lastProgressAt: now - 5 * 60 * 1000, // 5 minutes ago
      progress: [{ at: now - 5 * 60 * 1000, summary: "recent" }, { at: now - 10 * 60 * 1000, summary: "another" }],
    });
    const signals = detectCompletionSignals([], task, now);
    assert.ok(!signals.some((s) => s.type === "idle_after_progress"));
  });

  it("does NOT detect idle when insufficient progress entries", () => {
    const now = Date.now();
    const task = makeTask({
      lastProgressAt: now - 30 * 60 * 1000,
      progress: [{ at: now - 30 * 60 * 1000, summary: "only one" }], // need >= 2
    });
    const signals = detectCompletionSignals([], task, now);
    assert.ok(!signals.some((s) => s.type === "idle_after_progress"));
  });

  it("strips ANSI codes before matching", () => {
    const lines = ["\x1b[32mall tasks done\x1b[0m"];
    const signals = detectCompletionSignals(lines, makeTask());
    assert.ok(signals.some((s) => s.type === "explicit_done"));
  });
});

describe("aggregateConfidence", () => {
  it("returns 0 for empty signals", () => {
    assert.equal(aggregateConfidence([]), 0);
  });

  it("returns single signal confidence", () => {
    const result = aggregateConfidence([{ type: "explicit_done", confidence: 0.7, detail: "done" }]);
    assert.equal(result, 0.7);
  });

  it("combines multiple signals with diminishing returns", () => {
    const result = aggregateConfidence([
      { type: "explicit_done", confidence: 0.5, detail: "done" },
      { type: "tests_passed", confidence: 0.3, detail: "tests" },
    ]);
    // 1 - (0.5 * 0.7) = 1 - 0.35 = 0.65
    assert.ok(Math.abs(result - 0.65) < 0.001);
  });

  it("approaches 1.0 with many signals", () => {
    const signals = Array.from({ length: 10 }, (_, i) => ({
      type: "explicit_done" as const,
      confidence: 0.3,
      detail: `signal ${i}`,
    }));
    const result = aggregateConfidence(signals);
    assert.ok(result > 0.95);
  });
});

describe("shouldAutoComplete", () => {
  it("returns false for non-active tasks", () => {
    const task = makeTask({ status: "completed" });
    const signals = [{ type: "explicit_done" as const, confidence: 0.9, detail: "done" }];
    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, false);
  });

  it("returns false below threshold", () => {
    const task = makeTask();
    const signals = [{ type: "tests_passed" as const, confidence: 0.3, detail: "tests" }];
    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, false);
  });

  it("returns true above threshold", () => {
    const task = makeTask();
    const signals = [
      { type: "explicit_done" as const, confidence: 0.7, detail: "all tasks done" },
      { type: "commit_pushed" as const, confidence: 0.4, detail: "pushed main" },
    ];
    const result = shouldAutoComplete(signals, task);
    assert.equal(result.complete, true);
    assert.ok(result.summary.includes("auto-detected completion"));
    assert.ok(result.confidence > 0.7);
  });

  it("returns false for empty signals", () => {
    const result = shouldAutoComplete([], makeTask());
    assert.equal(result.complete, false);
    assert.equal(result.confidence, 0);
  });

  it("uses custom threshold", () => {
    const task = makeTask();
    const signals = [{ type: "tests_passed" as const, confidence: 0.3, detail: "tests" }];
    const result = shouldAutoComplete(signals, task, 0.2);
    assert.equal(result.complete, true);
  });
});
