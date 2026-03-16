import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseActionStats, parseHistoryStats, combineStats,
  formatDuration, formatRate, formatStats,
} from "./stats.js";
import type { HistoryEntry } from "./tui-history.js";

function makeActionLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: Date.now(),
    action: { action: "send_input", session: "abc12345", text: "hello" },
    success: true,
    detail: "sent",
    ...overrides,
  });
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    ts: Date.now(),
    time: "14:30:45",
    tag: "system",
    text: "test message",
    ...overrides,
  };
}

// ── parseActionStats ──────────────────────────────────────────────────────────

describe("parseActionStats", () => {
  it("returns null for empty input", () => {
    assert.strictEqual(parseActionStats([]), null);
  });

  it("returns null when all lines are wait actions", () => {
    const lines = [
      makeActionLine({ action: { action: "wait" } }),
      makeActionLine({ action: { action: "wait" } }),
    ];
    assert.strictEqual(parseActionStats(lines), null);
  });

  it("counts total, succeeded, failed", () => {
    const lines = [
      makeActionLine({ success: true }),
      makeActionLine({ success: true }),
      makeActionLine({ success: false }),
    ];
    const stats = parseActionStats(lines);
    assert.ok(stats);
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.succeeded, 2);
    assert.strictEqual(stats.failed, 1);
  });

  it("groups actions by type", () => {
    const lines = [
      makeActionLine({ action: { action: "send_input", session: "a" } }),
      makeActionLine({ action: { action: "send_input", session: "b" } }),
      makeActionLine({ action: { action: "start_session", session: "c" } }),
    ];
    const stats = parseActionStats(lines);
    assert.ok(stats);
    assert.strictEqual(stats.byType.get("send_input"), 2);
    assert.strictEqual(stats.byType.get("start_session"), 1);
  });

  it("groups actions by session (uses title when available)", () => {
    const lines = [
      makeActionLine({ action: { action: "send_input", session: "abc12345", title: "my-project" } }),
      makeActionLine({ action: { action: "send_input", session: "abc12345", title: "my-project" } }),
      makeActionLine({ action: { action: "send_input", session: "def67890" } }),
    ];
    const stats = parseActionStats(lines);
    assert.ok(stats);
    assert.strictEqual(stats.bySession.get("my-project")?.total, 2);
    assert.strictEqual(stats.bySession.get("def67890")?.total, 1);
  });

  it("tracks time range (first and last timestamps)", () => {
    const lines = [
      makeActionLine({ timestamp: 1000 }),
      makeActionLine({ timestamp: 5000 }),
      makeActionLine({ timestamp: 3000 }),
    ];
    const stats = parseActionStats(lines);
    assert.ok(stats);
    assert.strictEqual(stats.firstTs, 1000);
    assert.strictEqual(stats.lastTs, 5000);
  });

  it("skips malformed lines", () => {
    const lines = [
      "not json",
      makeActionLine({ success: true }),
      "{bad}",
    ];
    const stats = parseActionStats(lines);
    assert.ok(stats);
    assert.strictEqual(stats.total, 1);
  });

  it("respects maxAgeMs filter", () => {
    const now = 100_000;
    const lines = [
      makeActionLine({ timestamp: 10_000 }),  // old
      makeActionLine({ timestamp: 90_000 }),  // recent
      makeActionLine({ timestamp: 95_000 }),  // recent
    ];
    const stats = parseActionStats(lines, 20_000, now);
    assert.ok(stats);
    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.firstTs, 90_000);
  });

  it("tracks per-session success and failure counts", () => {
    const lines = [
      makeActionLine({ action: { action: "send_input", session: "abc" }, success: true }),
      makeActionLine({ action: { action: "send_input", session: "abc" }, success: false }),
      makeActionLine({ action: { action: "send_input", session: "abc" }, success: true }),
    ];
    const stats = parseActionStats(lines);
    assert.ok(stats);
    const session = stats.bySession.get("abc");
    assert.ok(session);
    assert.strictEqual(session.total, 3);
    assert.strictEqual(session.ok, 2);
    assert.strictEqual(session.fail, 1);
  });
});

// ── parseHistoryStats ─────────────────────────────────────────────────────────

describe("parseHistoryStats", () => {
  it("returns null for empty input", () => {
    assert.strictEqual(parseHistoryStats([]), null);
  });

  it("counts total entries", () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const stats = parseHistoryStats(entries);
    assert.ok(stats);
    assert.strictEqual(stats.total, 3);
  });

  it("groups entries by tag", () => {
    const entries = [
      makeEntry({ tag: "observation" }),
      makeEntry({ tag: "observation" }),
      makeEntry({ tag: "reasoner" }),
      makeEntry({ tag: "you" }),
    ];
    const stats = parseHistoryStats(entries);
    assert.ok(stats);
    assert.strictEqual(stats.byTag.get("observation"), 2);
    assert.strictEqual(stats.byTag.get("reasoner"), 1);
    assert.strictEqual(stats.byTag.get("you"), 1);
  });

  it("tracks time range", () => {
    const entries = [
      makeEntry({ ts: 2000 }),
      makeEntry({ ts: 8000 }),
      makeEntry({ ts: 5000 }),
    ];
    const stats = parseHistoryStats(entries);
    assert.ok(stats);
    assert.strictEqual(stats.firstTs, 2000);
    assert.strictEqual(stats.lastTs, 8000);
  });

  it("respects maxAgeMs filter", () => {
    const now = 100_000;
    const entries = [
      makeEntry({ ts: 10_000 }),  // old
      makeEntry({ ts: 90_000 }),  // recent
      makeEntry({ ts: 95_000 }),  // recent
    ];
    const stats = parseHistoryStats(entries, 20_000, now);
    assert.ok(stats);
    assert.strictEqual(stats.total, 2);
  });
});

// ── combineStats ──────────────────────────────────────────────────────────────

describe("combineStats", () => {
  it("returns null timeRange when both are null", () => {
    const combined = combineStats(null, null);
    assert.strictEqual(combined.actions, null);
    assert.strictEqual(combined.history, null);
    assert.strictEqual(combined.timeRange, null);
  });

  it("computes timeRange from actions only", () => {
    const actions = {
      total: 5, succeeded: 4, failed: 1,
      byType: new Map(), bySession: new Map(),
      firstTs: 1000, lastTs: 5000,
    };
    const combined = combineStats(actions, null);
    assert.ok(combined.timeRange);
    assert.strictEqual(combined.timeRange.start, 1000);
    assert.strictEqual(combined.timeRange.end, 5000);
  });

  it("computes timeRange from history only", () => {
    const history = {
      total: 10, byTag: new Map(), firstTs: 2000, lastTs: 8000,
    };
    const combined = combineStats(null, history);
    assert.ok(combined.timeRange);
    assert.strictEqual(combined.timeRange.start, 2000);
    assert.strictEqual(combined.timeRange.end, 8000);
  });

  it("takes min/max across both sources", () => {
    const actions = {
      total: 3, succeeded: 3, failed: 0,
      byType: new Map(), bySession: new Map(),
      firstTs: 3000, lastTs: 7000,
    };
    const history = {
      total: 5, byTag: new Map(), firstTs: 1000, lastTs: 9000,
    };
    const combined = combineStats(actions, history);
    assert.ok(combined.timeRange);
    assert.strictEqual(combined.timeRange.start, 1000);
    assert.strictEqual(combined.timeRange.end, 9000);
  });
});

// ── formatDuration ────────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("formats seconds", () => {
    assert.strictEqual(formatDuration(45_000), "45s");
  });

  it("formats minutes", () => {
    assert.strictEqual(formatDuration(90_000), "1m 30s");
  });

  it("formats minutes without trailing seconds", () => {
    assert.strictEqual(formatDuration(120_000), "2m");
  });

  it("formats hours", () => {
    assert.strictEqual(formatDuration(5_400_000), "1h 30m");
  });

  it("formats hours without trailing minutes", () => {
    assert.strictEqual(formatDuration(7_200_000), "2h");
  });

  it("formats days", () => {
    assert.strictEqual(formatDuration(90_000_000), "1d 1h");
  });

  it("formats days without trailing hours", () => {
    assert.strictEqual(formatDuration(172_800_000), "2d");
  });
});

// ── formatRate ────────────────────────────────────────────────────────────────

describe("formatRate", () => {
  it("returns total for zero span", () => {
    assert.strictEqual(formatRate(10, 0), "10 total");
  });

  it("returns total for very short span", () => {
    assert.strictEqual(formatRate(5, 1000), "5 total");
  });

  it("returns per-hour for spans >= 1h", () => {
    // 10 actions in 2 hours = 5.0/hr
    assert.strictEqual(formatRate(10, 7_200_000), "5.0/hr");
  });

  it("returns per-day for low-frequency actions", () => {
    // 1 action in 48 hours = 0.5/day
    assert.strictEqual(formatRate(1, 48 * 3_600_000), "0.5/day");
  });
});

// ── formatStats ───────────────────────────────────────────────────────────────

describe("formatStats", () => {
  it("shows 'no data found' when timeRange is null", () => {
    const result = formatStats({ actions: null, history: null, timeRange: null });
    assert.ok(result.includes("no data found"));
  });

  it("includes window label when provided", () => {
    const result = formatStats({ actions: null, history: null, timeRange: null }, "last 24h");
    assert.ok(result.includes("last 24h"));
  });

  it("shows time range when data exists", () => {
    const actions = {
      total: 2, succeeded: 2, failed: 0,
      byType: new Map([["send_input", 2]]),
      bySession: new Map([["proj", { total: 2, ok: 2, fail: 0 }]]),
      firstTs: Date.now() - 3_600_000, lastTs: Date.now(),
    };
    const combined = combineStats(actions, null);
    const result = formatStats(combined);
    assert.ok(result.includes("from:"));
    assert.ok(result.includes("to:"));
    assert.ok(result.includes("span:"));
  });

  it("shows action counts with success percentage", () => {
    const actions = {
      total: 10, succeeded: 8, failed: 2,
      byType: new Map([["send_input", 10]]),
      bySession: new Map([["proj", { total: 10, ok: 8, fail: 2 }]]),
      firstTs: 1000, lastTs: 5000,
    };
    const combined = combineStats(actions, null);
    const result = formatStats(combined);
    assert.ok(result.includes("10"));
    assert.ok(result.includes("8 ok"));
    assert.ok(result.includes("2 failed"));
    assert.ok(result.includes("80%"));
  });

  it("shows action type breakdown", () => {
    const actions = {
      total: 5, succeeded: 5, failed: 0,
      byType: new Map([["send_input", 3], ["start_session", 2]]),
      bySession: new Map(),
      firstTs: 1000, lastTs: 5000,
    };
    const combined = combineStats(actions, null);
    const result = formatStats(combined);
    assert.ok(result.includes("send_input"));
    assert.ok(result.includes("start_session"));
  });

  it("shows top sessions", () => {
    const actions = {
      total: 5, succeeded: 5, failed: 0,
      byType: new Map([["send_input", 5]]),
      bySession: new Map([
        ["adventure", { total: 3, ok: 3, fail: 0 }],
        ["aoaoe", { total: 2, ok: 2, fail: 0 }],
      ]),
      firstTs: 1000, lastTs: 5000,
    };
    const combined = combineStats(actions, null);
    const result = formatStats(combined);
    assert.ok(result.includes("adventure"));
    assert.ok(result.includes("aoaoe"));
    assert.ok(result.includes("top sessions"));
  });

  it("shows activity breakdown from history", () => {
    const history = {
      total: 20,
      byTag: new Map([["observation", 10], ["reasoner", 5], ["you", 3], ["system", 2]]),
      firstTs: 1000, lastTs: 5000,
    };
    const combined = combineStats(null, history);
    const result = formatStats(combined);
    assert.ok(result.includes("activity"));
    assert.ok(result.includes("observation"));
    assert.ok(result.includes("reasoner"));
  });

  it("shows 'no actions recorded' when only history exists", () => {
    const history = {
      total: 5, byTag: new Map([["system", 5]]), firstTs: 1000, lastTs: 5000,
    };
    const combined = combineStats(null, history);
    const result = formatStats(combined);
    assert.ok(result.includes("no actions recorded"));
  });
});

// ── parseCliArgs stats subcommand ─────────────────────────────────────────────

describe("parseCliArgs stats subcommand", () => {
  let parseCliArgs: (argv: string[]) => Record<string, unknown>;

  it("parses 'stats' subcommand with defaults", async () => {
    const mod = await import("./config.js");
    parseCliArgs = mod.parseCliArgs as (argv: string[]) => Record<string, unknown>;
    const result = parseCliArgs(["node", "aoaoe", "stats"]);
    assert.strictEqual(result.runStats, true);
    assert.strictEqual(result.statsLast, undefined);
  });

  it("parses 'stats --last 24h'", async () => {
    const mod = await import("./config.js");
    parseCliArgs = mod.parseCliArgs as (argv: string[]) => Record<string, unknown>;
    const result = parseCliArgs(["node", "aoaoe", "stats", "--last", "24h"]);
    assert.strictEqual(result.runStats, true);
    assert.strictEqual(result.statsLast, "24h");
  });

  it("parses 'stats -l 7d'", async () => {
    const mod = await import("./config.js");
    parseCliArgs = mod.parseCliArgs as (argv: string[]) => Record<string, unknown>;
    const result = parseCliArgs(["node", "aoaoe", "stats", "-l", "7d"]);
    assert.strictEqual(result.runStats, true);
    assert.strictEqual(result.statsLast, "7d");
  });

  it("returns runStats=false for non-stats subcommands", async () => {
    const mod = await import("./config.js");
    parseCliArgs = mod.parseCliArgs as (argv: string[]) => Record<string, unknown>;
    const result = parseCliArgs(["node", "aoaoe", "--verbose"]);
    assert.strictEqual(result.runStats, false);
  });
});
