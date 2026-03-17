import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatActivity, formatSessionCard, formatSessionSentence,
  truncateAnsi, truncatePlain,
  padBoxLine, padBoxLineHover, padToWidth, stripAnsiForLen, phaseDisplay,
  computeScrollSlice, formatScrollIndicator, formatDrilldownScrollIndicator,
  formatPrompt, formatDrilldownHeader,
  hitTestSession,
  matchesSearch, formatSearchIndicator,
  computeSparkline, formatSparkline,
  sortSessions, nextSortMode, SORT_MODES,
  formatCompactRows, computeCompactRowCount, COMPACT_NAME_LEN,
  shouldBell, BELL_COOLDOWN_MS,
  computeBookmarkOffset, MAX_BOOKMARKS,
  shouldMuteEntry, MUTE_ICON,
  TUI,
} from "./tui.js";
import type { ActivityEntry, SortMode } from "./tui.js";
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

// ── formatPrompt ────────────────────────────────────────────────────────────

describe("formatPrompt", () => {
  it("shows simple prompt when no pending messages", () => {
    const result = formatPrompt("sleeping", false, 0);
    const plain = stripAnsi(result);
    assert.ok(plain.includes(">"));
    assert.ok(!plain.includes("queued"));
  });

  it("shows queue count when messages are pending", () => {
    const result = formatPrompt("sleeping", false, 3);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("3 queued"));
  });

  it("shows paused prompt with queue count", () => {
    const result = formatPrompt("sleeping", true, 2);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("paused"));
    assert.ok(plain.includes("2 queued"));
  });

  it("shows thinking prompt during reasoning", () => {
    const result = formatPrompt("reasoning", false, 0);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("thinking"));
  });

  it("shows thinking prompt with queue count", () => {
    const result = formatPrompt("reasoning", false, 1);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("thinking"));
    assert.ok(plain.includes("1 queued"));
  });

  it("paused takes priority over reasoning", () => {
    const result = formatPrompt("reasoning", true, 0);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("paused"));
    assert.ok(!plain.includes("thinking"));
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

// ── formatDrilldownHeader ───────────────────────────────────────────────────

describe("formatDrilldownHeader", () => {
  const sessions: DaemonSessionState[] = [
    { id: "abc123", title: "frontend", tool: "opencode", status: "working" },
    { id: "def456", title: "backend", tool: "claude", status: "error" },
    { id: "ghi789", title: "tests", tool: "opencode", status: "idle" },
  ];

  it("includes session title and tool for a known session", () => {
    const result = formatDrilldownHeader("abc123", sessions, "sleeping", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("frontend"));
    assert.ok(plain.includes("opencode"));
  });

  it("shows status for a working session", () => {
    const result = formatDrilldownHeader("abc123", sessions, "sleeping", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("working"));
  });

  it("shows error status for an errored session", () => {
    const result = formatDrilldownHeader("def456", sessions, "sleeping", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("error"));
  });

  it("shows idle status", () => {
    const result = formatDrilldownHeader("ghi789", sessions, "sleeping", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("idle"));
  });

  it("shows 'session not found' for unknown session", () => {
    const result = formatDrilldownHeader("unknown", sessions, "sleeping", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("session not found"));
  });

  it("includes phase display", () => {
    const result = formatDrilldownHeader("abc123", sessions, "reasoning", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("reasoning"));
  });

  it("includes currentTask when present", () => {
    const sessionsWithTask: DaemonSessionState[] = [
      { id: "abc123", title: "frontend", tool: "opencode", status: "working", currentTask: "fixing build" },
    ];
    const result = formatDrilldownHeader("abc123", sessionsWithTask, "sleeping", false, 0, 120);
    const plain = stripAnsi(result);
    assert.ok(plain.includes("fixing build"));
  });
});

// ── TUI drill-down state ────────────────────────────────────────────────────

describe("TUI drill-down state", () => {
  it("starts in overview mode", () => {
    const tui = new TUI();
    assert.equal(tui.getViewMode(), "overview");
    assert.equal(tui.getDrilldownSessionId(), null);
  });

  it("enterDrilldown returns false when no sessions", () => {
    const tui = new TUI();
    assert.equal(tui.enterDrilldown(1), false);
    assert.equal(tui.getViewMode(), "overview");
  });

  it("exitDrilldown is a no-op in overview mode", () => {
    const tui = new TUI();
    tui.exitDrilldown(); // should not throw
    assert.equal(tui.getViewMode(), "overview");
  });

  it("setSessionOutputs stores outputs", () => {
    const tui = new TUI();
    const outputs = new Map<string, string>();
    outputs.set("abc123", "line1\nline2\nline3");
    tui.setSessionOutputs(outputs); // should not throw
  });
});

// ── hitTestSession ──────────────────────────────────────────────────────────

describe("hitTestSession", () => {
  // with headerHeight=1:
  //   row 2 = top border (not a session)
  //   row 3 = session 1
  //   row 4 = session 2
  //   row 5 = session 3
  //   row 6 = bottom border (not a session)

  it("returns 1 for first session row (row 3, header=1, 3 sessions)", () => {
    assert.equal(hitTestSession(3, 1, 3), 1);
  });

  it("returns 2 for second session row", () => {
    assert.equal(hitTestSession(4, 1, 3), 2);
  });

  it("returns 3 for third session row", () => {
    assert.equal(hitTestSession(5, 1, 3), 3);
  });

  it("returns null for top border row", () => {
    assert.equal(hitTestSession(2, 1, 3), null);
  });

  it("returns null for bottom border row (below last session)", () => {
    assert.equal(hitTestSession(6, 1, 3), null);
  });

  it("returns null for header row", () => {
    assert.equal(hitTestSession(1, 1, 3), null);
  });

  it("returns null for row 0", () => {
    assert.equal(hitTestSession(0, 1, 3), null);
  });

  it("returns null for row well below sessions", () => {
    assert.equal(hitTestSession(20, 1, 3), null);
  });

  it("returns null when sessionCount is 0", () => {
    assert.equal(hitTestSession(3, 1, 0), null);
  });

  it("handles single session", () => {
    // row 3 = session 1, rows 2 and 4 are borders
    assert.equal(hitTestSession(3, 1, 1), 1);
    assert.equal(hitTestSession(2, 1, 1), null);
    assert.equal(hitTestSession(4, 1, 1), null);
  });

  it("handles headerHeight=2", () => {
    // first session at row 4 (headerHeight+2)
    assert.equal(hitTestSession(3, 2, 3), null); // top border
    assert.equal(hitTestSession(4, 2, 3), 1);
    assert.equal(hitTestSession(5, 2, 3), 2);
    assert.equal(hitTestSession(6, 2, 3), 3);
    assert.equal(hitTestSession(7, 2, 3), null); // bottom border
  });

  it("handles large number of sessions", () => {
    assert.equal(hitTestSession(3, 1, 100), 1);
    assert.equal(hitTestSession(102, 1, 100), 100);
    assert.equal(hitTestSession(103, 1, 100), null);
  });

  it("returns null for negative row", () => {
    assert.equal(hitTestSession(-1, 1, 3), null);
  });

  it("returns null for negative sessionCount", () => {
    assert.equal(hitTestSession(3, 1, -1), null);
  });
});

// ── TUI.getSessionCount ─────────────────────────────────────────────────────

describe("TUI.getSessionCount", () => {
  it("returns 0 before any sessions are set", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionCount(), 0);
  });

  it("returns session count after updateState", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [
        { id: "a", title: "one", tool: "opencode", status: "working" },
        { id: "b", title: "two", tool: "claude", status: "idle" },
      ],
    });
    assert.equal(tui.getSessionCount(), 2);
  });

  it("updates when sessions change", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "a", title: "one", tool: "opencode", status: "working" }] });
    assert.equal(tui.getSessionCount(), 1);
    tui.updateState({ sessions: [] });
    assert.equal(tui.getSessionCount(), 0);
  });
});

// ── formatDrilldownScrollIndicator ──────────────────────────────────────────

describe("formatDrilldownScrollIndicator", () => {
  it("shows offset and position", () => {
    const result = formatDrilldownScrollIndicator(10, 100, 20, 0);
    assert.ok(result.includes("10 lines"));
    assert.ok(result.includes("90/100"));
  });

  it("shows new lines count when > 0", () => {
    const result = formatDrilldownScrollIndicator(10, 100, 20, 5);
    assert.ok(result.includes("5 new"));
  });

  it("omits new tag when count is 0", () => {
    const result = formatDrilldownScrollIndicator(10, 100, 20, 0);
    assert.ok(!result.includes("new"));
  });

  it("includes navigation hints", () => {
    const result = formatDrilldownScrollIndicator(10, 100, 20, 0);
    assert.ok(result.includes("scroll: navigate"));
    assert.ok(result.includes("End=live"));
  });

  it("handles single line offset", () => {
    const result = formatDrilldownScrollIndicator(1, 50, 20, 0);
    assert.ok(result.includes("1 lines"));
    assert.ok(result.includes("49/50"));
  });
});

// ── TUI drill-down scroll state ─────────────────────────────────────────────

describe("TUI drill-down scroll", () => {
  it("starts not scrolled back in drilldown", () => {
    const tui = new TUI();
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });

  it("scrollDrilldownUp is a no-op when not active", () => {
    const tui = new TUI();
    tui.scrollDrilldownUp();
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });

  it("scrollDrilldownDown is a no-op when not active", () => {
    const tui = new TUI();
    tui.scrollDrilldownDown();
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });

  it("scrollDrilldownToBottom is a no-op when not active", () => {
    const tui = new TUI();
    tui.scrollDrilldownToBottom();
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });

  it("scrollDrilldownUp is a no-op in overview mode", () => {
    const tui = new TUI();
    // not in drilldown — should not throw or change state
    tui.scrollDrilldownUp(3);
    assert.equal(tui.isDrilldownScrolledBack(), false);
    assert.equal(tui.getViewMode(), "overview");
  });

  it("scrollDrilldownDown is a no-op in overview mode", () => {
    const tui = new TUI();
    tui.scrollDrilldownDown(3);
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });

  it("resets scroll offset on enterDrilldown", () => {
    const tui = new TUI();
    // set up sessions so enterDrilldown can succeed
    tui.updateState({
      sessions: [{ id: "abc", title: "test", tool: "opencode", status: "working" }],
    });
    // enter drilldown (won't paint since not active, but state changes)
    tui.enterDrilldown(1);
    assert.equal(tui.getViewMode(), "drilldown");
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });

  it("resets scroll offset on exitDrilldown", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [{ id: "abc", title: "test", tool: "opencode", status: "working" }],
    });
    tui.enterDrilldown(1);
    tui.exitDrilldown();
    assert.equal(tui.getViewMode(), "overview");
    assert.equal(tui.isDrilldownScrolledBack(), false);
  });
});

// ── matchesSearch ───────────────────────────────────────────────────────────

describe("matchesSearch", () => {
  const entry: ActivityEntry = { time: "14:30:22", tag: "reasoner", text: "thinking about auth module" };

  it("matches on tag", () => {
    assert.equal(matchesSearch(entry, "reasoner"), true);
  });

  it("matches on text", () => {
    assert.equal(matchesSearch(entry, "auth"), true);
  });

  it("matches on time", () => {
    assert.equal(matchesSearch(entry, "14:30"), true);
  });

  it("is case-insensitive", () => {
    assert.equal(matchesSearch(entry, "REASONER"), true);
    assert.equal(matchesSearch(entry, "Auth"), true);
  });

  it("returns false when no match", () => {
    assert.equal(matchesSearch(entry, "zzz_no_match"), false);
  });

  it("returns true for empty pattern", () => {
    assert.equal(matchesSearch(entry, ""), true);
  });

  it("matches partial text", () => {
    assert.equal(matchesSearch(entry, "think"), true);
  });

  it("matches against all entry fields", () => {
    const e: ActivityEntry = { time: "09:00:00", tag: "system", text: "daemon started" };
    assert.equal(matchesSearch(e, "system"), true);
    assert.equal(matchesSearch(e, "daemon"), true);
    assert.equal(matchesSearch(e, "09:00"), true);
  });
});

// ── formatSearchIndicator ───────────────────────────────────────────────────

describe("formatSearchIndicator", () => {
  it("shows pattern and match counts", () => {
    const result = formatSearchIndicator("error", 12, 50);
    assert.ok(result.includes('"error"'));
    assert.ok(result.includes("12 of 50"));
  });

  it("shows zero matches", () => {
    const result = formatSearchIndicator("zzz", 0, 50);
    assert.ok(result.includes("0 of 50"));
  });

  it("shows clear hint", () => {
    const result = formatSearchIndicator("test", 5, 10);
    assert.ok(result.includes("/search: clear"));
  });

  it("shows pattern in quotes", () => {
    const result = formatSearchIndicator("auth module", 3, 100);
    assert.ok(result.includes('"auth module"'));
  });

  it("includes search label", () => {
    const result = formatSearchIndicator("x", 1, 1);
    assert.ok(result.includes("search:"));
  });
});

// ── TUI search state ────────────────────────────────────────────────────────

describe("TUI search state", () => {
  it("starts with null search pattern", () => {
    const tui = new TUI();
    assert.equal(tui.getSearchPattern(), null);
  });

  it("setSearch sets the pattern", () => {
    const tui = new TUI();
    tui.setSearch("error");
    assert.equal(tui.getSearchPattern(), "error");
  });

  it("setSearch with null clears the pattern", () => {
    const tui = new TUI();
    tui.setSearch("error");
    tui.setSearch(null);
    assert.equal(tui.getSearchPattern(), null);
  });

  it("setSearch with empty string clears the pattern", () => {
    const tui = new TUI();
    tui.setSearch("error");
    tui.setSearch("");
    assert.equal(tui.getSearchPattern(), null);
  });

  it("getSearchPattern returns the current pattern", () => {
    const tui = new TUI();
    tui.setSearch("auth");
    assert.equal(tui.getSearchPattern(), "auth");
    tui.setSearch("module");
    assert.equal(tui.getSearchPattern(), "module");
  });

  it("setSearch is safe when not active", () => {
    const tui = new TUI();
    assert.doesNotThrow(() => tui.setSearch("test"));
    assert.doesNotThrow(() => tui.setSearch(null));
  });
});

// ── padBoxLineHover ─────────────────────────────────────────────────────────

describe("padBoxLineHover", () => {
  it("adds hover background when hovered", () => {
    const result = padBoxLineHover("│ hello", 20, true);
    // should contain BG_HOVER escape code
    assert.ok(result.includes("\x1b[48;5;238m"), "should include hover BG");
  });

  it("matches padBoxLine behavior when not hovered", () => {
    const hoverResult = padBoxLineHover("│ hello", 20, false);
    const normalResult = padBoxLine("│ hello", 20);
    assert.equal(hoverResult, normalResult);
  });

  it("ends with right border", () => {
    const result = padBoxLineHover("│ hi", 20, true);
    const plain = stripAnsi(result);
    assert.ok(plain.endsWith("│"), `should end with │, got: "${plain}"`);
  });

  it("extends hover BG through padding", () => {
    const result = padBoxLineHover("│ x", 30, true);
    // the hover BG should appear before the padding spaces
    const hoverBg = "\x1b[48;5;238m";
    const lastHoverIdx = result.lastIndexOf(hoverBg);
    assert.ok(lastHoverIdx > 0, "hover BG should appear in padding area");
  });
});

// ── TUI hover state ─────────────────────────────────────────────────────────

describe("TUI hover state", () => {
  it("starts with null hover session", () => {
    const tui = new TUI();
    assert.equal(tui.getHoverSession(), null);
  });

  it("setHoverSession sets the index", () => {
    const tui = new TUI();
    tui.setHoverSession(2);
    assert.equal(tui.getHoverSession(), 2);
  });

  it("setHoverSession with null clears hover", () => {
    const tui = new TUI();
    tui.setHoverSession(1);
    tui.setHoverSession(null);
    assert.equal(tui.getHoverSession(), null);
  });

  it("setHoverSession is safe when not active", () => {
    const tui = new TUI();
    assert.doesNotThrow(() => tui.setHoverSession(1));
    assert.doesNotThrow(() => tui.setHoverSession(null));
  });

  it("setHoverSession is a no-op for same index", () => {
    const tui = new TUI();
    tui.setHoverSession(3);
    tui.setHoverSession(3); // should not throw or change
    assert.equal(tui.getHoverSession(), 3);
  });

  it("hover clears on enterDrilldown", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [{ id: "abc", title: "test", tool: "opencode", status: "working" }],
    });
    tui.setHoverSession(1);
    tui.enterDrilldown(1);
    assert.equal(tui.getHoverSession(), null);
  });

  it("hover clears on exitDrilldown", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [{ id: "abc", title: "test", tool: "opencode", status: "working" }],
    });
    tui.enterDrilldown(1);
    tui.setHoverSession(1); // set hover in drilldown (edge case)
    tui.exitDrilldown();
    assert.equal(tui.getHoverSession(), null);
  });
});

// ── computeSparkline ────────────────────────────────────────────────────────

describe("computeSparkline", () => {
  const NOW = 1700000000000;

  it("returns all zeros for empty timestamps", () => {
    const result = computeSparkline([], NOW, 5, 10000);
    assert.deepEqual(result, [0, 0, 0, 0, 0]);
  });

  it("returns correct bucket count", () => {
    const result = computeSparkline([], NOW, 10, 10000);
    assert.equal(result.length, 10);
  });

  it("places timestamps in correct buckets", () => {
    const windowMs = 10000; // 10s window
    const buckets = 5; // 5 buckets of 2s each
    const ts = [
      NOW - 9000, // bucket 0 (0-2s from cutoff)
      NOW - 7000, // bucket 1 (2-4s)
      NOW - 5000, // bucket 2 (4-6s)
      NOW - 3000, // bucket 3 (6-8s)
      NOW - 1000, // bucket 4 (8-10s)
    ];
    const result = computeSparkline(ts, NOW, buckets, windowMs);
    assert.deepEqual(result, [1, 1, 1, 1, 1]);
  });

  it("counts multiple entries in the same bucket", () => {
    const windowMs = 10000;
    const buckets = 2; // 2 buckets of 5s each
    const ts = [NOW - 8000, NOW - 7000, NOW - 6000]; // all in bucket 0
    const result = computeSparkline(ts, NOW, buckets, windowMs);
    assert.equal(result[0], 3);
    assert.equal(result[1], 0);
  });

  it("ignores timestamps outside the window", () => {
    const windowMs = 10000;
    const ts = [NOW - 20000, NOW - 15000]; // all before cutoff
    const result = computeSparkline(ts, NOW, 5, windowMs);
    assert.deepEqual(result, [0, 0, 0, 0, 0]);
  });

  it("puts recent timestamps in the last bucket", () => {
    const windowMs = 10000;
    const buckets = 5;
    const ts = [NOW - 500]; // very recent — should be in last bucket
    const result = computeSparkline(ts, NOW, buckets, windowMs);
    assert.equal(result[4], 1);
    assert.equal(result[0], 0);
  });

  it("handles burst of activity in one bucket", () => {
    const windowMs = 10000;
    const buckets = 4;
    const ts = Array(20).fill(NOW - 1000); // 20 entries, all very recent
    const result = computeSparkline(ts, NOW, buckets, windowMs);
    assert.equal(result[3], 20); // all in last bucket
  });
});

// ── formatSparkline ─────────────────────────────────────────────────────────

describe("formatSparkline", () => {
  it("returns empty string for all-zero counts", () => {
    assert.equal(formatSparkline([0, 0, 0, 0, 0]), "");
  });

  it("returns non-empty string for non-zero counts", () => {
    const result = formatSparkline([1, 2, 3, 4, 5]);
    assert.ok(result.length > 0);
  });

  it("uses Unicode block characters", () => {
    const result = stripAnsi(formatSparkline([0, 1, 5, 10]));
    // should contain at least one block character
    assert.ok(/[▁▂▃▄▅▆▇█ ]/.test(result), `should contain block chars, got: "${result}"`);
  });

  it("maps max value to highest block", () => {
    const result = stripAnsi(formatSparkline([10]));
    assert.ok(result.includes("█"), `max should map to █, got: "${result}"`);
  });

  it("uses space for zero-count buckets", () => {
    const result = stripAnsi(formatSparkline([0, 5, 0]));
    assert.ok(result.startsWith(" "), `zero bucket should be space, got: "${result}"`);
  });

  it("handles single non-zero bucket", () => {
    const result = formatSparkline([0, 0, 3, 0, 0]);
    const plain = stripAnsi(result);
    assert.equal(plain.length, 5); // 5 characters
    assert.ok(plain[2] !== " ", "middle bucket should not be space");
  });

  it("scales relative to max value", () => {
    const result = stripAnsi(formatSparkline([1, 100]));
    // first should be lowest block, second should be highest
    assert.ok(result[0] === "▁", `low value should be ▁, got: "${result[0]}"`);
    assert.ok(result[1] === "█", `high value should be █, got: "${result[1]}"`);
  });
});

// ── sortSessions ────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<DaemonSessionState> = {}): DaemonSessionState {
  return { id: "abc", title: "TestAgent", tool: "opencode", status: "working", ...overrides };
}

describe("sortSessions", () => {
  it("default mode preserves original order", () => {
    const sessions = [
      makeSession({ id: "c", title: "Charlie" }),
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Bravo" }),
    ];
    const result = sortSessions(sessions, "default");
    assert.deepStrictEqual(result.map(s => s.id), ["c", "a", "b"]);
  });

  it("does not mutate original array", () => {
    const sessions = [
      makeSession({ id: "b", title: "Bravo", status: "idle" }),
      makeSession({ id: "a", title: "Alpha", status: "error" }),
    ];
    const original = sessions.map(s => s.id);
    sortSessions(sessions, "status");
    assert.deepStrictEqual(sessions.map(s => s.id), original);
  });

  it("status mode sorts errors first", () => {
    const sessions = [
      makeSession({ id: "1", status: "idle" }),
      makeSession({ id: "2", status: "error" }),
      makeSession({ id: "3", status: "working" }),
    ];
    const result = sortSessions(sessions, "status");
    assert.deepStrictEqual(result.map(s => s.id), ["2", "3", "1"]);
  });

  it("status mode sorts all priorities correctly", () => {
    const sessions = [
      makeSession({ id: "unknown", status: "unknown" }),
      makeSession({ id: "done", status: "done" }),
      makeSession({ id: "error", status: "error" }),
      makeSession({ id: "idle", status: "idle" }),
      makeSession({ id: "waiting", status: "waiting" }),
      makeSession({ id: "working", status: "working" }),
      makeSession({ id: "stopped", status: "stopped" }),
    ];
    const result = sortSessions(sessions, "status");
    assert.deepStrictEqual(result.map(s => s.id), ["error", "waiting", "working", "idle", "done", "stopped", "unknown"]);
  });

  it("name mode sorts alphabetically (case-insensitive)", () => {
    const sessions = [
      makeSession({ id: "1", title: "Charlie" }),
      makeSession({ id: "2", title: "alpha" }),
      makeSession({ id: "3", title: "Bravo" }),
    ];
    const result = sortSessions(sessions, "name");
    assert.deepStrictEqual(result.map(s => s.id), ["2", "3", "1"]);
  });

  it("activity mode sorts by lastChangeAt (most recent first)", () => {
    const lastChangeAt = new Map([["old", 1000], ["new", 5000], ["mid", 3000]]);
    const sessions = [
      makeSession({ id: "old" }),
      makeSession({ id: "new" }),
      makeSession({ id: "mid" }),
    ];
    const result = sortSessions(sessions, "activity", lastChangeAt);
    assert.deepStrictEqual(result.map(s => s.id), ["new", "mid", "old"]);
  });

  it("activity mode with no timestamps preserves order", () => {
    const sessions = [
      makeSession({ id: "a" }),
      makeSession({ id: "b" }),
    ];
    const result = sortSessions(sessions, "activity");
    assert.deepStrictEqual(result.map(s => s.id), ["a", "b"]);
  });

  it("handles empty sessions array", () => {
    const result = sortSessions([], "status");
    assert.deepStrictEqual(result, []);
  });
});

// ── nextSortMode ────────────────────────────────────────────────────────────

describe("nextSortMode", () => {
  it("cycles default → status", () => {
    assert.equal(nextSortMode("default"), "status");
  });

  it("cycles status → name", () => {
    assert.equal(nextSortMode("status"), "name");
  });

  it("cycles name → activity", () => {
    assert.equal(nextSortMode("name"), "activity");
  });

  it("cycles activity → default", () => {
    assert.equal(nextSortMode("activity"), "default");
  });
});

// ── SORT_MODES ──────────────────────────────────────────────────────────────

describe("SORT_MODES", () => {
  it("contains all four modes", () => {
    assert.deepStrictEqual(SORT_MODES, ["default", "status", "name", "activity"]);
  });
});

// ── TUI sort state ──────────────────────────────────────────────────────────

describe("TUI sort state", () => {
  it("initial sort mode is default", () => {
    const tui = new TUI();
    assert.equal(tui.getSortMode(), "default");
  });

  it("setSortMode changes mode", () => {
    const tui = new TUI();
    tui.setSortMode("status");
    assert.equal(tui.getSortMode(), "status");
  });

  it("setSortMode no-ops for same mode", () => {
    const tui = new TUI();
    tui.setSortMode("name");
    assert.equal(tui.getSortMode(), "name");
    tui.setSortMode("name"); // should not throw
    assert.equal(tui.getSortMode(), "name");
  });

  it("setSortMode is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.setSortMode("activity"); // should not throw
    assert.equal(tui.getSortMode(), "activity");
  });

  it("updateState sorts sessions by status mode", () => {
    const tui = new TUI();
    tui.setSortMode("status");
    tui.updateState({
      sessions: [
        makeSession({ id: "idle", status: "idle" }),
        makeSession({ id: "error", status: "error" }),
      ],
    });
    // getSessionCount confirms sessions were stored
    assert.equal(tui.getSessionCount(), 2);
  });
});

// ── formatCompactRows ───────────────────────────────────────────────────────

describe("formatCompactRows", () => {
  it("returns 'no agents connected' for empty sessions", () => {
    const rows = formatCompactRows([], 80);
    assert.equal(rows.length, 1);
    assert.ok(stripAnsi(rows[0]).includes("no agents connected"));
  });

  it("formats a single session as one row", () => {
    const rows = formatCompactRows([makeSession({ title: "Alpha" })], 80);
    assert.equal(rows.length, 1);
    const plain = stripAnsi(rows[0]);
    assert.ok(plain.includes("1"), "should include index");
    assert.ok(plain.includes("Alpha"), "should include name");
  });

  it("fits multiple sessions on one row when width allows", () => {
    const sessions = [
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Bravo" }),
    ];
    const rows = formatCompactRows(sessions, 80);
    assert.equal(rows.length, 1);
    const plain = stripAnsi(rows[0]);
    assert.ok(plain.includes("Alpha"), "should include first name");
    assert.ok(plain.includes("Bravo"), "should include second name");
  });

  it("wraps to multiple rows when width is narrow", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ id: String(i), title: `Agent${i}` }),
    );
    // narrow width forces wrapping
    const rows = formatCompactRows(sessions, 30);
    assert.ok(rows.length > 1, `expected wrapping, got ${rows.length} rows`);
  });

  it("truncates long names", () => {
    const sessions = [makeSession({ title: "VeryLongAgentNameThatShouldBeTruncated" })];
    const rows = formatCompactRows(sessions, 80);
    const plain = stripAnsi(rows[0]);
    // name part should be at most COMPACT_NAME_LEN + index + dot
    assert.ok(plain.length <= COMPACT_NAME_LEN + 3, `token too long: "${plain}"`);
  });

  it("includes numbered indexes", () => {
    const sessions = [
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Bravo" }),
      makeSession({ id: "c", title: "Charlie" }),
    ];
    const rows = formatCompactRows(sessions, 80);
    const plain = stripAnsi(rows.join(""));
    assert.ok(plain.includes("1"), "should have index 1");
    assert.ok(plain.includes("2"), "should have index 2");
    assert.ok(plain.includes("3"), "should have index 3");
  });
});

// ── computeCompactRowCount ──────────────────────────────────────────────────

describe("computeCompactRowCount", () => {
  it("returns 1 for empty sessions", () => {
    assert.equal(computeCompactRowCount([], 80), 1);
  });

  it("returns 1 for few sessions in wide terminal", () => {
    const sessions = [makeSession({ title: "A" }), makeSession({ title: "B" })];
    assert.equal(computeCompactRowCount(sessions, 80), 1);
  });

  it("returns more rows for many sessions in narrow terminal", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ id: String(i), title: `Agent${i}` }),
    );
    const rows = computeCompactRowCount(sessions, 30);
    assert.ok(rows > 1, `expected > 1 row, got ${rows}`);
  });
});

// ── TUI compact state ──────────────────────────────────────────────────────

describe("TUI compact state", () => {
  it("initial compact mode is off", () => {
    const tui = new TUI();
    assert.equal(tui.isCompact(), false);
  });

  it("setCompact enables compact mode", () => {
    const tui = new TUI();
    tui.setCompact(true);
    assert.equal(tui.isCompact(), true);
  });

  it("setCompact(false) disables compact mode", () => {
    const tui = new TUI();
    tui.setCompact(true);
    tui.setCompact(false);
    assert.equal(tui.isCompact(), false);
  });

  it("setCompact no-ops for same value", () => {
    const tui = new TUI();
    tui.setCompact(false); // already false, should not throw
    assert.equal(tui.isCompact(), false);
  });

  it("setCompact is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.setCompact(true); // not started, should not throw
    assert.equal(tui.isCompact(), true);
  });
});

// ── sortSessions with pins ──────────────────────────────────────────────────

describe("sortSessions with pinnedIds", () => {
  it("pinned sessions sort to top in default mode", () => {
    const pinnedIds = new Set(["b"]);
    const sessions = [
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Bravo" }),
      makeSession({ id: "c", title: "Charlie" }),
    ];
    const result = sortSessions(sessions, "default", undefined, pinnedIds);
    assert.equal(result[0].id, "b");
  });

  it("pinned sessions sort to top in status mode (preserves order within groups)", () => {
    const pinnedIds = new Set(["idle"]);
    const sessions = [
      makeSession({ id: "error", status: "error" }),
      makeSession({ id: "idle", status: "idle" }),
      makeSession({ id: "working", status: "working" }),
    ];
    const result = sortSessions(sessions, "status", undefined, pinnedIds);
    // pinned idle should be first, then error, then working
    assert.equal(result[0].id, "idle");
    assert.equal(result[1].id, "error");
    assert.equal(result[2].id, "working");
  });

  it("empty pinnedIds has no effect", () => {
    const sessions = [
      makeSession({ id: "b", title: "Bravo" }),
      makeSession({ id: "a", title: "Alpha" }),
    ];
    const result = sortSessions(sessions, "name", undefined, new Set());
    assert.deepStrictEqual(result.map(s => s.id), ["a", "b"]); // name sort only
  });

  it("all sessions pinned preserves mode order", () => {
    const pinnedIds = new Set(["a", "b", "c"]);
    const sessions = [
      makeSession({ id: "c", title: "Charlie" }),
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Bravo" }),
    ];
    const result = sortSessions(sessions, "name", undefined, pinnedIds);
    assert.deepStrictEqual(result.map(s => s.id), ["a", "b", "c"]); // all pinned, name order
  });
});

// ── formatCompactRows with pins ─────────────────────────────────────────────

describe("formatCompactRows with pinnedIds", () => {
  it("includes pin indicator for pinned sessions", () => {
    const pinnedIds = new Set(["a"]);
    const sessions = [
      makeSession({ id: "a", title: "Alpha" }),
      makeSession({ id: "b", title: "Bravo" }),
    ];
    const rows = formatCompactRows(sessions, 80, pinnedIds);
    const plain = stripAnsi(rows.join(""));
    assert.ok(plain.includes("▲"), "should include pin icon for pinned session");
  });

  it("does not include pin indicator for unpinned sessions", () => {
    const sessions = [makeSession({ id: "a", title: "Alpha" })];
    const rows = formatCompactRows(sessions, 80, new Set());
    const plain = stripAnsi(rows.join(""));
    assert.ok(!plain.includes("▲"), "should not include pin icon");
  });
});

// ── TUI pin state ───────────────────────────────────────────────────────────

describe("TUI pin state", () => {
  it("initial state has no pins", () => {
    const tui = new TUI();
    assert.equal(tui.getPinnedCount(), 0);
  });

  it("togglePin by index pins a session", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [
        makeSession({ id: "abc", title: "Alpha" }),
        makeSession({ id: "def", title: "Bravo" }),
      ],
    });
    const ok = tui.togglePin(1);
    assert.equal(ok, true);
    assert.equal(tui.isPinned("abc"), true);
    assert.equal(tui.getPinnedCount(), 1);
  });

  it("togglePin by title pins a session", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [makeSession({ id: "abc", title: "Alpha" })],
    });
    const ok = tui.togglePin("alpha"); // case-insensitive
    assert.equal(ok, true);
    assert.equal(tui.isPinned("abc"), true);
  });

  it("togglePin returns false for invalid target", () => {
    const tui = new TUI();
    assert.equal(tui.togglePin(99), false);
    assert.equal(tui.togglePin("nonexistent"), false);
  });

  it("double toggle unpins", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [makeSession({ id: "abc", title: "Alpha" })],
    });
    tui.togglePin(1);
    assert.equal(tui.isPinned("abc"), true);
    tui.togglePin(1);
    assert.equal(tui.isPinned("abc"), false);
    assert.equal(tui.getPinnedCount(), 0);
  });

  it("togglePin is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [makeSession({ id: "abc", title: "Alpha" })],
    });
    tui.togglePin(1); // not started, should not throw
    assert.equal(tui.isPinned("abc"), true);
  });
});

// ── shouldBell ──────────────────────────────────────────────────────────────

describe("shouldBell", () => {
  it("returns true for error tag", () => {
    assert.equal(shouldBell("error", "something broke"), true);
  });

  it("returns true for ! action tag", () => {
    assert.equal(shouldBell("! action", "failed to send keys"), true);
  });

  it("returns true for + action with 'complete' in text", () => {
    assert.equal(shouldBell("+ action", "task completed successfully"), true);
  });

  it("returns true for + action with 'Complete' (case-insensitive)", () => {
    assert.equal(shouldBell("+ action", "Task Complete!"), true);
  });

  it("returns false for + action without 'complete'", () => {
    assert.equal(shouldBell("+ action", "sent keys to session"), false);
  });

  it("returns false for observation tag", () => {
    assert.equal(shouldBell("observation", "no changes"), false);
  });

  it("returns false for system tag", () => {
    assert.equal(shouldBell("system", "entering main loop"), false);
  });

  it("returns false for reasoner tag", () => {
    assert.equal(shouldBell("reasoner", "decided: wait"), false);
  });

  it("returns false for explain tag", () => {
    assert.equal(shouldBell("explain", "everything looks fine"), false);
  });

  it("returns false for status tag", () => {
    assert.equal(shouldBell("status", "you're working in Alpha"), false);
  });
});

// ── BELL_COOLDOWN_MS ────────────────────────────────────────────────────────

describe("BELL_COOLDOWN_MS", () => {
  it("is 5000ms", () => {
    assert.equal(BELL_COOLDOWN_MS, 5000);
  });
});

// ── TUI bell state ──────────────────────────────────────────────────────────

describe("TUI bell state", () => {
  it("initial bell is disabled", () => {
    const tui = new TUI();
    assert.equal(tui.isBellEnabled(), false);
  });

  it("setBell(true) enables bell", () => {
    const tui = new TUI();
    tui.setBell(true);
    assert.equal(tui.isBellEnabled(), true);
  });

  it("setBell(false) disables bell", () => {
    const tui = new TUI();
    tui.setBell(true);
    tui.setBell(false);
    assert.equal(tui.isBellEnabled(), false);
  });

  it("setBell is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.setBell(true); // not started, should not throw
    assert.equal(tui.isBellEnabled(), true);
  });
});

// ── TUI focus state ─────────────────────────────────────────────────────────

describe("TUI focus state", () => {
  it("initial focus mode is off", () => {
    const tui = new TUI();
    assert.equal(tui.isFocused(), false);
  });

  it("setFocus(true) enables focus mode", () => {
    const tui = new TUI();
    tui.setFocus(true);
    assert.equal(tui.isFocused(), true);
  });

  it("setFocus(false) disables focus mode", () => {
    const tui = new TUI();
    tui.setFocus(true);
    tui.setFocus(false);
    assert.equal(tui.isFocused(), false);
  });

  it("setFocus no-ops for same value", () => {
    const tui = new TUI();
    tui.setFocus(false); // already false, should not throw
    assert.equal(tui.isFocused(), false);
  });

  it("setFocus is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.setFocus(true); // not started, should not throw
    assert.equal(tui.isFocused(), true);
  });

  it("getSessionCount returns all sessions when not focused", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [
        makeSession({ id: "a", title: "Alpha" }),
        makeSession({ id: "b", title: "Bravo" }),
        makeSession({ id: "c", title: "Charlie" }),
      ],
    });
    assert.equal(tui.getSessionCount(), 3);
  });

  it("getSessionCount returns pinned-only count when focused", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [
        makeSession({ id: "a", title: "Alpha" }),
        makeSession({ id: "b", title: "Bravo" }),
        makeSession({ id: "c", title: "Charlie" }),
      ],
    });
    tui.togglePin(1); // pin "a" (Alpha)
    tui.setFocus(true);
    assert.equal(tui.getSessionCount(), 1);
  });

  it("getSessionCount returns 0 when focused with no pins", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [
        makeSession({ id: "a", title: "Alpha" }),
        makeSession({ id: "b", title: "Bravo" }),
      ],
    });
    tui.setFocus(true);
    assert.equal(tui.getSessionCount(), 0);
  });

  it("focus + pin + unpin updates visible count", () => {
    const tui = new TUI();
    tui.updateState({
      sessions: [
        makeSession({ id: "a", title: "Alpha" }),
        makeSession({ id: "b", title: "Bravo" }),
      ],
    });
    tui.togglePin(1); // pin a
    tui.togglePin(2); // pin b
    tui.setFocus(true);
    assert.equal(tui.getSessionCount(), 2);
    tui.togglePin(1); // unpin a
    assert.equal(tui.getSessionCount(), 1);
  });
});

// ── computeBookmarkOffset ───────────────────────────────────────────────────

describe("computeBookmarkOffset", () => {
  it("returns 0 when entry is in visible tail", () => {
    // buffer has 10 entries, visible = 5, bookmark = entry 8 (2 from end)
    assert.equal(computeBookmarkOffset(8, 10, 5), 0);
  });

  it("centers entry when scrolled back", () => {
    // buffer has 100 entries, visible = 10, bookmark = entry 50 (49 from end)
    // half = 5, offset = 49 - 5 = 44
    assert.equal(computeBookmarkOffset(50, 100, 10), 44);
  });

  it("returns 0 for last entry in buffer", () => {
    assert.equal(computeBookmarkOffset(99, 100, 10), 0);
  });

  it("handles entry at buffer start", () => {
    // entry 0 in buffer of 100, visible = 10
    // fromEnd = 99, half = 5, offset = 94
    assert.equal(computeBookmarkOffset(0, 100, 10), 94);
  });

  it("handles small buffer", () => {
    // buffer has 3 entries, visible = 10, entry 0
    assert.equal(computeBookmarkOffset(0, 3, 10), 0);
  });

  it("handles single entry", () => {
    assert.equal(computeBookmarkOffset(0, 1, 10), 0);
  });
});

// ── MAX_BOOKMARKS ───────────────────────────────────────────────────────────

describe("MAX_BOOKMARKS", () => {
  it("is 20", () => {
    assert.equal(MAX_BOOKMARKS, 20);
  });
});

// ── TUI bookmark state ─────────────────────────────────────────────────────

describe("TUI bookmark state", () => {
  it("initial state has no bookmarks", () => {
    const tui = new TUI();
    assert.equal(tui.getBookmarkCount(), 0);
    assert.deepStrictEqual(tui.getBookmarks(), []);
  });

  it("addBookmark returns 0 on empty buffer", () => {
    const tui = new TUI();
    assert.equal(tui.addBookmark(), 0);
  });

  it("addBookmark saves a bookmark and returns its number", () => {
    const tui = new TUI();
    tui.log("system", "hello world");
    const num = tui.addBookmark();
    assert.equal(num, 1);
    assert.equal(tui.getBookmarkCount(), 1);
    const bms = tui.getBookmarks();
    assert.ok(bms[0].label.includes("system"));
  });

  it("multiple addBookmark calls increment", () => {
    const tui = new TUI();
    tui.log("system", "first");
    tui.log("system", "second");
    assert.equal(tui.addBookmark(), 1);
    assert.equal(tui.addBookmark(), 2);
    assert.equal(tui.getBookmarkCount(), 2);
  });

  it("jumpToBookmark returns false for invalid number", () => {
    const tui = new TUI();
    assert.equal(tui.jumpToBookmark(1), false);
    assert.equal(tui.jumpToBookmark(0), false);
    assert.equal(tui.jumpToBookmark(-1), false);
  });

  it("jumpToBookmark returns true for valid bookmark", () => {
    const tui = new TUI();
    for (let i = 0; i < 20; i++) tui.log("system", `entry ${i}`);
    tui.addBookmark();
    assert.equal(tui.jumpToBookmark(1), true);
  });

  it("addBookmark is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.log("system", "test");
    assert.doesNotThrow(() => tui.addBookmark());
  });

  it("jumpToBookmark is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.log("system", "test");
    tui.addBookmark();
    assert.doesNotThrow(() => tui.jumpToBookmark(1));
  });
});

// ── shouldMuteEntry ─────────────────────────────────────────────────────────

describe("shouldMuteEntry", () => {
  it("returns false for entry without sessionId", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello" };
    assert.equal(shouldMuteEntry(entry, new Set(["sess-1"])), false);
  });

  it("returns false for entry with non-muted sessionId", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello", sessionId: "sess-2" };
    assert.equal(shouldMuteEntry(entry, new Set(["sess-1"])), false);
  });

  it("returns true for entry with muted sessionId", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "! action", text: "error!", sessionId: "sess-1" };
    assert.equal(shouldMuteEntry(entry, new Set(["sess-1"])), true);
  });

  it("returns false when mutedIds is empty", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello", sessionId: "sess-1" };
    assert.equal(shouldMuteEntry(entry, new Set()), false);
  });

  it("handles multiple muted IDs", () => {
    const muted = new Set(["a", "b", "c"]);
    assert.equal(shouldMuteEntry({ time: "12:00:00", tag: "system", text: "x", sessionId: "b" }, muted), true);
    assert.equal(shouldMuteEntry({ time: "12:00:00", tag: "system", text: "x", sessionId: "d" }, muted), false);
  });
});

// ── MUTE_ICON ───────────────────────────────────────────────────────────────

describe("MUTE_ICON", () => {
  it("is the hollow circle character", () => {
    assert.equal(MUTE_ICON, "◌");
  });
});

// ── TUI mute state ─────────────────────────────────────────────────────────

describe("TUI mute state", () => {
  it("initial state has no muted sessions", () => {
    const tui = new TUI();
    assert.equal(tui.getMutedCount(), 0);
  });

  it("toggleMute returns false for unknown session", () => {
    const tui = new TUI();
    assert.equal(tui.toggleMute(1), false);
    assert.equal(tui.toggleMute("nonexistent"), false);
  });

  it("toggleMute by index works with sessions present", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
    ]});
    assert.equal(tui.toggleMute(1), true);
    assert.equal(tui.isMuted("s1"), true);
    assert.equal(tui.isMuted("s2"), false);
    assert.equal(tui.getMutedCount(), 1);
  });

  it("toggleMute by name works (case-insensitive)", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    assert.equal(tui.toggleMute("alpha"), true);
    assert.equal(tui.isMuted("s1"), true);
  });

  it("double toggle unmutes", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    assert.equal(tui.isMuted("s1"), true);
    tui.toggleMute(1);
    assert.equal(tui.isMuted("s1"), false);
    assert.equal(tui.getMutedCount(), 0);
  });

  it("isMuted returns false for unknown ID", () => {
    const tui = new TUI();
    assert.equal(tui.isMuted("nonexistent"), false);
  });

  it("toggleMute is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    assert.doesNotThrow(() => tui.toggleMute(1));
  });

  it("muted session log entries with sessionId are still buffered", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    // log an entry tied to the muted session — should not throw
    assert.doesNotThrow(() => tui.log("! action", "Alpha errored", "s1"));
    // log a non-session entry — should also work fine
    assert.doesNotThrow(() => tui.log("system", "general message"));
  });
});


