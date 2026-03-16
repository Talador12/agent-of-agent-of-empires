import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatActivity, formatSessionCard, formatSessionSentence,
  truncateAnsi, truncatePlain,
  padBoxLine, padToWidth, stripAnsiForLen, phaseDisplay,
  computeScrollSlice, formatScrollIndicator,
  TUI,
} from "./tui.js";
import type { ActivityEntry } from "./tui.js";
import type { DaemonSessionState } from "./types.js";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── truncatePlain ────────────────────────────────────────────────────────────

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

// ── truncateAnsi ─────────────────────────────────────────────────────────────

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

// ── stripAnsiForLen ──────────────────────────────────────────────────────────

describe("stripAnsiForLen", () => {
  it("returns length of plain text", () => {
    assert.equal(stripAnsiForLen("hello"), 5);
  });

  it("ignores ANSI escape sequences", () => {
    assert.equal(stripAnsiForLen("\x1b[31mred\x1b[0m"), 3);
  });

  it("handles 256-color codes", () => {
    assert.equal(stripAnsiForLen("\x1b[38;5;105mtext\x1b[0m"), 4);
  });

  it("returns 0 for empty string", () => {
    assert.equal(stripAnsiForLen(""), 0);
  });
});

// ── padToWidth ───────────────────────────────────────────────────────────────

describe("padToWidth", () => {
  it("pads short string to fill width", () => {
    const result = padToWidth("abc", 10);
    // "abc" has 3 visible chars, need 7 spaces
    assert.equal(result, "       ");
  });

  it("returns empty string when line fills width", () => {
    const result = padToWidth("abcde", 5);
    assert.equal(result, "");
  });

  it("handles ANSI codes in length calc", () => {
    const result = padToWidth("\x1b[31mabc\x1b[0m", 10);
    assert.equal(result, "       "); // 3 visible -> 7 padding
  });
});

// ── padBoxLine ───────────────────────────────────────────────────────────────

describe("padBoxLine", () => {
  it("appends right border at correct position", () => {
    const result = padBoxLine("│ hello", 20);
    const plain = stripAnsi(result);
    assert.ok(plain.endsWith("│"), `should end with │, got: "${plain}"`);
  });

  it("adds padding between content and border", () => {
    const result = padBoxLine("│ hi", 20);
    const plain = stripAnsi(result);
    // "│ hi" is 4 chars, total 20, last char is │ → 15 spaces of padding
    assert.ok(plain.length >= 15, `should pad to width, got length ${plain.length}`);
  });
});

// ── phaseDisplay ─────────────────────────────────────────────────────────────

describe("phaseDisplay", () => {
  it("shows PAUSED when paused", () => {
    const result = stripAnsi(phaseDisplay("sleeping", true, 0));
    assert.ok(result.includes("PAUSED"), `got: ${result}`);
  });

  it("shows spinner for reasoning", () => {
    const result = phaseDisplay("reasoning", false, 0);
    assert.ok(result.includes("reasoning"));
    // should include a braille spinner char
    assert.ok(result.includes("⠋"), `frame 0 should be ⠋, got: ${stripAnsi(result)}`);
  });

  it("shows spinner for executing", () => {
    const result = phaseDisplay("executing", false, 2);
    assert.ok(result.includes("executing"));
    assert.ok(result.includes("⠹"), `frame 2 should be ⠹`);
  });

  it("shows spinner for polling", () => {
    const result = stripAnsi(phaseDisplay("polling", false, 0));
    assert.ok(result.includes("polling"));
  });

  it("shows sleeping without spinner", () => {
    const result = stripAnsi(phaseDisplay("sleeping", false, 0));
    assert.equal(result, "sleeping");
  });

  it("shows interrupted state", () => {
    const result = stripAnsi(phaseDisplay("interrupted", false, 0));
    assert.ok(result.includes("interrupted"));
  });

  it("cycles spinner frames correctly", () => {
    // frame 5 = "⠴"
    const result = phaseDisplay("reasoning", false, 5);
    assert.ok(result.includes("⠴"), `frame 5 should be ⠴`);
  });
});

// ── formatActivity ───────────────────────────────────────────────────────────

describe("formatActivity", () => {
  it("includes time, tag, and text", () => {
    const entry: ActivityEntry = { time: "12:30:45", tag: "reasoner", text: "thinking..." };
    const result = formatActivity(entry, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("12:30:45"));
    assert.ok(plain.includes("reasoner"));
    assert.ok(plain.includes("thinking..."));
  });

  it("uses 'obs' short name for observation tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "observation", text: "3 sessions" };
    const result = formatActivity(entry, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("obs"));
  });

  it("uses arrow prefix for action tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "action", text: "send_input" };
    const result = formatActivity(entry, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("→ action"), `should show → action, got: ${plain}`);
  });

  it("uses cross mark for error tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "error", text: "failed" };
    const result = formatActivity(entry, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("✗ error"), `should show ✗ error, got: ${plain}`);
  });

  it("uses pipe separator between tag and text", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello" };
    const result = formatActivity(entry, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("│"), `should include │ separator, got: ${plain}`);
  });
});

describe("formatActivity — explain tag", () => {
  it("uses 'AI' short name for explain tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "explain", text: "Adventure is doing great" };
    const result = formatActivity(entry, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("AI"), `should show AI tag, got: ${plain}`);
    assert.ok(plain.includes("Adventure is doing great"));
  });

  it("applies bold cyan color to explain tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "explain", text: "test" };
    const result = formatActivity(entry, 120);
    assert.ok(result.includes("\x1b[1m"), "should include bold");
    assert.ok(result.includes("\x1b[36m"), "should include cyan");
  });
});

// ── formatSessionCard ────────────────────────────────────────────────────────

describe("formatSessionCard", () => {
  function makeSession(overrides: Partial<DaemonSessionState> = {}): DaemonSessionState {
    return {
      id: "abc12345-def6-7890",
      title: "Adventure",
      tool: "opencode",
      status: "working",
      ...overrides,
    };
  }

  it("shows status dot, name, tool, and task", () => {
    const s = makeSession({ currentTask: "building auth" });
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(result.includes("Adventure"), `got: ${result}`);
    assert.ok(result.includes("opencode"), `got: ${result}`);
    assert.ok(result.includes("building auth"), `got: ${result}`);
  });

  it("shows status dot for working session", () => {
    const s = makeSession();
    const result = formatSessionCard(s, 80);
    // should include a filled dot (●)
    assert.ok(result.includes("●"), `should include ●, got: ${stripAnsi(result)}`);
  });

  it("shows hollow dot for idle session", () => {
    const s = makeSession({ status: "idle" });
    const result = formatSessionCard(s, 80);
    assert.ok(result.includes("○"), `should include ○, got: ${stripAnsi(result)}`);
  });

  it("shows error description", () => {
    const s = makeSession({ status: "error" });
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(result.includes("error"), `got: ${result}`);
  });

  it("shows user-active state", () => {
    const s = makeSession({ userActive: true });
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(result.includes("you're active"), `got: ${result}`);
  });

  it("shows done state", () => {
    const s = makeSession({ status: "done" });
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(result.includes("done"), `got: ${result}`);
  });

  it("shows waiting state", () => {
    const s = makeSession({ status: "waiting" });
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(result.includes("waiting"), `got: ${result}`);
  });

  it("includes box-drawing separator between tool and status", () => {
    const s = makeSession();
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(result.includes("─"), `should include ─ separator, got: ${result}`);
  });
});

// ── formatSessionSentence (backward compat) ──────────────────────────────────

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

  it("uses status dots instead of tilde icons", () => {
    const s = makeSession({ status: "working" });
    const result = formatSessionSentence(s, 120);
    assert.ok(result.includes("●"), `should use ● dot, got: ${stripAnsi(result)}`);
  });

  it("includes tool name in parentheses", () => {
    const s = makeSession({ tool: "claude" });
    const result = stripAnsi(formatSessionSentence(s, 120));
    assert.ok(result.includes("(claude)"), `got: ${result}`);
  });
});

// ── TUI class lifecycle ──────────────────────────────────────────────────────

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
    tui.log("system", "test message");
    tui.log("reasoner", "thinking...");
  });

  it("updateState does not throw when not active", () => {
    const tui = new TUI();
    tui.updateState({ phase: "reasoning", pollCount: 5, sessions: [] });
  });
});

// ── computeScrollSlice ──────────────────────────────────────────────────────

describe("computeScrollSlice", () => {
  it("returns tail slice when offset is 0 (live)", () => {
    const { start, end } = computeScrollSlice(100, 20, 0);
    assert.equal(start, 80);
    assert.equal(end, 100);
  });

  it("returns earlier slice when scrolled back", () => {
    const { start, end } = computeScrollSlice(100, 20, 30);
    assert.equal(end, 70);
    assert.equal(start, 50);
  });

  it("clamps start to 0 when near the top", () => {
    const { start, end } = computeScrollSlice(100, 20, 90);
    assert.equal(start, 0);
    assert.equal(end, 10);
  });

  it("handles offset exceeding buffer length", () => {
    const { start, end } = computeScrollSlice(10, 20, 50);
    assert.equal(start, 0);
    assert.equal(end, 0);
  });

  it("handles empty buffer", () => {
    const { start, end } = computeScrollSlice(0, 20, 0);
    assert.equal(start, 0);
    assert.equal(end, 0);
  });

  it("handles buffer smaller than visible lines", () => {
    const { start, end } = computeScrollSlice(5, 20, 0);
    assert.equal(start, 0);
    assert.equal(end, 5);
  });
});

// ── formatScrollIndicator ───────────────────────────────────────────────────

describe("formatScrollIndicator", () => {
  it("shows offset and position", () => {
    const result = formatScrollIndicator(10, 50, 20, 0);
    assert.ok(result.includes("10 older"));
    assert.ok(result.includes("40/50"));
  });

  it("shows new entries count when > 0", () => {
    const result = formatScrollIndicator(10, 50, 20, 5);
    assert.ok(result.includes("5 new"));
  });

  it("omits new tag when count is 0", () => {
    const result = formatScrollIndicator(10, 50, 20, 0);
    assert.ok(!result.includes("new"));
  });

  it("includes navigation hints", () => {
    const result = formatScrollIndicator(10, 50, 20, 0);
    assert.ok(result.includes("PgUp/PgDn"));
    assert.ok(result.includes("End=live"));
  });
});

// ── TUI scroll methods ──────────────────────────────────────────────────────

describe("TUI scroll state", () => {
  it("starts at live (not scrolled back)", () => {
    const tui = new TUI();
    assert.equal(tui.isScrolledBack(), false);
  });

  it("scrollUp/scrollDown are no-ops when not active", () => {
    const tui = new TUI();
    tui.scrollUp();
    tui.scrollDown();
    tui.scrollToTop();
    tui.scrollToBottom();
    assert.equal(tui.isScrolledBack(), false);
  });
});
