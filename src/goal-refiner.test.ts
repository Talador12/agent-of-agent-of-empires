import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { analyzeCompletedTasks, refineGoal, formatGoalRefinement } from "./goal-refiner.js";
import type { TaskState } from "./types.js";

function makeTask(goal: string, status = "completed", progressCount = 5): TaskState {
  const now = Date.now();
  return {
    repo: "test", sessionTitle: "test", sessionMode: "auto", tool: "opencode",
    goal, status: status as any,
    progress: Array.from({ length: progressCount }, (_, i) => ({ at: now - i * 60_000, summary: `step ${i}` })),
    createdAt: now - 3_600_000, completedAt: status === "completed" ? now : undefined,
  };
}

describe("analyzeCompletedTasks", () => {
  it("returns empty pattern for no tasks", () => {
    const p = analyzeCompletedTasks([]);
    assert.equal(p.sampleSize, 0);
  });

  it("extracts patterns from completed tasks", () => {
    const tasks = [
      makeTask("implement auth system with tests"),
      makeTask("implement payment system with tests"),
      makeTask("implement notification with tests"),
    ];
    const p = analyzeCompletedTasks(tasks);
    assert.equal(p.sampleSize, 3);
    assert.ok(p.keywords.includes("implement"));
    assert.ok(p.keywords.includes("tests"));
    assert.ok(p.avgProgressEntries > 0);
    assert.ok(p.avgDurationMs > 0);
    assert.equal(p.successRate, 1);
  });

  it("computes success rate with failed tasks", () => {
    const tasks = [
      makeTask("good task", "completed"),
      makeTask("bad task", "failed"),
    ];
    const p = analyzeCompletedTasks(tasks);
    assert.equal(p.successRate, 0.5);
  });
});

describe("refineGoal", () => {
  const patterns = analyzeCompletedTasks([
    makeTask("implement feature with tests and deployment"),
    makeTask("add feature with tests and verification"),
    makeTask("build feature with tests and push"),
  ]);

  it("suggests bullet points for flat goals", () => {
    const r = refineGoal("do the thing", patterns);
    assert.ok(r.suggestions.some((s) => s.includes("bullet") || s.includes("step") || s.includes("numbered")));
  });

  it("suggests testing when missing", () => {
    const r = refineGoal("implement the auth module", patterns);
    assert.ok(r.suggestions.some((s) => s.includes("test")));
  });

  it("suggests commit step when missing", () => {
    const r = refineGoal("implement the auth module with tests", patterns);
    assert.ok(r.suggestions.some((s) => s.includes("commit") || s.includes("push")));
  });

  it("includes duration estimate", () => {
    const r = refineGoal("do something", patterns);
    assert.ok(r.suggestions.some((s) => s.includes("completion")));
  });

  it("notes brief goals", () => {
    const r = refineGoal("fix bug", patterns);
    assert.ok(r.suggestions.some((s) => s.includes("brief")));
  });

  it("returns confidence based on sample size", () => {
    assert.equal(refineGoal("x", patterns).confidence, "medium"); // 3 samples → medium
  });
});

describe("formatGoalRefinement", () => {
  it("shows good message when no suggestions", () => {
    const r = { originalGoal: "good", suggestions: [], confidence: "high" as const, basedOn: 5 };
    const lines = formatGoalRefinement(r);
    assert.ok(lines[0].includes("looks good"));
  });

  it("shows suggestions", () => {
    const patterns = analyzeCompletedTasks([makeTask("x")]);
    const r = refineGoal("do thing", patterns);
    const lines = formatGoalRefinement(r);
    assert.ok(lines.length >= 2);
    assert.ok(lines.some((l) => l.includes("→")));
  });
});
