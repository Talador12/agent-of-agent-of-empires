import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { detectClipboardMethod, buildClipboardCommand, prepareForClipboard, buildClipboardResult, formatClipboardResult } from "./session-clipboard.js";

describe("detectClipboardMethod", () => {
  it("returns a valid method", () => {
    const method = detectClipboardMethod();
    assert.ok(["pbcopy", "xclip", "xsel", "wl-copy", "powershell", "fallback"].includes(method));
  });
});

describe("buildClipboardCommand", () => {
  it("returns pbcopy for darwin", () => {
    assert.equal(buildClipboardCommand("pbcopy"), "pbcopy");
  });
  it("returns xclip for linux", () => {
    assert.ok(buildClipboardCommand("xclip").includes("xclip"));
  });
  it("returns powershell for windows", () => {
    assert.ok(buildClipboardCommand("powershell").includes("powershell"));
  });
});

describe("prepareForClipboard", () => {
  it("strips ANSI codes", () => {
    const result = prepareForClipboard(["\x1b[31mred text\x1b[0m"]);
    assert.ok(!result.includes("\x1b"));
    assert.ok(result.includes("red text"));
  });
  it("limits to maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const result = prepareForClipboard(lines, 5);
    assert.equal(result.split("\n").length, 5);
  });
  it("takes last N lines", () => {
    const lines = ["first", "second", "third"];
    const result = prepareForClipboard(lines, 2);
    assert.ok(result.includes("second"));
    assert.ok(result.includes("third"));
    assert.ok(!result.includes("first"));
  });
});

describe("buildClipboardResult", () => {
  it("builds result with line and char count", () => {
    const r = buildClipboardResult(["hello world", "goodbye"]);
    assert.ok(r.success);
    assert.equal(r.lineCount, 2);
    assert.ok(r.charCount > 0);
    assert.ok(r.content.includes("hello"));
  });
  it("respects maxLines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const r = buildClipboardResult(lines, 10);
    assert.equal(r.lineCount, 10);
  });
});

describe("formatClipboardResult", () => {
  it("shows success with preview", () => {
    const r = buildClipboardResult(["line 1", "line 2", "line 3", "line 4"]);
    const lines = formatClipboardResult(r);
    assert.ok(lines[0].includes("Clipboard"));
    assert.ok(lines[0].includes("4 lines"));
    assert.ok(lines.some((l) => l.includes("line 1")));
  });
  it("shows failure message", () => {
    const lines = formatClipboardResult({ success: false, lineCount: 0, charCount: 0, content: "", method: "fallback" });
    assert.ok(lines[0].includes("failed"));
  });
});
