import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createContextDiffState, hashContent, diffContextFiles,
  getChangedFiles, diffSummary, formatContextDiff,
} from "./session-context-diff.js";

describe("hashContent", () => {
  it("produces consistent hashes", () => {
    assert.equal(hashContent("hello"), hashContent("hello"));
  });

  it("produces different hashes for different content", () => {
    assert.notEqual(hashContent("hello"), hashContent("world"));
  });
});

describe("createContextDiffState", () => {
  it("starts empty", () => {
    const s = createContextDiffState();
    assert.equal(s.hashes.size, 0);
  });
});

describe("diffContextFiles", () => {
  it("detects new files", () => {
    const state = createContextDiffState();
    const files = new Map([["a.md", "content"]]);
    const changes = diffContextFiles(state, files);
    assert.ok(changes.some((c) => c.type === "added"));
  });

  it("detects unchanged files on second check", () => {
    const state = createContextDiffState();
    const files = new Map([["a.md", "content"]]);
    diffContextFiles(state, files);
    const changes = diffContextFiles(state, files);
    assert.ok(changes.some((c) => c.type === "unchanged"));
  });

  it("detects modified files", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["a.md", "old content"]]));
    const changes = diffContextFiles(state, new Map([["a.md", "new content"]]));
    assert.ok(changes.some((c) => c.type === "modified"));
  });

  it("detects removed files", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["a.md", "content"]]));
    const changes = diffContextFiles(state, new Map());
    assert.ok(changes.some((c) => c.type === "removed"));
  });

  it("handles multiple files at once", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["a.md", "a"], ["b.md", "b"]]));
    const changes = diffContextFiles(state, new Map([["a.md", "a-changed"], ["c.md", "c"]]));
    const summary = diffSummary(changes);
    assert.equal(summary.modified, 1); // a changed
    assert.equal(summary.added, 1);    // c new
    assert.equal(summary.removed, 1);  // b removed
  });
});

describe("getChangedFiles", () => {
  it("excludes unchanged files", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["a.md", "content"]]));
    const changes = diffContextFiles(state, new Map([["a.md", "content"]]));
    assert.equal(getChangedFiles(changes).length, 0);
  });
});

describe("diffSummary", () => {
  it("computes correct counts", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["a.md", "a"], ["b.md", "b"]]));
    const changes = diffContextFiles(state, new Map([["a.md", "a"], ["b.md", "b-changed"], ["c.md", "c"]]));
    const summary = diffSummary(changes);
    assert.equal(summary.unchanged, 1); // a
    assert.equal(summary.modified, 1);  // b
    assert.equal(summary.added, 1);     // c
    assert.equal(summary.total, 3);
  });
});

describe("formatContextDiff", () => {
  it("shows no-changes message when nothing changed", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["a.md", "x"]]));
    const changes = diffContextFiles(state, new Map([["a.md", "x"]]));
    const lines = formatContextDiff(changes);
    assert.ok(lines.some((l) => l.includes("No changes")));
  });

  it("shows changed files", () => {
    const state = createContextDiffState();
    diffContextFiles(state, new Map([["AGENTS.md", "old"]]));
    const changes = diffContextFiles(state, new Map([["AGENTS.md", "new"]]));
    const lines = formatContextDiff(changes);
    assert.ok(lines.some((l) => l.includes("AGENTS.md")));
    assert.ok(lines.some((l) => l.includes("modified")));
  });
});
