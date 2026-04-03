import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseGoal, parseGoals, formatParsedGoal, formatParsedGoals } from "./goal-nl-parser.js";

describe("parseGoal", () => {
  it("extracts action verb", () => {
    const g = parseGoal("fix the authentication bug");
    assert.equal(g.action, "fix");
  });

  it("extracts target noun", () => {
    const g = parseGoal("build user dashboard");
    assert.equal(g.target, "user");
  });

  it("detects repo references", () => {
    const g = parseGoal("deploy github/adventure to production");
    assert.equal(g.repo, "github/adventure");
  });

  it("detects critical priority", () => {
    const g = parseGoal("critical: fix security vulnerability");
    assert.equal(g.priority, "critical");
  });

  it("detects high priority", () => {
    const g = parseGoal("important: update dependencies");
    assert.equal(g.priority, "high");
  });

  it("detects dependencies", () => {
    const g = parseGoal("deploy frontend after backend is ready");
    assert.ok(g.dependencies.includes("backend"));
  });

  it("detects blocked-by dependencies", () => {
    const g = parseGoal("migration blocked by schema-update");
    assert.ok(g.dependencies.includes("schema-update"));
  });

  it("extracts tags", () => {
    const g = parseGoal("fix auth bug #security @alice");
    assert.ok(g.tags.includes("#security"));
    assert.ok(g.tags.includes("@alice"));
  });

  it("returns normal priority by default", () => {
    const g = parseGoal("add dark mode toggle");
    assert.equal(g.priority, "normal");
  });

  it("higher confidence with more extracted info", () => {
    const rich = parseGoal("fix the authentication bug in github/app after backend #security");
    const poor = parseGoal("stuff");
    assert.ok(rich.confidence > poor.confidence);
  });

  it("handles empty string", () => {
    const g = parseGoal("");
    assert.equal(g.action, null);
    assert.equal(g.target, null);
  });
});

describe("parseGoals", () => {
  it("parses multiple lines", () => {
    const goals = parseGoals(["fix auth bug", "build dashboard", ""]);
    assert.equal(goals.length, 2);
  });
});

describe("formatParsedGoal", () => {
  it("shows confidence indicator", () => {
    const g = parseGoal("fix the auth bug");
    const lines = formatParsedGoal(g);
    assert.ok(lines[0].includes("fix the auth bug"));
    assert.ok(lines[0].includes("%"));
  });
});

describe("formatParsedGoals", () => {
  it("shows no-text message when empty", () => {
    const lines = formatParsedGoals([]);
    assert.ok(lines[0].includes("no text"));
  });

  it("shows parsed goals", () => {
    const goals = parseGoals(["fix auth bug", "build dashboard"]);
    const lines = formatParsedGoals(goals);
    assert.ok(lines[0].includes("Goal NL Parser"));
  });
});
