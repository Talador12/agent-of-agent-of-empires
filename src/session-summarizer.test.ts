import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { summarizeSession, SessionSummarizer } from "./session-summarizer.js";

describe("summarizeSession", () => {
  it("returns idle for empty lines", () => {
    const result = summarizeSession("test", []);
    assert.equal(result.activity, "idle");
    assert.equal(result.summary, "idle");
  });

  it("detects error output", () => {
    const result = summarizeSession("test", ["error: Cannot find module 'foo'"]);
    assert.equal(result.activity, "error");
    assert.ok(result.summary.includes("Cannot find module"));
  });

  it("detects ERR! prefix", () => {
    const result = summarizeSession("test", ["ERR! some npm error"]);
    assert.equal(result.activity, "error");
  });

  it("detects crash patterns", () => {
    const result = summarizeSession("test", ["Segmentation fault (core dumped)"]);
    assert.equal(result.activity, "error");
    assert.ok(result.summary.includes("crash"));
  });

  it("detects git commit", () => {
    const result = summarizeSession("test", ["[main abc1234] fix: resolve build issue"]);
    assert.equal(result.activity, "committing");
    assert.ok(result.summary.includes("committed"));
  });

  it("detects git push", () => {
    const result = summarizeSession("test", ["   abc1234..def5678  main -> main"]);
    assert.equal(result.activity, "committing");
    assert.ok(result.summary.includes("pushed"));
  });

  it("detects node:test results", () => {
    const result = summarizeSession("test", ["ℹ tests 2708"]);
    assert.equal(result.activity, "testing");
    assert.ok(result.summary.includes("2708"));
  });

  it("detects jest results", () => {
    const result = summarizeSession("test", ["Tests:  104 passed, 104 total"]);
    assert.equal(result.activity, "testing");
    assert.ok(result.summary.includes("104"));
  });

  it("detects build completion", () => {
    const result = summarizeSession("test", ["build completed successfully"]);
    assert.equal(result.activity, "building");
    assert.ok(result.summary.includes("build"));
  });

  it("detects vite build", () => {
    const result = summarizeSession("test", ["✓ built in 2.3s"]);
    assert.equal(result.activity, "building");
  });

  it("detects npm install", () => {
    const result = summarizeSession("test", ["npm install express"]);
    assert.equal(result.activity, "installing");
  });

  it("detects package installation count", () => {
    const result = summarizeSession("test", ["added 42 packages"]);
    assert.equal(result.activity, "installing");
    assert.ok(result.summary.includes("42"));
  });

  it("detects file editing", () => {
    const result = summarizeSession("test", ["Edit src/index.ts"]);
    assert.equal(result.activity, "coding");
    assert.ok(result.summary.includes("src/index.ts"));
  });

  it("detects file writing", () => {
    const result = summarizeSession("test", ["Write src/new-file.ts"]);
    assert.equal(result.activity, "coding");
    assert.ok(result.summary.includes("src/new-file.ts"));
  });

  it("detects permission prompt", () => {
    const result = summarizeSession("test", ["Permission required", "Allow once   Allow always   Reject"]);
    assert.equal(result.activity, "waiting");
  });

  it("detects debugging activity", () => {
    const result = summarizeSession("test", ["fixing the import path issue"]);
    assert.equal(result.activity, "debugging");
  });

  it("priorities error over lower signals", () => {
    const result = summarizeSession("test", [
      "Edit src/foo.ts",
      "error: type mismatch",
    ]);
    assert.equal(result.activity, "error");
  });

  it("priorities commit over coding", () => {
    const result = summarizeSession("test", [
      "Edit src/foo.ts",
      "[main abc1234] feat: new feature",
    ]);
    assert.equal(result.activity, "committing");
  });

  it("strips ANSI codes", () => {
    const result = summarizeSession("test", ["\x1b[32m✓ built in 3s\x1b[0m"]);
    assert.equal(result.activity, "building");
  });

  it("falls back to unknown with last line", () => {
    const result = summarizeSession("test", ["some random output here"]);
    assert.equal(result.activity, "unknown");
    assert.ok(result.summary.includes("some random output"));
  });

  it("truncates long fallback lines", () => {
    const longLine = "a".repeat(100);
    const result = summarizeSession("test", [longLine]);
    assert.ok(result.summary.length <= 63); // 60 + "..."
  });

  it("detects test running commands", () => {
    const result = summarizeSession("test", ["npm test"]);
    assert.equal(result.activity, "testing");
  });

  it("detects code review mentions", () => {
    const result = summarizeSession("test", ["reviewing the pull request"]);
    assert.equal(result.activity, "reviewing");
  });
});

describe("SessionSummarizer", () => {
  it("tracks summaries per session", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("session-a", ["Edit src/foo.ts"]);
    summarizer.update("session-b", ["npm test"]);
    assert.equal(summarizer.get("session-a")?.activity, "coding");
    assert.equal(summarizer.get("session-b")?.activity, "testing");
  });

  it("retains last summary when new lines are empty", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("session-a", ["Edit src/foo.ts"]);
    assert.equal(summarizer.get("session-a")?.activity, "coding");
    // empty update should keep the previous summary
    summarizer.update("session-a", []);
    assert.equal(summarizer.get("session-a")?.activity, "coding");
  });

  it("replaces summary with new activity", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("session-a", ["Edit src/foo.ts"]);
    assert.equal(summarizer.get("session-a")?.activity, "coding");
    summarizer.update("session-a", ["error: something broke"]);
    assert.equal(summarizer.get("session-a")?.activity, "error");
  });

  it("getAll returns all summaries", () => {
    const summarizer = new SessionSummarizer();
    summarizer.update("a", ["Edit foo.ts"]);
    summarizer.update("b", ["npm test"]);
    const all = summarizer.getAll();
    assert.equal(all.size, 2);
    assert.ok(all.has("a"));
    assert.ok(all.has("b"));
  });

  it("returns undefined for unknown session", () => {
    const summarizer = new SessionSummarizer();
    assert.equal(summarizer.get("nope"), undefined);
  });

  it("format produces an icon + text", () => {
    const summary = {
      sessionTitle: "test",
      summary: "editing src/foo.ts",
      activity: "coding" as const,
      timestamp: Date.now(),
    };
    const formatted = SessionSummarizer.format(summary);
    assert.ok(formatted.includes("editing src/foo.ts"));
  });
});
