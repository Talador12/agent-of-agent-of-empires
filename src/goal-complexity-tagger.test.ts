import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { estimateComplexity, tagFleetComplexity, formatComplexityTags } from "./goal-complexity-tagger.js";

describe("estimateComplexity", () => {
  it("tags simple goals as simple/trivial", () => {
    const t = estimateComplexity("a", "fix typo");
    assert.ok(["trivial", "simple"].includes(t.level));
  });
  it("tags large-scope goals as complex/epic", () => {
    const t = estimateComplexity("a", "refactor the entire authentication system infrastructure and migrate to new platform");
    assert.ok(["complex", "epic"].includes(t.level));
  });
  it("increases score for dependencies", () => {
    const noDeps = estimateComplexity("a", "build feature", 0);
    const withDeps = estimateComplexity("a", "build feature", 4);
    assert.ok(withDeps.score > noDeps.score);
  });
  it("increases score for sub-goals", () => {
    const noSubs = estimateComplexity("a", "build feature", 0, 0);
    const withSubs = estimateComplexity("a", "build feature", 0, 6);
    assert.ok(withSubs.score > noSubs.score);
  });
  it("decreases score for small-scope keywords", () => {
    const small = estimateComplexity("a", "fix lint typo");
    const normal = estimateComplexity("a", "build dashboard component");
    assert.ok(small.score <= normal.score);
  });
  it("increases score for long descriptions", () => {
    const short = estimateComplexity("a", "fix bug");
    const long = estimateComplexity("a", "implement the full user authentication system with OAuth integration and role-based access control including admin dashboard and audit logging");
    assert.ok(long.score > short.score);
  });
  it("score is 0-100", () => {
    const t = estimateComplexity("a", "refactor migrate redesign rewrite overhaul architecture infrastructure platform framework system", 10, 20);
    assert.ok(t.score >= 0 && t.score <= 100);
  });
  it("includes factors", () => {
    const t = estimateComplexity("a", "refactor authentication system", 3);
    assert.ok(t.factors.length > 0);
  });
});

describe("tagFleetComplexity", () => {
  it("tags and sorts by score descending", () => {
    const tags = tagFleetComplexity([
      { sessionTitle: "simple", goal: "fix typo", depCount: 0, subGoalCount: 0 },
      { sessionTitle: "complex", goal: "refactor entire platform infrastructure", depCount: 5, subGoalCount: 8 },
    ]);
    assert.equal(tags[0].sessionTitle, "complex");
  });
  it("handles empty input", () => {
    assert.equal(tagFleetComplexity([]).length, 0);
  });
});

describe("formatComplexityTags", () => {
  it("shows no-goals message when empty", () => {
    const lines = formatComplexityTags([]);
    assert.ok(lines[0].includes("no goals"));
  });
  it("shows complexity with icons", () => {
    const tags = tagFleetComplexity([{ sessionTitle: "alpha", goal: "build auth", depCount: 0, subGoalCount: 0 }]);
    const lines = formatComplexityTags(tags);
    assert.ok(lines[0].includes("Goal Complexity"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
