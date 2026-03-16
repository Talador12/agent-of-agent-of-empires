import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeDelay, formatSpeed, parseSpeed, filterByWindow,
  formatReplayHeader, formatReplayFooter, loadReplayEntries,
} from "./replay.js";
import type { HistoryEntry } from "./tui-history.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "aoaoe-replay-test-"));
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

// ── computeDelay ──────────────────────────────────────────────────────────────

describe("computeDelay", () => {
  it("returns 0 when speed is 0 (instant mode)", () => {
    assert.strictEqual(computeDelay(1000, 5000, 0), 0);
  });

  it("returns 0 when speed is negative", () => {
    assert.strictEqual(computeDelay(1000, 5000, -1), 0);
  });

  it("returns 0 when timestamps are equal", () => {
    assert.strictEqual(computeDelay(5000, 5000, 5), 0);
  });

  it("returns 0 when current timestamp is before previous", () => {
    assert.strictEqual(computeDelay(5000, 3000, 5), 0);
  });

  it("returns scaled delay at 1x speed", () => {
    // 4000ms gap at 1x = 4000ms (but capped at 3000ms)
    assert.strictEqual(computeDelay(1000, 5000, 1), 3000);
  });

  it("returns scaled delay at 5x speed", () => {
    // 5000ms gap at 5x = 1000ms
    assert.strictEqual(computeDelay(1000, 6000, 5), 1000);
  });

  it("returns scaled delay at 10x speed", () => {
    // 10000ms gap at 10x = 1000ms
    assert.strictEqual(computeDelay(0, 10_000, 10), 1000);
  });

  it("caps delay at maxDelayMs", () => {
    // 60s gap at 1x = 60000ms, capped at 3000ms (default)
    assert.strictEqual(computeDelay(0, 60_000, 1), 3000);
  });

  it("respects custom maxDelayMs", () => {
    // 10s gap at 1x = 10000ms, custom cap at 5000ms
    assert.strictEqual(computeDelay(0, 10_000, 1, 5000), 5000);
  });

  it("returns exact delay when under cap", () => {
    // 1000ms gap at 5x = 200ms
    assert.strictEqual(computeDelay(0, 1000, 5), 200);
  });
});

// ── formatSpeed ───────────────────────────────────────────────────────────────

describe("formatSpeed", () => {
  it("returns 'instant' for speed 0", () => {
    assert.strictEqual(formatSpeed(0), "instant");
  });

  it("returns 'instant' for negative speed", () => {
    assert.strictEqual(formatSpeed(-1), "instant");
  });

  it("returns '1x (realtime)' for speed 1", () => {
    assert.strictEqual(formatSpeed(1), "1x (realtime)");
  });

  it("returns integer format for whole numbers", () => {
    assert.strictEqual(formatSpeed(5), "5x");
    assert.strictEqual(formatSpeed(10), "10x");
  });

  it("returns decimal format for fractional speeds", () => {
    assert.strictEqual(formatSpeed(0.5), "0.5x");
    assert.strictEqual(formatSpeed(2.5), "2.5x");
  });
});

// ── parseSpeed ────────────────────────────────────────────────────────────────

describe("parseSpeed", () => {
  it("returns 0 for 'instant'", () => {
    assert.strictEqual(parseSpeed("instant"), 0);
  });

  it("returns 0 for '0'", () => {
    assert.strictEqual(parseSpeed("0"), 0);
  });

  it("parses integer without x suffix", () => {
    assert.strictEqual(parseSpeed("5"), 5);
  });

  it("parses integer with x suffix", () => {
    assert.strictEqual(parseSpeed("5x"), 5);
  });

  it("parses decimal without x suffix", () => {
    assert.strictEqual(parseSpeed("0.5"), 0.5);
  });

  it("parses decimal with x suffix", () => {
    assert.strictEqual(parseSpeed("2.5x"), 2.5);
  });

  it("returns null for empty string", () => {
    assert.strictEqual(parseSpeed(""), null);
  });

  it("returns null for non-numeric string", () => {
    assert.strictEqual(parseSpeed("fast"), null);
  });

  it("returns null for negative value", () => {
    assert.strictEqual(parseSpeed("-5"), null);
  });
});

// ── filterByWindow ────────────────────────────────────────────────────────────

describe("filterByWindow", () => {
  it("returns all entries when maxAgeMs is undefined", () => {
    const entries = [makeEntry({ ts: 1000 }), makeEntry({ ts: 2000 })];
    const result = filterByWindow(entries);
    assert.strictEqual(result.length, 2);
  });

  it("returns all entries when maxAgeMs is 0", () => {
    const entries = [makeEntry({ ts: 1000 }), makeEntry({ ts: 2000 })];
    const result = filterByWindow(entries, 0);
    assert.strictEqual(result.length, 2);
  });

  it("filters entries older than maxAgeMs", () => {
    const now = 100_000;
    const entries = [
      makeEntry({ ts: 10_000 }),  // old
      makeEntry({ ts: 90_000 }),  // recent
      makeEntry({ ts: 95_000 }),  // recent
    ];
    const result = filterByWindow(entries, 20_000, now);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].ts, 90_000);
    assert.strictEqual(result[1].ts, 95_000);
  });

  it("returns empty when all entries are too old", () => {
    const now = 100_000;
    const entries = [
      makeEntry({ ts: 10_000 }),
      makeEntry({ ts: 20_000 }),
    ];
    const result = filterByWindow(entries, 5_000, now);
    assert.strictEqual(result.length, 0);
  });

  it("uses Date.now() when now is not provided", () => {
    const entries = [makeEntry({ ts: Date.now() - 1000 })];
    const result = filterByWindow(entries, 60_000);
    assert.strictEqual(result.length, 1);
  });
});

// ── formatReplayHeader ────────────────────────────────────────────────────────

describe("formatReplayHeader", () => {
  it("returns 'no entries' message for empty array", () => {
    const result = formatReplayHeader([], 5);
    assert.ok(result.includes("no entries"));
  });

  it("includes entry count", () => {
    const entries = [
      makeEntry({ ts: 1000 }),
      makeEntry({ ts: 5000 }),
    ];
    const result = formatReplayHeader(entries, 5);
    assert.ok(result.includes("2 entries"));
  });

  it("includes speed display", () => {
    const entries = [
      makeEntry({ ts: 1000 }),
      makeEntry({ ts: 5000 }),
    ];
    const result = formatReplayHeader(entries, 5);
    assert.ok(result.includes("5x"));
  });

  it("includes 'instant' for speed 0", () => {
    const entries = [
      makeEntry({ ts: 1000 }),
      makeEntry({ ts: 5000 }),
    ];
    const result = formatReplayHeader(entries, 0);
    assert.ok(result.includes("instant"));
  });

  it("includes window label when provided", () => {
    const entries = [
      makeEntry({ ts: 1000 }),
      makeEntry({ ts: 5000 }),
    ];
    const result = formatReplayHeader(entries, 5, "last 1h");
    assert.ok(result.includes("last 1h"));
  });

  it("shows time span in seconds for short spans", () => {
    const entries = [
      makeEntry({ ts: 1000 }),
      makeEntry({ ts: 31_000 }),
    ];
    const result = formatReplayHeader(entries, 5);
    assert.ok(result.includes("30s"));
  });

  it("shows time span in minutes for medium spans", () => {
    const entries = [
      makeEntry({ ts: 0 }),
      makeEntry({ ts: 120_000 }),
    ];
    const result = formatReplayHeader(entries, 5);
    assert.ok(result.includes("2m"));
  });

  it("shows time span in hours for long spans", () => {
    const entries = [
      makeEntry({ ts: 0 }),
      makeEntry({ ts: 5_400_000 }),
    ];
    const result = formatReplayHeader(entries, 5);
    assert.ok(result.includes("1h"));
  });
});

// ── formatReplayFooter ────────────────────────────────────────────────────────

describe("formatReplayFooter", () => {
  it("returns empty string for empty array", () => {
    assert.strictEqual(formatReplayFooter([]), "");
  });

  it("includes entry count", () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()];
    const result = formatReplayFooter(entries);
    assert.ok(result.includes("3 entries"));
  });

  it("includes 'replay complete' text", () => {
    const entries = [makeEntry()];
    const result = formatReplayFooter(entries);
    assert.ok(result.includes("replay complete"));
  });
});

// ── loadReplayEntries ─────────────────────────────────────────────────────────

describe("loadReplayEntries", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "history.jsonl");
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  it("returns empty array for missing file", () => {
    const entries = loadReplayEntries(undefined, join(dir, "nonexistent.jsonl"));
    assert.deepStrictEqual(entries, []);
  });

  it("returns empty array for empty file", () => {
    writeFileSync(filePath, "");
    const entries = loadReplayEntries(undefined, filePath);
    assert.deepStrictEqual(entries, []);
  });

  it("loads all entries from JSONL file", () => {
    const e1 = makeEntry({ ts: 1000, text: "first" });
    const e2 = makeEntry({ ts: 2000, text: "second" });
    writeFileSync(filePath, JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n");
    const entries = loadReplayEntries(undefined, filePath);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].text, "first");
    assert.strictEqual(entries[1].text, "second");
  });

  it("skips malformed JSON lines", () => {
    const good = makeEntry({ text: "valid" });
    writeFileSync(filePath, "not json\n" + JSON.stringify(good) + "\n{bad}\n");
    const entries = loadReplayEntries(undefined, filePath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "valid");
  });

  it("skips entries missing required fields", () => {
    const good = makeEntry({ text: "complete" });
    const bad = { ts: 1000, time: "12:00:00" }; // missing tag and text
    writeFileSync(filePath, JSON.stringify(bad) + "\n" + JSON.stringify(good) + "\n");
    const entries = loadReplayEntries(undefined, filePath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "complete");
  });

  it("filters by maxAgeMs when provided", () => {
    const now = Date.now();
    const old = makeEntry({ ts: now - 60_000, text: "old" });
    const recent = makeEntry({ ts: now - 5_000, text: "recent" });
    writeFileSync(filePath, JSON.stringify(old) + "\n" + JSON.stringify(recent) + "\n");
    const entries = loadReplayEntries(10_000, filePath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "recent");
  });

  it("returns all entries when maxAgeMs is undefined", () => {
    const e1 = makeEntry({ ts: 1000, text: "ancient" });
    const e2 = makeEntry({ ts: Date.now(), text: "now" });
    writeFileSync(filePath, JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n");
    const entries = loadReplayEntries(undefined, filePath);
    assert.strictEqual(entries.length, 2);
  });
});

// ── parseCliArgs replay subcommand ────────────────────────────────────────────

describe("parseCliArgs replay subcommand", () => {
  let parseCliArgs: (argv: string[]) => Record<string, unknown>;

  beforeEach(async () => {
    const mod = await import("./config.js");
    parseCliArgs = mod.parseCliArgs as (argv: string[]) => Record<string, unknown>;
  });

  it("parses 'replay' subcommand with defaults", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, undefined);
    assert.strictEqual(result.replayLast, undefined);
  });

  it("parses 'replay --speed 10'", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--speed", "10"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, 10);
  });

  it("parses 'replay -s 0.5'", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "-s", "0.5"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, 0.5);
  });

  it("parses 'replay --instant'", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--instant"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, 0);
  });

  it("parses 'replay --last 1h'", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--last", "1h"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replayLast, "1h");
  });

  it("parses 'replay -l 24h'", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "-l", "24h"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replayLast, "24h");
  });

  it("parses 'replay --speed 10 --last 6h' with both flags", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--speed", "10", "--last", "6h"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, 10);
    assert.strictEqual(result.replayLast, "6h");
  });

  it("parses 'replay --instant --last 1h' combined", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--instant", "--last", "1h"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, 0);
    assert.strictEqual(result.replayLast, "1h");
  });

  it("ignores invalid speed values", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--speed", "abc"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, undefined);
  });

  it("ignores negative speed values", () => {
    const result = parseCliArgs(["node", "aoaoe", "replay", "--speed", "-5"]);
    assert.strictEqual(result.runReplay, true);
    assert.strictEqual(result.replaySpeed, undefined);
  });

  it("returns runReplay=false for non-replay subcommands", () => {
    const result = parseCliArgs(["node", "aoaoe", "--verbose"]);
    assert.strictEqual(result.runReplay, false);
  });
});
