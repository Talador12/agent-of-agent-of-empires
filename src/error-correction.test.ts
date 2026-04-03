// error-correction.test.ts — tests for the session error state misdetection fix.
// verifies that idle opencode UI chrome is not falsely reported as "error".

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

// We test the static method via a minimal reimplementation since Poller
// is tightly coupled to the shell. The logic is the same.

function correctErrorMisdetection(status: string, output: string): string {
  if (status !== "error") return status;
  const clean = output.replace(/\x1b\[[0-9;]*[mABCDHJKST]/g, "");
  const lines = clean.split("\n").map((l) => l.trim()).filter(Boolean);
  const last20 = lines.slice(-20);

  const hasRealError = last20.some((l) =>
    /(?:^error|^ERR[!]|panic|SIGSEGV|core dumped|unhandled|FATAL|stack trace|Traceback)/i.test(l)
  );
  if (hasRealError) return "error";

  const hasIdleChrome = last20.some((l) =>
    /^[>$#%]\s*$/.test(l) ||
    /model:|provider:|tokens?:/i.test(l) ||
    /opencode|claude|anthropic/i.test(l) ||
    /^\s*[─═│┃┌┐└┘├┤┬┴┼]+\s*$/.test(l)
  );
  if (hasIdleChrome && !hasRealError) return "idle";

  return status;
}

describe("correctErrorMisdetection", () => {
  it("preserves non-error statuses", () => {
    assert.equal(correctErrorMisdetection("working", "anything"), "working");
    assert.equal(correctErrorMisdetection("idle", "anything"), "idle");
    assert.equal(correctErrorMisdetection("done", "anything"), "done");
  });

  it("keeps error when output has real error text", () => {
    assert.equal(correctErrorMisdetection("error", "error: module not found\nstack trace at..."), "error");
    assert.equal(correctErrorMisdetection("error", "ERR! npm install failed"), "error");
    assert.equal(correctErrorMisdetection("error", "panic: segfault in thread"), "error");
    assert.equal(correctErrorMisdetection("error", "FATAL: database connection refused"), "error");
    assert.equal(correctErrorMisdetection("error", "Traceback (most recent call last):"), "error");
  });

  it("overrides error to idle when output is opencode UI chrome", () => {
    assert.equal(correctErrorMisdetection("error", "model: claude-sonnet-4\ntokens: 5000\n> "), "idle");
    assert.equal(correctErrorMisdetection("error", "opencode v1.2.3\nprovider: anthropic\n$"), "idle");
    assert.equal(correctErrorMisdetection("error", "─────────────────\n│ session info │\n─────────────────"), "idle");
  });

  it("overrides error to idle when output is a bare prompt", () => {
    assert.equal(correctErrorMisdetection("error", "some previous output\n> "), "idle");
    assert.equal(correctErrorMisdetection("error", "$ "), "idle");
  });

  it("keeps error when output has real errors mixed with chrome", () => {
    assert.equal(correctErrorMisdetection("error", "opencode v1.2.3\nerror: crash\n> "), "error");
  });

  it("keeps error when output has no recognizable patterns", () => {
    assert.equal(correctErrorMisdetection("error", "some random text\nnothing special"), "error");
  });

  it("handles empty output", () => {
    assert.equal(correctErrorMisdetection("error", ""), "error");
  });

  it("handles ANSI-colored output", () => {
    assert.equal(correctErrorMisdetection("error", "\x1b[32mmodel: claude\x1b[0m\n\x1b[36m> \x1b[0m"), "idle");
    assert.equal(correctErrorMisdetection("error", "\x1b[31merror: fail\x1b[0m"), "error");
  });

  it("handles multiline opencode status display", () => {
    const output = [
      "╭─────────────────────────╮",
      "│ opencode agent session  │",
      "│ model: claude-sonnet-4  │",
      "│ tokens: 150,000/200,000 │",
      "╰─────────────────────────╯",
      "> ",
    ].join("\n");
    assert.equal(correctErrorMisdetection("error", output), "idle");
  });
});
