import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveTitle, formatAgo, formatTaskTable } from "./task-manager.js";
import type { TaskState } from "./types.js";

// ── deriveTitle ─────────────────────────────────────────────────────────────

describe("deriveTitle", () => {
  it("extracts basename and lowercases", () => {
    assert.equal(deriveTitle("github/Adventure"), "adventure");
  });

  it("handles deeply nested paths", () => {
    assert.equal(deriveTitle("org/group/sub/my-project"), "my-project");
  });

  it("replaces special characters with dashes", () => {
    assert.equal(deriveTitle("My Cool Project!"), "my-cool-project-");
  });

  it("keeps hyphens and underscores", () => {
    assert.equal(deriveTitle("my_cool-repo"), "my_cool-repo");
  });

  it("handles bare name (no path separator)", () => {
    assert.equal(deriveTitle("adventure"), "adventure");
  });

  it("handles trailing slash", () => {
    // basename("foo/bar/") returns "" on some platforms, but Node returns "bar"
    // for "foo/bar/" — basename strips the trailing slash first
    const result = deriveTitle("foo/bar/");
    // Node basename("foo/bar/") = "bar"
    assert.equal(result, "bar");
  });
});

// ── formatAgo ───────────────────────────────────────────────────────────────

describe("formatAgo", () => {
  it("formats sub-minute as seconds", () => {
    assert.equal(formatAgo(5000), "5s ago");
    assert.equal(formatAgo(45_000), "45s ago");
  });

  it("formats minutes", () => {
    assert.equal(formatAgo(120_000), "2m ago");
    assert.equal(formatAgo(300_000), "5m ago");
  });

  it("formats hours", () => {
    assert.equal(formatAgo(3_600_000), "1h ago");
    assert.equal(formatAgo(7_200_000), "2h ago");
  });

  it("formats days", () => {
    assert.equal(formatAgo(86_400_000), "1d ago");
    assert.equal(formatAgo(172_800_000), "2d ago");
  });

  it("formats zero as 0s", () => {
    assert.equal(formatAgo(0), "0s ago");
  });
});

// ── formatTaskTable ─────────────────────────────────────────────────────────

function makeTask(overrides: Partial<TaskState> = {}): TaskState {
  return {
    repo: "github/test-project",
    sessionTitle: "test-project",
    sessionMode: "auto",
    tool: "opencode",
    goal: "Continue the roadmap",
    status: "pending",
    progress: [],
    ...overrides,
  };
}

describe("formatTaskTable", () => {
  it("returns placeholder for empty array", () => {
    const result = formatTaskTable([]);
    assert.ok(result.includes("no tasks defined"));
  });

  it("returns placeholder for empty map", () => {
    const result = formatTaskTable(new Map());
    assert.ok(result.includes("no tasks defined"));
  });

  it("renders a single pending task", () => {
    const result = formatTaskTable([makeTask()]);
    assert.ok(result.includes("github/test-project"));
    assert.ok(result.includes("pending"));
    assert.ok(result.includes("not started"));
  });

  it("renders an active task with progress", () => {
    const task = makeTask({
      status: "active",
      sessionId: "abcdef1234567890",
      progress: [{ at: Date.now() - 60_000, summary: "Fixed the bug" }],
    });
    const result = formatTaskTable([task]);
    assert.ok(result.includes("active"));
    assert.ok(result.includes("abcdef12")); // first 8 chars of session ID
    assert.ok(result.includes("Fixed the bug"));
  });

  it("renders a completed task", () => {
    const task = makeTask({ status: "completed" });
    const result = formatTaskTable([task]);
    assert.ok(result.includes("completed"));
  });

  it("truncates long repo names", () => {
    const task = makeTask({ repo: "very/deeply/nested/organization/project-name-that-is-very-long" });
    const result = formatTaskTable([task]);
    // repo column is max 27 chars, should truncate from the left
    assert.ok(result.includes("project-name-that-is-very-long".slice(-27)));
  });

  it("truncates long progress summaries", () => {
    const task = makeTask({
      status: "active",
      progress: [{ at: Date.now(), summary: "A".repeat(60) }],
    });
    const result = formatTaskTable([task]);
    assert.ok(result.includes("..."));
  });

  it("shows goal line for active and pending tasks", () => {
    const result = formatTaskTable([makeTask({ status: "active", goal: "Build the thing" })]);
    assert.ok(result.includes("goal: Build the thing"));
  });

  it("accepts a Map as input", () => {
    const map = new Map<string, TaskState>();
    map.set("github/foo", makeTask({ repo: "github/foo" }));
    const result = formatTaskTable(map);
    assert.ok(result.includes("github/foo"));
  });

  it("renders header with REPO STATUS MODE SESSION PROGRESS", () => {
    const result = formatTaskTable([makeTask()]);
    assert.ok(result.includes("REPO"));
    assert.ok(result.includes("STATUS"));
    assert.ok(result.includes("MODE"));
    assert.ok(result.includes("SESSION"));
    assert.ok(result.includes("PROGRESS"));
  });

  it("shows context line with session title and repo", () => {
    const result = formatTaskTable([makeTask({ sessionTitle: "adventure", repo: "github/adventure" })]);
    assert.ok(result.includes("context: adventure @ github/adventure"));
  });
});
