import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createCascadeState, addParentGoal, cascadeChild,
  completeCascadeGoal, getCascadeTree, getRootGoals,
  cascadeStats, formatCascadeTree,
} from "./goal-cascading.js";

describe("createCascadeState", () => {
  it("starts empty", () => {
    const state = createCascadeState();
    assert.equal(state.goals.length, 0);
  });
});

describe("addParentGoal", () => {
  it("adds a root goal at depth 0", () => {
    const state = createCascadeState();
    const g = addParentGoal(state, "alpha", "build auth", "github/app");
    assert.equal(g.depth, 0);
    assert.equal(g.parentId, null);
    assert.equal(state.goals.length, 1);
  });
});

describe("cascadeChild", () => {
  it("creates a child goal linked to parent", () => {
    const state = createCascadeState();
    const parent = addParentGoal(state, "alpha", "build auth", "github/app");
    const child = cascadeChild(state, parent.id, "beta", "implement login", "github/web");
    assert.ok(child);
    assert.equal(child!.parentId, parent.id);
    assert.equal(child!.depth, 1);
    assert.ok(parent.children.includes(child!.id));
  });

  it("returns null for invalid parent", () => {
    const state = createCascadeState();
    assert.equal(cascadeChild(state, 999, "a", "g", "r"), null);
  });

  it("enforces max depth", () => {
    const state = createCascadeState(2);
    const root = addParentGoal(state, "a", "g0", "r");
    const c1 = cascadeChild(state, root.id, "b", "g1", "r")!;
    const c2 = cascadeChild(state, c1.id, "c", "g2", "r")!;
    const c3 = cascadeChild(state, c2.id, "d", "g3", "r");
    assert.equal(c3, null); // depth 2 is max
  });
});

describe("completeCascadeGoal", () => {
  it("marks a goal as completed", () => {
    const state = createCascadeState();
    const g = addParentGoal(state, "a", "goal", "r");
    assert.ok(completeCascadeGoal(state, g.id));
    assert.equal(g.status, "completed");
  });

  it("auto-completes parent when all children done", () => {
    const state = createCascadeState();
    const parent = addParentGoal(state, "a", "parent", "r");
    const c1 = cascadeChild(state, parent.id, "b", "child1", "r")!;
    const c2 = cascadeChild(state, parent.id, "c", "child2", "r")!;
    completeCascadeGoal(state, c1.id);
    completeCascadeGoal(state, c2.id);
    assert.equal(parent.status, "completed"); // auto-propagated
  });

  it("does not auto-complete parent with pending children", () => {
    const state = createCascadeState();
    const parent = addParentGoal(state, "a", "parent", "r");
    cascadeChild(state, parent.id, "b", "child1", "r");
    const c2 = cascadeChild(state, parent.id, "c", "child2", "r")!;
    completeCascadeGoal(state, c2.id);
    assert.equal(parent.status, "active"); // still active
  });

  it("returns false for invalid ID", () => {
    const state = createCascadeState();
    assert.ok(!completeCascadeGoal(state, 999));
  });
});

describe("getCascadeTree", () => {
  it("returns full tree from root", () => {
    const state = createCascadeState();
    const root = addParentGoal(state, "a", "root", "r");
    cascadeChild(state, root.id, "b", "c1", "r");
    cascadeChild(state, root.id, "c", "c2", "r");
    const tree = getCascadeTree(state, root.id);
    assert.equal(tree.length, 3);
  });

  it("returns empty for invalid root", () => {
    const state = createCascadeState();
    assert.equal(getCascadeTree(state, 999).length, 0);
  });
});

describe("getRootGoals", () => {
  it("returns only parentless goals", () => {
    const state = createCascadeState();
    const root = addParentGoal(state, "a", "root", "r");
    cascadeChild(state, root.id, "b", "child", "r");
    const roots = getRootGoals(state);
    assert.equal(roots.length, 1);
    assert.equal(roots[0].id, root.id);
  });
});

describe("cascadeStats", () => {
  it("computes correct stats", () => {
    const state = createCascadeState();
    const root = addParentGoal(state, "a", "root", "r");
    const c = cascadeChild(state, root.id, "b", "child", "r")!;
    completeCascadeGoal(state, c.id);
    const stats = cascadeStats(state);
    assert.equal(stats.total, 2);
    assert.equal(stats.roots, 1);
    assert.equal(stats.completed, 2); // parent auto-completed
  });
});

describe("formatCascadeTree", () => {
  it("shows no-goals message when empty", () => {
    const state = createCascadeState();
    const lines = formatCascadeTree(state);
    assert.ok(lines.some((l) => l.includes("No cascading")));
  });

  it("shows tree with indentation", () => {
    const state = createCascadeState();
    const root = addParentGoal(state, "alpha", "build system", "r");
    cascadeChild(state, root.id, "beta", "implement auth", "r");
    const lines = formatCascadeTree(state);
    assert.ok(lines[0].includes("Goal Cascading"));
    assert.ok(lines.some((l) => l.includes("alpha")));
    assert.ok(lines.some((l) => l.includes("beta")));
  });
});
