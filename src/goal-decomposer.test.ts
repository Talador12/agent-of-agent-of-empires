import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { decomposeGoal, subGoalsToTaskDefs, formatDecomposition } from "./goal-decomposer.js";

describe("decomposeGoal", () => {
  it("decomposes numbered steps into sequential sub-goals", () => {
    const goal = "1. Set up database\n2. Build API endpoints\n3. Add frontend UI\n4. Write tests";
    const result = decomposeGoal(goal);
    assert.equal(result.subGoals.length, 4);
    assert.ok(result.hasSequentialDeps);
    assert.equal(result.subGoals[0].dependsOn.length, 0);
    assert.deepEqual(result.subGoals[1].dependsOn, ["task-1"]);
    assert.deepEqual(result.subGoals[2].dependsOn, ["task-2"]);
  });

  it("decomposes bullet points without sequential markers as parallel", () => {
    const goal = "- implement auth\n- add logging\n- update docs";
    const result = decomposeGoal(goal);
    assert.equal(result.subGoals.length, 3);
    assert.equal(result.hasSequentialDeps, false);
    for (const sg of result.subGoals) {
      assert.equal(sg.dependsOn.length, 0);
    }
  });

  it("decomposes bullets with 'then' as sequential", () => {
    const goal = "- set up database\n- then build the API\n- then add tests";
    const result = decomposeGoal(goal);
    assert.equal(result.subGoals.length, 3);
    assert.ok(result.hasSequentialDeps);
  });

  it("splits on sequential markers", () => {
    const goal = "implement the auth module, then add tests, finally deploy";
    const result = decomposeGoal(goal);
    assert.ok(result.subGoals.length >= 2);
    assert.ok(result.hasSequentialDeps);
  });

  it("returns single goal for atomic text", () => {
    const goal = "fix the bug in login page";
    const result = decomposeGoal(goal);
    assert.equal(result.subGoals.length, 1);
    assert.equal(result.hasSequentialDeps, false);
  });

  it("uses custom base title", () => {
    const goal = "1. step one\n2. step two";
    const result = decomposeGoal(goal, "auth");
    assert.equal(result.subGoals[0].id, "auth-1");
    assert.equal(result.subGoals[1].id, "auth-2");
  });

  it("builds correct parallel groups for sequential goals", () => {
    const goal = "1. first\n2. second\n3. third";
    const result = decomposeGoal(goal);
    assert.equal(result.parallelGroups.length, 3); // each is its own wave
  });

  it("builds single parallel group for parallel goals", () => {
    const goal = "- task a\n- task b\n- task c";
    const result = decomposeGoal(goal);
    assert.equal(result.parallelGroups.length, 1); // all in one wave
  });
});

describe("subGoalsToTaskDefs", () => {
  it("converts sub-goals to task definitions", () => {
    const goal = "1. do thing\n2. test thing";
    const decomp = decomposeGoal(goal);
    const defs = subGoalsToTaskDefs(decomp, { repo: "test/repo", tool: "opencode", sessionMode: "auto" });
    assert.equal(defs.length, 2);
    assert.equal(defs[0].goal, "do thing");
    assert.equal(defs[1].dependsOn?.[0], "task-1");
  });
});

describe("formatDecomposition", () => {
  it("shows atomic message for single goal", () => {
    const result = decomposeGoal("simple goal");
    const lines = formatDecomposition(result);
    assert.ok(lines[0].includes("atomic"));
  });

  it("shows sub-goals and dependencies", () => {
    const result = decomposeGoal("1. first\n2. second\n3. third");
    const lines = formatDecomposition(result);
    assert.ok(lines[0].includes("3 sub-goals"));
    assert.ok(lines.some((l) => l.includes("task-1")));
    assert.ok(lines.some((l) => l.includes("after:")));
  });
});
