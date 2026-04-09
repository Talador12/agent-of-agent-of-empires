// batch-goal-assignment.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseManifest,
  validateDependencies,
  applyManifest,
  generateTemplate,
  formatManifest,
  formatAssignment,
} from "./batch-goal-assignment.js";

describe("parseManifest", () => {
  it("parses a single session block", () => {
    const text = `
[my-session]
goal: fix the login bug
priority: high
tags: frontend, auth
`;
    const result = parseManifest(text);
    assert.equal(result.goals.length, 1);
    assert.equal(result.goals[0].session, "my-session");
    assert.equal(result.goals[0].goal, "fix the login bug");
    assert.equal(result.goals[0].priority, "high");
    assert.deepEqual(result.goals[0].tags, ["frontend", "auth"]);
    assert.equal(result.errors.length, 0);
  });

  it("parses multiple session blocks", () => {
    const text = `
[session-a]
goal: build the API

[session-b]
goal: write tests
depends: session-a
`;
    const result = parseManifest(text);
    assert.equal(result.goals.length, 2);
    assert.equal(result.goals[0].session, "session-a");
    assert.equal(result.goals[1].session, "session-b");
    assert.deepEqual(result.goals[1].dependsOn, ["session-a"]);
  });

  it("handles budget field", () => {
    const text = `
[test]
goal: deploy
budget: 5.50
`;
    const result = parseManifest(text);
    assert.equal(result.goals[0].budgetUsd, 5.50);
  });

  it("handles repo field", () => {
    const text = `
[test]
goal: refactor
repo: /Users/dev/my-project
`;
    const result = parseManifest(text);
    assert.equal(result.goals[0].repo, "/Users/dev/my-project");
  });

  it("skips comments and blank lines", () => {
    const text = `
# this is a comment

[test]
# another comment
goal: do stuff
`;
    const result = parseManifest(text);
    assert.equal(result.goals.length, 1);
    assert.equal(result.errors.length, 0);
  });

  it("reports error for invalid syntax", () => {
    const text = `
[test]
goal: do stuff
not a valid line
`;
    const result = parseManifest(text);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].message.includes("invalid syntax"));
  });

  it("reports error for key-value outside block", () => {
    const text = `goal: orphaned`;
    const result = parseManifest(text);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].message.includes("outside"));
  });

  it("reports error for invalid priority", () => {
    const text = `
[test]
goal: x
priority: super-urgent
`;
    const result = parseManifest(text);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].message.includes("invalid priority"));
  });

  it("warns for unknown keys", () => {
    const text = `
[test]
goal: x
foobar: y
`;
    const result = parseManifest(text);
    assert.ok(result.warnings.length > 0);
    assert.ok(result.warnings[0].includes("foobar"));
  });

  it("warns for session with no goal", () => {
    const text = `[empty-session]`;
    const result = parseManifest(text);
    assert.ok(result.warnings.some((w) => w.includes("no goal")));
  });

  it("handles depends-on alias", () => {
    const text = `
[test]
goal: x
depends-on: a, b
`;
    const result = parseManifest(text);
    assert.deepEqual(result.goals[0].dependsOn, ["a", "b"]);
  });

  it("handles empty input", () => {
    const result = parseManifest("");
    assert.equal(result.goals.length, 0);
    assert.equal(result.errors.length, 0);
  });
});

describe("validateDependencies", () => {
  it("returns empty for valid deps", () => {
    const goals = [
      { session: "a", goal: "x" },
      { session: "b", goal: "y", dependsOn: ["a"] },
    ];
    assert.equal(validateDependencies(goals).length, 0);
  });

  it("reports missing dependency", () => {
    const goals = [
      { session: "a", goal: "x", dependsOn: ["nonexistent"] },
    ];
    const errors = validateDependencies(goals);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("nonexistent"));
  });
});

describe("applyManifest", () => {
  it("assigns goals to matching sessions", () => {
    const manifest = parseManifest(`
[frontend]
goal: fix layout
[backend]
goal: add endpoint
`);
    const result = applyManifest(manifest, ["frontend", "backend"]);
    assert.equal(result.assigned.length, 2);
    assert.equal(result.skipped.length, 0);
  });

  it("skips sessions not found", () => {
    const manifest = parseManifest(`
[missing-session]
goal: do stuff
`);
    const result = applyManifest(manifest, ["other"]);
    assert.equal(result.skipped.length, 1);
    assert.ok(result.skipped[0].reason.includes("not found"));
  });

  it("case-insensitive session matching", () => {
    const manifest = parseManifest(`
[Frontend]
goal: fix stuff
`);
    const result = applyManifest(manifest, ["frontend"]);
    assert.equal(result.assigned.length, 1);
  });
});

describe("generateTemplate", () => {
  it("generates template for sessions", () => {
    const template = generateTemplate([
      { title: "frontend", repo: "/repos/app" },
      { title: "backend" },
    ]);
    assert.ok(template.includes("[frontend]"));
    assert.ok(template.includes("[backend]"));
    assert.ok(template.includes("repo: /repos/app"));
    assert.ok(template.includes("goal:"));
  });
});

describe("formatManifest", () => {
  it("formats parsed manifest for TUI", () => {
    const manifest = parseManifest(`
[test]
goal: fix bug
priority: critical
tags: urgent
`);
    const lines = formatManifest(manifest);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("1 goals"));
    assert.ok(lines.some((l) => l.includes("fix bug")));
    assert.ok(lines.some((l) => l.includes("critical")));
  });
});

describe("formatAssignment", () => {
  it("formats assignment result", () => {
    const manifest = parseManifest(`
[s1]
goal: task1
[s2]
goal: task2
`);
    const result = applyManifest(manifest, ["s1"]);
    const lines = formatAssignment(result);
    assert.ok(lines[0].includes("1 assigned"));
    assert.ok(lines[0].includes("1 skipped"));
  });
});
