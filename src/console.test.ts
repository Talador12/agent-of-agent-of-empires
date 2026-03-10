import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, renameSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatTickSeparator, formatSessionSummaries, formatActionDetail } from "./console.js";

// ReasonerConsole.drainInput uses hardcoded paths (~/.aoaoe/pending-input.txt)
// so we test the atomic swap logic pattern here with temp files instead.
// This validates the rename-then-read approach is correct.

describe("atomic drain pattern", () => {
  const testDir = join(tmpdir(), `aoaoe-test-drain-${process.pid}`);
  const inputFile = join(testDir, "pending-input.txt");
  const drainFile = inputFile + ".drain";

  // replicate the atomic drain logic from console.ts
  function atomicDrain(): string[] {
    if (!existsSync(inputFile)) return [];

    try {
      renameSync(inputFile, drainFile);
    } catch {
      return [];
    }

    try {
      const content = readFileSync(drainFile, "utf-8").trim();
      try { unlinkSync(drainFile); } catch {}
      if (!content) return [];
      return content.split("\n").filter((l) => l.trim());
    } catch {
      return [];
    }
  }

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    // clean up any leftover files
    try { unlinkSync(inputFile); } catch {}
    try { unlinkSync(drainFile); } catch {}
  });

  afterEach(() => {
    try { unlinkSync(inputFile); } catch {}
    try { unlinkSync(drainFile); } catch {}
  });

  it("returns empty when input file does not exist", () => {
    const result = atomicDrain();
    assert.deepEqual(result, []);
  });

  it("returns empty when input file is empty", () => {
    writeFileSync(inputFile, "");
    const result = atomicDrain();
    assert.deepEqual(result, []);
  });

  it("drains a single message", () => {
    writeFileSync(inputFile, "hello world\n");
    const result = atomicDrain();
    assert.deepEqual(result, ["hello world"]);
  });

  it("drains multiple messages", () => {
    writeFileSync(inputFile, "msg1\nmsg2\nmsg3\n");
    const result = atomicDrain();
    assert.deepEqual(result, ["msg1", "msg2", "msg3"]);
  });

  it("filters out blank lines", () => {
    writeFileSync(inputFile, "msg1\n\n  \nmsg2\n");
    const result = atomicDrain();
    assert.deepEqual(result, ["msg1", "msg2"]);
  });

  it("removes the input file after drain (via rename)", () => {
    writeFileSync(inputFile, "test\n");
    atomicDrain();
    assert.equal(existsSync(inputFile), false, "input file should not exist after drain");
    assert.equal(existsSync(drainFile), false, "drain file should be cleaned up");
  });

  it("concurrent write during drain is not lost (rename is atomic)", () => {
    writeFileSync(inputFile, "original\n");

    // simulate the rename (atomic operation)
    renameSync(inputFile, drainFile);

    // now a "concurrent" write creates a new file
    writeFileSync(inputFile, "concurrent\n");

    // read from drain file (gets the original)
    const drained = readFileSync(drainFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    assert.deepEqual(drained, ["original"]);

    // the concurrent write is in the new file, will be picked up next drain
    const pending = readFileSync(inputFile, "utf-8").trim().split("\n").filter((l) => l.trim());
    assert.deepEqual(pending, ["concurrent"]);

    // clean up
    unlinkSync(drainFile);
  });
});

// hasPendingInput uses the same file path pattern — test with temp files.
// the real method reads ~/.aoaoe/pending-input.txt; we test the logic pattern here.

describe("hasPendingInput pattern", () => {
  const pendingDir = join(tmpdir(), `aoaoe-test-pending-${process.pid}`);
  const pendingFile = join(pendingDir, "pending-input.txt");

  // replicates the logic from ReasonerConsole.hasPendingInput()
  function hasPending(): boolean {
    try {
      if (!existsSync(pendingFile)) return false;
      const st = statSync(pendingFile);
      return st.size > 0;
    } catch {
      return false;
    }
  }

  beforeEach(() => {
    mkdirSync(pendingDir, { recursive: true });
    try { unlinkSync(pendingFile); } catch {}
  });

  afterEach(() => {
    try { unlinkSync(pendingFile); } catch {}
  });

  it("returns false when file does not exist", () => {
    assert.equal(hasPending(), false);
  });

  it("returns false when file is empty", () => {
    writeFileSync(pendingFile, "");
    assert.equal(hasPending(), false);
  });

  it("returns true when file has content", () => {
    writeFileSync(pendingFile, "user message\n");
    assert.equal(hasPending(), true);
  });

  it("returns true after multiple writes", () => {
    writeFileSync(pendingFile, "msg1\n");
    appendFileSync(pendingFile, "msg2\n");
    assert.equal(hasPending(), true);
  });

  it("returns false after drain clears the file (via rename)", () => {
    writeFileSync(pendingFile, "message\n");
    assert.equal(hasPending(), true);

    // simulate atomic drain (rename)
    renameSync(pendingFile, pendingFile + ".drain");
    assert.equal(hasPending(), false);

    // cleanup
    try { unlinkSync(pendingFile + ".drain"); } catch {}
  });
});

// --- formatTickSeparator ---

describe("formatTickSeparator", () => {
  it("contains the poll count", () => {
    assert.ok(formatTickSeparator(42).includes("42"));
  });

  it("starts and ends with dashes", () => {
    const sep = formatTickSeparator(1);
    assert.ok(sep.startsWith("────"), `expected leading dashes: ${sep}`);
    assert.ok(sep.endsWith("────"), `expected trailing dashes: ${sep}`);
  });

  it("contains 'tick #N' label", () => {
    assert.ok(formatTickSeparator(99).includes("tick #99"));
  });
});

// --- formatSessionSummaries ---

describe("formatSessionSummaries", () => {
  it("formats a working session with activity", () => {
    const sessions = [{ title: "adventure", tool: "opencode", status: "working", lastActivity: "writing auth.tsx" }];
    const result = formatSessionSummaries(sessions, new Set(["adventure"]));
    assert.equal(result.length, 1);
    assert.ok(result[0].startsWith("~"), "working session should have ~ icon");
    assert.ok(result[0].includes("adventure"));
    assert.ok(result[0].includes("writing auth.tsx"));
    assert.ok(result[0].includes("*"), "changed session should have * marker");
  });

  it("formats an idle session", () => {
    const sessions = [{ title: "idle-proj", tool: "claude", status: "idle" }];
    const result = formatSessionSummaries(sessions, new Set());
    assert.ok(result[0].startsWith("."), "idle session should have . icon");
    assert.ok(result[0].includes("idle"), "should show status as activity when no lastActivity");
  });

  it("formats an error session", () => {
    const sessions = [{ title: "broken", tool: "opencode", status: "error", lastActivity: "TypeError: foo" }];
    const result = formatSessionSummaries(sessions, new Set());
    assert.ok(result[0].startsWith("!"), "error session should have ! icon");
    assert.ok(result[0].includes("TypeError: foo"));
  });

  it("truncates long activity to 60 chars", () => {
    const longActivity = "a".repeat(80);
    const sessions = [{ title: "proj", tool: "opencode", status: "working", lastActivity: longActivity }];
    const result = formatSessionSummaries(sessions, new Set());
    assert.ok(result[0].length < 80 + 30, "should be truncated");
    assert.ok(result[0].includes("..."), "should have ellipsis");
  });

  it("marks changed sessions with *", () => {
    const sessions = [
      { title: "changed", tool: "opencode", status: "working", lastActivity: "building" },
      { title: "stable", tool: "opencode", status: "idle", lastActivity: "done" },
    ];
    const result = formatSessionSummaries(sessions, new Set(["changed"]));
    assert.ok(result[0].includes("*"), "changed session should have *");
    assert.ok(!result[1].includes("*"), "unchanged session should not have *");
  });

  it("handles multiple sessions", () => {
    const sessions = [
      { title: "a", tool: "opencode", status: "working" },
      { title: "b", tool: "claude", status: "idle" },
      { title: "c", tool: "opencode", status: "error" },
    ];
    const result = formatSessionSummaries(sessions, new Set());
    assert.equal(result.length, 3);
  });
});

// --- formatActionDetail ---

describe("formatActionDetail", () => {
  it("formats send_input with session title and arrow", () => {
    const result = formatActionDetail("send_input", "adventure", "fix the auth bug");
    assert.ok(result.includes("send_input →"), "should use arrow");
    assert.ok(result.includes("adventure:"));
    assert.ok(result.includes("fix the auth bug"));
  });

  it("truncates long send_input text to 80 chars", () => {
    const longText = "x".repeat(120);
    const result = formatActionDetail("send_input", "proj", longText);
    assert.ok(result.includes("..."), "should truncate with ellipsis");
    assert.ok(result.length < 120 + 30, "should be shorter than original");
  });

  it("formats other actions with just session title", () => {
    const result = formatActionDetail("start_session", "my-proj", "started");
    assert.equal(result, "start_session → my-proj");
  });

  it("falls back to detail when no session title", () => {
    const result = formatActionDetail("wait", undefined, "nothing to do");
    assert.equal(result, "wait: nothing to do");
  });
});

