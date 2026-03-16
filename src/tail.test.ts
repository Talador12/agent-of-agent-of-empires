import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { formatTailEntry, formatTailDate, loadTailEntries, getFileSize, readNewEntries } from "./tail.js";
import type { HistoryEntry } from "./tui-history.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "aoaoe-tail-test-"));
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

// ── formatTailEntry ───────────────────────────────────────────────────────────

describe("formatTailEntry", () => {
  it("formats observation entries with 'obs' prefix", () => {
    const entry = makeEntry({ tag: "observation", text: "3 sessions, 1 changed" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("obs"));
    assert.ok(result.includes("3 sessions, 1 changed"));
  });

  it("formats reasoner entries with SKY color", () => {
    const entry = makeEntry({ tag: "reasoner", text: "decided: wait" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("reasoner"));
    assert.ok(result.includes("decided: wait"));
  });

  it("formats explain entries with AI prefix", () => {
    const entry = makeEntry({ tag: "explain", text: "everything looks good" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("AI"));
    assert.ok(result.includes("everything looks good"));
  });

  it("formats action entries with arrow prefix", () => {
    const entry = makeEntry({ tag: "+ action", text: "sent input to agent-1" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("→ action"));
    assert.ok(result.includes("sent input to agent-1"));
  });

  it("formats error entries with cross mark prefix", () => {
    const entry = makeEntry({ tag: "! action", text: "session not found" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("✗ error"));
    assert.ok(result.includes("session not found"));
  });

  it("formats user entries with 'you' tag", () => {
    const entry = makeEntry({ tag: "you", text: "hello AI" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("you"));
    assert.ok(result.includes("hello AI"));
  });

  it("formats system entries with system tag", () => {
    const entry = makeEntry({ tag: "system", text: "entering main loop" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("system"));
    assert.ok(result.includes("entering main loop"));
  });

  it("includes the time field in output", () => {
    const entry = makeEntry({ time: "09:15:30", text: "test" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("09:15:30"));
  });

  it("includes pipe separator", () => {
    const entry = makeEntry();
    const result = formatTailEntry(entry);
    assert.ok(result.includes("│"));
  });

  it("handles unknown tags with default color", () => {
    const entry = makeEntry({ tag: "custom-tag", text: "custom" });
    const result = formatTailEntry(entry);
    assert.ok(result.includes("custom-tag"));
    assert.ok(result.includes("custom"));
  });
});

// ── formatTailDate ────────────────────────────────────────────────────────────

describe("formatTailDate", () => {
  it("formats a timestamp as YYYY-MM-DD", () => {
    // 2025-06-15T12:00:00Z
    const ts = new Date("2025-06-15T12:00:00Z").getTime();
    const result = formatTailDate(ts);
    assert.ok(result.includes("2025"));
    assert.ok(result.includes("06") || result.includes("6"));
    assert.ok(result.includes("15"));
  });

  it("zero-pads single-digit months", () => {
    // use noon UTC to avoid timezone-crossing issues
    const ts = new Date("2025-01-05T12:00:00Z").getTime();
    const result = formatTailDate(ts);
    assert.ok(result.includes("01"));
  });

  it("zero-pads single-digit days", () => {
    // use noon UTC to avoid timezone-crossing issues
    const ts = new Date("2025-12-03T12:00:00Z").getTime();
    const result = formatTailDate(ts);
    assert.ok(result.includes("03"));
  });
});

// ── loadTailEntries ───────────────────────────────────────────────────────────

describe("loadTailEntries", () => {
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
    const entries = loadTailEntries(10, filePath);
    assert.deepStrictEqual(entries, []);
  });

  it("returns empty array for empty file", () => {
    writeFileSync(filePath, "");
    const entries = loadTailEntries(10, filePath);
    assert.deepStrictEqual(entries, []);
  });

  it("loads entries from JSONL file", () => {
    const e1 = makeEntry({ ts: 1000, text: "first" });
    const e2 = makeEntry({ ts: 2000, text: "second" });
    writeFileSync(filePath, JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n");
    const entries = loadTailEntries(10, filePath);
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].text, "first");
    assert.strictEqual(entries[1].text, "second");
  });

  it("respects count limit (returns last N)", () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) {
      lines.push(JSON.stringify(makeEntry({ ts: i * 1000, text: `msg-${i}` })));
    }
    writeFileSync(filePath, lines.join("\n") + "\n");
    const entries = loadTailEntries(3, filePath);
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(entries[0].text, "msg-7");
    assert.strictEqual(entries[1].text, "msg-8");
    assert.strictEqual(entries[2].text, "msg-9");
  });

  it("skips malformed JSON lines", () => {
    const good = makeEntry({ text: "valid" });
    writeFileSync(filePath, "not json\n" + JSON.stringify(good) + "\n{bad}\n");
    const entries = loadTailEntries(10, filePath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "valid");
  });

  it("skips entries with missing required fields", () => {
    const good = makeEntry({ text: "complete" });
    const bad = { ts: 1000, time: "12:00:00" }; // missing tag and text
    writeFileSync(filePath, JSON.stringify(bad) + "\n" + JSON.stringify(good) + "\n");
    const entries = loadTailEntries(10, filePath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "complete");
  });
});

// ── getFileSize ───────────────────────────────────────────────────────────────

describe("getFileSize", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  it("returns 0 for missing file", () => {
    assert.strictEqual(getFileSize(join(dir, "nonexistent")), 0);
  });

  it("returns correct size for existing file", () => {
    const filePath = join(dir, "test.txt");
    writeFileSync(filePath, "hello world");
    assert.strictEqual(getFileSize(filePath), 11);
  });

  it("returns 0 for empty file", () => {
    const filePath = join(dir, "empty.txt");
    writeFileSync(filePath, "");
    assert.strictEqual(getFileSize(filePath), 0);
  });
});

// ── readNewEntries ────────────────────────────────────────────────────────────

describe("readNewEntries", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "history.jsonl");
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true }); } catch {}
  });

  it("returns empty when file hasn't grown", () => {
    const entry = makeEntry({ text: "initial" });
    writeFileSync(filePath, JSON.stringify(entry) + "\n");
    const size = readFileSync(filePath).length;
    const { entries, newSize } = readNewEntries(filePath, size);
    assert.strictEqual(entries.length, 0);
    assert.strictEqual(newSize, size);
  });

  it("reads new entries appended after offset", () => {
    const e1 = makeEntry({ text: "old" });
    writeFileSync(filePath, JSON.stringify(e1) + "\n");
    const initialSize = readFileSync(filePath).length;

    const e2 = makeEntry({ text: "new-entry" });
    appendFileSync(filePath, JSON.stringify(e2) + "\n");

    const { entries, newSize } = readNewEntries(filePath, initialSize);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "new-entry");
    assert.ok(newSize > initialSize);
  });

  it("reads from start when file was truncated/rotated", () => {
    const e1 = makeEntry({ text: "after-rotation" });
    writeFileSync(filePath, JSON.stringify(e1) + "\n");
    // pretend the old file was larger
    const { entries, newSize } = readNewEntries(filePath, 999999);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "after-rotation");
    assert.ok(newSize > 0);
  });

  it("returns empty for missing file", () => {
    const { entries, newSize } = readNewEntries(join(dir, "gone.jsonl"), 0);
    assert.strictEqual(entries.length, 0);
    assert.strictEqual(newSize, 0);
  });

  it("skips malformed lines in new content", () => {
    writeFileSync(filePath, "");
    const good = makeEntry({ text: "valid-new" });
    appendFileSync(filePath, "broken json\n" + JSON.stringify(good) + "\n");
    const { entries } = readNewEntries(filePath, 0);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].text, "valid-new");
  });
});

// ── parseCliArgs tail subcommand ──────────────────────────────────────────────

describe("parseCliArgs tail subcommand", () => {
  // import parseCliArgs for CLI argument testing
  let parseCliArgs: (argv: string[]) => Record<string, unknown>;

  beforeEach(async () => {
    const mod = await import("./config.js");
    parseCliArgs = mod.parseCliArgs as (argv: string[]) => Record<string, unknown>;
  });

  it("parses 'tail' subcommand with defaults", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailFollow, false);
    assert.strictEqual(result.tailCount, undefined);
  });

  it("parses 'tail -f' for follow mode", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "-f"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailFollow, true);
  });

  it("parses 'tail --follow' for follow mode", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "--follow"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailFollow, true);
  });

  it("parses 'tail -n 100' for count", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "-n", "100"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailCount, 100);
  });

  it("parses 'tail --count 25' for count", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "--count", "25"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailCount, 25);
  });

  it("parses 'tail -f -n 200' with both flags", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "-f", "-n", "200"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailFollow, true);
    assert.strictEqual(result.tailCount, 200);
  });

  it("ignores invalid count values", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "-n", "abc"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailCount, undefined);
  });

  it("ignores zero count", () => {
    const result = parseCliArgs(["node", "aoaoe", "tail", "-n", "0"]);
    assert.strictEqual(result.runTail, true);
    assert.strictEqual(result.tailCount, undefined);
  });

  it("returns runTail=false for non-tail subcommands", () => {
    const result = parseCliArgs(["node", "aoaoe", "--verbose"]);
    assert.strictEqual(result.runTail, false);
  });
});
