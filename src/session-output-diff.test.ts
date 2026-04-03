import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeOutputDiff, formatOutputDiff } from "./session-output-diff.js";

describe("computeOutputDiff", () => {
  it("detects added lines", () => {
    const prev = "line 1\nline 2";
    const curr = "line 1\nline 2\nline 3";
    const diff = computeOutputDiff("test", prev, curr);
    assert.ok(diff.addedCount > 0);
    assert.ok(diff.lines.some((l) => l.type === "add" && l.text === "line 3"));
  });

  it("detects removed lines", () => {
    const prev = "line 1\nline 2\nline 3";
    const curr = "line 1\nline 3";
    const diff = computeOutputDiff("test", prev, curr);
    assert.ok(diff.removedCount > 0);
  });

  it("handles identical outputs", () => {
    const text = "line 1\nline 2\nline 3";
    const diff = computeOutputDiff("test", text, text);
    assert.equal(diff.addedCount, 0);
    assert.equal(diff.removedCount, 0);
  });

  it("handles empty previous (all lines are new)", () => {
    const diff = computeOutputDiff("test", "", "line 1\nline 2");
    assert.ok(diff.addedCount > 0);
  });

  it("handles empty current (all lines removed)", () => {
    const diff = computeOutputDiff("test", "line 1\nline 2", "");
    // empty string split gives [""], which differs from ["line 1", "line 2"]
    assert.ok(diff.lines.length > 0);
  });

  it("uses tail-diff for large outputs", () => {
    const prevLines = Array.from({ length: 600 }, (_, i) => `line ${i}`);
    const currLines = [...prevLines, "new line A", "new line B"];
    const diff = computeOutputDiff("test", prevLines.join("\n"), currLines.join("\n"));
    assert.ok(diff.addedCount > 0);
    assert.ok(diff.lines.some((l) => l.text === "new line A"));
  });

  it("limits context around changes", () => {
    const prev = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj";
    const curr = "a\nb\nc\nd\ne\nNEW\ng\nh\ni\nj";
    const diff = computeOutputDiff("test", prev, curr, 1);
    // should show NEW and ~1 context line around it, not all 10 lines
    assert.ok(diff.lines.length < 10);
  });

  it("includes session title and timestamp", () => {
    const diff = computeOutputDiff("alpha", "a", "b");
    assert.equal(diff.sessionTitle, "alpha");
    assert.ok(diff.timestamp > 0);
  });
});

describe("formatOutputDiff", () => {
  it("shows no-changes message for identical output", () => {
    const diff = computeOutputDiff("test", "same", "same");
    const lines = formatOutputDiff(diff);
    assert.ok(lines[0].includes("no changes"));
  });

  it("shows diff lines with +/- prefixes", () => {
    const diff = computeOutputDiff("test", "old line", "new line");
    const lines = formatOutputDiff(diff);
    assert.ok(lines.some((l) => l.includes("+") || l.includes("-")));
  });

  it("strips ANSI codes from output", () => {
    const diff = computeOutputDiff("test", "", "\x1b[31mred text\x1b[0m");
    const lines = formatOutputDiff(diff);
    assert.ok(lines.some((l) => l.includes("red text")));
    assert.ok(!lines.some((l) => l.includes("\x1b")));
  });
});
