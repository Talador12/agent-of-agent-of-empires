import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { diffSessionOutput, formatSessionDiff } from "./session-snapshot-diff.js";

describe("diffSessionOutput", () => {
  it("detects added lines", () => {
    const d = diffSessionOutput("test", ["a", "b"], ["a", "b", "c"]);
    assert.deepEqual(d.addedLines, ["c"]);
    assert.equal(d.removedLines.length, 0);
  });
  it("detects removed lines", () => {
    const d = diffSessionOutput("test", ["a", "b", "c"], ["a", "c"]);
    assert.deepEqual(d.removedLines, ["b"]);
  });
  it("handles identical outputs", () => {
    const d = diffSessionOutput("test", ["a"], ["a"]);
    assert.equal(d.addedLines.length, 0);
    assert.equal(d.removedLines.length, 0);
  });
  it("handles empty before", () => {
    const d = diffSessionOutput("test", [], ["new"]);
    assert.deepEqual(d.addedLines, ["new"]);
  });
});

describe("formatSessionDiff", () => {
  it("shows no changes", () => {
    const d = diffSessionOutput("test", ["a"], ["a"]);
    const lines = formatSessionDiff(d);
    assert.ok(lines.some((l) => l.includes("no changes")));
  });
  it("shows added and removed", () => {
    const d = diffSessionOutput("test", ["old"], ["new"]);
    const lines = formatSessionDiff(d);
    assert.ok(lines.some((l) => l.includes("+")));
    assert.ok(lines.some((l) => l.includes("-")));
  });
});
