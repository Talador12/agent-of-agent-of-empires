import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildGraph, renderGraph, detectCycles, formatCycles } from "./dep-graph-viz.js";
import type { TaskState } from "./types.js";

function makeTask(title: string, status = "active", deps?: string[]): TaskState {
  return { repo: "test", sessionTitle: title, sessionMode: "auto", tool: "opencode", goal: "test", status: status as any, progress: [], dependsOn: deps };
}

describe("buildGraph", () => {
  it("assigns depth 0 to tasks with no deps", () => {
    const nodes = buildGraph([makeTask("a"), makeTask("b")]);
    assert.equal(nodes[0].depth, 0);
    assert.equal(nodes[1].depth, 0);
  });

  it("assigns increasing depth for chains", () => {
    const tasks = [makeTask("c", "active", ["b"]), makeTask("b", "active", ["a"]), makeTask("a")];
    const nodes = buildGraph(tasks);
    const byTitle = new Map(nodes.map((n) => [n.title, n]));
    assert.equal(byTitle.get("a")!.depth, 0);
    assert.equal(byTitle.get("b")!.depth, 1);
    assert.equal(byTitle.get("c")!.depth, 2);
  });

  it("handles diamond dependencies", () => {
    const tasks = [makeTask("d", "active", ["b", "c"]), makeTask("b", "active", ["a"]), makeTask("c", "active", ["a"]), makeTask("a")];
    const nodes = buildGraph(tasks);
    const byTitle = new Map(nodes.map((n) => [n.title, n]));
    assert.equal(byTitle.get("a")!.depth, 0);
    assert.equal(byTitle.get("d")!.depth, 2);
  });

  it("sorts by depth then title", () => {
    const tasks = [makeTask("z"), makeTask("a"), makeTask("b", "active", ["a"])];
    const nodes = buildGraph(tasks);
    assert.equal(nodes[0].title, "a"); // depth 0, "a" before "z"
    assert.equal(nodes[1].title, "z"); // depth 0, "z" after "a"
    assert.equal(nodes[2].title, "b"); // depth 1
  });
});

describe("renderGraph", () => {
  it("renders empty graph", () => {
    const lines = renderGraph([]);
    assert.ok(lines[0].includes("no tasks"));
  });

  it("renders simple chain", () => {
    const tasks = [makeTask("a"), makeTask("b", "active", ["a"])];
    const nodes = buildGraph(tasks);
    const lines = renderGraph(nodes);
    assert.ok(lines.some((l) => l.includes("a")));
    assert.ok(lines.some((l) => l.includes("b")));
    assert.ok(lines.some((l) => l.includes("depends on")));
  });

  it("shows status icons", () => {
    const tasks = [makeTask("done", "completed"), makeTask("running", "active")];
    const lines = renderGraph(buildGraph(tasks));
    assert.ok(lines.some((l) => l.includes("✓")));
    assert.ok(lines.some((l) => l.includes("▶")));
  });
});

describe("detectCycles", () => {
  it("returns empty for acyclic graph", () => {
    const tasks = [makeTask("a"), makeTask("b", "active", ["a"])];
    assert.equal(detectCycles(tasks).length, 0);
  });

  it("detects simple cycle", () => {
    const tasks = [makeTask("a", "active", ["b"]), makeTask("b", "active", ["a"])];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0);
  });

  it("detects cycle in longer chain", () => {
    const tasks = [makeTask("a", "active", ["c"]), makeTask("b", "active", ["a"]), makeTask("c", "active", ["b"])];
    const cycles = detectCycles(tasks);
    assert.ok(cycles.length > 0);
  });
});

describe("formatCycles", () => {
  it("shows clean message for no cycles", () => {
    const lines = formatCycles([]);
    assert.ok(lines[0].includes("No dependency cycles"));
  });

  it("shows cycle path", () => {
    const lines = formatCycles([["a", "b"]]);
    assert.ok(lines.some((l) => l.includes("a") && l.includes("b")));
  });
});
