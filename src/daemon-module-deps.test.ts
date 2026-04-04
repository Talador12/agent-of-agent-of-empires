import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createModuleDepGraph, getDependents, getDependencies, getRoots, getLeaves, categoryBreakdown, mostDepended, moduleDepStats, formatModuleDeps } from "./daemon-module-deps.js";

const MODULES = [
  { moduleName: "poller", dependsOn: [], category: "core" as const },
  { moduleName: "reasoner", dependsOn: ["poller"], category: "core" as const },
  { moduleName: "executor", dependsOn: ["reasoner"], category: "core" as const },
  { moduleName: "summarizer", dependsOn: ["poller"], category: "intelligence" as const },
  { moduleName: "tui", dependsOn: ["poller", "reasoner"], category: "tui" as const },
];

describe("getDependents", () => {
  it("finds modules that depend on target", () => {
    const g = createModuleDepGraph(MODULES);
    const deps = getDependents(g, "poller");
    assert.ok(deps.includes("reasoner"));
    assert.ok(deps.includes("summarizer"));
    assert.ok(deps.includes("tui"));
  });
  it("returns empty for leaf modules", () => {
    const g = createModuleDepGraph(MODULES);
    assert.equal(getDependents(g, "executor").length, 0);
  });
});

describe("getDependencies", () => {
  it("finds dependencies of a module", () => {
    const g = createModuleDepGraph(MODULES);
    assert.deepEqual(getDependencies(g, "tui"), ["poller", "reasoner"]);
  });
  it("returns empty for root modules", () => {
    const g = createModuleDepGraph(MODULES);
    assert.deepEqual(getDependencies(g, "poller"), []);
  });
});

describe("getRoots", () => {
  it("finds modules with no dependencies", () => {
    const g = createModuleDepGraph(MODULES);
    assert.deepEqual(getRoots(g), ["poller"]);
  });
});

describe("getLeaves", () => {
  it("finds modules with no dependents", () => {
    const g = createModuleDepGraph(MODULES);
    const leaves = getLeaves(g);
    assert.ok(leaves.includes("executor"));
    assert.ok(leaves.includes("tui"));
  });
});

describe("categoryBreakdown", () => {
  it("counts by category", () => {
    const g = createModuleDepGraph(MODULES);
    const cats = categoryBreakdown(g);
    assert.equal(cats.get("core"), 3);
    assert.equal(cats.get("intelligence"), 1);
    assert.equal(cats.get("tui"), 1);
  });
});

describe("mostDepended", () => {
  it("finds most depended module", () => {
    const g = createModuleDepGraph(MODULES);
    const top = mostDepended(g);
    assert.ok(top);
    assert.equal(top!.moduleName, "poller"); // 3 dependents
  });
  it("returns null for empty graph", () => {
    assert.equal(mostDepended(createModuleDepGraph([])), null);
  });
});

describe("moduleDepStats", () => {
  it("computes correct stats", () => {
    const g = createModuleDepGraph(MODULES);
    const s = moduleDepStats(g);
    assert.equal(s.modules, 5);
    assert.equal(s.edges, 5);
    assert.equal(s.roots, 1);
    assert.equal(s.categories, 3);
  });
});

describe("formatModuleDeps", () => {
  it("shows graph summary", () => {
    const g = createModuleDepGraph(MODULES);
    const lines = formatModuleDeps(g);
    assert.ok(lines[0].includes("Module Dependencies"));
    assert.ok(lines.some((l) => l.includes("poller")));
  });
});
