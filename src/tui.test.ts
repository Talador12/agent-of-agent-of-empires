import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatActivity, truncateAnsi, truncatePlain, TUI, formatSessionSentence } from "./tui.js";
import type { ActivityEntry } from "./tui.js";
import type { DaemonSessionState } from "./types.js";

describe("truncatePlain", () => {
  it("returns string unchanged when under limit", () => {
    assert.equal(truncatePlain("hello", 10), "hello");
  });

  it("truncates with .. when over limit", () => {
    assert.equal(truncatePlain("hello world", 8), "hello ..");
  });

  it("handles exact length", () => {
    assert.equal(truncatePlain("hello", 5), "hello");
  });
});

describe("truncateAnsi", () => {
  it("does not truncate short strings", () => {
    const result = truncateAnsi("hello", 80);
    assert.equal(result, "hello");
  });

  it("preserves ANSI codes in length calculation", () => {
    const colored = "\x1b[32mhi\x1b[0m";  // visible: "hi" (2 chars)
    const result = truncateAnsi(colored, 80);
    assert.equal(result, colored);
  });

  it("truncates based on visible chars not raw length", () => {
    const long = "a".repeat(100);
    const result = truncateAnsi(long, 50);
    assert.ok(result.length <= 60); // some slack for reset code
  });
});

describe("formatActivity", () => {
  it("includes time, tag, and text", () => {
    const entry: ActivityEntry = { time: "12:30:45", tag: "reasoner", text: "thinking..." };
    const result = formatActivity(entry, 120);
    // strip ANSI for content check
    const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(plain.includes("12:30:45"));
    assert.ok(plain.includes("[reasoner]"));
    assert.ok(plain.includes("thinking..."));
  });

  it("uses 'obs' short name for observation tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "observation", text: "3 sessions" };
    const result = formatActivity(entry, 120);
    const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(plain.includes("[obs]"));
  });

  it("uses '+ action' for action tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "action", text: "send_input" };
    const result = formatActivity(entry, 120);
    const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(plain.includes("[+ action]"));
  });

  it("uses '! action' for error tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "error", text: "failed" };
    const result = formatActivity(entry, 120);
    const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(plain.includes("[! action]"));
  });
});

describe("TUI class", () => {
  it("constructs without throwing", () => {
    const tui = new TUI();
    assert.ok(tui);
  });

  it("isActive returns false before start", () => {
    const tui = new TUI();
    assert.equal(tui.isActive(), false);
  });

  it("log buffers entries before start", () => {
    const tui = new TUI();
    // should not throw even when not active
    tui.log("system", "test message");
    tui.log("reasoner", "thinking...");
  });

  it("updateState does not throw when not active", () => {
    const tui = new TUI();
    tui.updateState({ phase: "reasoning", pollCount: 5, sessions: [] });
  });
});

// --- formatSessionSentence ---

describe("formatSessionSentence", () => {
  function makeSession(overrides: Partial<DaemonSessionState> = {}): DaemonSessionState {
    return {
      id: "abc12345-def6-7890",
      title: "Adventure",
      tool: "opencode",
      status: "working",
      ...overrides,
    };
  }

  function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
  }

  it("shows working session with task", () => {
    const s = makeSession({ currentTask: "implementing auth" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("Adventure"), `got: ${result}`);
    assert.ok(result.includes("opencode"), `got: ${result}`);
    assert.ok(result.includes("implementing auth"), `got: ${result}`);
  });

  it("shows working session without task as 'working'", () => {
    const s = makeSession();
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("working"), `got: ${result}`);
  });

  it("shows idle session", () => {
    const s = makeSession({ status: "idle" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("idle"), `got: ${result}`);
  });

  it("shows error session as 'hit an error'", () => {
    const s = makeSession({ status: "error" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("hit an error"), `got: ${result}`);
  });

  it("shows user-active session as 'you're working here'", () => {
    const s = makeSession({ userActive: true });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("you're working here"), `got: ${result}`);
  });

  it("shows done session as 'finished'", () => {
    const s = makeSession({ status: "done" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("finished"), `got: ${result}`);
  });

  it("shows waiting session", () => {
    const s = makeSession({ status: "waiting" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("waiting for input"), `got: ${result}`);
  });

  it("includes tool name in parentheses", () => {
    const s = makeSession({ tool: "claude" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("(claude)"), `got: ${result}`);
  });
});

describe("formatActivity — explain tag", () => {
  it("uses 'AI' short name for explain tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "explain", text: "Adventure is doing great" };
    const result = formatActivity(entry, 120);
    const plain = result.replace(/\x1b\[[0-9;]*m/g, "");
    assert.ok(plain.includes("[AI]"), `should show [AI] tag, got: ${plain}`);
    assert.ok(plain.includes("Adventure is doing great"));
  });

  it("applies bold cyan color to explain tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "explain", text: "test" };
    const result = formatActivity(entry, 120);
    assert.ok(result.includes("\x1b[1m"), "should include bold");
    assert.ok(result.includes("\x1b[36m"), "should include cyan");
  });
});
