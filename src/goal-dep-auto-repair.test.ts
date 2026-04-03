import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { findBrokenDeps, applyRepairs, detectCycles, formatDepRepairs } from "./goal-dep-auto-repair.js";

describe("findBrokenDeps", () => {
  it("finds deps on completed tasks", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["b"] },
      { sessionTitle: "b", status: "completed", dependsOn: [] },
    ];
    const repairs = findBrokenDeps(tasks);
    assert.equal(repairs.length, 1);
    assert.ok(repairs[0].removedDeps.includes("b"));
  });

  it("finds deps on nonexistent tasks", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["ghost"] },
    ];
    const repairs = findBrokenDeps(tasks);
    assert.equal(repairs.length, 1);
    assert.ok(repairs[0].reason.includes("not found"));
  });

  it("finds deps on removed tasks", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["b"] },
      { sessionTitle: "b", status: "removed", dependsOn: [] },
    ];
    const repairs = findBrokenDeps(tasks);
    assert.equal(repairs.length, 1);
  });

  it("finds deps on failed tasks", () => {
    const tasks = [
      { sessionTitle: "a", status: "pending", dependsOn: ["b"] },
      { sessionTitle: "b", status: "failed", dependsOn: [] },
    ];
    const repairs = findBrokenDeps(tasks);
    assert.equal(repairs.length, 1);
  });

  it("returns empty for healthy deps", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["b"] },
      { sessionTitle: "b", status: "active", dependsOn: [] },
    ];
    assert.equal(findBrokenDeps(tasks).length, 0);
  });

  it("skips completed/removed tasks", () => {
    const tasks = [
      { sessionTitle: "a", status: "completed", dependsOn: ["ghost"] },
    ];
    assert.equal(findBrokenDeps(tasks).length, 0);
  });
});

describe("applyRepairs", () => {
  it("removes broken deps from task lists", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["b", "c"] },
      { sessionTitle: "b", status: "completed", dependsOn: [] },
      { sessionTitle: "c", status: "active", dependsOn: [] },
    ];
    const repairs = findBrokenDeps(tasks);
    const updated = applyRepairs(tasks, repairs);
    assert.deepEqual(updated.get("a"), ["c"]); // b removed, c kept
  });
});

describe("detectCycles", () => {
  it("detects circular dependency", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["b"] },
      { sessionTitle: "b", status: "active", dependsOn: ["a"] },
    ];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0);
  });

  it("returns empty for acyclic graph", () => {
    const tasks = [
      { sessionTitle: "a", status: "active", dependsOn: ["b"] },
      { sessionTitle: "b", status: "active", dependsOn: [] },
    ];
    assert.equal(detectCycles(tasks).length, 0);
  });
});

describe("formatDepRepairs", () => {
  it("shows healthy message when no issues", () => {
    const lines = formatDepRepairs([], []);
    assert.ok(lines[0].includes("healthy"));
  });

  it("shows repair details", () => {
    const repairs = [{ sessionTitle: "a", removedDeps: ["b"], reason: '"b" completed' }];
    const lines = formatDepRepairs(repairs, []);
    assert.ok(lines.some((l) => l.includes("removed")));
  });

  it("shows cycles", () => {
    const lines = formatDepRepairs([], [["a", "b", "a"]]);
    assert.ok(lines.some((l) => l.includes("Cycle")));
  });
});
