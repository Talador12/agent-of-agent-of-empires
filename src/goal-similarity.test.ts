import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { jaccardSimilarity, findSimilarGoals, formatSimilarGoals } from "./goal-similarity.js";
import type { TaskState } from "./types.js";

describe("jaccardSimilarity", () => {
  it("returns 1 for identical sets", () => {
    assert.equal(jaccardSimilarity(new Set(["a", "b"]), new Set(["a", "b"])), 1);
  });
  it("returns 0 for disjoint sets", () => {
    assert.equal(jaccardSimilarity(new Set(["a"]), new Set(["b"])), 0);
  });
  it("returns 0 for empty sets", () => {
    assert.equal(jaccardSimilarity(new Set(), new Set()), 0);
  });
  it("computes correctly for partial overlap", () => {
    // {a,b,c} ∩ {b,c,d} = {b,c}, union = {a,b,c,d} → 2/4 = 0.5
    assert.equal(jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"])), 0.5);
  });
});

describe("findSimilarGoals", () => {
  const makeTask = (title: string, goal: string): TaskState => ({
    repo: "t", sessionTitle: title, sessionMode: "auto", tool: "opencode", goal, status: "active", progress: [],
  });

  it("finds similar goals", () => {
    const tasks = [
      makeTask("a", "implement authentication system with OAuth login"),
      makeTask("b", "implement authentication module with OAuth provider"),
      makeTask("c", "build music synthesizer with polyphony"),
    ];
    const pairs = findSimilarGoals(tasks, 0.2);
    assert.ok(pairs.some((p) => p.titleA === "a" && p.titleB === "b"));
    assert.ok(!pairs.some((p) => p.titleA === "a" && p.titleB === "c"));
  });

  it("returns empty for dissimilar goals", () => {
    const tasks = [
      makeTask("a", "implement authentication system"),
      makeTask("b", "build music synthesizer engine"),
    ];
    assert.equal(findSimilarGoals(tasks, 0.5).length, 0);
  });

  it("sorts by similarity descending", () => {
    const tasks = [
      makeTask("a", "implement auth login system"),
      makeTask("b", "implement auth login module"),
      makeTask("c", "implement auth system"),
    ];
    const pairs = findSimilarGoals(tasks, 0.1);
    if (pairs.length >= 2) {
      assert.ok(pairs[0].similarity >= pairs[1].similarity);
    }
  });
});

describe("formatSimilarGoals", () => {
  it("handles empty", () => {
    const lines = formatSimilarGoals([]);
    assert.ok(lines[0].includes("no similar"));
  });
  it("shows pairs", () => {
    const pairs = [{ titleA: "auth", titleB: "login", similarity: 0.75, sharedKeywords: ["implement", "system"] }];
    const lines = formatSimilarGoals(pairs);
    assert.ok(lines.some((l) => l.includes("75%")));
    assert.ok(lines.some((l) => l.includes("auth")));
  });
});
