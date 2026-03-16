import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseActionLogEntries,
  parseActivityEntries,
  mergeTimeline,
  filterByAge,
  parseDuration,
  formatTimelineJson,
  formatTimelineMarkdown,
  type TimelineEntry,
} from "./export.js";
import type { HistoryEntry } from "./tui-history.js";

// ── parseActionLogEntries ───────────────────────────────────────────────────

describe("parseActionLogEntries", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(parseActionLogEntries([]), []);
  });

  it("parses a valid action log line", () => {
    const line = JSON.stringify({
      timestamp: 1700000000000,
      action: { action: "send_input", session: "abc123", text: "run tests" },
      success: true,
      detail: "sent to aoe_adventure_abc12345",
    });
    const result = parseActionLogEntries([line]);
    assert.equal(result.length, 1);
    assert.equal(result[0].ts, 1700000000000);
    assert.equal(result[0].source, "action");
    assert.equal(result[0].tag, "send_input");
    assert.equal(result[0].success, true);
    assert.equal(result[0].session, "abc123");
    assert.ok(result[0].text.includes("sent to"));
  });

  it("parses multiple lines", () => {
    const lines = [
      JSON.stringify({ timestamp: 1000, action: { action: "send_input", session: "s1", text: "go" }, success: true, detail: "ok" }),
      JSON.stringify({ timestamp: 2000, action: { action: "start_session", session: "s2" }, success: false, detail: "failed" }),
    ];
    const result = parseActionLogEntries(lines);
    assert.equal(result.length, 2);
    assert.equal(result[0].tag, "send_input");
    assert.equal(result[1].tag, "start_session");
    assert.equal(result[1].success, false);
  });

  it("skips malformed lines", () => {
    const lines = ["not json", "{}", JSON.stringify({
      timestamp: 1000, action: { action: "send_input", session: "s1", text: "go" }, success: true, detail: "ok",
    })];
    const result = parseActionLogEntries(lines);
    assert.equal(result.length, 1);
  });

  it("skips wait actions", () => {
    const line = JSON.stringify({
      timestamp: 1000, action: { action: "wait", reason: "idle" }, success: true, detail: "",
    });
    const result = parseActionLogEntries([line]);
    assert.equal(result.length, 0);
  });

  it("skips blank lines", () => {
    const lines = ["", "  ", JSON.stringify({
      timestamp: 1000, action: { action: "send_input", session: "s1", text: "go" }, success: true, detail: "ok",
    }), ""];
    const result = parseActionLogEntries(lines);
    assert.equal(result.length, 1);
  });

  it("uses title as session for create_agent", () => {
    const line = JSON.stringify({
      timestamp: 1000, action: { action: "create_agent", path: "/tmp", title: "new-agent", tool: "opencode" }, success: true, detail: "created",
    });
    const result = parseActionLogEntries([line]);
    assert.equal(result[0].session, "new-agent");
  });
});

// ── parseActivityEntries ────────────────────────────────────────────────────

describe("parseActivityEntries", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(parseActivityEntries([]), []);
  });

  it("converts a single HistoryEntry", () => {
    const entry: HistoryEntry = { ts: 5000, time: "12:00:00", tag: "observation", text: "3 sessions active" };
    const result = parseActivityEntries([entry]);
    assert.equal(result.length, 1);
    assert.equal(result[0].ts, 5000);
    assert.equal(result[0].source, "activity");
    assert.equal(result[0].tag, "observation");
    assert.equal(result[0].text, "3 sessions active");
  });

  it("converts multiple entries preserving order", () => {
    const entries: HistoryEntry[] = [
      { ts: 1000, time: "12:00:00", tag: "system", text: "started" },
      { ts: 2000, time: "12:00:01", tag: "reasoner", text: "thinking" },
      { ts: 3000, time: "12:00:02", tag: "+ action", text: "sent input" },
    ];
    const result = parseActivityEntries(entries);
    assert.equal(result.length, 3);
    assert.equal(result[0].tag, "system");
    assert.equal(result[1].tag, "reasoner");
    assert.equal(result[2].tag, "+ action");
  });

  it("does not set success or session fields", () => {
    const entry: HistoryEntry = { ts: 1000, time: "12:00:00", tag: "status", text: "ok" };
    const result = parseActivityEntries([entry]);
    assert.equal(result[0].success, undefined);
    assert.equal(result[0].session, undefined);
  });
});

// ── mergeTimeline ───────────────────────────────────────────────────────────

describe("mergeTimeline", () => {
  it("returns empty for no sources", () => {
    assert.deepEqual(mergeTimeline(), []);
  });

  it("returns single source sorted", () => {
    const entries: TimelineEntry[] = [
      { ts: 3000, source: "action", tag: "send_input", text: "c" },
      { ts: 1000, source: "action", tag: "send_input", text: "a" },
      { ts: 2000, source: "action", tag: "send_input", text: "b" },
    ];
    const result = mergeTimeline(entries);
    assert.equal(result[0].text, "a");
    assert.equal(result[1].text, "b");
    assert.equal(result[2].text, "c");
  });

  it("interleaves multiple sources chronologically", () => {
    const actions: TimelineEntry[] = [
      { ts: 1000, source: "action", tag: "send_input", text: "action1" },
      { ts: 3000, source: "action", tag: "start_session", text: "action2" },
    ];
    const activity: TimelineEntry[] = [
      { ts: 2000, source: "activity", tag: "observation", text: "activity1" },
      { ts: 4000, source: "activity", tag: "reasoner", text: "activity2" },
    ];
    const result = mergeTimeline(actions, activity);
    assert.equal(result.length, 4);
    assert.equal(result[0].text, "action1");
    assert.equal(result[1].text, "activity1");
    assert.equal(result[2].text, "action2");
    assert.equal(result[3].text, "activity2");
  });
});

// ── filterByAge ─────────────────────────────────────────────────────────────

describe("filterByAge", () => {
  const now = 10_000;

  it("keeps entries within window", () => {
    const entries: TimelineEntry[] = [
      { ts: 5000, source: "action", tag: "a", text: "recent" },
      { ts: 9000, source: "action", tag: "b", text: "very recent" },
    ];
    const result = filterByAge(entries, 6000, now);
    assert.equal(result.length, 2);
  });

  it("filters out old entries", () => {
    const entries: TimelineEntry[] = [
      { ts: 1000, source: "action", tag: "a", text: "old" },
      { ts: 9000, source: "action", tag: "b", text: "recent" },
    ];
    const result = filterByAge(entries, 5000, now);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "recent");
  });

  it("returns empty when all entries are old", () => {
    const entries: TimelineEntry[] = [
      { ts: 1000, source: "action", tag: "a", text: "old" },
    ];
    const result = filterByAge(entries, 1000, now);
    assert.equal(result.length, 0);
  });
});

// ── parseDuration ───────────────────────────────────────────────────────────

describe("parseDuration", () => {
  it("parses hours", () => {
    assert.equal(parseDuration("1h"), 3_600_000);
    assert.equal(parseDuration("24h"), 86_400_000);
  });

  it("parses days", () => {
    assert.equal(parseDuration("1d"), 86_400_000);
    assert.equal(parseDuration("7d"), 604_800_000);
  });

  it("returns null for invalid format", () => {
    assert.equal(parseDuration("abc"), null);
    assert.equal(parseDuration(""), null);
    assert.equal(parseDuration("5m"), null);
    assert.equal(parseDuration("h"), null);
  });

  it("returns null for zero value", () => {
    assert.equal(parseDuration("0h"), null);
    assert.equal(parseDuration("0d"), null);
  });

  it("handles large values", () => {
    assert.equal(parseDuration("30d"), 30 * 86_400_000);
    assert.equal(parseDuration("168h"), 168 * 3_600_000);
  });
});

// ── formatTimelineJson ──────────────────────────────────────────────────────

describe("formatTimelineJson", () => {
  it("returns empty array for no entries", () => {
    const result = formatTimelineJson([]);
    assert.equal(result.trim(), "[]");
  });

  it("formats entries with ISO timestamps", () => {
    const entries: TimelineEntry[] = [{
      ts: 1700000000000,
      source: "action",
      tag: "send_input",
      text: "sent to agent",
      success: true,
      session: "adventure",
    }];
    const result = formatTimelineJson(entries);
    const parsed = JSON.parse(result);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].time, new Date(1700000000000).toISOString());
    assert.equal(parsed[0].source, "action");
    assert.equal(parsed[0].tag, "send_input");
    assert.equal(parsed[0].text, "sent to agent");
    assert.equal(parsed[0].success, true);
    assert.equal(parsed[0].session, "adventure");
  });

  it("omits success and session when undefined", () => {
    const entries: TimelineEntry[] = [{
      ts: 1000, source: "activity", tag: "system", text: "started",
    }];
    const result = formatTimelineJson(entries);
    const parsed = JSON.parse(result);
    assert.equal(parsed[0].success, undefined);
    assert.equal(parsed[0].session, undefined);
  });
});

// ── formatTimelineMarkdown ──────────────────────────────────────────────────

describe("formatTimelineMarkdown", () => {
  it("returns empty-state message for no entries", () => {
    const result = formatTimelineMarkdown([]);
    assert.ok(result.includes("No entries"));
    assert.ok(result.startsWith("# aoaoe Session Export"));
  });

  it("includes header with metadata", () => {
    const entries: TimelineEntry[] = [{
      ts: 1700000000000, source: "action", tag: "send_input", text: "go", success: true, session: "s1",
    }];
    const result = formatTimelineMarkdown(entries);
    assert.ok(result.includes("# aoaoe Session Export"));
    assert.ok(result.includes("**Generated**"));
    assert.ok(result.includes("**Range**"));
    assert.ok(result.includes("**Entries**: 1"));
    assert.ok(result.includes("## Timeline"));
  });

  it("groups entries by hour", () => {
    // two entries in same hour, one in different hour
    const base = new Date("2026-03-16T10:00:00Z").getTime();
    const entries: TimelineEntry[] = [
      { ts: base, source: "activity", tag: "system", text: "started" },
      { ts: base + 30_000, source: "action", tag: "send_input", text: "go", success: true, session: "s1" },
      { ts: base + 3_600_000, source: "activity", tag: "observation", text: "3 sessions" },
    ];
    const result = formatTimelineMarkdown(entries);
    // should have two ### hour headers
    const headers = result.split("\n").filter((l) => l.startsWith("### "));
    assert.equal(headers.length, 2);
  });

  it("shows success icon for actions", () => {
    const entries: TimelineEntry[] = [
      { ts: 1700000000000, source: "action", tag: "send_input", text: "ok", success: true, session: "s1" },
      { ts: 1700000001000, source: "action", tag: "start_session", text: "failed", success: false, session: "s2" },
    ];
    const result = formatTimelineMarkdown(entries);
    const lines = result.split("\n").filter((l) => l.startsWith("- "));
    assert.ok(lines[0].includes("+"), "success should show +");
    assert.ok(lines[1].includes("!"), "failure should show !");
  });

  it("shows session arrow for action entries", () => {
    const entries: TimelineEntry[] = [{
      ts: 1700000000000, source: "action", tag: "send_input", text: "detail", success: true, session: "adventure",
    }];
    const result = formatTimelineMarkdown(entries);
    assert.ok(result.includes("→ adventure"));
  });

  it("truncates long text to 120 chars", () => {
    const longText = "x".repeat(200);
    const entries: TimelineEntry[] = [{
      ts: 1700000000000, source: "activity", tag: "system", text: longText,
    }];
    const result = formatTimelineMarkdown(entries);
    const entryLine = result.split("\n").find((l) => l.startsWith("- "));
    assert.ok(entryLine);
    assert.ok(entryLine!.includes("..."));
  });
});
