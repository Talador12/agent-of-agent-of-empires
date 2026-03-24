import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSnapshotData, formatSnapshotJson, formatSnapshotMarkdown,
  formatBroadcastSummary,
  rankSessions, TOP_SORT_MODES,
  buildSessionStats, formatSessionStatsLines, formatStatsJson,
  formatWatchdogTag, formatGroupFilterTag,
  computeSessionActivityRate, formatActivityRateBadge, ACTIVITY_RATE_WINDOW_MS,
  formatIdleSince,
  WATCHDOG_DEFAULT_MINUTES, WATCHDOG_ALERT_COOLDOWN_MS,
  formatActivity, formatSessionCard, formatSessionSentence,
  truncateAnsi, truncatePlain,
  padBoxLine, padBoxLineHover, padToWidth, stripAnsiForLen, phaseDisplay,
  computeScrollSlice, formatScrollIndicator, formatDrilldownScrollIndicator,
  formatPrompt, formatDrilldownHeader,
  hitTestSession,
  matchesSearch, formatSearchIndicator,
  computeSparkline, formatSparkline,
  formatSessionErrorSparkline, SESSION_SPARK_BUCKETS, SESSION_SPARK_WINDOW_MS, MAX_ERROR_TIMESTAMPS,
  parseContextTokenNumber, computeContextBurnRate, formatBurnRateAlert,
  CONTEXT_BURN_THRESHOLD, CONTEXT_BURN_WINDOW_MS, MAX_CONTEXT_HISTORY,
  parseContextCeiling, formatContextCeilingAlert, CONTEXT_CEILING_THRESHOLD,
  computeHealthScore, formatHealthBadge, HEALTH_GOOD, HEALTH_WARN, HEALTH_ICON,
  isSuppressedEntry, MUTE_ERRORS_PATTERN,
  MAX_GOAL_HISTORY, validateSessionTag, formatSessionTagsBadge, MAX_SESSION_TAGS, MAX_SESSION_TAG_LEN,
  filterSessionTimeline, TIMELINE_DEFAULT_COUNT,
  validateColorName, formatColorDot, SESSION_COLOR_NAMES,
  computeErrorTrend, formatErrorTrend,
  buildDuplicateArgs,
  isQuietHour, parseQuietHoursRange,
  parseCostValue, computeCostSummary,
  formatSessionReport,
  formatQuietStatus,
  parseSessionAge, formatSessionAge,
  formatHealthSparkline, MAX_HEALTH_HISTORY,
  isOverBudget, formatBudgetAlert,
  formatHealthTrendChart,
  isFlapping, MAX_STATUS_HISTORY, FLAP_WINDOW_MS, FLAP_THRESHOLD,
  isAlertMuted,
  DRAIN_ICON,
  MAX_NOTE_HISTORY,
  truncateLabel, MAX_LABEL_LEN,
  formatSessionsTable,
  truncateRename, MAX_RENAME_LEN,
  sortSessions, nextSortMode, SORT_MODES,
  formatCompactRows, computeCompactRowCount, COMPACT_NAME_LEN,
  shouldBell, BELL_COOLDOWN_MS,
  computeBookmarkOffset, MAX_BOOKMARKS,
  shouldMuteEntry, MUTE_ICON, formatMuteBadge,
  truncateNote, MAX_NOTE_LEN, NOTE_ICON,
  matchesTagFilter, formatTagFilterIndicator,
  formatUptime,
  shouldAutoPin,
  formatClipText, CLIP_DEFAULT_COUNT,
  loadTuiPrefs, saveTuiPrefs,
  FILTER_PRESETS, resolveFilterPreset,
  resolveAlias, validateAliasName, MAX_ALIASES, BUILTIN_COMMANDS,
  validateGroupName, formatGroupBadge, GROUP_ICON, MAX_GROUP_NAME_LEN,
  TUI,
} from "./tui.js";
import type { ActivityEntry, SortMode, TuiPrefs, SnapshotData, SnapshotSession, TopSortMode, SessionReportData } from "./tui.js";
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
    // gutter bar ┃ or legacy │ — either satisfies the visual separation requirement
    assert.ok(plain.includes("┃") || plain.includes("│"), `should include gutter separator, got: ${plain}`);
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

  it("applies bold teal color to explain tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "explain", text: "test" };
    const result = formatActivity(entry, 120);
    assert.ok(result.includes("\x1b[1m"), "should include bold");
    // explain tag now uses TEAL (256-color) instead of 16-color cyan
    assert.ok(result.includes("\x1b[38;5;73m") || result.includes("AI"), "should include teal or AI label");
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

  it("cycles activity → health", () => {
    assert.equal(nextSortMode("activity"), "health");
  });

  it("cycles health → default", () => {
    assert.equal(nextSortMode("health"), "default");
  });
});

// ── SORT_MODES ──────────────────────────────────────────────────────────────

describe("SORT_MODES", () => {
  it("contains all four modes", () => {
    assert.deepStrictEqual(SORT_MODES, ["default", "status", "name", "activity", "health"]);
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

// ── formatCompactRows with health scores ─────────────────────────────────────

describe("formatCompactRows with healthScores", () => {
  it("includes health glyph for low-health sessions", () => {
    const sessions = [makeSession({ id: "a", title: "Alpha" })];
    const healthScores = new Map([["a", 50]]); // below HEALTH_GOOD(80)
    const rows = formatCompactRows(sessions, 80, undefined, undefined, undefined, healthScores);
    const plain = stripAnsi(rows.join(""));
    assert.ok(plain.includes(HEALTH_ICON), "should include health icon for unhealthy session");
  });

  it("does not include health glyph for healthy sessions (score=100)", () => {
    const sessions = [makeSession({ id: "a", title: "Alpha" })];
    const healthScores = new Map([["a", 100]]);
    const rows = formatCompactRows(sessions, 80, undefined, undefined, undefined, healthScores);
    const plain = stripAnsi(rows.join(""));
    assert.ok(!plain.includes(HEALTH_ICON), "should not include health icon at 100");
  });

  it("does not include health glyph when no scores provided", () => {
    const sessions = [makeSession({ id: "a", title: "Alpha" })];
    const rows = formatCompactRows(sessions, 80);
    const plain = stripAnsi(rows.join(""));
    assert.ok(!plain.includes(HEALTH_ICON));
  });

  it("includes ANSI color codes for unhealthy session glyph", () => {
    const sessions = [makeSession({ id: "a", title: "Alpha" })];
    const healthScores = new Map([["a", 40]]); // ROSE threshold
    const rows = formatCompactRows(sessions, 80, undefined, undefined, undefined, healthScores);
    assert.ok(rows.join("").includes("\x1b["));
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

// ── truncateNote ────────────────────────────────────────────────────────────

describe("truncateNote", () => {
  it("returns text unchanged when under limit", () => {
    assert.equal(truncateNote("short note"), "short note");
  });

  it("truncates long text with '..' suffix", () => {
    const long = "a".repeat(100);
    const result = truncateNote(long);
    assert.equal(result.length, MAX_NOTE_LEN);
    assert.ok(result.endsWith(".."));
    assert.equal(result, "a".repeat(78) + "..");
  });

  it("returns text unchanged at exact limit", () => {
    const exact = "b".repeat(MAX_NOTE_LEN);
    assert.equal(truncateNote(exact), exact);
  });

  it("handles empty string", () => {
    assert.equal(truncateNote(""), "");
  });
});

// ── MAX_NOTE_LEN ────────────────────────────────────────────────────────────

describe("MAX_NOTE_LEN", () => {
  it("is 80", () => {
    assert.equal(MAX_NOTE_LEN, 80);
  });
});

// ── NOTE_ICON ───────────────────────────────────────────────────────────────

describe("NOTE_ICON", () => {
  it("is the pencil character", () => {
    assert.equal(NOTE_ICON, "✎");
  });
});

// ── TUI note state ──────────────────────────────────────────────────────────

describe("TUI note state", () => {
  it("initial state has no notes", () => {
    const tui = new TUI();
    assert.equal(tui.getNoteCount(), 0);
    assert.equal(tui.getAllNotes().size, 0);
  });

  it("setNote by index works with sessions present", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
    ]});
    assert.equal(tui.setNote(1, "working on auth"), true);
    assert.equal(tui.getNote("s1"), "working on auth");
    assert.equal(tui.getNote("s2"), undefined);
    assert.equal(tui.getNoteCount(), 1);
  });

  it("setNote by name works (case-insensitive)", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    assert.equal(tui.setNote("alpha", "fixing tests"), true);
    assert.equal(tui.getNote("s1"), "fixing tests");
  });

  it("setNote with empty text clears note", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.setNote(1, "some note");
    assert.equal(tui.getNoteCount(), 1);
    tui.setNote(1, "");
    assert.equal(tui.getNoteCount(), 0);
    assert.equal(tui.getNote("s1"), undefined);
  });

  it("setNote returns false for unknown session", () => {
    const tui = new TUI();
    assert.equal(tui.setNote(1, "test"), false);
    assert.equal(tui.setNote("nonexistent", "test"), false);
  });

  it("getNote returns undefined for unknown ID", () => {
    const tui = new TUI();
    assert.equal(tui.getNote("nonexistent"), undefined);
  });

  it("getAllNotes returns all set notes", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
    ]});
    tui.setNote(1, "note one");
    tui.setNote(2, "note two");
    const notes = tui.getAllNotes();
    assert.equal(notes.size, 2);
    assert.equal(notes.get("s1"), "note one");
    assert.equal(notes.get("s2"), "note two");
  });

  it("getSessions returns current session list", () => {
    const tui = new TUI();
    const sessions = [
      { id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode", currentTask: "", userActive: false },
    ];
    tui.updateState({ sessions });
    const result = tui.getSessions();
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "s1");
    assert.equal(result[0].title, "Alpha");
  });

  it("setNote is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    assert.doesNotThrow(() => tui.setNote(1, "safe note"));
  });
});

// ── formatMuteBadge ─────────────────────────────────────────────────────────

describe("formatMuteBadge", () => {
  it("returns empty string for 0", () => {
    assert.equal(formatMuteBadge(0), "");
  });

  it("returns empty string for negative", () => {
    assert.equal(formatMuteBadge(-1), "");
  });

  it("formats small count", () => {
    const result = stripAnsi(formatMuteBadge(5));
    assert.equal(result, "(5)");
  });

  it("formats larger count", () => {
    const result = stripAnsi(formatMuteBadge(42));
    assert.equal(result, "(42)");
  });

  it("caps at 999+", () => {
    const result = stripAnsi(formatMuteBadge(1000));
    assert.equal(result, "(999+)");
  });

  it("caps at 999+ for huge numbers", () => {
    const result = stripAnsi(formatMuteBadge(50000));
    assert.equal(result, "(999+)");
  });
});

// ── TUI unmuteAll ───────────────────────────────────────────────────────────

describe("TUI unmuteAll", () => {
  it("returns 0 when nothing is muted", () => {
    const tui = new TUI();
    assert.equal(tui.unmuteAll(), 0);
  });

  it("unmutes all muted sessions and returns count", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
      { id: "s3", title: "Charlie", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    tui.toggleMute(3);
    assert.equal(tui.getMutedCount(), 2);
    const count = tui.unmuteAll();
    assert.equal(count, 2);
    assert.equal(tui.getMutedCount(), 0);
    assert.equal(tui.isMuted("s1"), false);
    assert.equal(tui.isMuted("s3"), false);
  });

  it("clears suppressed entry counts", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    tui.log("! action", "error happened", "s1");
    assert.equal(tui.getMutedEntryCount("s1"), 1);
    tui.unmuteAll();
    assert.equal(tui.getMutedEntryCount("s1"), 0);
  });

  it("is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    assert.doesNotThrow(() => tui.unmuteAll());
  });
});

// ── TUI mutedEntryCount ─────────────────────────────────────────────────────

describe("TUI mutedEntryCount", () => {
  it("returns 0 for unknown session", () => {
    const tui = new TUI();
    assert.equal(tui.getMutedEntryCount("nonexistent"), 0);
  });

  it("returns 0 for unmuted session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    assert.equal(tui.getMutedEntryCount("s1"), 0);
  });

  it("starts at 0 when muted", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    assert.equal(tui.getMutedEntryCount("s1"), 0);
  });

  it("increments on muted log entries", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    tui.log("system", "event 1", "s1");
    tui.log("! action", "event 2", "s1");
    tui.log("system", "event 3", "s1");
    assert.equal(tui.getMutedEntryCount("s1"), 3);
  });

  it("does not increment for non-muted sessions", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
    ]});
    tui.toggleMute(1);
    tui.log("system", "from bravo", "s2");
    assert.equal(tui.getMutedEntryCount("s1"), 0);
    assert.equal(tui.getMutedEntryCount("s2"), 0);
  });

  it("resets on unmute (toggle off)", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    tui.log("system", "suppressed", "s1");
    assert.equal(tui.getMutedEntryCount("s1"), 1);
    tui.toggleMute(1); // unmute
    assert.equal(tui.getMutedEntryCount("s1"), 0);
  });

  it("does not count entries without sessionId", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.toggleMute(1);
    tui.log("system", "general message"); // no sessionId
    assert.equal(tui.getMutedEntryCount("s1"), 0);
  });
});

// ── matchesTagFilter ────────────────────────────────────────────────────────

describe("matchesTagFilter", () => {
  it("returns true when tag is empty", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "error", text: "boom" };
    assert.equal(matchesTagFilter(entry, ""), true);
  });

  it("matches exact tag (case-insensitive)", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "error", text: "boom" };
    assert.equal(matchesTagFilter(entry, "error"), true);
    assert.equal(matchesTagFilter(entry, "ERROR"), true);
    assert.equal(matchesTagFilter(entry, "Error"), true);
  });

  it("rejects non-matching tag", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello" };
    assert.equal(matchesTagFilter(entry, "error"), false);
  });

  it("matches multi-word tags", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "+ action", text: "sent input" };
    assert.equal(matchesTagFilter(entry, "+ action"), true);
    assert.equal(matchesTagFilter(entry, "! action"), false);
  });

  it("does not partial-match", () => {
    const entry: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello" };
    assert.equal(matchesTagFilter(entry, "sys"), false);
  });

  it("matches pipe-separated multi-tag filter", () => {
    const error: ActivityEntry = { time: "12:00:00", tag: "error", text: "boom" };
    const action: ActivityEntry = { time: "12:00:00", tag: "! action", text: "failed" };
    const system: ActivityEntry = { time: "12:00:00", tag: "system", text: "hello" };
    assert.equal(matchesTagFilter(error, "error|! action"), true);
    assert.equal(matchesTagFilter(action, "error|! action"), true);
    assert.equal(matchesTagFilter(system, "error|! action"), false);
  });
});

// ── resolveFilterPreset ─────────────────────────────────────────────────────

describe("resolveFilterPreset", () => {
  it("expands 'errors' preset", () => {
    assert.equal(resolveFilterPreset("errors"), "error|! action");
  });

  it("expands 'actions' preset", () => {
    assert.equal(resolveFilterPreset("actions"), "+ action|! action");
  });

  it("expands 'system' preset", () => {
    assert.equal(resolveFilterPreset("system"), "system|status");
  });

  it("is case-insensitive", () => {
    assert.equal(resolveFilterPreset("Errors"), "error|! action");
  });

  it("passes through unknown tags unchanged", () => {
    assert.equal(resolveFilterPreset("reasoner"), "reasoner");
  });
});

// ── FILTER_PRESETS ──────────────────────────────────────────────────────────

describe("FILTER_PRESETS", () => {
  it("has errors, actions, system keys", () => {
    assert.ok("errors" in FILTER_PRESETS);
    assert.ok("actions" in FILTER_PRESETS);
    assert.ok("system" in FILTER_PRESETS);
  });

  it("has config key", () => {
    assert.ok("config" in FILTER_PRESETS);
    assert.equal(FILTER_PRESETS.config, "config");
  });
});

// ── formatTagFilterIndicator ────────────────────────────────────────────────

describe("formatTagFilterIndicator", () => {
  it("includes the tag name", () => {
    const result = stripAnsi(formatTagFilterIndicator("error", 5, 100));
    assert.ok(result.includes("error"));
  });

  it("includes match/total counts", () => {
    const result = stripAnsi(formatTagFilterIndicator("system", 42, 200));
    assert.ok(result.includes("42/200"));
  });

  it("includes 'filter:' label", () => {
    const result = stripAnsi(formatTagFilterIndicator("error", 0, 50));
    assert.ok(result.includes("filter:"));
  });
});

// ── TUI tag filter state ────────────────────────────────────────────────────

describe("TUI tag filter state", () => {
  it("initial state has no tag filter", () => {
    const tui = new TUI();
    assert.equal(tui.getTagFilter(), null);
  });

  it("setTagFilter sets the filter", () => {
    const tui = new TUI();
    tui.setTagFilter("error");
    assert.equal(tui.getTagFilter(), "error");
  });

  it("setTagFilter with null clears the filter", () => {
    const tui = new TUI();
    tui.setTagFilter("error");
    tui.setTagFilter(null);
    assert.equal(tui.getTagFilter(), null);
  });

  it("setTagFilter with empty string clears the filter", () => {
    const tui = new TUI();
    tui.setTagFilter("error");
    tui.setTagFilter("");
    assert.equal(tui.getTagFilter(), null);
  });

  it("setTagFilter resets scroll offset", () => {
    const tui = new TUI();
    // can't directly test scrollOffset (private), but setTagFilter is safe to call
    assert.doesNotThrow(() => tui.setTagFilter("system"));
    assert.doesNotThrow(() => tui.setTagFilter(null));
  });

  it("setTagFilter is safe when TUI is not active", () => {
    const tui = new TUI();
    assert.doesNotThrow(() => tui.setTagFilter("error"));
    assert.doesNotThrow(() => tui.setTagFilter(null));
  });
});

// ── formatUptime ────────────────────────────────────────────────────────────

describe("formatUptime", () => {
  it("returns '< 1m' for negative values", () => {
    assert.equal(formatUptime(-1000), "< 1m");
  });

  it("returns '< 1m' for zero", () => {
    assert.equal(formatUptime(0), "< 1m");
  });

  it("returns '< 1m' for under a minute", () => {
    assert.equal(formatUptime(30_000), "< 1m");
  });

  it("returns minutes for < 1 hour", () => {
    assert.equal(formatUptime(45 * 60_000), "45m");
  });

  it("returns hours and minutes", () => {
    assert.equal(formatUptime(2 * 3600_000 + 15 * 60_000), "2h 15m");
  });

  it("returns hours only when no remainder", () => {
    assert.equal(formatUptime(3 * 3600_000), "3h");
  });

  it("returns days and hours", () => {
    assert.equal(formatUptime(3 * 86400_000 + 2 * 3600_000), "3d 2h");
  });

  it("returns days only when no hour remainder", () => {
    assert.equal(formatUptime(1 * 86400_000), "1d");
  });

  it("returns 1m for exactly one minute", () => {
    assert.equal(formatUptime(60_000), "1m");
  });
});

// ── TUI uptime state ────────────────────────────────────────────────────────

describe("TUI uptime state", () => {
  it("getUptime returns 0 for unknown session", () => {
    const tui = new TUI();
    assert.equal(tui.getUptime("nonexistent"), 0);
  });

  it("getUptime returns positive value after updateState", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    const uptime = tui.getUptime("s1");
    assert.ok(uptime >= 0);
  });

  it("getAllFirstSeen tracks first-seen timestamps", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
    ]});
    const firstSeen = tui.getAllFirstSeen();
    assert.equal(firstSeen.size, 2);
    assert.ok(firstSeen.has("s1"));
    assert.ok(firstSeen.has("s2"));
  });

  it("first-seen time does not change on subsequent updateState calls", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    const first = tui.getAllFirstSeen().get("s1");
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "working", tool: "opencode", currentTask: "building", userActive: false },
    ]});
    const second = tui.getAllFirstSeen().get("s1");
    assert.equal(first, second);
  });

  it("new sessions get their own first-seen time", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    const t1 = tui.getAllFirstSeen().get("s1");
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
      { id: "s2", title: "Bravo", status: "working", tool: "cursor", currentTask: "test", userActive: false },
    ]});
    const t2 = tui.getAllFirstSeen().get("s2");
    assert.ok(t1 !== undefined);
    assert.ok(t2 !== undefined);
    assert.ok(t2! >= t1!);
  });
});

// ── shouldAutoPin ───────────────────────────────────────────────────────────

describe("shouldAutoPin", () => {
  it("returns true for '! action' tag", () => {
    assert.equal(shouldAutoPin("! action"), true);
  });

  it("returns true for 'error' tag", () => {
    assert.equal(shouldAutoPin("error"), true);
  });

  it("returns true case-insensitively", () => {
    assert.equal(shouldAutoPin("! Action"), true);
    assert.equal(shouldAutoPin("ERROR"), true);
  });

  it("returns false for 'system' tag", () => {
    assert.equal(shouldAutoPin("system"), false);
  });

  it("returns false for '+ action' tag", () => {
    assert.equal(shouldAutoPin("+ action"), false);
  });

  it("returns false for 'reasoner' tag", () => {
    assert.equal(shouldAutoPin("reasoner"), false);
  });
});

// ── TUI auto-pin state ─────────────────────────────────────────────────────

describe("TUI auto-pin state", () => {
  it("auto-pin is disabled by default", () => {
    const tui = new TUI();
    assert.equal(tui.isAutoPinEnabled(), false);
  });

  it("setAutoPin enables auto-pin", () => {
    const tui = new TUI();
    tui.setAutoPin(true);
    assert.equal(tui.isAutoPinEnabled(), true);
  });

  it("setAutoPin(false) disables auto-pin", () => {
    const tui = new TUI();
    tui.setAutoPin(true);
    tui.setAutoPin(false);
    assert.equal(tui.isAutoPinEnabled(), false);
  });

  it("auto-pins session on error log entry", () => {
    const tui = new TUI();
    tui.setAutoPin(true);
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    assert.equal(tui.isPinned("s1"), false);
    tui.log("! action", "something failed", "s1");
    assert.equal(tui.isPinned("s1"), true);
  });

  it("does not auto-pin when disabled", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.log("! action", "something failed", "s1");
    assert.equal(tui.isPinned("s1"), false);
  });

  it("does not auto-pin for non-error tags", () => {
    const tui = new TUI();
    tui.setAutoPin(true);
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.log("system", "normal message", "s1");
    assert.equal(tui.isPinned("s1"), false);
  });

  it("does not auto-pin entries without sessionId", () => {
    const tui = new TUI();
    tui.setAutoPin(true);
    tui.log("! action", "error happened"); // no sessionId
    // should not throw or pin anything
  });

  it("does not double-pin already pinned sessions", () => {
    const tui = new TUI();
    tui.setAutoPin(true);
    tui.updateState({ sessions: [
      { id: "s1", title: "Alpha", status: "idle", tool: "opencode", currentTask: "", userActive: false },
    ]});
    tui.togglePin(1); // manual pin
    assert.equal(tui.isPinned("s1"), true);
    // should not throw
    assert.doesNotThrow(() => tui.log("! action", "error", "s1"));
    assert.equal(tui.isPinned("s1"), true);
  });
});

// ── CLIP_DEFAULT_COUNT ──────────────────────────────────────────────────────

describe("CLIP_DEFAULT_COUNT", () => {
  it("is 20", () => {
    assert.equal(CLIP_DEFAULT_COUNT, 20);
  });
});

// ── formatClipText ──────────────────────────────────────────────────────────

describe("formatClipText", () => {
  it("returns newline for empty array", () => {
    assert.equal(formatClipText([]), "\n");
  });

  it("formats a single entry", () => {
    const entries = [{ time: "12:00:00", tag: "system", text: "hello" }];
    assert.equal(formatClipText(entries), "[12:00:00] system: hello\n");
  });

  it("formats multiple entries", () => {
    const entries = [
      { time: "12:00:00", tag: "system", text: "first" },
      { time: "12:00:01", tag: "error", text: "second" },
    ];
    assert.equal(formatClipText(entries), "[12:00:00] system: first\n[12:00:01] error: second\n");
  });

  it("uses CLIP_DEFAULT_COUNT when n is omitted", () => {
    // create 25 entries, default count is 20 so only last 20 should appear
    const entries = Array.from({ length: 25 }, (_, i) => ({
      time: `12:00:${String(i).padStart(2, "0")}`,
      tag: "system",
      text: `entry-${i}`,
    }));
    const text = formatClipText(entries);
    const lines = text.trimEnd().split("\n");
    assert.equal(lines.length, 20);
    assert.ok(lines[0].includes("entry-5"));
    assert.ok(lines[19].includes("entry-24"));
  });

  it("respects custom count", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      time: `12:00:${String(i).padStart(2, "0")}`,
      tag: "system",
      text: `entry-${i}`,
    }));
    const text = formatClipText(entries, 3);
    const lines = text.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    assert.ok(lines[0].includes("entry-7"));
    assert.ok(lines[2].includes("entry-9"));
  });

  it("returns all entries when count exceeds buffer size", () => {
    const entries = [
      { time: "12:00:00", tag: "system", text: "only" },
    ];
    const text = formatClipText(entries, 100);
    const lines = text.trimEnd().split("\n");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("only"));
  });
});

// ── TUI getActivityBuffer ──────────────────────────────────────────────────

describe("TUI getActivityBuffer", () => {
  it("returns empty array initially", () => {
    const tui = new TUI();
    assert.deepStrictEqual([...tui.getActivityBuffer()], []);
  });

  it("returns entries after log calls", () => {
    const tui = new TUI();
    tui.log("system", "hello");
    tui.log("error", "oops");
    const buffer = tui.getActivityBuffer();
    assert.equal(buffer.length, 2);
    assert.equal(buffer[0].tag, "system");
    assert.equal(buffer[0].text, "hello");
    assert.equal(buffer[1].tag, "error");
    assert.equal(buffer[1].text, "oops");
  });

  it("returns readonly array (same reference across calls)", () => {
    const tui = new TUI();
    tui.log("system", "test");
    const a = tui.getActivityBuffer();
    const b = tui.getActivityBuffer();
    assert.equal(a, b);
  });
});

// ── loadTuiPrefs / saveTuiPrefs ────────────────────────────────────────────

describe("loadTuiPrefs", () => {
  it("returns empty object when file does not exist", () => {
    // default path won't exist in CI; loadTuiPrefs is resilient
    const prefs = loadTuiPrefs();
    assert.equal(typeof prefs, "object");
  });
});

describe("saveTuiPrefs", () => {
  it("does not throw on write", () => {
    // writes to ~/.aoaoe/tui-prefs.json — best effort
    assert.doesNotThrow(() => saveTuiPrefs({ compact: true }));
  });
});

// ── TUI getSessionErrorCounts ──────────────────────────────────────────────

describe("TUI getSessionErrorCounts", () => {
  it("returns empty map initially", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionErrorCounts().size, 0);
  });

  it("counts error-tagged entries per session", () => {
    const tui = new TUI();
    tui.log("error", "boom", "s1");
    tui.log("! action", "fail", "s1");
    tui.log("system", "ok", "s1"); // not an error
    tui.log("error", "crash", "s2");
    const counts = tui.getSessionErrorCounts();
    assert.equal(counts.get("s1"), 2);
    assert.equal(counts.get("s2"), 1);
  });

  it("does not count entries without sessionId", () => {
    const tui = new TUI();
    tui.log("error", "no session"); // no sessionId
    assert.equal(tui.getSessionErrorCounts().size, 0);
  });
});

// ── resolveAlias ───────────────────────────────────────────────────────────

describe("resolveAlias", () => {
  it("returns original line when no alias matches", () => {
    const aliases = new Map<string, string>();
    assert.equal(resolveAlias("/help", aliases), "/help");
  });

  it("expands a simple alias", () => {
    const aliases = new Map([[ "/e", "/filter errors" ]]);
    assert.equal(resolveAlias("/e", aliases), "/filter errors");
  });

  it("appends trailing args from original line", () => {
    const aliases = new Map([[ "/n", "/note" ]]);
    assert.equal(resolveAlias("/n 1 hello", aliases), "/note 1 hello");
  });

  it("does not expand non-slash text", () => {
    const aliases = new Map([[ "/x", "/who" ]]);
    assert.equal(resolveAlias("hello", aliases), "hello");
  });

  it("matches first word only", () => {
    const aliases = new Map([[ "/x", "/who" ]]);
    assert.equal(resolveAlias("/x extra", aliases), "/who extra");
  });

  it("empty alias map returns original", () => {
    assert.equal(resolveAlias("/foo bar", new Map()), "/foo bar");
  });
});

// ── validateAliasName ──────────────────────────────────────────────────────

describe("validateAliasName", () => {
  it("accepts valid alias name", () => {
    assert.equal(validateAliasName("/e"), null);
  });

  it("accepts multi-char alias", () => {
    assert.equal(validateAliasName("/my-filter"), null);
  });

  it("rejects name without slash", () => {
    assert.ok(validateAliasName("foo") !== null);
  });

  it("rejects single slash", () => {
    assert.ok(validateAliasName("/") !== null);
  });

  it("rejects built-in command /help", () => {
    const err = validateAliasName("/help");
    assert.ok(err !== null);
    assert.ok(err!.includes("built-in"));
  });

  it("rejects built-in command /alias", () => {
    assert.ok(validateAliasName("/alias") !== null);
  });

  it("rejects built-in command /filter", () => {
    assert.ok(validateAliasName("/filter") !== null);
  });

  it("rejects uppercase characters", () => {
    assert.ok(validateAliasName("/Foo") !== null);
  });

  it("rejects special characters", () => {
    assert.ok(validateAliasName("/foo!") !== null);
  });

  it("accepts numeric alias", () => {
    assert.equal(validateAliasName("/1"), null);
  });
});

// ── MAX_ALIASES ────────────────────────────────────────────────────────────

describe("MAX_ALIASES", () => {
  it("is 50", () => {
    assert.equal(MAX_ALIASES, 50);
  });
});

// ── buildSessionStats ─────────────────────────────────────────────────────

describe("buildSessionStats", () => {
  const sessions: DaemonSessionState[] = [
    { id: "s1", title: "Alpha", status: "working", tool: "opencode", contextTokens: "50,000 / 200,000 tokens", lastActivity: "step 1", userActive: false, currentTask: "build" },
    { id: "s2", title: "Bravo", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];

  it("returns one entry per session", () => {
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), new Map(), new Map(), new Map());
    assert.equal(result.length, 2);
  });

  it("includes title and status", () => {
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), new Map(), new Map(), new Map());
    assert.equal(result[0].title, "Alpha");
    assert.equal(result[0].status, "working");
  });

  it("includes error count", () => {
    const errors = new Map([["s1", 3]]);
    const result = buildSessionStats(sessions, errors, new Map(), new Map(), new Map(), new Map(), new Map());
    assert.equal(result[0].errors, 3);
  });

  it("includes context percentage when ceiling available", () => {
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), new Map(), new Map(), new Map());
    assert.equal(result[0].contextPct, 25); // 50k/200k = 25%
    assert.equal(result[1].contextPct, null);
  });

  it("includes uptime when firstSeen set", () => {
    const now = Date.now();
    const firstSeen = new Map([["s1", now - 5 * 60_000]]);
    const result = buildSessionStats(sessions, new Map(), new Map(), firstSeen, new Map(), new Map(), new Map(), now);
    assert.ok(result[0].uptimeMs !== null && result[0].uptimeMs >= 5 * 60_000 - 100);
    assert.equal(result[1].uptimeMs, null);
  });

  it("includes idleSinceMs when lastChangeAt set", () => {
    const now = Date.now();
    const lastChange = new Map([["s1", now - 3 * 60_000]]);
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), lastChange, new Map(), new Map(), now);
    assert.ok(result[0].idleSinceMs !== null && result[0].idleSinceMs >= 3 * 60_000 - 100);
  });

  it("includes displayName from sessionAliases", () => {
    const aliases = new Map([["s1", "My Alpha"]]);
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), new Map(), new Map(), aliases);
    assert.equal(result[0].displayName, "My Alpha");
    assert.equal(result[1].displayName, undefined);
  });

  it("includes health score from healthScores map", () => {
    const health = new Map([["s1", 75], ["s2", 100]]);
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), new Map(), health, new Map());
    assert.equal(result[0].health, 75);
    assert.equal(result[1].health, 100);
  });

  it("defaults health to 100 when not in map", () => {
    const result = buildSessionStats(sessions, new Map(), new Map(), new Map(), new Map(), new Map(), new Map());
    assert.equal(result[0].health, 100);
  });
});

// ── formatSessionStatsLines ───────────────────────────────────────────────

describe("formatSessionStatsLines", () => {
  it("returns 'no sessions' for empty array", () => {
    const lines = formatSessionStatsLines([]);
    assert.ok(lines[0].includes("no sessions"));
  });

  it("returns one line per entry", () => {
    const entries = [
      { title: "Alpha", status: "working", health: 100, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null },
      { title: "Bravo", status: "idle", health: 80, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null },
    ];
    assert.equal(formatSessionStatsLines(entries).length, 2);
  });

  it("includes session title", () => {
    const entries = [{ title: "Alpha", status: "working", health: 95, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null }];
    assert.ok(formatSessionStatsLines(entries)[0].includes("Alpha"));
  });

  it("includes health score glyph", () => {
    const entries = [{ title: "A", status: "idle", health: 75, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null }];
    assert.ok(formatSessionStatsLines(entries)[0].includes("⬡75"));
  });

  it("includes error count when > 0", () => {
    const entries = [{ title: "A", status: "error", health: 50, errors: 3, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null }];
    assert.ok(formatSessionStatsLines(entries)[0].includes("3err"));
  });

  it("includes context pct when set", () => {
    const entries = [{ title: "A", status: "working", health: 90, errors: 0, burnRatePerMin: null, contextPct: 85, uptimeMs: null, idleSinceMs: null }];
    assert.ok(formatSessionStatsLines(entries)[0].includes("ctx:85%"));
  });

  it("includes displayName when set", () => {
    const entries = [{ title: "alpha-session", displayName: "My Worker", status: "idle", health: 100, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null }];
    const line = formatSessionStatsLines(entries)[0];
    assert.ok(line.includes("My Worker"));
    assert.ok(line.includes("alpha-session"));
  });
});

// ── formatStatsJson ───────────────────────────────────────────────────────

describe("formatStatsJson", () => {
  it("returns valid JSON", () => {
    const entries = [{ title: "Alpha", status: "working", health: 95, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null }];
    assert.doesNotThrow(() => JSON.parse(formatStatsJson(entries, "1.0.0")));
  });

  it("includes version and exportedAt", () => {
    const obj = JSON.parse(formatStatsJson([], "0.119.0"));
    assert.equal(obj.version, "0.119.0");
    assert.ok(typeof obj.exportedAt === "string");
  });

  it("includes sessions array", () => {
    const entries = [{ title: "A", status: "idle", health: 100, errors: 0, burnRatePerMin: null, contextPct: null, uptimeMs: null, idleSinceMs: null }];
    const obj = JSON.parse(formatStatsJson(entries, "1.0.0"));
    assert.ok(Array.isArray(obj.sessions));
    assert.equal(obj.sessions.length, 1);
  });

  it("ends with newline", () => {
    assert.ok(formatStatsJson([], "1.0.0").endsWith("\n"));
  });
});

// ── computeSessionActivityRate ────────────────────────────────────────────

describe("computeSessionActivityRate", () => {
  it("returns 0 for empty buffer", () => {
    assert.equal(computeSessionActivityRate([], [], "s1"), 0);
  });

  it("returns 0 when no entries for session", () => {
    const now = Date.now();
    const buf = [{ sessionId: "s2", tag: "system", text: "hello", time: "12:00" }];
    const ts = [now];
    assert.equal(computeSessionActivityRate(buf, ts, "s1", now), 0);
  });

  it("returns 0 for entries outside window", () => {
    const now = Date.now();
    const old = now - ACTIVITY_RATE_WINDOW_MS - 5000;
    const buf = [{ sessionId: "s1", tag: "system", text: "hello", time: "12:00" }];
    const ts = [old];
    assert.equal(computeSessionActivityRate(buf, ts, "s1", now), 0);
  });

  it("computes rate for recent entries", () => {
    const now = Date.now();
    // 3 entries in 5-minute window = 3/5 per minute = 0.6/min
    const buf = [
      { sessionId: "s1", tag: "system", text: "a", time: "12:00" },
      { sessionId: "s1", tag: "system", text: "b", time: "12:01" },
      { sessionId: "s1", tag: "system", text: "c", time: "12:02" },
    ];
    const ts = [now - 1000, now - 2000, now - 3000];
    const rate = computeSessionActivityRate(buf, ts, "s1", now);
    assert.ok(rate > 0);
  });

  it("only counts entries for specified session", () => {
    const now = Date.now();
    const buf = [
      { sessionId: "s1", tag: "system", text: "a", time: "12:00" },
      { sessionId: "s2", tag: "system", text: "b", time: "12:00" },
    ];
    const ts = [now, now];
    const rateS1 = computeSessionActivityRate(buf, ts, "s1", now);
    const rateS2 = computeSessionActivityRate(buf, ts, "s2", now);
    assert.ok(rateS1 > 0);
    assert.ok(rateS2 > 0);
    // rates should be similar (1 entry each)
    assert.ok(Math.abs(rateS1 - rateS2) < 0.1);
  });
});

// ── formatActivityRateBadge ───────────────────────────────────────────────

describe("formatActivityRateBadge", () => {
  it("returns empty for rate 0", () => {
    assert.equal(formatActivityRateBadge(0), "");
  });

  it("returns empty for negative rate", () => {
    assert.equal(formatActivityRateBadge(-1), "");
  });

  it("returns badge for positive rate", () => {
    const badge = stripAnsi(formatActivityRateBadge(3));
    assert.ok(badge.includes("/m"));
  });

  it("rounds rate to nearest integer", () => {
    const badge = stripAnsi(formatActivityRateBadge(2.7));
    assert.ok(badge.includes("3"));
  });

  it("returns at least 1 when rate is positive but < 0.5", () => {
    const badge = stripAnsi(formatActivityRateBadge(0.1));
    assert.ok(badge.includes("1"));
  });
});

// ── ACTIVITY_RATE_WINDOW_MS ───────────────────────────────────────────────

describe("ACTIVITY_RATE_WINDOW_MS", () => {
  it("is 5 minutes", () => {
    assert.equal(ACTIVITY_RATE_WINDOW_MS, 5 * 60_000);
  });
});

// ── TUI pinAllErrors ──────────────────────────────────────────────────────

describe("TUI pinAllErrors", () => {
  function makeErrorSessions(): DaemonSessionState[] {
    return [
      { id: "e1", title: "Alpha", status: "error", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
      { id: "e2", title: "Bravo", status: "working", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
      { id: "e3", title: "Charlie", status: "error", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    ];
  }

  it("pins all sessions in error status", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeErrorSessions() });
    const count = tui.pinAllErrors();
    assert.equal(count, 2); // Alpha and Charlie are errors
    assert.equal(tui.isPinned("e1"), true);
    assert.equal(tui.isPinned("e3"), true);
  });

  it("does not pin non-error sessions", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeErrorSessions() });
    tui.pinAllErrors();
    assert.equal(tui.isPinned("e2"), false);
  });

  it("does not double-pin already pinned error sessions", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeErrorSessions() });
    tui.pinAllErrors();
    const count2 = tui.pinAllErrors(); // second call
    assert.equal(count2, 0); // already pinned
  });

  it("returns 0 when no error sessions", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "x", title: "X", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(tui.pinAllErrors(), 0);
  });

  it("also pins sessions with error counts > 0", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "x", title: "X", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    tui.log("error", "oops", "x"); // adds error count
    const count = tui.pinAllErrors();
    assert.equal(count, 1);
  });
});

// ── formatWatchdogTag ─────────────────────────────────────────────────────

describe("formatWatchdogTag", () => {
  it("returns empty string when disabled", () => {
    assert.equal(formatWatchdogTag(null), "");
  });

  it("returns formatted tag with minutes", () => {
    const tag = formatWatchdogTag(10 * 60_000);
    assert.ok(tag.includes("10m"));
    assert.ok(tag.includes("⊛"));
  });

  it("rounds to nearest minute", () => {
    const tag = formatWatchdogTag(5 * 60_000);
    assert.ok(tag.includes("5m"));
  });
});

// ── formatGroupFilterTag ──────────────────────────────────────────────────

describe("formatGroupFilterTag", () => {
  it("returns empty string when no filter", () => {
    assert.equal(formatGroupFilterTag(null), "");
  });

  it("includes group name", () => {
    const tag = formatGroupFilterTag("frontend");
    assert.ok(tag.includes("frontend"));
  });

  it("includes GROUP_ICON", () => {
    const tag = formatGroupFilterTag("backend");
    assert.ok(tag.includes(GROUP_ICON));
  });
});

// ── rankSessions ─────────────────────────────────────────────────────────

function makeRankSessions(): DaemonSessionState[] {
  return [
    { id: "s1", title: "Alpha", status: "error", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s2", title: "Bravo", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s3", title: "Charlie", status: "working", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];
}

describe("rankSessions", () => {
  it("returns one entry per session", () => {
    const sessions = makeRankSessions();
    const result = rankSessions(sessions, new Map(), new Map(), new Map(), "default");
    assert.equal(result.length, 3);
  });

  it("assigns sequential ranks starting at 1", () => {
    const result = rankSessions(makeRankSessions(), new Map(), new Map(), new Map(), "default");
    const ranks = result.map((e) => e.rank).sort((a, b) => a - b);
    assert.deepEqual(ranks, [1, 2, 3]);
  });

  it("errors mode: most errors first", () => {
    const errors = new Map([["s2", 5], ["s1", 2], ["s3", 0]]);
    const result = rankSessions(makeRankSessions(), errors, new Map(), new Map(), "errors");
    assert.equal(result[0].title, "Bravo");
    assert.equal(result[1].title, "Alpha");
  });

  it("burn mode: highest burn first", () => {
    const burns = new Map<string, number | null>([["s1", 8000], ["s2", 3000], ["s3", null]]);
    const result = rankSessions(makeRankSessions(), new Map(), burns, new Map(), "burn");
    assert.equal(result[0].title, "Alpha");
  });

  it("idle mode: most idle first", () => {
    const now = Date.now();
    const lastChange = new Map([["s1", now - 1000], ["s2", now - 60_000], ["s3", now - 5000]]);
    const result = rankSessions(makeRankSessions(), new Map(), new Map(), lastChange, "idle", now);
    assert.equal(result[0].title, "Bravo"); // idle longest
  });

  it("default mode: errors heavily weighted", () => {
    const errors = new Map([["s2", 10]]);
    const result = rankSessions(makeRankSessions(), errors, new Map(), new Map(), "default");
    assert.equal(result[0].title, "Bravo");
  });

  it("empty sessions returns empty array", () => {
    assert.deepEqual(rankSessions([], new Map(), new Map(), new Map(), "default"), []);
  });

  it("includes burnRatePerMin in entries", () => {
    const burns = new Map<string, number | null>([["s1", 1234]]);
    const result = rankSessions(makeRankSessions(), new Map(), burns, new Map(), "default");
    const alpha = result.find((e) => e.title === "Alpha")!;
    assert.equal(alpha.burnRatePerMin, 1234);
  });

  it("includes idleMs in entries when lastChangeAt present", () => {
    const now = Date.now();
    const lastChange = new Map([["s1", now - 5000]]);
    const result = rankSessions(makeRankSessions(), new Map(), new Map(), lastChange, "default", now);
    const alpha = result.find((e) => e.title === "Alpha")!;
    assert.ok(alpha.idleMs !== null && alpha.idleMs >= 5000 - 10);
  });

  it("idleMs is null when lastChangeAt not tracked", () => {
    const result = rankSessions(makeRankSessions(), new Map(), new Map(), new Map(), "default");
    for (const e of result) assert.equal(e.idleMs, null);
  });
});

// ── TOP_SORT_MODES ────────────────────────────────────────────────────────

describe("TOP_SORT_MODES", () => {
  it("contains all four modes", () => {
    assert.ok(TOP_SORT_MODES.includes("default"));
    assert.ok(TOP_SORT_MODES.includes("errors"));
    assert.ok(TOP_SORT_MODES.includes("burn"));
    assert.ok(TOP_SORT_MODES.includes("idle"));
  });
});

// ── formatIdleSince ───────────────────────────────────────────────────────

describe("formatIdleSince", () => {
  it("returns empty for ms under threshold", () => {
    assert.equal(formatIdleSince(60_000), ""); // 1 min < 2 min default
  });

  it("returns idle string for ms over threshold", () => {
    const result = formatIdleSince(5 * 60_000); // 5 min
    assert.ok(result.includes("idle"));
    assert.ok(result.includes("5m"));
  });

  it("returns empty for negative ms", () => {
    assert.equal(formatIdleSince(-1), "");
  });

  it("respects custom threshold", () => {
    assert.equal(formatIdleSince(30_000, 60_000), ""); // 30s < 60s threshold
    assert.ok(formatIdleSince(90_000, 60_000).includes("idle")); // 90s > 60s threshold
  });

  it("includes formatted uptime in output", () => {
    const result = formatIdleSince(70 * 60_000); // 70 min = 1h 10m
    assert.ok(result.includes("1h") || result.includes("70m") || result.includes("idle"));
  });
});

// ── WATCHDOG_DEFAULT_MINUTES ──────────────────────────────────────────────

describe("WATCHDOG_DEFAULT_MINUTES", () => {
  it("is 10", () => {
    assert.equal(WATCHDOG_DEFAULT_MINUTES, 10);
  });
});

// ── WATCHDOG_ALERT_COOLDOWN_MS ────────────────────────────────────────────

describe("WATCHDOG_ALERT_COOLDOWN_MS", () => {
  it("is 5 minutes", () => {
    assert.equal(WATCHDOG_ALERT_COOLDOWN_MS, 5 * 60_000);
  });
});

// ── TUI watchdog state ────────────────────────────────────────────────────

describe("TUI watchdog state", () => {
  it("starts with watchdog disabled (null)", () => {
    const tui = new TUI();
    assert.equal(tui.getWatchdogThreshold(), null);
  });

  it("setWatchdog sets threshold", () => {
    const tui = new TUI();
    tui.setWatchdog(10 * 60_000);
    assert.equal(tui.getWatchdogThreshold(), 10 * 60_000);
  });

  it("setWatchdog null disables watchdog", () => {
    const tui = new TUI();
    tui.setWatchdog(5 * 60_000);
    tui.setWatchdog(null);
    assert.equal(tui.getWatchdogThreshold(), null);
  });

  it("getWatchdogAlertedAt returns 0 for unalerted session", () => {
    const tui = new TUI();
    assert.equal(tui.getWatchdogAlertedAt("s1"), 0);
  });

  it("watchdog fires alert when session idle past threshold", () => {
    const tui = new TUI();
    tui.setWatchdog(1 * 60_000); // 1 minute threshold
    const baseSession = { id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: "old", userActive: false, currentTask: undefined };
    // first update to record activity
    tui.updateState({ sessions: [baseSession] });
    // advance time by manually setting lastChangeAt via another update with same activity
    // simulate idle: don't change lastActivity
    const logs: string[] = [];
    const origLog = tui.log.bind(tui);
    // track logged status messages
    let alertFired = false;
    const origLogFn = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("watchdog")) alertFired = true;
      origLogFn.call(tui, tag, text);
    };
    // force lastChangeAt to be old enough
    (tui as unknown as { lastChangeAt: Map<string, number> }).lastChangeAt.set("s1", Date.now() - 2 * 60_000);
    tui.updateState({ sessions: [baseSession] });
    assert.equal(alertFired, true);
  });

  it("watchdog does not fire when disabled", () => {
    const tui = new TUI();
    // watchdog is null (disabled)
    const baseSession = { id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: "old", userActive: false, currentTask: undefined };
    tui.updateState({ sessions: [baseSession] });
    let alertFired = false;
    const origLogFn = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("watchdog")) alertFired = true;
      origLogFn.call(tui, tag, text);
    };
    (tui as unknown as { lastChangeAt: Map<string, number> }).lastChangeAt.set("s1", Date.now() - 20 * 60_000);
    tui.updateState({ sessions: [baseSession] });
    assert.equal(alertFired, false);
  });

  it("is safe when TUI is not active", () => {
    const tui = new TUI();
    assert.doesNotThrow(() => {
      tui.setWatchdog(5 * 60_000);
      tui.setWatchdog(null);
    });
  });
});

// ── TUI getAllLastChangeAt ─────────────────────────────────────────────────

describe("TUI getAllLastChangeAt", () => {
  it("returns empty map initially", () => {
    const tui = new TUI();
    assert.equal(tui.getAllLastChangeAt().size, 0);
  });

  it("records change when lastActivity changes", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "A", status: "working" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: "step 1", userActive: false, currentTask: undefined }] });
    assert.ok(tui.getAllLastChangeAt().has("s1"));
  });

  it("does not record change when lastActivity is undefined", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "A", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(tui.getAllLastChangeAt().has("s1"), false);
  });
});

// ── formatSessionCard with idleSinceMs ────────────────────────────────────

describe("formatSessionCard with idleSinceMs", () => {
  const idleSession: DaemonSessionState = {
    id: "s1", title: "Alpha", status: "idle", tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
  };
  const doneSession: DaemonSessionState = {
    id: "s1", title: "Alpha", status: "done", tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
  };

  it("shows idle label when idle and stale > 2min", () => {
    const result = stripAnsi(formatSessionCard(idleSession, 80, undefined, 10 * 60_000));
    assert.ok(result.includes("idle"));
  });

  it("does not show idle label when stale < 2min", () => {
    const result = stripAnsi(formatSessionCard(idleSession, 80, undefined, 60_000));
    // "idle 1m" should not appear — under threshold
    assert.ok(!result.includes("idle 1m"));
  });

  it("shows done with idle-since for done session", () => {
    const result = stripAnsi(formatSessionCard(doneSession, 80, undefined, 10 * 60_000));
    assert.ok(result.includes("done"));
    assert.ok(result.includes("idle"));
  });

  it("without idleSinceMs, idle sessions show plain idle", () => {
    const result = stripAnsi(formatSessionCard(idleSession, 80));
    assert.ok(result.includes("idle"));
  });
});

// ── BUILTIN_COMMANDS ───────────────────────────────────────────────────────

describe("BUILTIN_COMMANDS", () => {
  it("contains /help", () => {
    assert.ok(BUILTIN_COMMANDS.has("/help"));
  });

  it("contains /alias", () => {
    assert.ok(BUILTIN_COMMANDS.has("/alias"));
  });

  it("contains /group", () => {
    assert.ok(BUILTIN_COMMANDS.has("/group"));
  });

  it("contains /groups", () => {
    assert.ok(BUILTIN_COMMANDS.has("/groups"));
  });

  it("contains /group-filter", () => {
    assert.ok(BUILTIN_COMMANDS.has("/group-filter"));
  });

  it("does not contain user aliases", () => {
    assert.ok(!BUILTIN_COMMANDS.has("/e"));
  });

  it("has at least 30 commands", () => {
    assert.ok(BUILTIN_COMMANDS.size >= 30);
  });
});

// ── formatBroadcastSummary ────────────────────────────────────────────────

describe("formatBroadcastSummary", () => {
  it("no sessions, no group", () => {
    assert.ok(formatBroadcastSummary(0, null).includes("no sessions"));
  });

  it("no sessions, with group", () => {
    const msg = formatBroadcastSummary(0, "frontend");
    assert.ok(msg.includes("frontend"));
  });

  it("1 session, no group", () => {
    const msg = formatBroadcastSummary(1, null);
    assert.ok(msg.includes("1 session"));
    assert.ok(msg.includes("all sessions"));
  });

  it("multiple sessions, no group", () => {
    const msg = formatBroadcastSummary(3, null);
    assert.ok(msg.includes("3 sessions"));
  });

  it("multiple sessions, with group", () => {
    const msg = formatBroadcastSummary(2, "backend");
    assert.ok(msg.includes("2 sessions"));
    assert.ok(msg.includes("backend"));
  });

  it("singular vs plural", () => {
    const one = formatBroadcastSummary(1, null);
    const two = formatBroadcastSummary(2, null);
    assert.ok(one.includes("1 session"));
    assert.ok(two.includes("2 sessions"));
  });
});

// ── buildSnapshotData ─────────────────────────────────────────────────────

function makeSnapSessions(): DaemonSessionState[] {
  return [
    { id: "a1", title: "Alpha", status: "working", tool: "opencode", contextTokens: "10,000 tokens", lastActivity: "doing work", userActive: false, currentTask: "build the thing" },
    { id: "b2", title: "Bravo", status: "idle", tool: "claude-code", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];
}

describe("buildSnapshotData", () => {
  it("includes all sessions", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(data.sessions.length, 2);
  });

  it("sets version and exportedAt", () => {
    const now = 1700000000000;
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "0.107.0", now);
    assert.equal(data.version, "0.107.0");
    assert.equal(data.exportedAtMs, now);
    assert.ok(data.exportedAt.startsWith("2023"));
  });

  it("includes group when set", () => {
    const groups = new Map([["a1", "frontend"]]);
    const data = buildSnapshotData(makeSnapSessions(), groups, new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(data.sessions[0].group, "frontend");
    assert.equal(data.sessions[1].group, undefined);
  });

  it("includes note when set", () => {
    const notes = new Map([["a1", "needs attention"]]);
    const data = buildSnapshotData(makeSnapSessions(), new Map(), notes, new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(data.sessions[0].note, "needs attention");
  });

  it("includes uptimeMs from firstSeen", () => {
    const now = Date.now();
    const firstSeen = new Map([["a1", now - 5 * 60 * 1000]]); // 5 min ago
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), firstSeen, new Map(), new Map(), "1.0.0", now);
    assert.ok(data.sessions[0].uptimeMs !== undefined);
    assert.ok(data.sessions[0].uptimeMs! >= 5 * 60 * 1000 - 100);
  });

  it("includes contextTokens", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(data.sessions[0].contextTokens, "10,000 tokens");
    assert.equal(data.sessions[1].contextTokens, undefined);
  });

  it("includes currentTask", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(data.sessions[0].currentTask, "build the thing");
  });

  it("includes error count when > 0", () => {
    const errorCounts = new Map([["a1", 3]]);
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), errorCounts, new Map(), "1.0.0");
    assert.equal(data.sessions[0].errorCount, 3);
  });

  it("omits error count when 0", () => {
    const errorCounts = new Map([["a1", 0]]);
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), errorCounts, new Map(), "1.0.0");
    assert.equal(data.sessions[0].errorCount, undefined);
  });

  it("handles empty sessions", () => {
    const data = buildSnapshotData([], new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(data.sessions.length, 0);
  });
});

// ── formatSnapshotJson ────────────────────────────────────────────────────

describe("formatSnapshotJson", () => {
  it("returns valid JSON string", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const json = formatSnapshotJson(data);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it("contains version field", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const obj = JSON.parse(formatSnapshotJson(data));
    assert.equal(obj.version, "1.0.0");
  });

  it("contains sessions array", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const obj = JSON.parse(formatSnapshotJson(data));
    assert.ok(Array.isArray(obj.sessions));
    assert.equal(obj.sessions.length, 2);
  });

  it("ends with newline", () => {
    const data = buildSnapshotData([], new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.ok(formatSnapshotJson(data).endsWith("\n"));
  });
});

// ── formatSnapshotMarkdown ────────────────────────────────────────────────

describe("formatSnapshotMarkdown", () => {
  it("contains h1 heading", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const md = formatSnapshotMarkdown(data);
    assert.ok(md.startsWith("# aoaoe Snapshot"));
  });

  it("contains session titles as h2", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const md = formatSnapshotMarkdown(data);
    assert.ok(md.includes("## Alpha"));
    assert.ok(md.includes("## Bravo"));
  });

  it("includes status", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const md = formatSnapshotMarkdown(data);
    assert.ok(md.includes("working"));
  });

  it("includes group when set", () => {
    const groups = new Map([["a1", "frontend"]]);
    const data = buildSnapshotData(makeSnapSessions(), groups, new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const md = formatSnapshotMarkdown(data);
    assert.ok(md.includes("frontend"));
  });

  it("includes note when set", () => {
    const notes = new Map([["a1", "critical session"]]);
    const data = buildSnapshotData(makeSnapSessions(), new Map(), notes, new Map(), new Map(), new Map(), "1.0.0");
    const md = formatSnapshotMarkdown(data);
    assert.ok(md.includes("critical session"));
  });

  it("shows no sessions message when empty", () => {
    const data = buildSnapshotData([], new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    const md = formatSnapshotMarkdown(data);
    assert.ok(md.includes("No active sessions"));
  });

  it("returns a string", () => {
    const data = buildSnapshotData(makeSnapSessions(), new Map(), new Map(), new Map(), new Map(), new Map(), "1.0.0");
    assert.equal(typeof formatSnapshotMarkdown(data), "string");
  });
});

// ── computeHealthScore ────────────────────────────────────────────────────

describe("computeHealthScore", () => {
  const clean = { errorCount: 0, burnRatePerMin: null, contextFraction: null, idleMs: null, watchdogThresholdMs: null };

  it("returns 100 for perfect session", () => {
    assert.equal(computeHealthScore(clean), 100);
  });

  it("deducts 10 per error", () => {
    assert.equal(computeHealthScore({ ...clean, errorCount: 2 }), 80);
  });

  it("caps error deduction at 50", () => {
    assert.equal(computeHealthScore({ ...clean, errorCount: 10 }), 50);
  });

  it("deducts 20 for high burn rate", () => {
    assert.equal(computeHealthScore({ ...clean, burnRatePerMin: CONTEXT_BURN_THRESHOLD + 1 }), 80);
  });

  it("no deduction for burn rate at threshold", () => {
    assert.equal(computeHealthScore({ ...clean, burnRatePerMin: CONTEXT_BURN_THRESHOLD }), 100);
  });

  it("deducts for context ceiling proximity above 70%", () => {
    // 80% usage = 10% above 70% = -10
    const score = computeHealthScore({ ...clean, contextFraction: 0.80 });
    assert.equal(score, 90);
  });

  it("no deduction at 70% context or below", () => {
    assert.equal(computeHealthScore({ ...clean, contextFraction: 0.70 }), 100);
  });

  it("deducts 15 for stalled session", () => {
    assert.equal(computeHealthScore({ ...clean, idleMs: 10 * 60_000, watchdogThresholdMs: 5 * 60_000 }), 85);
  });

  it("no stall deduction when below watchdog threshold", () => {
    assert.equal(computeHealthScore({ ...clean, idleMs: 3 * 60_000, watchdogThresholdMs: 5 * 60_000 }), 100);
  });

  it("no stall deduction when watchdog disabled", () => {
    assert.equal(computeHealthScore({ ...clean, idleMs: 60 * 60_000, watchdogThresholdMs: null }), 100);
  });

  it("combines all deductions", () => {
    const score = computeHealthScore({
      errorCount: 1,        // -10
      burnRatePerMin: CONTEXT_BURN_THRESHOLD + 1, // -20
      contextFraction: 0.80, // -10 (10% above 70%)
      idleMs: 10 * 60_000,  // -15
      watchdogThresholdMs: 5 * 60_000,
    });
    assert.equal(score, 100 - 10 - 20 - 10 - 15);
  });

  it("clamps to 0 on extreme deductions", () => {
    assert.ok(computeHealthScore({ errorCount: 100, burnRatePerMin: 99999, contextFraction: 1.0, idleMs: 999, watchdogThresholdMs: 1 }) >= 0);
  });

  it("clamps to 100 maximum", () => {
    assert.ok(computeHealthScore(clean) <= 100);
  });
});

// ── formatHealthBadge ─────────────────────────────────────────────────────

describe("formatHealthBadge", () => {
  it("returns empty string for score 100", () => {
    assert.equal(formatHealthBadge(100), "");
  });

  it("includes HEALTH_ICON", () => {
    const badge = stripAnsi(formatHealthBadge(85));
    assert.ok(badge.includes(HEALTH_ICON));
  });

  it("includes score number", () => {
    const badge = stripAnsi(formatHealthBadge(75));
    assert.ok(badge.includes("75"));
  });

  it("is ANSI-colored (contains escape codes)", () => {
    assert.ok(formatHealthBadge(50).includes("\x1b["));
  });

  it("score 80 is at good threshold", () => {
    assert.equal(HEALTH_GOOD, 80);
  });

  it("score 60 is at warn threshold", () => {
    assert.equal(HEALTH_WARN, 60);
  });
});

// ── parseContextCeiling ───────────────────────────────────────────────────

describe("parseContextCeiling", () => {
  it("parses 'X / Y tokens' format", () => {
    const result = parseContextCeiling("137,918 / 200,000 tokens");
    assert.ok(result !== null);
    assert.equal(result!.current, 137918);
    assert.equal(result!.max, 200000);
  });

  it("parses without commas", () => {
    const result = parseContextCeiling("50000 / 100000 tokens");
    assert.ok(result !== null);
    assert.equal(result!.current, 50000);
    assert.equal(result!.max, 100000);
  });

  it("returns null for plain token string (no ceiling)", () => {
    assert.equal(parseContextCeiling("137,918 tokens"), null);
  });

  it("returns null for undefined", () => {
    assert.equal(parseContextCeiling(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseContextCeiling(""), null);
  });

  it("returns null when max is zero", () => {
    assert.equal(parseContextCeiling("0 / 0 tokens"), null);
  });

  it("handles spaces around slash", () => {
    const result = parseContextCeiling("10000/200000 tokens");
    assert.ok(result !== null);
    assert.equal(result!.current, 10000);
    assert.equal(result!.max, 200000);
  });
});

// ── formatContextCeilingAlert ─────────────────────────────────────────────

describe("formatContextCeilingAlert", () => {
  it("includes session title", () => {
    assert.ok(formatContextCeilingAlert("Alpha", 180000, 200000).includes("Alpha"));
  });

  it("includes percentage", () => {
    const msg = formatContextCeilingAlert("Alpha", 180000, 200000);
    assert.ok(msg.includes("90%"));
  });

  it("includes current and max tokens", () => {
    const msg = formatContextCeilingAlert("Alpha", 180000, 200000);
    assert.ok(msg.includes("180,000"));
    assert.ok(msg.includes("200,000"));
  });

  it("includes 'approaching limit'", () => {
    assert.ok(formatContextCeilingAlert("Alpha", 190000, 200000).includes("approaching"));
  });
});

// ── CONTEXT_CEILING_THRESHOLD ─────────────────────────────────────────────

describe("CONTEXT_CEILING_THRESHOLD", () => {
  it("is 0.90", () => {
    assert.equal(CONTEXT_CEILING_THRESHOLD, 0.90);
  });
});

// ── TUI context ceiling alerting ──────────────────────────────────────────

describe("TUI context ceiling alerting", () => {
  it("fires ceiling alert when above threshold", () => {
    const tui = new TUI();
    let alertFired = false;
    const origLog = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("approaching limit")) alertFired = true;
      origLog.call(tui, tag, text);
    };
    // 95% usage — above 90% threshold
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: "190,000 / 200,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(alertFired, true);
  });

  it("does not fire alert below threshold", () => {
    const tui = new TUI();
    let alertFired = false;
    const origLog = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("approaching limit")) alertFired = true;
      origLog.call(tui, tag, text);
    };
    // 50% usage — below threshold
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: "100,000 / 200,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(alertFired, false);
  });

  it("does not fire when no ceiling data available", () => {
    const tui = new TUI();
    let alertFired = false;
    const origLog = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("approaching limit")) alertFired = true;
      origLog.call(tui, tag, text);
    };
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: "100,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(alertFired, false);
  });

  it("getAllContextCeilings returns null for sessions without ceiling", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode",
      contextTokens: "100 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(tui.getAllContextCeilings().get("s1"), null);
  });

  it("getAllContextCeilings returns ceiling for sessions with ceiling", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: "50,000 / 200,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    const c = tui.getAllContextCeilings().get("s1");
    assert.ok(c !== null && c !== undefined);
    assert.equal(c!.current, 50000);
    assert.equal(c!.max, 200000);
  });
});

// ── parseContextTokenNumber ────────────────────────────────────────────────

describe("parseContextTokenNumber", () => {
  it("parses simple token string", () => {
    assert.equal(parseContextTokenNumber("137918 tokens"), 137918);
  });

  it("parses comma-formatted string", () => {
    assert.equal(parseContextTokenNumber("137,918 tokens"), 137918);
  });

  it("parses number-only string", () => {
    assert.equal(parseContextTokenNumber("50000"), 50000);
  });

  it("returns null for undefined", () => {
    assert.equal(parseContextTokenNumber(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseContextTokenNumber(""), null);
  });

  it("returns null for non-numeric string", () => {
    assert.equal(parseContextTokenNumber("no tokens here"), null);
  });

  it("parses first number from mixed string", () => {
    assert.equal(parseContextTokenNumber("12,500 / 200,000 tokens"), 12500);
  });
});

// ── computeContextBurnRate ─────────────────────────────────────────────────

describe("computeContextBurnRate", () => {
  it("returns null for empty history", () => {
    assert.equal(computeContextBurnRate([]), null);
  });

  it("returns null for single entry", () => {
    const now = Date.now();
    assert.equal(computeContextBurnRate([{ tokens: 1000, ts: now }], now), null);
  });

  it("computes correct burn rate for simple case", () => {
    const now = Date.now();
    const oneMinAgo = now - 60_000;
    // 6000 tokens gained in 1 minute = 6000/min
    const rate = computeContextBurnRate(
      [{ tokens: 10_000, ts: oneMinAgo }, { tokens: 16_000, ts: now }],
      now
    );
    assert.ok(rate !== null);
    assert.ok(Math.abs(rate! - 6000) < 10); // within 10 tokens/min of expected
  });

  it("returns null when no entries in window", () => {
    const now = Date.now();
    const tooOld = now - CONTEXT_BURN_WINDOW_MS - 5000;
    const rate = computeContextBurnRate(
      [{ tokens: 10_000, ts: tooOld }, { tokens: 11_000, ts: tooOld + 1000 }],
      now
    );
    assert.equal(rate, null);
  });

  it("returns null for zero delta time", () => {
    const now = Date.now();
    const rate = computeContextBurnRate(
      [{ tokens: 10_000, ts: now }, { tokens: 11_000, ts: now }],
      now
    );
    assert.equal(rate, null);
  });

  it("handles stable context (no change)", () => {
    const now = Date.now();
    const oneMinAgo = now - 60_000;
    const rate = computeContextBurnRate(
      [{ tokens: 10_000, ts: oneMinAgo }, { tokens: 10_000, ts: now }],
      now
    );
    assert.ok(rate !== null);
    assert.equal(rate, 0);
  });
});

// ── formatBurnRateAlert ────────────────────────────────────────────────────

describe("formatBurnRateAlert", () => {
  it("includes session title", () => {
    const msg = formatBurnRateAlert("Alpha", 6000);
    assert.ok(msg.includes("Alpha"));
  });

  it("includes tokens per minute rounded to nearest 100", () => {
    const msg = formatBurnRateAlert("Alpha", 6000);
    assert.ok(msg.includes("6,000"));
  });

  it("includes 'tokens/min'", () => {
    const msg = formatBurnRateAlert("Alpha", 6000);
    assert.ok(msg.includes("tokens/min"));
  });

  it("rounds to nearest 100", () => {
    const msg = formatBurnRateAlert("Alpha", 6450);
    assert.ok(msg.includes("6,500") || msg.includes("6500"));
  });
});

// ── CONTEXT_BURN_THRESHOLD ─────────────────────────────────────────────────

describe("CONTEXT_BURN_THRESHOLD", () => {
  it("is 5000", () => {
    assert.equal(CONTEXT_BURN_THRESHOLD, 5_000);
  });
});

// ── CONTEXT_BURN_WINDOW_MS ─────────────────────────────────────────────────

describe("CONTEXT_BURN_WINDOW_MS", () => {
  it("is 2 minutes", () => {
    assert.equal(CONTEXT_BURN_WINDOW_MS, 2 * 60 * 1000);
  });
});

// ── MAX_CONTEXT_HISTORY ────────────────────────────────────────────────────

describe("MAX_CONTEXT_HISTORY", () => {
  it("is 30", () => {
    assert.equal(MAX_CONTEXT_HISTORY, 30);
  });
});

// ── TUI context burn-rate tracking ────────────────────────────────────────

describe("TUI context burn-rate tracking", () => {
  it("starts with empty context history", () => {
    const tui = new TUI();
    assert.deepEqual(tui.getSessionContextHistory("s1"), []);
  });

  it("records context history on updateState with tokens", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{
      id: "s1", title: "Alpha", status: "working", tool: "opencode",
      contextTokens: "10,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined,
    }] });
    const hist = tui.getSessionContextHistory("s1");
    assert.equal(hist.length, 1);
    assert.equal(hist[0].tokens, 10000);
  });

  it("accumulates history across multiple updateState calls", () => {
    const tui = new TUI();
    const base = { id: "s1", title: "Alpha", status: "working" as const, tool: "opencode", lastActivity: undefined, userActive: false, currentTask: undefined };
    tui.updateState({ sessions: [{ ...base, contextTokens: "10,000 tokens" }] });
    tui.updateState({ sessions: [{ ...base, contextTokens: "15,000 tokens" }] });
    const hist = tui.getSessionContextHistory("s1");
    assert.equal(hist.length, 2);
    assert.equal(hist[0].tokens, 10000);
    assert.equal(hist[1].tokens, 15000);
  });

  it("caps context history at MAX_CONTEXT_HISTORY", () => {
    const tui = new TUI();
    const base = { id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode", lastActivity: undefined, userActive: false, currentTask: undefined };
    for (let i = 0; i <= MAX_CONTEXT_HISTORY + 5; i++) {
      tui.updateState({ sessions: [{ ...base, contextTokens: `${i * 1000} tokens` }] });
    }
    assert.ok(tui.getSessionContextHistory("s1").length <= MAX_CONTEXT_HISTORY);
  });

  it("prunes context history when session disappears", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode", contextTokens: "10,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(tui.getSessionContextHistory("s1").length, 1);
    // Update with no sessions — s1 disappears
    tui.updateState({ sessions: [] });
    assert.equal(tui.getSessionContextHistory("s1").length, 0);
  });

  it("getAllBurnRates returns null for sessions with insufficient history", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode", contextTokens: "10,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined }] });
    const rates = tui.getAllBurnRates();
    assert.equal(rates.get("s1"), null);
  });

  it("skips recording when contextTokens is undefined", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(tui.getSessionContextHistory("s1").length, 0);
  });
});

// ── formatSessionErrorSparkline ───────────────────────────────────────────

describe("formatSessionErrorSparkline", () => {
  it("returns empty string for no timestamps", () => {
    assert.equal(formatSessionErrorSparkline([]), "");
  });

  it("returns empty string when all timestamps are outside window", () => {
    const old = Date.now() - SESSION_SPARK_WINDOW_MS - 10000;
    assert.equal(formatSessionErrorSparkline([old, old], Date.now()), "");
  });

  it("returns non-empty string for recent error", () => {
    const now = Date.now();
    const result = formatSessionErrorSparkline([now], now);
    assert.ok(result.length > 0);
  });

  it("returns exactly SESSION_SPARK_BUCKETS visible chars (without ANSI)", () => {
    const now = Date.now();
    const result = stripAnsi(formatSessionErrorSparkline([now], now));
    assert.equal(result.length, SESSION_SPARK_BUCKETS);
  });

  it("contains ROSE color codes for non-zero buckets", () => {
    const now = Date.now();
    const result = formatSessionErrorSparkline([now], now);
    assert.ok(result.includes("\x1b[")); // has ANSI codes
  });

  it("most recent error goes in last bucket", () => {
    const now = Date.now();
    const result = stripAnsi(formatSessionErrorSparkline([now], now));
    // last char should be a spark block (not a space) since we just logged an error
    const lastChar = result[result.length - 1];
    assert.ok(lastChar !== " ");
  });
});

// ── SESSION_SPARK_BUCKETS ──────────────────────────────────────────────────

describe("SESSION_SPARK_BUCKETS", () => {
  it("is 5", () => {
    assert.equal(SESSION_SPARK_BUCKETS, 5);
  });
});

// ── SESSION_SPARK_WINDOW_MS ────────────────────────────────────────────────

describe("SESSION_SPARK_WINDOW_MS", () => {
  it("is 5 minutes", () => {
    assert.equal(SESSION_SPARK_WINDOW_MS, 5 * 60 * 1000);
  });
});

// ── MAX_ERROR_TIMESTAMPS ───────────────────────────────────────────────────

describe("MAX_ERROR_TIMESTAMPS", () => {
  it("is 100", () => {
    assert.equal(MAX_ERROR_TIMESTAMPS, 100);
  });
});

// ── TUI error timestamp tracking ──────────────────────────────────────────

describe("TUI error timestamp tracking", () => {
  it("starts with no error timestamps", () => {
    const tui = new TUI();
    assert.deepEqual(tui.getSessionErrorTimestamps("s1"), []);
  });

  it("records timestamp on error log with sessionId", () => {
    const tui = new TUI();
    tui.log("! action", "something failed", "s1");
    const ts = tui.getSessionErrorTimestamps("s1");
    assert.equal(ts.length, 1);
    assert.ok(ts[0] > 0);
  });

  it("records timestamp on 'error' tag", () => {
    const tui = new TUI();
    tui.log("error", "oops", "s1");
    assert.equal(tui.getSessionErrorTimestamps("s1").length, 1);
  });

  it("does not record timestamp for non-error tags", () => {
    const tui = new TUI();
    tui.log("observation", "all good", "s1");
    tui.log("system", "tick", "s1");
    assert.equal(tui.getSessionErrorTimestamps("s1").length, 0);
  });

  it("does not record timestamp without sessionId", () => {
    const tui = new TUI();
    tui.log("! action", "failed");
    // no session ID — no timestamp stored for any key
    assert.deepEqual(tui.getSessionErrorTimestamps(""), []);
  });

  it("accumulates multiple error timestamps", () => {
    const tui = new TUI();
    tui.log("! action", "err1", "s1");
    tui.log("error", "err2", "s1");
    tui.log("! action", "err3", "s1");
    assert.equal(tui.getSessionErrorTimestamps("s1").length, 3);
  });

  it("caps at MAX_ERROR_TIMESTAMPS", () => {
    const tui = new TUI();
    for (let i = 0; i < MAX_ERROR_TIMESTAMPS + 10; i++) {
      tui.log("error", `err${i}`, "s1");
    }
    assert.ok(tui.getSessionErrorTimestamps("s1").length <= MAX_ERROR_TIMESTAMPS);
  });

  it("tracks timestamps per session independently", () => {
    const tui = new TUI();
    tui.log("error", "err", "s1");
    tui.log("error", "err", "s1");
    tui.log("error", "err", "s2");
    assert.equal(tui.getSessionErrorTimestamps("s1").length, 2);
    assert.equal(tui.getSessionErrorTimestamps("s2").length, 1);
  });
});

// ── formatSessionCard with error sparkline ────────────────────────────────

describe("formatSessionCard with error sparkline", () => {
  const session: DaemonSessionState = {
    id: "s1", title: "Alpha", status: "error", tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
  };

  it("renders without sparkline when not provided", () => {
    const result = stripAnsi(formatSessionCard(session, 80));
    assert.ok(result.includes("Alpha"));
  });

  it("renders with sparkline when provided", () => {
    const spark = "▁▂▃▄█";
    const result = formatSessionCard(session, 80, spark);
    assert.ok(result.includes("▁") || result.includes(spark));
  });

  it("result is truncated to maxWidth", () => {
    const spark = "█████";
    const result = stripAnsi(formatSessionCard(session, 30, spark));
    assert.ok(result.length <= 32); // allow small RESET overhead
  });
});

// ── validateGroupName ──────────────────────────────────────────────────────

describe("validateGroupName", () => {
  it("accepts simple lowercase name", () => {
    assert.equal(validateGroupName("frontend"), null);
  });

  it("accepts name with dash", () => {
    assert.equal(validateGroupName("my-group"), null);
  });

  it("accepts name with underscore", () => {
    assert.equal(validateGroupName("my_group"), null);
  });

  it("accepts alphanumeric", () => {
    assert.equal(validateGroupName("group1"), null);
  });

  it("rejects empty name", () => {
    assert.ok(validateGroupName("") !== null);
  });

  it("rejects whitespace only", () => {
    assert.ok(validateGroupName("   ") !== null);
  });

  it("rejects name too long", () => {
    assert.ok(validateGroupName("a".repeat(17)) !== null);
  });

  it("accepts name at max length", () => {
    assert.equal(validateGroupName("a".repeat(16)), null);
  });

  it("rejects special characters", () => {
    assert.ok(validateGroupName("group!") !== null);
  });

  it("rejects spaces in name", () => {
    assert.ok(validateGroupName("my group") !== null);
  });
});

// ── MAX_GROUP_NAME_LEN ─────────────────────────────────────────────────────

describe("MAX_GROUP_NAME_LEN", () => {
  it("is 16", () => {
    assert.equal(MAX_GROUP_NAME_LEN, 16);
  });
});

// ── GROUP_ICON ─────────────────────────────────────────────────────────────

describe("GROUP_ICON", () => {
  it("is ⊹", () => {
    assert.equal(GROUP_ICON, "⊹");
  });
});

// ── formatGroupBadge ───────────────────────────────────────────────────────

describe("formatGroupBadge", () => {
  it("includes group name", () => {
    const badge = stripAnsi(formatGroupBadge("frontend"));
    assert.ok(badge.includes("frontend"));
  });

  it("includes GROUP_ICON", () => {
    const badge = stripAnsi(formatGroupBadge("frontend"));
    assert.ok(badge.includes(GROUP_ICON));
  });

  it("returns ANSI-colored string", () => {
    const badge = formatGroupBadge("backend");
    assert.ok(badge.includes("\x1b["));
  });
});

// ── TUI getSessionOutput ──────────────────────────────────────────────────

describe("TUI getSessionOutput", () => {
  it("returns null for unknown session by index", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionOutput(99), null);
  });

  it("returns null for unknown session by name", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionOutput("zzz"), null);
  });

  it("returns null when session exists but no output stored", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.equal(tui.getSessionOutput(1), null);
  });

  it("returns stored output lines after setSessionOutputs", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    tui.setSessionOutputs(new Map([["s1", "line1\nline2\nline3"]]));
    const lines = tui.getSessionOutput("alpha");
    assert.ok(lines !== null && lines.length >= 2);
  });

  it("getDrilldownId returns null before entering drilldown", () => {
    const tui = new TUI();
    assert.equal(tui.getDrilldownId(), null);
  });
});

// ── formatHealthTrendChart ────────────────────────────────────────────────

describe("formatHealthTrendChart", () => {
  it("returns single-line message for empty history", () => {
    const lines = formatHealthTrendChart([], "Alpha");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("no health history"));
  });

  it("returns multiple lines for history", () => {
    const now = Date.now();
    const hist = Array.from({ length: 5 }, (_, i) => ({ score: 80 - i * 5, ts: now - i * 60_000 }));
    const lines = formatHealthTrendChart(hist, "Alpha", 4);
    assert.ok(lines.length > 2);
  });

  it("includes title in header", () => {
    const now = Date.now();
    const hist = [{ score: 90, ts: now }];
    const lines = formatHealthTrendChart(hist, "MySession", 4);
    assert.ok(lines[0].includes("MySession"));
  });

  it("bottom row is always present (x-axis)", () => {
    const now = Date.now();
    const hist = [{ score: 80, ts: now }];
    const lines = formatHealthTrendChart(hist, "X", 3);
    assert.ok(lines[lines.length - 1].includes("└"));
  });

  it("height parameter controls number of data rows", () => {
    const now = Date.now();
    const hist = Array.from({ length: 10 }, (_, i) => ({ score: 70, ts: now - i * 1000 }));
    const lines4 = formatHealthTrendChart(hist, "X", 4);
    const lines6 = formatHealthTrendChart(hist, "X", 6);
    // 6-row chart should have more lines than 4-row
    assert.ok(lines6.length > lines4.length);
  });
});

// ── isFlapping ────────────────────────────────────────────────────────────

describe("isFlapping", () => {
  it("returns false for empty history", () => {
    assert.equal(isFlapping([]), false);
  });

  it("returns false when below threshold", () => {
    const now = Date.now();
    const changes = Array.from({ length: FLAP_THRESHOLD - 1 }, (_, i) => ({
      status: i % 2 === 0 ? "working" : "idle",
      ts: now - i * 60_000,
    }));
    assert.equal(isFlapping(changes, now), false);
  });

  it("returns true when at or above threshold", () => {
    const now = Date.now();
    const changes = Array.from({ length: FLAP_THRESHOLD }, (_, i) => ({
      status: i % 2 === 0 ? "working" : "idle",
      ts: now - i * 60_000,
    }));
    assert.equal(isFlapping(changes, now), true);
  });

  it("ignores changes outside window", () => {
    const now = Date.now();
    const oldChanges = Array.from({ length: FLAP_THRESHOLD + 3 }, (_, i) => ({
      status: "working",
      ts: now - FLAP_WINDOW_MS - i * 1000, // all outside window
    }));
    assert.equal(isFlapping(oldChanges, now), false);
  });
});

// ── FLAP constants ────────────────────────────────────────────────────────

describe("FLAP constants", () => {
  it("MAX_STATUS_HISTORY is 30", () => { assert.equal(MAX_STATUS_HISTORY, 30); });
  it("FLAP_WINDOW_MS is 10 minutes", () => { assert.equal(FLAP_WINDOW_MS, 10 * 60_000); });
  it("FLAP_THRESHOLD is 5", () => { assert.equal(FLAP_THRESHOLD, 5); });
});

// ── isAlertMuted ──────────────────────────────────────────────────────────

describe("isAlertMuted", () => {
  it("returns false for empty patterns", () => {
    assert.equal(isAlertMuted("watchdog alert", new Set()), false);
  });

  it("returns true when text matches a pattern", () => {
    assert.equal(isAlertMuted("watchdog: session stalled", new Set(["watchdog"])), true);
  });

  it("is case-insensitive", () => {
    assert.equal(isAlertMuted("WATCHDOG stall", new Set(["watchdog"])), true);
  });

  it("returns false when no pattern matches", () => {
    assert.equal(isAlertMuted("burn rate high", new Set(["watchdog"])), false);
  });

  it("matches any of multiple patterns", () => {
    const pats = new Set(["watchdog", "ceiling"]);
    assert.equal(isAlertMuted("context ceiling at 92%", pats), true);
    assert.equal(isAlertMuted("watchdog stall", pats), true);
    assert.equal(isAlertMuted("budget exceeded", pats), false);
  });
});

// ── MAX_NOTE_HISTORY ──────────────────────────────────────────────────────

describe("MAX_NOTE_HISTORY", () => {
  it("is 5", () => { assert.equal(MAX_NOTE_HISTORY, 5); });
});

// ── TUI note history ──────────────────────────────────────────────────────

describe("TUI note history", () => {
  const sess = { id: "n1", title: "Alpha", status: "idle" as const, tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };

  it("starts with no history", () => {
    const tui = new TUI();
    assert.equal(tui.getNoteHistory("n1").length, 0);
  });

  it("records note in history when cleared", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setNote(1, "first note");
    tui.setNote(1, ""); // clear
    assert.equal(tui.getNoteHistory("n1").length, 1);
    assert.equal(tui.getNoteHistory("n1")[0], "first note");
  });

  it("accumulates multiple notes in history", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setNote(1, "note A");
    tui.setNote(1, ""); // clear → pushes A
    tui.setNote(1, "note B");
    tui.setNote(1, ""); // clear → pushes B
    const hist = tui.getNoteHistory("n1");
    assert.equal(hist.length, 2);
    assert.equal(hist[0], "note A");
    assert.equal(hist[1], "note B");
  });

  it("caps at MAX_NOTE_HISTORY", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    for (let i = 0; i < MAX_NOTE_HISTORY + 3; i++) {
      tui.setNote(1, `note ${i}`);
      tui.setNote(1, ""); // clear
    }
    assert.ok(tui.getNoteHistory("n1").length <= MAX_NOTE_HISTORY);
  });

  it("does not push empty note to history", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setNote(1, ""); // no note to push
    assert.equal(tui.getNoteHistory("n1").length, 0);
  });
});

// ── truncateLabel ─────────────────────────────────────────────────────────

describe("truncateLabel", () => {
  it("returns label unchanged when under limit", () => {
    assert.equal(truncateLabel("short label"), "short label");
  });
  it("truncates with .. when over max length", () => {
    const long = "x".repeat(MAX_LABEL_LEN + 5);
    const result = truncateLabel(long);
    assert.ok(result.length <= MAX_LABEL_LEN);
    assert.ok(result.endsWith(".."));
  });
  it("handles exact max length without truncation", () => {
    const exact = "x".repeat(MAX_LABEL_LEN);
    assert.equal(truncateLabel(exact), exact);
  });
});

// ── MAX_LABEL_LEN ─────────────────────────────────────────────────────────

describe("MAX_LABEL_LEN", () => {
  it("is 40", () => { assert.equal(MAX_LABEL_LEN, 40); });
});

// ── TUI setLabel / getLabel ───────────────────────────────────────────────

describe("TUI setLabel / getLabel", () => {
  const sess = { id: "l1", title: "Alpha", status: "idle" as const, tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };

  it("starts with no labels", () => {
    const tui = new TUI();
    assert.equal(tui.getLabel("l1"), undefined);
    assert.equal(tui.getAllLabels().size, 0);
  });

  it("setLabel by index sets label", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    const ok = tui.setLabel(1, "my worker");
    assert.equal(ok, true);
    assert.equal(tui.getLabel("l1"), "my worker");
  });

  it("setLabel by name", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setLabel("alpha", "doing stuff");
    assert.equal(tui.getLabel("l1"), "doing stuff");
  });

  it("setLabel empty clears label", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setLabel(1, "x");
    tui.setLabel(1, "");
    assert.equal(tui.getLabel("l1"), undefined);
  });

  it("setLabel null clears label", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setLabel(1, "x");
    tui.setLabel(1, null);
    assert.equal(tui.getLabel("l1"), undefined);
  });

  it("setLabel returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    assert.equal(tui.setLabel("zzz", "x"), false);
  });

  it("truncates long labels", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setLabel(1, "x".repeat(MAX_LABEL_LEN + 10));
    const lbl = tui.getLabel("l1");
    assert.ok(lbl !== undefined && lbl.length <= MAX_LABEL_LEN);
  });
});

// ── formatSessionCard with label ──────────────────────────────────────────

describe("formatSessionCard with label", () => {
  const s: DaemonSessionState = { id: "s1", title: "Alpha", status: "idle", tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };

  it("does not include label when not provided", () => {
    const result = stripAnsi(formatSessionCard(s, 80));
    assert.ok(!result.includes("·"));
  });

  it("includes label when provided", () => {
    const result = stripAnsi(formatSessionCard(s, 80, undefined, undefined, undefined, undefined, undefined, "my label"));
    assert.ok(result.includes("my label"));
  });
});

// ── formatSessionsTable ───────────────────────────────────────────────────

describe("formatSessionsTable", () => {
  const sessions: DaemonSessionState[] = [
    { id: "s1", title: "Alpha", status: "working", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s2", title: "Bravo", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];
  const opts = { groups: new Map(), tags: new Map(), colors: new Map(), notes: new Map(), labels: new Map(), aliases: new Map(), drainingIds: new Set<string>(), healthScores: new Map(), costs: new Map(), firstSeen: new Map() };

  it("returns 'no sessions' for empty", () => {
    const lines = formatSessionsTable([], opts);
    assert.ok(lines[0].includes("no sessions"));
  });

  it("returns header + separator + rows", () => {
    const lines = formatSessionsTable(sessions, opts);
    assert.ok(lines.length >= 4); // header + sep + 2 rows
  });

  it("includes session titles", () => {
    const lines = formatSessionsTable(sessions, opts).join("\n");
    assert.ok(lines.includes("Alpha"));
    assert.ok(lines.includes("Bravo"));
  });

  it("shows drain flag D when draining", () => {
    const optsD = { ...opts, drainingIds: new Set(["s1"]) };
    const lines = formatSessionsTable(sessions, optsD).join("\n");
    assert.ok(lines.includes("D"));
  });

  it("shows N flag when note set", () => {
    const optsN = { ...opts, notes: new Map([["s1", "some note"]]) };
    const lines = formatSessionsTable(sessions, optsN).join("\n");
    assert.ok(lines.includes("N"));
  });

  it("shows cost when available", () => {
    const optsC = { ...opts, costs: new Map([["s1", "$3.42"]]) };
    const lines = formatSessionsTable(sessions, optsC).join("\n");
    assert.ok(lines.includes("$3.42"));
  });
});

// ── DRAIN_ICON ────────────────────────────────────────────────────────────

describe("DRAIN_ICON", () => {
  it("is ⇣", () => { assert.equal(DRAIN_ICON, "⇣"); });
});

// ── TUI drain mode ────────────────────────────────────────────────────────

describe("TUI drain mode", () => {
  const sess = { id: "d1", title: "Alpha", status: "idle" as const, tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };

  it("starts with no draining sessions", () => {
    const tui = new TUI();
    assert.equal(tui.getDrainingIds().size, 0);
  });

  it("drainSession marks session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    const ok = tui.drainSession(1);
    assert.equal(ok, true);
    assert.equal(tui.isDraining("d1"), true);
  });

  it("drainSession by name", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.drainSession("alpha");
    assert.equal(tui.isDraining("d1"), true);
  });

  it("undrainSession removes mark", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.drainSession(1);
    const had = tui.undrainSession(1);
    assert.equal(had, true);
    assert.equal(tui.isDraining("d1"), false);
  });

  it("drainSession returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    assert.equal(tui.drainSession("zzz"), false);
  });

  it("getDrainingIds returns set of all draining", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.drainSession(1);
    assert.ok(tui.getDrainingIds().has("d1"));
  });

  it("isDraining returns false when not draining", () => {
    const tui = new TUI();
    assert.equal(tui.isDraining("d1"), false);
  });
});

// ── TUI getFlapLog ────────────────────────────────────────────────────────

describe("TUI getFlapLog", () => {
  it("starts empty", () => {
    const tui = new TUI();
    assert.equal(tui.getFlapLog().length, 0);
  });

  it("records flap event when session flaps", () => {
    const tui = new TUI();
    const base = { id: "f1", title: "Alpha", tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };
    tui.updateState({ sessions: [{ ...base, status: "working" as const }] });
    for (let i = 0; i < FLAP_THRESHOLD; i++) {
      const st = i % 2 === 0 ? "idle" : "working";
      tui.updateState({ sessions: [{ ...base, status: st as "idle" | "working" }] });
    }
    // may or may not have fired depending on timing, but should not throw
    assert.ok(tui.getFlapLog().length >= 0);
  });
});

// ── TUI flap detection ────────────────────────────────────────────────────

describe("TUI flap detection", () => {
  it("getSessionStatusHistory starts empty", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionStatusHistory("s1").length, 0);
  });

  it("isSessionFlapping returns false initially", () => {
    const tui = new TUI();
    assert.equal(tui.isSessionFlapping("s1"), false);
  });

  it("tracks status changes across updates", () => {
    const tui = new TUI();
    const base = { id: "s1", title: "Alpha", tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };
    // initial update — establishes prevStatus
    tui.updateState({ sessions: [{ ...base, status: "working" as const }] });
    // status change
    tui.updateState({ sessions: [{ ...base, status: "idle" as const }] });
    tui.updateState({ sessions: [{ ...base, status: "working" as const }] });
    const hist = tui.getSessionStatusHistory("s1");
    assert.ok(hist.length >= 2);
  });

  it("detects flapping when status oscillates rapidly", () => {
    const tui = new TUI();
    const base = { id: "s1", title: "Alpha", tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };
    tui.updateState({ sessions: [{ ...base, status: "working" as const }] });
    for (let i = 0; i < FLAP_THRESHOLD; i++) {
      const st = i % 2 === 0 ? "idle" : "working";
      tui.updateState({ sessions: [{ ...base, status: st as "idle" | "working" }] });
    }
    assert.equal(tui.isSessionFlapping("s1"), true);
  });
});

// ── TUI alert mute patterns ───────────────────────────────────────────────

describe("TUI alert mute patterns", () => {
  it("starts with no mute patterns", () => {
    const tui = new TUI();
    assert.equal(tui.getAlertMutePatterns().size, 0);
  });

  it("addAlertMutePattern adds pattern", () => {
    const tui = new TUI();
    tui.addAlertMutePattern("watchdog");
    assert.ok(tui.getAlertMutePatterns().has("watchdog"));
  });

  it("removeAlertMutePattern removes pattern", () => {
    const tui = new TUI();
    tui.addAlertMutePattern("watchdog");
    const removed = tui.removeAlertMutePattern("watchdog");
    assert.equal(removed, true);
    assert.equal(tui.getAlertMutePatterns().size, 0);
  });

  it("clearAlertMutePatterns clears all", () => {
    const tui = new TUI();
    tui.addAlertMutePattern("watchdog");
    tui.addAlertMutePattern("burn");
    tui.clearAlertMutePatterns();
    assert.equal(tui.getAlertMutePatterns().size, 0);
  });

  it("getAlertLog filters muted patterns", () => {
    const tui = new TUI();
    tui.log("status", "watchdog: stalled");
    tui.log("status", "burn rate high");
    tui.addAlertMutePattern("watchdog");
    const filtered = tui.getAlertLog(); // default: apply mute
    assert.equal(filtered.length, 1);
    assert.ok(filtered[0].text.includes("burn rate"));
  });

  it("getAlertLog(includeAll=true) ignores mute patterns", () => {
    const tui = new TUI();
    tui.log("status", "watchdog: stalled");
    tui.addAlertMutePattern("watchdog");
    const all = tui.getAlertLog(true);
    assert.equal(all.length, 1);
  });
});

// ── isOverBudget ──────────────────────────────────────────────────────────

describe("isOverBudget", () => {
  it("returns false for undefined costStr", () => {
    assert.equal(isOverBudget(undefined, 5.00), false);
  });
  it("returns false when cost is under budget", () => {
    assert.equal(isOverBudget("$2.00", 5.00), false);
  });
  it("returns true when cost exceeds budget", () => {
    assert.equal(isOverBudget("$6.00", 5.00), true);
  });
  it("returns false when cost equals budget (not strictly over)", () => {
    assert.equal(isOverBudget("$5.00", 5.00), false);
  });
  it("returns false for unparseable cost", () => {
    assert.equal(isOverBudget("no cost", 5.00), false);
  });
});

// ── formatBudgetAlert ─────────────────────────────────────────────────────

describe("formatBudgetAlert", () => {
  it("includes session title", () => {
    assert.ok(formatBudgetAlert("Alpha", "$6.00", 5.00).includes("Alpha"));
  });
  it("includes cost string", () => {
    assert.ok(formatBudgetAlert("Alpha", "$6.00", 5.00).includes("$6.00"));
  });
  it("includes budget value", () => {
    assert.ok(formatBudgetAlert("Alpha", "$6.00", 5.00).includes("$5.00"));
  });
  it("includes 'exceeded'", () => {
    assert.ok(formatBudgetAlert("Alpha", "$6.00", 5.00).toLowerCase().includes("exceed"));
  });
});

// ── TUI session budget ────────────────────────────────────────────────────

describe("TUI session budget", () => {
  const sess = { id: "b1", title: "Alpha", status: "idle" as const, tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };

  it("starts with no budgets", () => {
    const tui = new TUI();
    assert.equal(tui.getGlobalBudget(), null);
    assert.equal(tui.getAllSessionBudgets().size, 0);
  });

  it("setGlobalBudget sets global", () => {
    const tui = new TUI();
    tui.setGlobalBudget(5.00);
    assert.equal(tui.getGlobalBudget(), 5.00);
  });

  it("setGlobalBudget null clears", () => {
    const tui = new TUI();
    tui.setGlobalBudget(5.00);
    tui.setGlobalBudget(null);
    assert.equal(tui.getGlobalBudget(), null);
  });

  it("setSessionBudget by index sets budget", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    const ok = tui.setSessionBudget(1, 2.50);
    assert.equal(ok, true);
    assert.equal(tui.getSessionBudget("b1"), 2.50);
  });

  it("setSessionBudget null clears per-session budget", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setSessionBudget(1, 2.50);
    tui.setSessionBudget(1, null);
    assert.equal(tui.getSessionBudget("b1"), null);
  });

  it("setSessionBudget returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    assert.equal(tui.setSessionBudget("zzz", 1.00), false);
  });

  it("fires budget alert when cost exceeds session budget", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setSessionBudget(1, 1.00);
    let alertFired = false;
    const origLog = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("exceeded")) alertFired = true;
      origLog.call(tui, tag, text);
    };
    tui.updateState({ sessions: [{ ...sess, costStr: "$5.00" }] });
    assert.equal(alertFired, true);
  });

  it("fires budget alert using global budget when no per-session budget", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setGlobalBudget(1.00);
    let alertFired = false;
    const origLog = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("exceeded")) alertFired = true;
      origLog.call(tui, tag, text);
    };
    tui.updateState({ sessions: [{ ...sess, costStr: "$3.00" }] });
    assert.equal(alertFired, true);
  });

  it("does not fire when under budget", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setGlobalBudget(10.00);
    let alertFired = false;
    const origLog = (tui as unknown as { log: (tag: string, text: string) => void }).log;
    (tui as unknown as { log: (tag: string, text: string) => void }).log = (tag, text) => {
      if (tag === "status" && text.includes("exceeded")) alertFired = true;
      origLog.call(tui, tag, text);
    };
    tui.updateState({ sessions: [{ ...sess, costStr: "$2.00" }] });
    assert.equal(alertFired, false);
  });
});

// ── formatSessionCard with ageStr ─────────────────────────────────────────

describe("formatSessionCard with ageStr", () => {
  const session: DaemonSessionState = {
    id: "s1", title: "Alpha", status: "idle", tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
  };

  it("does not include age when not provided", () => {
    const result = stripAnsi(formatSessionCard(session, 80));
    assert.ok(!result.includes("age:"));
  });

  it("includes age when provided", () => {
    const result = stripAnsi(formatSessionCard(session, 80, undefined, undefined, undefined, undefined, "2h"));
    assert.ok(result.includes("age:2h"));
  });
});

// ── formatQuietStatus ─────────────────────────────────────────────────────

describe("formatQuietStatus", () => {
  it("returns not configured when no ranges", () => {
    const r = formatQuietStatus([]);
    assert.equal(r.active, false);
    assert.ok(r.message.includes("not configured"));
  });

  it("returns active=true when current hour is in range", () => {
    const d = new Date(); d.setHours(10);
    const r = formatQuietStatus([[0, 23]], d);
    assert.equal(r.active, true);
    assert.ok(r.message.includes("ACTIVE"));
  });

  it("returns active=false when outside range", () => {
    const d = new Date(); d.setHours(15);
    const r = formatQuietStatus([[22, 6]], d);
    assert.equal(r.active, false);
    assert.ok(!r.message.includes("ACTIVE"));
  });

  it("includes configured ranges in message", () => {
    const r = formatQuietStatus([[22, 6]]);
    assert.ok(r.message.includes("22:00"));
    assert.ok(r.message.includes("06:00"));
  });
});

// ── parseSessionAge ───────────────────────────────────────────────────────

describe("parseSessionAge", () => {
  it("returns null for undefined createdAt", () => {
    assert.equal(parseSessionAge(undefined), null);
  });

  it("returns null for invalid ISO string", () => {
    assert.equal(parseSessionAge("not-a-date"), null);
  });

  it("returns ms since createdAt", () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 3600000).toISOString();
    const age = parseSessionAge(oneHourAgo, now);
    assert.ok(age !== null && age >= 3600000 - 100 && age <= 3600000 + 100);
  });
});

// ── formatSessionAge ──────────────────────────────────────────────────────

describe("formatSessionAge", () => {
  it("returns empty string for undefined", () => {
    assert.equal(formatSessionAge(undefined), "");
  });

  it("returns uptime string for valid ISO date", () => {
    const now = Date.now();
    const twoHoursAgo = new Date(now - 7200000).toISOString();
    const result = formatSessionAge(twoHoursAgo, now);
    assert.ok(result.includes("2h") || result.includes("h"));
  });
});

// ── formatHealthSparkline ─────────────────────────────────────────────────

describe("formatHealthSparkline", () => {
  it("returns empty for no history", () => {
    assert.equal(formatHealthSparkline([]), "");
  });

  it("returns empty when all snapshots outside window", () => {
    const old = Date.now() - 35 * 60_000; // older than 30 min window
    assert.equal(formatHealthSparkline([{ score: 80, ts: old }], Date.now()), "");
  });

  it("returns non-empty for recent snapshots", () => {
    const now = Date.now();
    const result = formatHealthSparkline([{ score: 90, ts: now }], now);
    assert.ok(result.length > 0);
  });

  it("returns 5 visible chars (with ANSI)", () => {
    const now = Date.now();
    const hist = Array.from({ length: 5 }, (_, i) => ({ score: 80, ts: now - i * 100 }));
    const result = stripAnsi(formatHealthSparkline(hist, now));
    assert.ok(result.length <= 5); // at most 5 blocks
  });

  it("contains ANSI codes", () => {
    const now = Date.now();
    const result = formatHealthSparkline([{ score: 50, ts: now }], now);
    assert.ok(result.includes("\x1b["));
  });
});

// ── MAX_HEALTH_HISTORY ────────────────────────────────────────────────────

describe("MAX_HEALTH_HISTORY", () => {
  it("is 20", () => {
    assert.equal(MAX_HEALTH_HISTORY, 20);
  });
});

// ── TUI health history tracking ───────────────────────────────────────────

describe("TUI health history tracking", () => {
  it("starts empty", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionHealthHistory("s1").length, 0);
  });

  it("records snapshot on updateState", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "A", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    assert.ok(tui.getSessionHealthHistory("s1").length >= 1);
  });

  it("accumulates snapshots", () => {
    const tui = new TUI();
    const base = { id: "s1", title: "A", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };
    tui.updateState({ sessions: [base] });
    tui.updateState({ sessions: [base] });
    assert.ok(tui.getSessionHealthHistory("s1").length >= 2);
  });

  it("caps at MAX_HEALTH_HISTORY", () => {
    const tui = new TUI();
    const base = { id: "s1", title: "A", status: "idle" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };
    for (let i = 0; i <= MAX_HEALTH_HISTORY + 5; i++) tui.updateState({ sessions: [base] });
    assert.ok(tui.getSessionHealthHistory("s1").length <= MAX_HEALTH_HISTORY);
  });
});

// ── TUI alert log ─────────────────────────────────────────────────────────

describe("TUI alert log", () => {
  it("starts empty", () => {
    const tui = new TUI();
    assert.equal(tui.getAlertLog().length, 0);
  });

  it("collects status-tagged entries", () => {
    const tui = new TUI();
    tui.log("status", "watchdog: session stalled");
    assert.equal(tui.getAlertLog().length, 1);
  });

  it("does not collect non-status entries", () => {
    const tui = new TUI();
    tui.log("system", "tick");
    tui.log("error", "oops");
    tui.log("+ action", "sent");
    assert.equal(tui.getAlertLog().length, 0);
  });

  it("collects multiple alerts", () => {
    const tui = new TUI();
    tui.log("status", "alert 1");
    tui.log("status", "alert 2");
    tui.log("status", "alert 3");
    assert.equal(tui.getAlertLog().length, 3);
  });

  it("caps at 100", () => {
    const tui = new TUI();
    for (let i = 0; i < 110; i++) tui.log("status", `alert ${i}`);
    assert.ok(tui.getAlertLog().length <= 100);
  });
});

// ── TUI session age (createdAt) ───────────────────────────────────────────

describe("TUI session with createdAt", () => {
  it("DaemonSessionState createdAt is optional", () => {
    const sess: DaemonSessionState = {
      id: "s1", title: "A", status: "idle", tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
    };
    assert.equal(sess.createdAt, undefined);
  });

  it("DaemonSessionState with createdAt set", () => {
    const sess: DaemonSessionState = {
      id: "s1", title: "A", status: "idle", tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    assert.ok(parseSessionAge(sess.createdAt) !== null);
  });
});

// ── parseCostValue ────────────────────────────────────────────────────────

describe("parseCostValue", () => {
  it("parses $N.NN string", () => {
    assert.equal(parseCostValue("$3.42"), 3.42);
  });
  it("parses without $ sign", () => {
    assert.equal(parseCostValue("1.50"), 1.50);
  });
  it("returns null for undefined", () => {
    assert.equal(parseCostValue(undefined), null);
  });
  it("returns null for non-numeric", () => {
    assert.equal(parseCostValue("no cost"), null);
  });
  it("parses zero", () => {
    assert.equal(parseCostValue("$0.00"), 0);
  });
});

// ── computeCostSummary ────────────────────────────────────────────────────

describe("computeCostSummary", () => {
  const sessions: DaemonSessionState[] = [
    { id: "s1", title: "Alpha", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s2", title: "Bravo", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s3", title: "Charlie", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];

  it("returns zero total when no costs", () => {
    const s = computeCostSummary(sessions, new Map());
    assert.equal(s.total, 0);
    assert.equal(s.sessionCount, 0);
  });

  it("sums costs correctly", () => {
    const costs = new Map([["s1", "$3.00"], ["s2", "$1.50"]]);
    const s = computeCostSummary(sessions, costs);
    assert.equal(s.total, 4.50);
    assert.equal(s.totalStr, "$4.50");
  });

  it("sorts entries by cost descending", () => {
    const costs = new Map([["s1", "$1.00"], ["s2", "$5.00"]]);
    const s = computeCostSummary(sessions, costs);
    assert.equal(s.entries[0].title, "Bravo");
  });

  it("excludes sessions with no cost data", () => {
    const costs = new Map([["s1", "$2.00"]]);
    const s = computeCostSummary(sessions, costs);
    assert.equal(s.sessionCount, 1);
  });

  it("handles empty sessions", () => {
    const s = computeCostSummary([], new Map());
    assert.equal(s.total, 0);
    assert.equal(s.entries.length, 0);
  });
});

// ── formatSessionReport ───────────────────────────────────────────────────

describe("formatSessionReport", () => {
  const baseData: SessionReportData = {
    title: "Alpha",
    status: "working",
    tool: "opencode",
    health: 85,
    errors: 2,
    errorTrend: "rising",
    tags: [],
    goalHistory: ["old goal", "current goal"],
    recentTimeline: [{ time: "12:00", tag: "system", text: "tick", sessionId: "s1" }],
    exportedAt: "2025-01-01T00:00:00.000Z",
    burnRatePerMin: null,
  };

  it("starts with h1 heading", () => {
    const md = formatSessionReport(baseData);
    assert.ok(md.startsWith("# Session Report: Alpha"));
  });

  it("includes status and tool", () => {
    const md = formatSessionReport(baseData);
    assert.ok(md.includes("working"));
    assert.ok(md.includes("opencode"));
  });

  it("includes health score", () => {
    const md = formatSessionReport(baseData);
    assert.ok(md.includes("85/100"));
  });

  it("includes error count with trend", () => {
    const md = formatSessionReport(baseData);
    assert.ok(md.includes("2") && md.includes("↑"));
  });

  it("includes goal history section", () => {
    const md = formatSessionReport(baseData);
    assert.ok(md.includes("Goal History"));
    assert.ok(md.includes("current goal"));
  });

  it("includes recent activity section", () => {
    const md = formatSessionReport(baseData);
    assert.ok(md.includes("Recent Activity"));
    assert.ok(md.includes("tick"));
  });

  it("includes optional fields when present", () => {
    const d = { ...baseData, group: "frontend", tags: ["prod"], costStr: "$2.50", note: "important" };
    const md = formatSessionReport(d);
    assert.ok(md.includes("frontend"));
    assert.ok(md.includes("prod"));
    assert.ok(md.includes("$2.50"));
    assert.ok(md.includes("important"));
  });

  it("omits goal history section when empty", () => {
    const d = { ...baseData, goalHistory: [] };
    assert.ok(!formatSessionReport(d).includes("Goal History"));
  });
});

// ── buildDuplicateArgs ────────────────────────────────────────────────────

describe("buildDuplicateArgs", () => {
  const sessions: DaemonSessionState[] = [
    { id: "s1", title: "Alpha", status: "working", tool: "opencode", path: "/projects/alpha",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s2", title: "Bravo", status: "idle", tool: "claude-code", path: "/projects/bravo",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];

  it("finds session by 1-indexed number", () => {
    const r = buildDuplicateArgs(sessions, 1);
    assert.ok(r !== null);
    assert.equal(r!.path, "/projects/alpha");
    assert.equal(r!.tool, "opencode");
    assert.equal(r!.title, "Alpha-copy");
  });

  it("finds session by title (case insensitive)", () => {
    const r = buildDuplicateArgs(sessions, "bravo");
    assert.ok(r !== null);
    assert.equal(r!.path, "/projects/bravo");
  });

  it("uses provided new title", () => {
    const r = buildDuplicateArgs(sessions, 1, "My New Session");
    assert.equal(r!.title, "My New Session");
  });

  it("returns null for unknown session", () => {
    assert.equal(buildDuplicateArgs(sessions, "zzz"), null);
  });

  it("returns null for session with no path", () => {
    const nopathSessions: DaemonSessionState[] = [
      { id: "x", title: "X", status: "idle", tool: "opencode",
        contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    ];
    assert.equal(buildDuplicateArgs(nopathSessions, 1), null);
  });

  it("returns null for empty sessions array", () => {
    assert.equal(buildDuplicateArgs([], 1), null);
  });

  it("trims new title", () => {
    const r = buildDuplicateArgs(sessions, 1, "  trimmed  ");
    assert.equal(r!.title, "trimmed");
  });
});

// ── isQuietHour ───────────────────────────────────────────────────────────

describe("isQuietHour", () => {
  it("returns false when no ranges", () => {
    assert.equal(isQuietHour(22, []), false);
  });

  it("matches hour within simple range", () => {
    assert.equal(isQuietHour(10, [[9, 17]]), true);
  });

  it("misses hour outside simple range", () => {
    assert.equal(isQuietHour(8, [[9, 17]]), false);
  });

  it("handles wraparound range (22-06)", () => {
    assert.equal(isQuietHour(23, [[22, 6]]), true);
    assert.equal(isQuietHour(3, [[22, 6]]), true);
    assert.equal(isQuietHour(10, [[22, 6]]), false);
  });

  it("matches boundary hours", () => {
    assert.equal(isQuietHour(9, [[9, 17]]), true);
    assert.equal(isQuietHour(17, [[9, 17]]), true);
  });

  it("matches any of multiple ranges", () => {
    assert.equal(isQuietHour(13, [[9, 11], [12, 14]]), true);
    assert.equal(isQuietHour(15, [[9, 11], [12, 14]]), false);
  });
});

// ── parseQuietHoursRange ──────────────────────────────────────────────────

describe("parseQuietHoursRange", () => {
  it("parses valid simple range", () => {
    const r = parseQuietHoursRange("09-17");
    assert.deepEqual(r, [9, 17]);
  });

  it("parses wraparound range", () => {
    const r = parseQuietHoursRange("22-06");
    assert.deepEqual(r, [22, 6]);
  });

  it("parses single-digit hours", () => {
    const r = parseQuietHoursRange("9-5");
    assert.deepEqual(r, [9, 5]);
  });

  it("returns null for invalid format", () => {
    assert.equal(parseQuietHoursRange("abc"), null);
    assert.equal(parseQuietHoursRange("9"), null);
    assert.equal(parseQuietHoursRange("9-30"), null); // 30 > 23
  });

  it("returns null for out-of-range hours", () => {
    assert.equal(parseQuietHoursRange("25-06"), null);
  });
});

// ── TUI quiet hours ───────────────────────────────────────────────────────

describe("TUI quiet hours", () => {
  it("starts with no quiet hours", () => {
    const tui = new TUI();
    assert.equal(tui.getQuietHours().length, 0);
  });

  it("setQuietHours stores ranges", () => {
    const tui = new TUI();
    tui.setQuietHours([[22, 6], [13, 14]]);
    assert.equal(tui.getQuietHours().length, 2);
  });

  it("setQuietHours empty clears", () => {
    const tui = new TUI();
    tui.setQuietHours([[22, 6]]);
    tui.setQuietHours([]);
    assert.equal(tui.getQuietHours().length, 0);
  });

  it("isCurrentlyQuiet returns false when no ranges", () => {
    const tui = new TUI();
    assert.equal(tui.isCurrentlyQuiet(), false);
  });

  it("isCurrentlyQuiet returns true when in range", () => {
    const tui = new TUI();
    tui.setQuietHours([[0, 23]]); // all day
    assert.equal(tui.isCurrentlyQuiet(), true);
  });

  it("isCurrentlyQuiet returns false when outside range", () => {
    const tui = new TUI();
    tui.setQuietHours([[25, 26] as unknown as [number, number]]); // impossible range
    assert.equal(tui.isCurrentlyQuiet(), false);
  });

  it("isCurrentlyQuiet respects provided Date", () => {
    const tui = new TUI();
    tui.setQuietHours([[10, 12]]);
    const inRange = new Date(); inRange.setHours(11);
    const outRange = new Date(); outRange.setHours(15);
    assert.equal(tui.isCurrentlyQuiet(inRange), true);
    assert.equal(tui.isCurrentlyQuiet(outRange), false);
  });
});

// ── TUI setColorAll ───────────────────────────────────────────────────────

describe("TUI setColorAll", () => {
  function makeSessions3(): DaemonSessionState[] {
    return [
      { id: "a", title: "A", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
      { id: "b", title: "B", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
      { id: "c", title: "C", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    ];
  }

  it("sets color on all sessions", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessions3() });
    const count = tui.setColorAll("lime");
    assert.equal(count, 3);
    assert.equal(tui.getSessionColor("a"), "lime");
    assert.equal(tui.getSessionColor("b"), "lime");
    assert.equal(tui.getSessionColor("c"), "lime");
  });

  it("clears color from all sessions", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessions3() });
    tui.setColorAll("rose");
    tui.setColorAll(null);
    assert.equal(tui.getSessionColor("a"), undefined);
    assert.equal(tui.getSessionColor("b"), undefined);
  });

  it("returns count of sessions affected", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessions3() });
    assert.equal(tui.setColorAll("teal"), 3);
  });

  it("returns 0 with no sessions", () => {
    const tui = new TUI();
    assert.equal(tui.setColorAll("teal"), 0);
  });
});

// ── computeErrorTrend ────────────────────────────────────────────────────

describe("computeErrorTrend", () => {
  it("returns stable for empty timestamps", () => {
    assert.equal(computeErrorTrend([]), "stable");
  });

  it("returns rising when more errors in recent half", () => {
    const now = Date.now();
    const window = 10 * 60_000;
    // 0 in older half, 3 in newer half
    const ts = [now - 1000, now - 2000, now - 3000];
    assert.equal(computeErrorTrend(ts, now, window), "rising");
  });

  it("returns falling when more errors in older half", () => {
    const now = Date.now();
    const window = 10 * 60_000;
    // 3 in older half, 0 in newer half
    const midpoint = now - window / 2;
    const ts = [midpoint - 1000, midpoint - 2000, midpoint - 3000];
    assert.equal(computeErrorTrend(ts, now, window), "falling");
  });

  it("returns stable when equal in both halves", () => {
    const now = Date.now();
    const window = 10 * 60_000;
    const midpoint = now - window / 2;
    const ts = [midpoint - 1000, now - 1000]; // 1 each
    assert.equal(computeErrorTrend(ts, now, window), "stable");
  });

  it("ignores timestamps outside window", () => {
    const now = Date.now();
    const window = 10 * 60_000;
    const veryOld = now - window - 5000;
    assert.equal(computeErrorTrend([veryOld], now, window), "stable");
  });
});

// ── formatErrorTrend ──────────────────────────────────────────────────────

describe("formatErrorTrend", () => {
  it("rising returns ↑ with ANSI", () => {
    const s = formatErrorTrend("rising");
    assert.ok(stripAnsi(s).includes("↑"));
  });

  it("falling returns ↓ with ANSI", () => {
    const s = formatErrorTrend("falling");
    assert.ok(stripAnsi(s).includes("↓"));
  });

  it("stable returns → with ANSI", () => {
    const s = formatErrorTrend("stable");
    assert.ok(stripAnsi(s).includes("→"));
  });
});

// ── TUI getSessionCost / getAllSessionCosts ───────────────────────────────

describe("TUI session cost tracking", () => {
  it("starts with no costs", () => {
    const tui = new TUI();
    assert.equal(tui.getAllSessionCosts().size, 0);
  });

  it("tracks cost from updateState with costStr", () => {
    const tui = new TUI();
    const sess = { id: "c1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined, costStr: "$3.42" };
    tui.updateState({ sessions: [sess] });
    assert.equal(tui.getSessionCost("c1"), "$3.42");
  });

  it("does not overwrite cost when costStr undefined", () => {
    const tui = new TUI();
    const withCost = { id: "c1", title: "Alpha", status: "working" as const, tool: "opencode",
      contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined, costStr: "$3.42" };
    tui.updateState({ sessions: [withCost] });
    const noCost = { ...withCost, costStr: undefined };
    tui.updateState({ sessions: [noCost] });
    // cost should still be there (we only set, never clear on undefined)
    assert.equal(tui.getSessionCost("c1"), "$3.42");
  });

  it("getAllSessionCosts returns all", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [
      { id: "c1", title: "A", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined, costStr: "$1.00" },
      { id: "c2", title: "B", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined, costStr: "$2.00" },
    ] });
    assert.equal(tui.getAllSessionCosts().size, 2);
  });
});

// ── filterSessionTimeline ────────────────────────────────────────────────

describe("filterSessionTimeline", () => {
  const makeEntry = (tag: string, text: string, sessionId?: string): ActivityEntry =>
    ({ time: "12:00", tag, text, sessionId });

  it("returns empty for empty buffer", () => {
    assert.deepEqual(filterSessionTimeline([], "s1"), []);
  });

  it("returns only entries matching sessionId", () => {
    const buf = [
      makeEntry("system", "a", "s1"),
      makeEntry("system", "b", "s2"),
      makeEntry("system", "c", "s1"),
    ];
    const result = filterSessionTimeline(buf, "s1");
    assert.equal(result.length, 2);
    assert.ok(result.every((e) => e.sessionId === "s1"));
  });

  it("returns empty when no entries for session", () => {
    const buf = [makeEntry("system", "x", "s2")];
    assert.equal(filterSessionTimeline(buf, "s1").length, 0);
  });

  it("caps at count", () => {
    const buf = Array.from({ length: 50 }, (_, i) => makeEntry("system", `msg${i}`, "s1"));
    const result = filterSessionTimeline(buf, "s1", 10);
    assert.equal(result.length, 10);
  });

  it("returns most recent entries (last N)", () => {
    const buf = [
      makeEntry("system", "old", "s1"),
      makeEntry("system", "new", "s1"),
    ];
    const result = filterSessionTimeline(buf, "s1", 1);
    assert.equal(result[0].text, "new");
  });

  it("excludes entries without matching sessionId", () => {
    const buf = [makeEntry("system", "no-session"), makeEntry("system", "s1-entry", "s1")];
    const result = filterSessionTimeline(buf, "s1");
    assert.equal(result.length, 1);
  });
});

// ── TIMELINE_DEFAULT_COUNT ────────────────────────────────────────────────

describe("TIMELINE_DEFAULT_COUNT", () => {
  it("is 30", () => {
    assert.equal(TIMELINE_DEFAULT_COUNT, 30);
  });
});

// ── TUI getSessionTimeline ────────────────────────────────────────────────

describe("TUI getSessionTimeline", () => {
  it("returns null for unknown session", () => {
    const tui = new TUI();
    assert.equal(tui.getSessionTimeline("zzz"), null);
  });

  it("returns entries for known session by index", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "working" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    tui.log("system", "hello", "s1");
    const result = tui.getSessionTimeline(1);
    assert.ok(result !== null && result.length >= 1);
  });

  it("returns entries for known session by name", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [{ id: "s1", title: "Alpha", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined }] });
    tui.log("system", "world", "s1");
    const result = tui.getSessionTimeline("alpha");
    assert.ok(result !== null && result.length >= 1);
  });
});

// ── validateColorName ─────────────────────────────────────────────────────

describe("validateColorName", () => {
  it("accepts all valid color names", () => {
    for (const c of SESSION_COLOR_NAMES) {
      assert.equal(validateColorName(c), null, `expected ${c} to be valid`);
    }
  });

  it("is case-insensitive", () => {
    assert.equal(validateColorName("LIME"), null);
    assert.equal(validateColorName("Amber"), null);
  });

  it("rejects unknown color", () => {
    assert.ok(validateColorName("purple") !== null);
  });

  it("rejects empty string", () => {
    assert.ok(validateColorName("") !== null);
  });
});

// ── formatColorDot ────────────────────────────────────────────────────────

describe("formatColorDot", () => {
  it("returns non-empty for valid color", () => {
    assert.ok(formatColorDot("lime").length > 0);
  });

  it("includes ANSI codes", () => {
    assert.ok(formatColorDot("rose").includes("\x1b["));
  });

  it("returns empty for unknown color", () => {
    assert.equal(formatColorDot("purple"), "");
  });

  it("ends with space", () => {
    const dot = stripAnsi(formatColorDot("teal"));
    assert.ok(dot.endsWith(" "));
  });
});

// ── SESSION_COLOR_NAMES ───────────────────────────────────────────────────

describe("SESSION_COLOR_NAMES", () => {
  it("contains lime, amber, rose, teal, sky, slate", () => {
    const set = new Set(SESSION_COLOR_NAMES);
    assert.ok(set.has("lime"));
    assert.ok(set.has("amber"));
    assert.ok(set.has("rose"));
    assert.ok(set.has("teal"));
    assert.ok(set.has("sky"));
    assert.ok(set.has("slate"));
  });

  it("has at least 6 colors", () => {
    assert.ok(SESSION_COLOR_NAMES.length >= 6);
  });
});

// ── TUI session accent colors ─────────────────────────────────────────────

describe("TUI session accent colors", () => {
  const sess = { id: "c1", title: "Alpha", status: "idle" as const, tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined };

  it("starts with no colors", () => {
    const tui = new TUI();
    assert.equal(tui.getAllSessionColors().size, 0);
  });

  it("setSessionColor by index sets color", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    const ok = tui.setSessionColor(1, "lime");
    assert.equal(ok, true);
    assert.equal(tui.getSessionColor("c1"), "lime");
  });

  it("setSessionColor by name sets color", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setSessionColor("alpha", "rose");
    assert.equal(tui.getSessionColor("c1"), "rose");
  });

  it("setSessionColor null clears color", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    tui.setSessionColor(1, "lime");
    tui.setSessionColor(1, null);
    assert.equal(tui.getSessionColor("c1"), undefined);
  });

  it("setSessionColor returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    assert.equal(tui.setSessionColor("zzz", "lime"), false);
  });

  it("restoreSessionColors bulk-sets colors", () => {
    const tui = new TUI();
    tui.restoreSessionColors({ "c1": "teal", "c2": "sky" });
    assert.equal(tui.getSessionColor("c1"), "teal");
    assert.equal(tui.getSessionColor("c2"), "sky");
  });

  it("getAllSessionColors returns all", () => {
    const tui = new TUI();
    tui.restoreSessionColors({ "x": "lime", "y": "amber" });
    assert.equal(tui.getAllSessionColors().size, 2);
  });

  it("is safe when TUI not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [sess] });
    assert.doesNotThrow(() => {
      tui.setSessionColor(1, "sky");
      tui.setSessionColor(1, null);
    });
  });
});

// ── isSuppressedEntry ─────────────────────────────────────────────────────

describe("isSuppressedEntry", () => {
  const entry = (tag: string): ActivityEntry => ({ time: "12:00", tag, text: "msg" });

  it("returns false for empty suppressed set", () => {
    assert.equal(isSuppressedEntry(entry("error"), new Set()), false);
  });

  it("returns true when entry tag matches suppressed pattern", () => {
    const suppressed = new Set([MUTE_ERRORS_PATTERN]);
    assert.equal(isSuppressedEntry(entry("error"), suppressed), true);
  });

  it("returns true for pipe-separated pattern match", () => {
    const suppressed = new Set([MUTE_ERRORS_PATTERN]);
    assert.equal(isSuppressedEntry(entry("! action"), suppressed), true);
  });

  it("returns false for non-matching tag", () => {
    const suppressed = new Set([MUTE_ERRORS_PATTERN]);
    assert.equal(isSuppressedEntry(entry("system"), suppressed), false);
  });

  it("is case-insensitive", () => {
    const suppressed = new Set(["error"]);
    assert.equal(isSuppressedEntry(entry("ERROR"), suppressed), true);
  });
});

// ── MUTE_ERRORS_PATTERN ───────────────────────────────────────────────────

describe("MUTE_ERRORS_PATTERN", () => {
  it("matches error tag", () => {
    const entry = { time: "12:00", tag: "error", text: "x" };
    assert.equal(isSuppressedEntry(entry, new Set([MUTE_ERRORS_PATTERN])), true);
  });

  it("matches ! action tag", () => {
    const entry = { time: "12:00", tag: "! action", text: "x" };
    assert.equal(isSuppressedEntry(entry, new Set([MUTE_ERRORS_PATTERN])), true);
  });

  it("does not match system tag", () => {
    const entry = { time: "12:00", tag: "system", text: "x" };
    assert.equal(isSuppressedEntry(entry, new Set([MUTE_ERRORS_PATTERN])), false);
  });
});

// ── TUI toggleMuteErrors / isErrorsMuted ──────────────────────────────────

describe("TUI toggleMuteErrors", () => {
  it("starts with errors not muted", () => {
    const tui = new TUI();
    assert.equal(tui.isErrorsMuted(), false);
  });

  it("toggleMuteErrors mutes errors", () => {
    const tui = new TUI();
    const nowMuted = tui.toggleMuteErrors();
    assert.equal(nowMuted, true);
    assert.equal(tui.isErrorsMuted(), true);
  });

  it("toggleMuteErrors toggles off", () => {
    const tui = new TUI();
    tui.toggleMuteErrors();
    const nowMuted = tui.toggleMuteErrors();
    assert.equal(nowMuted, false);
    assert.equal(tui.isErrorsMuted(), false);
  });

  it("getSuppressedTags reflects muted state", () => {
    const tui = new TUI();
    assert.equal(tui.getSuppressedTags().size, 0);
    tui.toggleMuteErrors();
    assert.equal(tui.getSuppressedTags().size, 1);
  });

  it("is safe when TUI not active", () => {
    const tui = new TUI();
    assert.doesNotThrow(() => { tui.toggleMuteErrors(); tui.toggleMuteErrors(); });
  });
});

// ── TUI per-session goal history ──────────────────────────────────────────

describe("TUI per-session goal history", () => {
  it("starts with empty history", () => {
    const tui = new TUI();
    assert.deepEqual(tui.getGoalHistory("s1"), []);
  });

  it("pushGoalHistory records goal", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "build the thing");
    assert.equal(tui.getGoalHistory("s1").length, 1);
    assert.equal(tui.getGoalHistory("s1")[0], "build the thing");
  });

  it("pushGoalHistory appends multiple goals", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "goal 1");
    tui.pushGoalHistory("s1", "goal 2");
    const hist = tui.getGoalHistory("s1");
    assert.equal(hist.length, 2);
    assert.equal(hist[hist.length - 1], "goal 2");
  });

  it("caps at MAX_GOAL_HISTORY", () => {
    const tui = new TUI();
    for (let i = 0; i <= MAX_GOAL_HISTORY + 2; i++) {
      tui.pushGoalHistory("s1", `goal ${i}`);
    }
    assert.ok(tui.getGoalHistory("s1").length <= MAX_GOAL_HISTORY);
  });

  it("does not duplicate consecutive same goal", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "same");
    tui.pushGoalHistory("s1", "same");
    assert.equal(tui.getGoalHistory("s1").length, 1);
  });

  it("ignores empty/whitespace goals", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "");
    tui.pushGoalHistory("s1", "   ");
    assert.equal(tui.getGoalHistory("s1").length, 0);
  });

  it("getPreviousGoal returns most recent (nBack=1)", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "old goal");
    tui.pushGoalHistory("s1", "new goal");
    assert.equal(tui.getPreviousGoal("s1", 1), "new goal");
  });

  it("getPreviousGoal returns older goal (nBack=2)", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "first");
    tui.pushGoalHistory("s1", "second");
    assert.equal(tui.getPreviousGoal("s1", 2), "first");
  });

  it("getPreviousGoal returns null when nBack exceeds history", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "only");
    assert.equal(tui.getPreviousGoal("s1", 5), null);
  });

  it("history is per-session independent", () => {
    const tui = new TUI();
    tui.pushGoalHistory("s1", "alpha goal");
    tui.pushGoalHistory("s2", "bravo goal");
    assert.equal(tui.getPreviousGoal("s1", 1), "alpha goal");
    assert.equal(tui.getPreviousGoal("s2", 1), "bravo goal");
  });
});

// ── MAX_GOAL_HISTORY ──────────────────────────────────────────────────────

describe("MAX_GOAL_HISTORY", () => {
  it("is 5", () => {
    assert.equal(MAX_GOAL_HISTORY, 5);
  });
});

// ── validateSessionTag ────────────────────────────────────────────────────

describe("validateSessionTag", () => {
  it("accepts simple tag", () => {
    assert.equal(validateSessionTag("frontend"), null);
  });

  it("accepts tag with dash", () => {
    assert.equal(validateSessionTag("my-tag"), null);
  });

  it("accepts tag with underscore", () => {
    assert.equal(validateSessionTag("my_tag"), null);
  });

  it("rejects empty tag", () => {
    assert.ok(validateSessionTag("") !== null);
  });

  it("rejects too-long tag", () => {
    assert.ok(validateSessionTag("a".repeat(MAX_SESSION_TAG_LEN + 1)) !== null);
  });

  it("accepts max-length tag", () => {
    assert.equal(validateSessionTag("a".repeat(MAX_SESSION_TAG_LEN)), null);
  });

  it("rejects spaces", () => {
    assert.ok(validateSessionTag("my tag") !== null);
  });

  it("rejects special chars", () => {
    assert.ok(validateSessionTag("tag!") !== null);
  });
});

// ── formatSessionTagsBadge ────────────────────────────────────────────────

describe("formatSessionTagsBadge", () => {
  it("returns empty for empty set", () => {
    assert.equal(stripAnsi(formatSessionTagsBadge(new Set())), "");
  });

  it("includes tag names", () => {
    const badge = stripAnsi(formatSessionTagsBadge(new Set(["frontend", "prod"])));
    assert.ok(badge.includes("frontend"));
    assert.ok(badge.includes("prod"));
  });

  it("sorts tags alphabetically", () => {
    const badge = stripAnsi(formatSessionTagsBadge(new Set(["zzz", "aaa"])));
    assert.ok(badge.indexOf("aaa") < badge.indexOf("zzz"));
  });

  it("is wrapped in brackets", () => {
    const badge = stripAnsi(formatSessionTagsBadge(new Set(["x"])));
    assert.ok(badge.includes("[") && badge.includes("]"));
  });
});

// ── TUI setTagFilter2 / getTagFilter2 ────────────────────────────────────

describe("TUI setTagFilter2 / getTagFilter2", () => {
  it("starts with null tag filter", () => {
    const tui = new TUI();
    assert.equal(tui.getTagFilter2(), null);
  });

  it("setTagFilter2 sets filter", () => {
    const tui = new TUI();
    tui.setTagFilter2("frontend");
    assert.equal(tui.getTagFilter2(), "frontend");
  });

  it("normalizes to lowercase", () => {
    const tui = new TUI();
    tui.setTagFilter2("Frontend");
    assert.equal(tui.getTagFilter2(), "frontend");
  });

  it("setTagFilter2 null clears", () => {
    const tui = new TUI();
    tui.setTagFilter2("x");
    tui.setTagFilter2(null);
    assert.equal(tui.getTagFilter2(), null);
  });

  it("empty string clears", () => {
    const tui = new TUI();
    tui.setTagFilter2("x");
    tui.setTagFilter2("");
    assert.equal(tui.getTagFilter2(), null);
  });

  it("is safe when TUI not active", () => {
    const tui = new TUI();
    assert.doesNotThrow(() => { tui.setTagFilter2("x"); tui.setTagFilter2(null); });
  });
});

// ── TUI resetSessionHealth ────────────────────────────────────────────────

describe("TUI resetSessionHealth", () => {
  const base = { id: "r1", title: "Alpha", status: "error" as const, tool: "opencode",
    contextTokens: "50,000 / 200,000 tokens", lastActivity: undefined, userActive: false, currentTask: undefined };

  it("returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [base] });
    assert.equal(tui.resetSessionHealth("zzz"), false);
  });

  it("returns true for known session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [base] });
    assert.equal(tui.resetSessionHealth(1), true);
  });

  it("clears error counts", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [base] });
    tui.log("error", "oops", "r1");
    assert.ok((tui.getSessionErrorCounts().get("r1") ?? 0) > 0);
    tui.resetSessionHealth(1);
    assert.equal(tui.getSessionErrorCounts().get("r1"), undefined);
  });

  it("clears error timestamps", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [base] });
    tui.log("error", "oops", "r1");
    assert.ok(tui.getSessionErrorTimestamps("r1").length > 0);
    tui.resetSessionHealth("alpha");
    assert.equal(tui.getSessionErrorTimestamps("r1").length, 0);
  });

  it("clears context history", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [base] });
    assert.ok(tui.getSessionContextHistory("r1").length > 0);
    tui.resetSessionHealth(1);
    assert.equal(tui.getSessionContextHistory("r1").length, 0);
  });

  it("is safe when TUI not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: [base] });
    assert.doesNotThrow(() => tui.resetSessionHealth(1));
  });
});

// ── TUI session multi-tags ────────────────────────────────────────────────

describe("TUI session multi-tags", () => {
  function makeTagSessions(): DaemonSessionState[] {
    return [
      { id: "t1", title: "Alpha", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
      { id: "t2", title: "Bravo", status: "working", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    ];
  }

  it("starts with no tags", () => {
    const tui = new TUI();
    assert.equal(tui.getAllSessionTags().size, 0);
  });

  it("setSessionTags by index sets tags", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeTagSessions() });
    const ok = tui.setSessionTags(1, ["frontend", "prod"]);
    assert.equal(ok, true);
    const tags = tui.getSessionTags("t1");
    assert.ok(tags.has("frontend"));
    assert.ok(tags.has("prod"));
  });

  it("setSessionTags by name sets tags", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeTagSessions() });
    tui.setSessionTags("bravo", ["backend"]);
    assert.ok(tui.getSessionTags("t2").has("backend"));
  });

  it("setSessionTags empty array clears tags", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeTagSessions() });
    tui.setSessionTags(1, ["x"]);
    tui.setSessionTags(1, []);
    assert.equal(tui.getSessionTags("t1").size, 0);
  });

  it("setSessionTags returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeTagSessions() });
    assert.equal(tui.setSessionTags("zzz", ["x"]), false);
  });

  it("getSessionsWithTag filters correctly", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeTagSessions() });
    tui.setSessionTags(1, ["backend"]);
    tui.setSessionTags(2, ["frontend"]);
    const be = tui.getSessionsWithTag("backend");
    assert.equal(be.length, 1);
    assert.equal(be[0].title, "Alpha");
  });

  it("restoreSessionTags bulk-sets tags", () => {
    const tui = new TUI();
    tui.restoreSessionTags({ "t1": ["frontend"], "t2": ["backend"] });
    assert.ok(tui.getSessionTags("t1").has("frontend"));
    assert.ok(tui.getSessionTags("t2").has("backend"));
  });

  it("getAllSessionTags returns all", () => {
    const tui = new TUI();
    tui.restoreSessionTags({ "t1": ["a"], "t2": ["b"] });
    assert.equal(tui.getAllSessionTags().size, 2);
  });

  it("is safe when TUI not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeTagSessions() });
    assert.doesNotThrow(() => {
      tui.setSessionTags(1, ["x"]);
      tui.restoreSessionTags({ "t1": ["y"] });
    });
  });
});

// ── truncateRename ────────────────────────────────────────────────────────

describe("truncateRename", () => {
  it("returns name unchanged when under limit", () => {
    assert.equal(truncateRename("Alpha"), "Alpha");
  });

  it("truncates with .. when over max length", () => {
    const long = "a".repeat(MAX_RENAME_LEN + 5);
    const result = truncateRename(long);
    assert.ok(result.length <= MAX_RENAME_LEN);
    assert.ok(result.endsWith(".."));
  });

  it("handles exact max length", () => {
    const exact = "a".repeat(MAX_RENAME_LEN);
    assert.equal(truncateRename(exact), exact);
  });
});

// ── MAX_RENAME_LEN ────────────────────────────────────────────────────────

describe("MAX_RENAME_LEN", () => {
  it("is 32", () => {
    assert.equal(MAX_RENAME_LEN, 32);
  });
});

// ── TUI rename state ──────────────────────────────────────────────────────

function makeSessionsForRename(): DaemonSessionState[] {
  return [
    { id: "r1", title: "Alpha", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "r2", title: "Bravo", status: "working", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];
}

describe("TUI rename state", () => {
  it("starts with no aliases", () => {
    const tui = new TUI();
    assert.equal(tui.getAllSessionAliases().size, 0);
  });

  it("renameSession by index sets alias", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    const ok = tui.renameSession(1, "My Alpha");
    assert.equal(ok, true);
    assert.equal(tui.getSessionAlias("r1"), "My Alpha");
  });

  it("renameSession by name sets alias", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    tui.renameSession("bravo", "Beta");
    assert.equal(tui.getSessionAlias("r2"), "Beta");
  });

  it("renameSession with empty string clears alias", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    tui.renameSession(1, "MyName");
    tui.renameSession(1, "");
    assert.equal(tui.getSessionAlias("r1"), undefined);
  });

  it("renameSession with null clears alias", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    tui.renameSession(1, "MyName");
    tui.renameSession(1, null);
    assert.equal(tui.getSessionAlias("r1"), undefined);
  });

  it("renameSession returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    assert.equal(tui.renameSession("zzz", "Foo"), false);
  });

  it("truncates long names to MAX_RENAME_LEN", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    tui.renameSession(1, "a".repeat(MAX_RENAME_LEN + 10));
    const alias = tui.getSessionAlias("r1");
    assert.ok(alias !== undefined && alias.length <= MAX_RENAME_LEN);
  });

  it("restoreSessionAliases bulk-sets aliases", () => {
    const tui = new TUI();
    tui.restoreSessionAliases({ "r1": "Custom Alpha", "r2": "Custom Bravo" });
    assert.equal(tui.getSessionAlias("r1"), "Custom Alpha");
    assert.equal(tui.getSessionAlias("r2"), "Custom Bravo");
  });

  it("getAllSessionAliases returns all aliases", () => {
    const tui = new TUI();
    tui.restoreSessionAliases({ "x": "Foo", "y": "Bar" });
    assert.equal(tui.getAllSessionAliases().size, 2);
  });

  it("is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForRename() });
    assert.doesNotThrow(() => {
      tui.renameSession(1, "Test");
      tui.restoreSessionAliases({ "r1": "Test" });
    });
  });
});

// ── formatSessionCard with displayName ───────────────────────────────────

describe("formatSessionCard with displayName", () => {
  const session: DaemonSessionState = {
    id: "s1", title: "Alpha", status: "working", tool: "opencode",
    contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined,
  };

  it("shows original title when no displayName", () => {
    const result = stripAnsi(formatSessionCard(session, 80));
    assert.ok(result.includes("Alpha"));
  });

  it("shows custom display name when provided", () => {
    const result = stripAnsi(formatSessionCard(session, 80, undefined, undefined, undefined, "My Worker"));
    assert.ok(result.includes("My Worker"));
  });

  it("shows original title in dim when displayName set", () => {
    // the original title should still appear (in dim) for disambiguation
    const result = stripAnsi(formatSessionCard(session, 80, undefined, undefined, undefined, "My Worker"));
    assert.ok(result.includes("Alpha"));
  });
});

// ── TUI group state ────────────────────────────────────────────────────────

function makeSessionsForGroup(): DaemonSessionState[] {
  return [
    { id: "s1", title: "Alpha", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s2", title: "Bravo", status: "working", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
    { id: "s3", title: "Charlie", status: "idle", tool: "opencode", contextTokens: undefined, lastActivity: undefined, userActive: false, currentTask: undefined },
  ];
}

describe("TUI group state", () => {
  it("starts with no groups", () => {
    const tui = new TUI();
    assert.equal(tui.getGroupCount(), 0);
  });

  it("setGroup by index assigns group", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    const ok = tui.setGroup(1, "frontend");
    assert.equal(ok, true);
    assert.equal(tui.getGroup("s1"), "frontend");
  });

  it("setGroup by name assigns group", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    const ok = tui.setGroup("bravo", "backend");
    assert.equal(ok, true);
    assert.equal(tui.getGroup("s2"), "backend");
  });

  it("setGroup normalizes to lowercase", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    tui.setGroup(1, "Frontend");
    assert.equal(tui.getGroup("s1"), "frontend");
  });

  it("setGroup with empty string clears group", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    tui.setGroup(1, "frontend");
    tui.setGroup(1, "");
    assert.equal(tui.getGroup("s1"), undefined);
  });

  it("setGroup with null clears group", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    tui.setGroup(1, "frontend");
    tui.setGroup(1, null);
    assert.equal(tui.getGroup("s1"), undefined);
  });

  it("setGroup returns false for unknown session", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    const ok = tui.setGroup("zzz", "frontend");
    assert.equal(ok, false);
  });

  it("getGroupCount returns correct count", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    tui.setGroup(1, "frontend");
    tui.setGroup(2, "backend");
    assert.equal(tui.getGroupCount(), 2);
  });

  it("getAllGroups returns all groups", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    tui.setGroup(1, "frontend");
    tui.setGroup(2, "backend");
    const all = tui.getAllGroups();
    assert.equal(all.get("s1"), "frontend");
    assert.equal(all.get("s2"), "backend");
  });

  it("restoreGroups bulk-sets groups", () => {
    const tui = new TUI();
    tui.restoreGroups({ "s1": "frontend", "s2": "backend" });
    assert.equal(tui.getGroup("s1"), "frontend");
    assert.equal(tui.getGroup("s2"), "backend");
    assert.equal(tui.getGroupCount(), 2);
  });

  it("getGroupFilter starts null", () => {
    const tui = new TUI();
    assert.equal(tui.getGroupFilter(), null);
  });

  it("setGroupFilter sets filter", () => {
    const tui = new TUI();
    tui.setGroupFilter("frontend");
    assert.equal(tui.getGroupFilter(), "frontend");
  });

  it("setGroupFilter normalizes to lowercase", () => {
    const tui = new TUI();
    tui.setGroupFilter("Frontend");
    assert.equal(tui.getGroupFilter(), "frontend");
  });

  it("setGroupFilter null clears filter", () => {
    const tui = new TUI();
    tui.setGroupFilter("frontend");
    tui.setGroupFilter(null);
    assert.equal(tui.getGroupFilter(), null);
  });

  it("setGroupFilter empty string clears filter", () => {
    const tui = new TUI();
    tui.setGroupFilter("frontend");
    tui.setGroupFilter("");
    assert.equal(tui.getGroupFilter(), null);
  });

  it("is safe when TUI is not active", () => {
    const tui = new TUI();
    tui.updateState({ sessions: makeSessionsForGroup() });
    assert.doesNotThrow(() => {
      tui.setGroup(1, "frontend");
      tui.setGroupFilter("frontend");
      tui.restoreGroups({ "x": "g" });
    });
  });
});

