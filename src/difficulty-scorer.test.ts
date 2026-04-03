import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { scoreDifficulty, formatDifficultyScores } from "./difficulty-scorer.js";

describe("scoreDifficulty", () => {
  it("scores simple task as easy", () => {
    const d = scoreDifficulty("test", "fix bug in login page");
    assert.ok(d.score <= 4);
    assert.ok(d.label === "trivial" || d.label === "easy");
  });

  it("scores complex task as hard", () => {
    const d = scoreDifficulty("test", [
      "1. Refactor the distributed database migration pipeline",
      "2. Add concurrent async worker pool for performance optimization",
      "3. Implement security hardening with input validation",
      "4. Set up CI/CD infrastructure with Terraform",
      "5. Deploy to production with zero-downtime migration",
      "6. Write comprehensive integration tests for all components",
    ].join("\n"));
    assert.ok(d.score >= 6, `expected score >= 6, got ${d.score}`);
    assert.ok(d.label === "hard" || d.label === "complex");
  });

  it("increases score for many sub-tasks", () => {
    const simple = scoreDifficulty("a", "do one thing");
    const complex = scoreDifficulty("b", "- task 1\n- task 2\n- task 3\n- task 4\n- task 5");
    assert.ok(complex.score > simple.score);
  });

  it("increases score for long goals", () => {
    const short = scoreDifficulty("a", "fix bug");
    const long = scoreDifficulty("b", "implement a comprehensive " + "feature ".repeat(20) + "with tests and documentation and deployment");
    assert.ok(long.score > short.score);
  });

  it("increases score for slow progress rate", () => {
    const fast = scoreDifficulty("a", "do task", 5, 30 * 60_000);
    const slow = scoreDifficulty("b", "do task", 1, 3 * 3_600_000);
    assert.ok(slow.score >= fast.score);
  });

  it("clamps score to 1-10", () => {
    const d1 = scoreDifficulty("a", "x"); // minimal
    assert.ok(d1.score >= 1 && d1.score <= 10);
    const d2 = scoreDifficulty("b", "refactor migrate rewrite architecture security performance optimize distributed concurrent async database schema deploy infrastructure CI/CD " + "x ".repeat(200));
    assert.ok(d2.score >= 1 && d2.score <= 10);
  });

  it("provides estimated hours", () => {
    const d = scoreDifficulty("test", "implement auth");
    assert.ok(d.estimatedHours > 0);
  });
});

describe("formatDifficultyScores", () => {
  it("handles empty", () => {
    const lines = formatDifficultyScores([]);
    assert.ok(lines[0].includes("no tasks"));
  });

  it("shows bar and label", () => {
    const scores = [scoreDifficulty("adventure", "implement the full auth system with OAuth")];
    const lines = formatDifficultyScores(scores);
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("█")));
  });
});
