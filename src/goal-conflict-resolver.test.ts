import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  extractKeywords,
  detectGoalConflicts,
  formatGoalConflicts,
} from "./goal-conflict-resolver.js";

describe("extractKeywords", () => {
  it("extracts meaningful words", () => {
    const kw = extractKeywords("Add authentication to the user dashboard");
    assert.ok(kw.includes("add"));
    assert.ok(kw.includes("authentication"));
    assert.ok(kw.includes("user"));
    assert.ok(kw.includes("dashboard"));
    assert.ok(!kw.includes("the")); // stopword
    assert.ok(!kw.includes("to"));  // stopword
  });
  it("handles empty string", () => {
    assert.deepEqual(extractKeywords(""), []);
  });
  it("strips punctuation", () => {
    const kw = extractKeywords("fix: user-auth bug (#123)");
    assert.ok(kw.includes("fix"));
    assert.ok(kw.includes("user-auth"));
    assert.ok(kw.includes("bug"));
    assert.ok(kw.includes("123"));
  });
});

describe("detectGoalConflicts", () => {
  it("detects goal keyword overlap", () => {
    const goals = [
      { sessionTitle: "a", goal: "implement user authentication login system page", repo: "app" },
      { sessionTitle: "b", goal: "add user authentication system login page", repo: "app" },
    ];
    const conflicts = detectGoalConflicts(goals);
    assert.ok(conflicts.length > 0);
    assert.equal(conflicts[0].conflictType, "goal-overlap");
  });

  it("no conflict for unrelated goals", () => {
    const goals = [
      { sessionTitle: "a", goal: "implement user authentication", repo: "app" },
      { sessionTitle: "b", goal: "fix database migration scripts", repo: "db" },
    ];
    const conflicts = detectGoalConflicts(goals);
    assert.equal(conflicts.length, 0);
  });

  it("detects file overlap", () => {
    const goals = [
      { sessionTitle: "a", goal: "refactor login", repo: "app", files: ["src/auth.ts", "src/login.ts"] },
      { sessionTitle: "b", goal: "fix auth bug", repo: "app", files: ["src/auth.ts", "src/config.ts"] },
    ];
    const conflicts = detectGoalConflicts(goals);
    const fileConflict = conflicts.find((c) => c.conflictType === "file-overlap");
    assert.ok(fileConflict);
    assert.ok(fileConflict!.description.includes("src/auth.ts"));
  });

  it("detects dependency cycles", () => {
    const goals = [
      { sessionTitle: "a", goal: "build frontend", repo: "web" },
      { sessionTitle: "b", goal: "build backend", repo: "api" },
    ];
    const deps = new Map([["a", ["b"]], ["b", ["a"]]]);
    const conflicts = detectGoalConflicts(goals, deps);
    const cycle = conflicts.find((c) => c.conflictType === "dependency-cycle");
    assert.ok(cycle);
    assert.equal(cycle!.severity, "high");
  });

  it("sorts by severity (high first)", () => {
    const goals = [
      { sessionTitle: "a", goal: "implement user auth login", repo: "app" },
      { sessionTitle: "b", goal: "add user auth login page", repo: "app" },
      { sessionTitle: "c", goal: "build database", repo: "api" },
    ];
    const deps = new Map([["a", ["c"]], ["c", ["a"]]]);
    const conflicts = detectGoalConflicts(goals, deps);
    if (conflicts.length >= 2) {
      const severities = conflicts.map((c) => c.severity);
      const sevIdx = { high: 0, medium: 1, low: 2 };
      for (let i = 1; i < severities.length; i++) {
        assert.ok(sevIdx[severities[i]] >= sevIdx[severities[i - 1]]);
      }
    }
  });

  it("handles empty input", () => {
    assert.deepEqual(detectGoalConflicts([]), []);
  });
});

describe("formatGoalConflicts", () => {
  it("shows no-conflict message", () => {
    const lines = formatGoalConflicts([]);
    assert.ok(lines[0].includes("none detected"));
  });
  it("shows conflict details", () => {
    const conflicts = [{
      sessionA: "auth", sessionB: "login",
      conflictType: "goal-overlap" as const,
      description: "75% overlap", severity: "high" as const,
      suggestion: "Merge sessions",
    }];
    const lines = formatGoalConflicts(conflicts);
    assert.ok(lines.some((l) => l.includes("auth")));
    assert.ok(lines.some((l) => l.includes("login")));
    assert.ok(lines.some((l) => l.includes("75%")));
  });
});
