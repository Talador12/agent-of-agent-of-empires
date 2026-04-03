import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { cloneSession, formatCloneResult } from "./session-clone.js";
import type { TaskState } from "./types.js";

const source: TaskState = { repo: "test/adventure", sessionTitle: "adventure", sessionMode: "auto", tool: "opencode", goal: "implement auth", status: "active", progress: [] };

describe("cloneSession", () => {
  it("clones with new title", () => {
    const def = cloneSession(source, { sourceTitle: "adventure", cloneTitle: "adventure-v2" });
    assert.equal(def.sessionTitle, "adventure-v2");
    assert.equal(def.goal, "implement auth");
    assert.equal(def.tool, "opencode");
  });
  it("overrides goal", () => {
    const def = cloneSession(source, { sourceTitle: "adventure", cloneTitle: "alt", goalOverride: "try different approach" });
    assert.equal(def.goal, "try different approach");
  });
  it("overrides tool", () => {
    const def = cloneSession(source, { sourceTitle: "adventure", cloneTitle: "alt", toolOverride: "claude-code" });
    assert.equal(def.tool, "claude-code");
  });
  it("has no dependencies", () => {
    const def = cloneSession(source, { sourceTitle: "adventure", cloneTitle: "alt" });
    assert.equal(def.dependsOn, undefined);
  });
});

describe("formatCloneResult", () => {
  it("shows original and clone names", () => {
    const lines = formatCloneResult({ original: "adventure", clone: "adventure-v2", goal: "implement auth", tool: "opencode" });
    assert.ok(lines[0].includes("adventure") && lines[0].includes("adventure-v2"));
  });
});
