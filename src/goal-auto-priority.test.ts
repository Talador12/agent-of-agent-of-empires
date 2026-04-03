import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { scoreGoal, rankGoals, formatGoalPriority } from "./goal-auto-priority.js";
import type { GoalPriorityInput } from "./goal-auto-priority.js";

function makeInput(overrides: Partial<GoalPriorityInput> = {}): GoalPriorityInput {
  return {
    sessionTitle: "alpha",
    goal: "build feature",
    repo: "github/adventure",
    createdAt: Date.now() - 3_600_000, // 1h ago
    dependencyCount: 0,
    tags: new Map(),
    status: "active",
    ...overrides,
  };
}

describe("scoreGoal", () => {
  it("returns base score for plain goal", () => {
    const result = scoreGoal(makeInput());
    assert.ok(result.score >= 0);
    assert.equal(result.sessionTitle, "alpha");
  });

  it("boosts urgency keywords", () => {
    const urgent = scoreGoal(makeInput({ goal: "fix critical security bug" }));
    const normal = scoreGoal(makeInput({ goal: "add new feature" }));
    assert.ok(urgent.score > normal.score);
    assert.ok(urgent.factors.some((f) => f.name === "urgency-keywords"));
  });

  it("boosts impact keywords", () => {
    const impactful = scoreGoal(makeInput({ goal: "deploy production migration" }));
    const normal = scoreGoal(makeInput({ goal: "update readme docs" }));
    assert.ok(impactful.score > normal.score);
  });

  it("boosts dependency count", () => {
    const depended = scoreGoal(makeInput({ dependencyCount: 3 }));
    const alone = scoreGoal(makeInput({ dependencyCount: 0 }));
    assert.ok(depended.score > alone.score);
    assert.ok(depended.factors.some((f) => f.name === "dependencies"));
  });

  it("boosts age (anti-starvation)", () => {
    const old = scoreGoal(makeInput({ createdAt: Date.now() - 24 * 3_600_000 })); // 24h
    const fresh = scoreGoal(makeInput({ createdAt: Date.now() - 60_000 })); // 1m
    assert.ok(old.score > fresh.score);
  });

  it("boosts explicit priority tag", () => {
    const p0 = scoreGoal(makeInput({ tags: new Map([["priority", "critical"]]) }));
    const none = scoreGoal(makeInput({ tags: new Map() }));
    assert.ok(p0.score > none.score);
    assert.ok(p0.factors.some((f) => f.name === "priority-tag"));
  });

  it("caps at 100", () => {
    const max = scoreGoal(makeInput({
      goal: "fix critical urgent security bug hotfix",
      dependencyCount: 10,
      createdAt: Date.now() - 100 * 3_600_000,
      tags: new Map([["priority", "critical"]]),
    }));
    assert.ok(max.score <= 100);
  });
});

describe("rankGoals", () => {
  it("ranks by score descending", () => {
    const inputs = [
      makeInput({ sessionTitle: "low", goal: "update docs" }),
      makeInput({ sessionTitle: "high", goal: "fix critical security bug", dependencyCount: 3 }),
    ];
    const ranked = rankGoals(inputs);
    assert.equal(ranked[0].sessionTitle, "high");
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].rank, 2);
  });

  it("handles empty input", () => {
    assert.deepEqual(rankGoals([]), []);
  });
});

describe("formatGoalPriority", () => {
  it("shows no-goals message when empty", () => {
    const lines = formatGoalPriority([]);
    assert.ok(lines[0].includes("no goals"));
  });

  it("shows ranked goals with factors", () => {
    const ranked = rankGoals([
      makeInput({ sessionTitle: "alpha", goal: "fix critical bug" }),
      makeInput({ sessionTitle: "beta", goal: "update readme" }),
    ]);
    const lines = formatGoalPriority(ranked);
    assert.ok(lines[0].includes("Goal Auto-Priority"));
    assert.ok(lines.some((l) => l.includes("#1")));
    assert.ok(lines.some((l) => l.includes("factors")));
  });
});
