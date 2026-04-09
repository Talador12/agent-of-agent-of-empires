// alert-rule-inheritance.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveInheritance,
  getInheritanceChain,
  formatInheritanceTree,
  type InheritableRule,
} from "./alert-rule-inheritance.js";

describe("resolveInheritance", () => {
  it("resolves root rules with defaults", () => {
    const rules: InheritableRule[] = [
      { id: "r1", name: "Root Rule" },
    ];
    const result = resolveInheritance(rules);
    assert.equal(result.rules.length, 1);
    assert.equal(result.rootCount, 1);
    assert.equal(result.rules[0].severity, "warning");
    assert.equal(result.rules[0].cooldownMs, 300_000);
    assert.equal(result.rules[0].enabled, true);
    assert.equal(result.rules[0].depth, 0);
  });

  it("child inherits parent severity", () => {
    const rules: InheritableRule[] = [
      { id: "parent", name: "Parent", severity: "critical", cooldownMs: 60_000 },
      { id: "child", parentId: "parent", name: "Child" },
    ];
    const result = resolveInheritance(rules);
    const child = result.rules.find((r) => r.id === "child")!;
    assert.equal(child.severity, "critical");
    assert.equal(child.cooldownMs, 60_000);
    assert.equal(child.depth, 1);
    assert.ok(child.inheritedFrom.includes("severity"));
    assert.ok(child.inheritedFrom.includes("cooldownMs"));
  });

  it("child overrides parent fields", () => {
    const rules: InheritableRule[] = [
      { id: "parent", name: "Parent", severity: "critical" },
      { id: "child", parentId: "parent", name: "Child", severity: "info" },
    ];
    const result = resolveInheritance(rules);
    const child = result.rules.find((r) => r.id === "child")!;
    assert.equal(child.severity, "info");
    assert.ok(!child.inheritedFrom.includes("severity"));
  });

  it("supports multi-level inheritance", () => {
    const rules: InheritableRule[] = [
      { id: "root", name: "Root", severity: "error", cooldownMs: 120_000 },
      { id: "mid", parentId: "root", name: "Mid", cooldownMs: 60_000 },
      { id: "leaf", parentId: "mid", name: "Leaf" },
    ];
    const result = resolveInheritance(rules);
    assert.equal(result.maxDepth, 2);
    const leaf = result.rules.find((r) => r.id === "leaf")!;
    assert.equal(leaf.severity, "error");      // from root
    assert.equal(leaf.cooldownMs, 60_000);     // from mid (overridden)
    assert.equal(leaf.depth, 2);
  });

  it("detects orphan rules", () => {
    const rules: InheritableRule[] = [
      { id: "child", parentId: "nonexistent", name: "Orphan" },
    ];
    const result = resolveInheritance(rules);
    assert.ok(result.orphanIds.includes("child"));
    assert.equal(result.rules.length, 1);
  });

  it("detects circular references", () => {
    const rules: InheritableRule[] = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ];
    const result = resolveInheritance(rules);
    assert.ok(result.circularIds.length > 0);
  });

  it("handles empty input", () => {
    const result = resolveInheritance([]);
    assert.equal(result.rules.length, 0);
    assert.equal(result.rootCount, 0);
    assert.equal(result.maxDepth, 0);
  });

  it("inherits tags from parent", () => {
    const rules: InheritableRule[] = [
      { id: "p", name: "P", tags: ["fleet", "cost"] },
      { id: "c", parentId: "p", name: "C" },
    ];
    const result = resolveInheritance(rules);
    const child = result.rules.find((r) => r.id === "c")!;
    assert.deepEqual(child.tags, ["fleet", "cost"]);
  });

  it("child can override tags", () => {
    const rules: InheritableRule[] = [
      { id: "p", name: "P", tags: ["fleet"] },
      { id: "c", parentId: "p", name: "C", tags: ["session"] },
    ];
    const result = resolveInheritance(rules);
    const child = result.rules.find((r) => r.id === "c")!;
    assert.deepEqual(child.tags, ["session"]);
  });

  it("inherits enabled=false from parent", () => {
    const rules: InheritableRule[] = [
      { id: "p", name: "P", enabled: false },
      { id: "c", parentId: "p", name: "C" },
    ];
    const result = resolveInheritance(rules);
    const child = result.rules.find((r) => r.id === "c")!;
    assert.equal(child.enabled, false);
  });

  it("handles multiple root rules independently", () => {
    const rules: InheritableRule[] = [
      { id: "r1", name: "Root1", severity: "critical" },
      { id: "r2", name: "Root2", severity: "info" },
      { id: "c1", parentId: "r1", name: "Child1" },
      { id: "c2", parentId: "r2", name: "Child2" },
    ];
    const result = resolveInheritance(rules);
    assert.equal(result.rootCount, 2);
    assert.equal(result.rules.find((r) => r.id === "c1")!.severity, "critical");
    assert.equal(result.rules.find((r) => r.id === "c2")!.severity, "info");
  });
});

describe("getInheritanceChain", () => {
  it("returns chain from root to leaf", () => {
    const rules: InheritableRule[] = [
      { id: "root", name: "Root" },
      { id: "mid", parentId: "root", name: "Mid" },
      { id: "leaf", parentId: "mid", name: "Leaf" },
    ];
    const resolved = resolveInheritance(rules).rules;
    const chain = getInheritanceChain(resolved, "leaf");
    assert.equal(chain.length, 3);
    assert.equal(chain[0].id, "root");
    assert.equal(chain[1].id, "mid");
    assert.equal(chain[2].id, "leaf");
  });

  it("returns single element for root", () => {
    const rules: InheritableRule[] = [{ id: "r", name: "Root" }];
    const resolved = resolveInheritance(rules).rules;
    const chain = getInheritanceChain(resolved, "r");
    assert.equal(chain.length, 1);
  });

  it("returns empty for unknown id", () => {
    const chain = getInheritanceChain([], "unknown");
    assert.equal(chain.length, 0);
  });
});

describe("formatInheritanceTree", () => {
  it("formats tree view with inheritance info", () => {
    const rules: InheritableRule[] = [
      { id: "root", name: "Fleet Alert", severity: "error", cooldownMs: 120_000 },
      { id: "child1", parentId: "root", name: "Cost Alert" },
      { id: "child2", parentId: "root", name: "Health Alert", severity: "critical" },
    ];
    const result = resolveInheritance(rules);
    const lines = formatInheritanceTree(result);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("3 rules"));
    assert.ok(lines[0].includes("1 roots"));
    assert.ok(lines.some((l) => l.includes("Fleet Alert")));
    assert.ok(lines.some((l) => l.includes("Cost Alert")));
    assert.ok(lines.some((l) => l.includes("inherits:")));
  });

  it("shows orphan warnings", () => {
    const rules: InheritableRule[] = [
      { id: "orphan", parentId: "missing", name: "Lost Rule" },
    ];
    const result = resolveInheritance(rules);
    const lines = formatInheritanceTree(result);
    assert.ok(lines.some((l) => l.includes("orphan")));
  });
});
