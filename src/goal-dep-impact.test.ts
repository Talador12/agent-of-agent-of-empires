import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeImpact, computeFleetImpact, formatImpact } from "./goal-dep-impact.js";
import type { TaskNode } from "./goal-dep-impact.js";

function makeTasks(): TaskNode[] {
  return [
    { sessionTitle: "a", goal: "build api", status: "active", dependsOn: [] },
    { sessionTitle: "b", goal: "build frontend", status: "active", dependsOn: ["a"] },
    { sessionTitle: "c", goal: "deploy", status: "pending", dependsOn: ["b"] },
    { sessionTitle: "d", goal: "test", status: "active", dependsOn: ["a"] },
  ];
}

describe("computeImpact", () => {
  it("finds directly blocked sessions", () => {
    const r = computeImpact(makeTasks(), "a", "failure");
    assert.ok(r.directlyBlocked.includes("b"));
    assert.ok(r.directlyBlocked.includes("d"));
  });
  it("finds transitively blocked sessions", () => {
    const r = computeImpact(makeTasks(), "a", "failure");
    assert.ok(r.transitivelyBlocked.includes("c") || r.directlyBlocked.includes("c") || r.totalAffected >= 3);
  });
  it("returns zero for leaf nodes", () => {
    const r = computeImpact(makeTasks(), "c", "failure");
    assert.equal(r.totalAffected, 0);
  });
  it("identifies critical path tasks", () => {
    const r = computeImpact(makeTasks(), "a", "failure");
    assert.ok(r.criticalPath);
  });
  it("skips completed tasks", () => {
    const tasks = [
      { sessionTitle: "a", goal: "g", status: "active", dependsOn: [] },
      { sessionTitle: "b", goal: "g", status: "completed", dependsOn: ["a"] },
    ];
    const r = computeImpact(tasks, "a", "failure");
    assert.equal(r.directlyBlocked.length, 0);
  });
});

describe("computeFleetImpact", () => {
  it("computes impact for all active tasks", () => {
    const results = computeFleetImpact(makeTasks());
    assert.ok(results.length > 0);
  });
  it("sorts by total affected descending", () => {
    const results = computeFleetImpact(makeTasks());
    if (results.length >= 2) assert.ok(results[0].totalAffected >= results[1].totalAffected);
  });
});

describe("formatImpact", () => {
  it("shows no-deps message when no downstream", () => {
    const lines = formatImpact([]);
    assert.ok(lines[0].includes("no tasks"));
  });
  it("shows impact details", () => {
    const results = computeFleetImpact(makeTasks());
    const lines = formatImpact(results);
    assert.ok(lines[0].includes("Dep Impact"));
  });
});
