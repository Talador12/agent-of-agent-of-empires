import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { extractKeywords, scoreDecomposition, formatDecompQuality } from "./goal-decomp-quality.js";

describe("extractKeywords", () => {
  it("extracts meaningful words", () => {
    const kw = extractKeywords("Build user authentication system");
    assert.ok(kw.includes("build"));
    assert.ok(kw.includes("user"));
    assert.ok(kw.includes("authentication"));
    assert.ok(kw.includes("system"));
  });

  it("filters stopwords", () => {
    const kw = extractKeywords("the quick and the brown");
    assert.ok(!kw.includes("the"));
    assert.ok(!kw.includes("and"));
  });

  it("handles empty string", () => {
    assert.deepEqual(extractKeywords(""), []);
  });
});

describe("scoreDecomposition", () => {
  it("scores high for good coverage", () => {
    const result = scoreDecomposition({
      parentGoal: "Build user authentication login system",
      subGoals: ["implement user login page", "build authentication backend", "create session system"],
    });
    assert.ok(result.coveragePct >= 60);
    assert.ok(["A", "B"].includes(result.grade));
  });

  it("scores low for poor coverage", () => {
    const result = scoreDecomposition({
      parentGoal: "Build user authentication login system with OAuth",
      subGoals: ["update readme"],
    });
    assert.ok(result.coveragePct < 50);
  });

  it("handles zero sub-goals", () => {
    const result = scoreDecomposition({ parentGoal: "Build something", subGoals: [] });
    assert.equal(result.coveragePct, 0);
    assert.equal(result.grade, "F");
  });

  it("suggests adding sub-goals for uncovered keywords", () => {
    const result = scoreDecomposition({
      parentGoal: "Build authentication and authorization with OAuth",
      subGoals: ["implement authentication"],
    });
    assert.ok(result.suggestions.length > 0);
    assert.ok(result.uncoveredKeywords.length > 0);
  });

  it("warns about single sub-goal", () => {
    const result = scoreDecomposition({
      parentGoal: "Build system",
      subGoals: ["build the system"],
    });
    assert.ok(result.suggestions.some((s) => s.includes("1 sub-goal")));
  });

  it("warns about too many sub-goals", () => {
    const result = scoreDecomposition({
      parentGoal: "Build system",
      subGoals: Array.from({ length: 10 }, (_, i) => `task ${i}`),
    });
    assert.ok(result.suggestions.some((s) => s.includes("grouping")));
  });

  it("gives A grade for full coverage", () => {
    const result = scoreDecomposition({
      parentGoal: "add dark mode toggle",
      subGoals: ["implement dark mode CSS", "add toggle component", "wire dark mode state"],
    });
    assert.equal(result.grade, "A");
  });
});

describe("formatDecompQuality", () => {
  it("shows grade and coverage", () => {
    const result = scoreDecomposition({
      parentGoal: "Build auth",
      subGoals: ["implement auth"],
    });
    const lines = formatDecompQuality(result);
    assert.ok(lines[0].includes("Grade"));
    assert.ok(lines[0].includes("%"));
  });

  it("shows uncovered keywords", () => {
    const result = scoreDecomposition({
      parentGoal: "Build authentication and authorization",
      subGoals: ["add login"],
    });
    const lines = formatDecompQuality(result);
    assert.ok(lines.some((l) => l.includes("Uncovered")));
  });
});
