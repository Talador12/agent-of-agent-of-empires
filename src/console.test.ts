import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, renameSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatTickSeparator, formatSessionSummaries, formatActionDetail, formatPlainEnglishAction, colorizeConsoleLine, narrateObservation, summarizeRecentActions, friendlyError } from "./console.js";

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

// --- formatPlainEnglishAction ---

describe("formatPlainEnglishAction", () => {
  it("formats send_input as a friendly sentence", () => {
    const result = formatPlainEnglishAction("send_input", "Adventure", "implement login flow", true);
    assert.ok(result.startsWith("Sent a message to Adventure:"), `got: ${result}`);
    assert.ok(result.includes("implement login flow"));
  });

  it("truncates long send_input text", () => {
    const longText = "x".repeat(100);
    const result = formatPlainEnglishAction("send_input", "Proj", longText, true);
    assert.ok(result.includes("..."), "should truncate");
  });

  it("formats start_session", () => {
    assert.equal(formatPlainEnglishAction("start_session", "CHV", "", true), "Starting CHV");
  });

  it("formats stop_session", () => {
    assert.equal(formatPlainEnglishAction("stop_session", "CHV", "", true), "Stopping CHV");
  });

  it("formats create_agent", () => {
    assert.equal(formatPlainEnglishAction("create_agent", "NewProj", "", true), "Creating a new agent: NewProj");
  });

  it("formats remove_agent", () => {
    assert.equal(formatPlainEnglishAction("remove_agent", "OldProj", "", true), "Removing OldProj");
  });

  it("formats report_progress", () => {
    const result = formatPlainEnglishAction("report_progress", "Adventure", "auth feature complete", true);
    assert.ok(result.includes("Progress on Adventure:"));
    assert.ok(result.includes("auth feature complete"));
  });

  it("formats complete_task", () => {
    assert.equal(formatPlainEnglishAction("complete_task", "Adventure", "", true), "Marked Adventure as complete");
  });

  it("formats wait with reason", () => {
    const result = formatPlainEnglishAction("wait", undefined, "all agents progressing normally", true);
    assert.ok(result.includes("Waiting"));
    assert.ok(result.includes("all agents progressing normally"));
  });

  it("appends (failed) on failure", () => {
    const result = formatPlainEnglishAction("start_session", "CHV", "", false);
    assert.equal(result, "Starting CHV (failed)");
  });
});

// --- colorizeConsoleLine: explain tag ---

describe("colorizeConsoleLine — explain tag", () => {
  it("colorizes [explain] tag with bold cyan", () => {
    const line = "12:00:00 [explain] Adventure is making progress";
    const result = colorizeConsoleLine(line);
    assert.ok(result.includes("\x1b[1m"), "should include bold");
    assert.ok(result.includes("\x1b[36m"), "should include cyan");
    assert.ok(result.includes("explain"), "should preserve tag name");
  });

  it("still colorizes standard tags", () => {
    const line = "12:00:00 [reasoner] decided: wait";
    const result = colorizeConsoleLine(line);
    assert.ok(result.includes("\x1b[36m"), "reasoner should be cyan");
  });
});

// --- narrateObservation ---

describe("narrateObservation", () => {
  it("returns 'No agents running.' when empty", () => {
    assert.equal(narrateObservation([], new Set()), "No agents running.");
  });

  it("mentions sessions that made progress", () => {
    const sessions = [
      { title: "Adventure", status: "working" },
      { title: "CHV", status: "idle" },
    ];
    const result = narrateObservation(sessions, new Set(["Adventure"]));
    assert.ok(result.includes("Adventure just made progress"), `got: ${result}`);
  });

  it("mentions errored sessions prominently", () => {
    const sessions = [{ title: "Broken", status: "error" }];
    const result = narrateObservation(sessions, new Set(["Broken"]));
    assert.ok(result.includes("Broken hit an error"), `got: ${result}`);
  });

  it("reports all idle when nothing changed and all idle", () => {
    const sessions = [
      { title: "A", status: "idle" },
      { title: "B", status: "stopped" },
    ];
    const result = narrateObservation(sessions, new Set());
    assert.ok(result.includes("2 agents are idle"), `got: ${result}`);
  });

  it("reports no new changes when agents are working but nothing changed", () => {
    const sessions = [
      { title: "A", status: "working" },
      { title: "B", status: "working" },
    ];
    const result = narrateObservation(sessions, new Set());
    assert.ok(result.includes("no new changes"), `got: ${result}`);
  });

  it("combines multiple observations", () => {
    const sessions = [
      { title: "Adventure", status: "working" },
      { title: "CHV", status: "error" },
      { title: "Idle", status: "idle" },
    ];
    const result = narrateObservation(sessions, new Set(["Adventure", "CHV"]));
    assert.ok(result.includes("CHV hit an error"), `should mention error: ${result}`);
    assert.ok(result.includes("Adventure just made progress"), `should mention progress: ${result}`);
    assert.ok(result.includes("Idle"), `should mention idle session: ${result}`);
  });

  it("uses singular 'is' for a single idle session", () => {
    const sessions = [
      { title: "A", status: "working" },
      { title: "B", status: "idle" },
    ];
    const result = narrateObservation(sessions, new Set(["A"]));
    assert.ok(result.includes("B is idle"), `got: ${result}`);
  });
});

// --- summarizeRecentActions ---

describe("summarizeRecentActions", () => {
  const now = Date.now();
  const recentTs = now - 300_000; // 5 minutes ago
  const oldTs = now - 7_200_000; // 2 hours ago

  it("returns 'No previous activity' for empty input", () => {
    assert.equal(summarizeRecentActions([]), "No previous activity found.");
  });

  it("returns 'No actions in the last hour' when all entries are old", () => {
    const lines = [
      JSON.stringify({ timestamp: oldTs, action: { action: "send_input", session: "s1" }, success: true }),
    ];
    const result = summarizeRecentActions(lines);
    assert.equal(result, "No actions in the last hour.");
  });

  it("counts recent actions within the window", () => {
    const lines = [
      JSON.stringify({ timestamp: recentTs, action: { action: "send_input", session: "Adventure" }, success: true }),
      JSON.stringify({ timestamp: recentTs, action: { action: "start_session", session: "CHV" }, success: true }),
    ];
    const result = summarizeRecentActions(lines);
    assert.ok(result.includes("2 actions"), `got: ${result}`);
    assert.ok(result.includes("1 hour"), `got: ${result}`);
  });

  it("skips wait actions", () => {
    const lines = [
      JSON.stringify({ timestamp: recentTs, action: { action: "wait" }, success: true }),
      JSON.stringify({ timestamp: recentTs, action: { action: "send_input", session: "A" }, success: true }),
    ];
    const result = summarizeRecentActions(lines);
    assert.ok(result.includes("1 action"), `got: ${result}`);
  });

  it("reports failures", () => {
    const lines = [
      JSON.stringify({ timestamp: recentTs, action: { action: "send_input", session: "A" }, success: false }),
    ];
    const result = summarizeRecentActions(lines);
    assert.ok(result.includes("1 failed"), `got: ${result}`);
  });

  it("mentions session names when <= 4", () => {
    const lines = [
      JSON.stringify({ timestamp: recentTs, action: { action: "send_input", session: "Adventure" }, success: true }),
    ];
    const result = summarizeRecentActions(lines);
    assert.ok(result.includes("Adventure"), `got: ${result}`);
  });

  it("handles malformed lines gracefully", () => {
    const lines = [
      "not valid json",
      JSON.stringify({ timestamp: recentTs, action: { action: "send_input", session: "A" }, success: true }),
    ];
    const result = summarizeRecentActions(lines);
    assert.ok(result.includes("1 action"), `got: ${result}`);
  });

  it("respects custom window", () => {
    const fiveMinAgo = now - 300_000;
    const thirtyMinAgo = now - 1_800_000;
    const lines = [
      JSON.stringify({ timestamp: fiveMinAgo, action: { action: "send_input", session: "A" }, success: true }),
      JSON.stringify({ timestamp: thirtyMinAgo, action: { action: "send_input", session: "B" }, success: true }),
    ];
    // 10 minute window should only include the 5-minute-ago entry
    const result = summarizeRecentActions(lines, 600_000);
    assert.ok(result.includes("1 action"), `got: ${result}`);
    assert.ok(result.includes("10 minutes"), `got: ${result}`);
  });
});

// --- friendlyError ---

describe("friendlyError", () => {
  it("handles 'command not found'", () => {
    const result = friendlyError("bash: aoe: command not found");
    assert.ok(result.includes("aoe"), `got: ${result}`);
    assert.ok(result.includes("not installed") || result.includes("PATH"), `got: ${result}`);
  });

  it("handles ECONNREFUSED", () => {
    const result = friendlyError("Error: connect ECONNREFUSED 127.0.0.1:4097");
    assert.ok(result.includes("Connection refused"), `got: ${result}`);
  });

  it("handles ENOENT with path", () => {
    const result = friendlyError("Error: ENOENT: no such file or directory, open '/foo/bar'");
    assert.ok(result.includes("/foo/bar"), `got: ${result}`);
  });

  it("handles permission denied", () => {
    const result = friendlyError("Error: EACCES: permission denied");
    assert.ok(result.includes("Permission denied"), `got: ${result}`);
  });

  it("handles timeout", () => {
    const result = friendlyError("Error: ETIMEDOUT");
    assert.ok(result.includes("timed out"), `got: ${result}`);
  });

  it("handles 401 unauthorized", () => {
    const result = friendlyError("401 Unauthorized");
    assert.ok(result.includes("Authentication failed"), `got: ${result}`);
  });

  it("handles rate limit", () => {
    const result = friendlyError("429 Too Many Requests: rate limit exceeded");
    assert.ok(result.includes("Rate limited"), `got: ${result}`);
  });

  it("handles empty input", () => {
    assert.equal(friendlyError(""), "Unknown error (no details)");
  });

  it("truncates long unknown errors", () => {
    const longError = "x".repeat(200);
    const result = friendlyError(longError);
    assert.ok(result.length <= 125, `got length: ${result.length}`);
    assert.ok(result.includes("..."), `got: ${result}`);
  });

  it("returns first line for unknown errors", () => {
    const result = friendlyError("some weird error\nsecond line\nthird line");
    assert.equal(result, "some weird error");
  });

  it("handles 'no such session'", () => {
    const result = friendlyError("error: no such session 'foo'");
    assert.ok(result.includes("session doesn't exist"), `got: ${result}`);
  });
});

