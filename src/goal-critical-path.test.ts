import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeCriticalPath, formatCriticalPath } from "./goal-critical-path.js";
import type { CriticalPathNode } from "./goal-critical-path.js";

function makeNode(overrides: Partial<CriticalPathNode> = {}): CriticalPathNode {
  return { sessionTitle: "a", goal: "build", durationEstHours: 2, dependsOn: [], depth: 0, ...overrides };
}

describe("computeCriticalPath", () => {
  it("returns empty for no nodes", () => {
    const r = computeCriticalPath([]);
    assert.equal(r.path.length, 0);
    assert.equal(r.totalDurationHours, 0);
  });

  it("returns single node as critical path", () => {
    const r = computeCriticalPath([makeNode({ sessionTitle: "a", durationEstHours: 3 })]);
    assert.equal(r.path.length, 1);
    assert.equal(r.totalDurationHours, 3);
  });

  it("finds longest chain through dependencies", () => {
    const nodes = [
      makeNode({ sessionTitle: "a", durationEstHours: 2, dependsOn: [] }),
      makeNode({ sessionTitle: "b", durationEstHours: 3, dependsOn: ["a"] }),
      makeNode({ sessionTitle: "c", durationEstHours: 1, dependsOn: ["b"] }),
    ];
    const r = computeCriticalPath(nodes);
    assert.equal(r.totalDurationHours, 6); // 2+3+1
    assert.ok(r.path.length >= 2);
  });

  it("picks longer branch in diamond", () => {
    const nodes = [
      makeNode({ sessionTitle: "root", durationEstHours: 1, dependsOn: [] }),
      makeNode({ sessionTitle: "fast", durationEstHours: 1, dependsOn: ["root"] }),
      makeNode({ sessionTitle: "slow", durationEstHours: 5, dependsOn: ["root"] }),
      makeNode({ sessionTitle: "end", durationEstHours: 1, dependsOn: ["fast", "slow"] }),
    ];
    const r = computeCriticalPath(nodes);
    assert.ok(r.totalDurationHours >= 7); // root(1)+slow(5)+end(1)
  });

  it("identifies bottleneck as longest single node", () => {
    const nodes = [
      makeNode({ sessionTitle: "short", durationEstHours: 1, dependsOn: [] }),
      makeNode({ sessionTitle: "long", durationEstHours: 10, dependsOn: ["short"] }),
    ];
    const r = computeCriticalPath(nodes);
    assert.equal(r.bottleneck, "long");
  });

  it("counts parallelizable tasks", () => {
    const nodes = [
      makeNode({ sessionTitle: "a", durationEstHours: 5, dependsOn: [] }),
      makeNode({ sessionTitle: "b", durationEstHours: 1, dependsOn: [] }),
      makeNode({ sessionTitle: "c", durationEstHours: 1, dependsOn: [] }),
    ];
    const r = computeCriticalPath(nodes);
    assert.equal(r.parallelizable, 2); // b and c are not on critical path
  });

  it("handles independent nodes", () => {
    const nodes = [
      makeNode({ sessionTitle: "a", durationEstHours: 3, dependsOn: [] }),
      makeNode({ sessionTitle: "b", durationEstHours: 5, dependsOn: [] }),
    ];
    const r = computeCriticalPath(nodes);
    assert.equal(r.totalDurationHours, 5); // longest single node
  });

  it("assigns correct depths", () => {
    const nodes = [
      makeNode({ sessionTitle: "a", durationEstHours: 1, dependsOn: [] }),
      makeNode({ sessionTitle: "b", durationEstHours: 1, dependsOn: ["a"] }),
      makeNode({ sessionTitle: "c", durationEstHours: 1, dependsOn: ["b"] }),
    ];
    const r = computeCriticalPath(nodes);
    assert.equal(r.maxDepth, r.path.length);
  });
});

describe("formatCriticalPath", () => {
  it("shows no-graph message when empty", () => {
    const lines = formatCriticalPath(computeCriticalPath([]));
    assert.ok(lines[0].includes("no dependency graph"));
  });

  it("shows path with bottleneck", () => {
    const nodes = [
      makeNode({ sessionTitle: "a", durationEstHours: 1 }),
      makeNode({ sessionTitle: "b", durationEstHours: 5, dependsOn: ["a"] }),
    ];
    const r = computeCriticalPath(nodes);
    const lines = formatCriticalPath(r);
    assert.ok(lines[0].includes("Critical Path"));
    assert.ok(lines.some((l) => l.includes("bottleneck")));
  });
});
