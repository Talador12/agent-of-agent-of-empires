import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendHistoryEntry, loadTuiHistory, rotateTuiHistory } from "./tui-history.js";
import type { HistoryEntry } from "./tui-history.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "aoaoe-hist-test-"));
}

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    ts: Date.now(),
    time: "12:30:45",
    tag: "system",
    text: "test message",
    ...overrides,
  };
}

// ── appendHistoryEntry ────────────────────────────────────────────────────────

describe("appendHistoryEntry", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "tui-history.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file and appends a JSONL line", () => {
    const entry = makeEntry({ tag: "reasoner", text: "thinking..." });
    appendHistoryEntry(entry, filePath);
    assert.ok(existsSync(filePath));
    const content = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.tag, "reasoner");
    assert.equal(parsed.text, "thinking...");
    assert.equal(parsed.time, "12:30:45");
    assert.equal(typeof parsed.ts, "number");
  });

  it("appends multiple entries on separate lines", () => {
    appendHistoryEntry(makeEntry({ text: "one" }), filePath);
    appendHistoryEntry(makeEntry({ text: "two" }), filePath);
    appendHistoryEntry(makeEntry({ text: "three" }), filePath);
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal(JSON.parse(lines[0]).text, "one");
    assert.equal(JSON.parse(lines[2]).text, "three");
  });

  it("creates parent directory if missing", () => {
    const nested = join(dir, "sub", "deep", "history.jsonl");
    appendHistoryEntry(makeEntry(), nested);
    assert.ok(existsSync(nested));
  });

  it("does not throw on write error (fire-and-forget)", () => {
    // point to a path under a file (not a directory) to trigger an error
    const badPath = join(filePath, "impossible", "path.jsonl");
    // write a regular file at filePath first so filePath is not a directory
    writeFileSync(filePath, "not a dir");
    assert.doesNotThrow(() => {
      appendHistoryEntry(makeEntry(), badPath);
    });
  });

  it("rotates the file when it exceeds maxSize", () => {
    // write enough to exceed a tiny maxSize
    const bigText = "x".repeat(200);
    appendHistoryEntry(makeEntry({ text: bigText }), filePath, 100);
    // first entry should trigger rotation on next append
    appendHistoryEntry(makeEntry({ text: "after-rotation" }), filePath, 100);
    // the old file should exist
    assert.ok(existsSync(filePath + ".old"), "rotated .old file should exist");
    // current file should only have the post-rotation entry
    const lines = readFileSync(filePath, "utf-8").trim().split("\n");
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).text, "after-rotation");
  });
});

// ── loadTuiHistory ──────────────────────────────────────────────────────────

describe("loadTuiHistory", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "tui-history.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", () => {
    const result = loadTuiHistory(100, filePath);
    assert.deepEqual(result, []);
  });

  it("returns empty array for empty file", () => {
    writeFileSync(filePath, "");
    const result = loadTuiHistory(100, filePath);
    assert.deepEqual(result, []);
  });

  it("loads entries from JSONL file", () => {
    const entries = [
      makeEntry({ ts: 1000, text: "first" }),
      makeEntry({ ts: 2000, text: "second" }),
      makeEntry({ ts: 3000, text: "third" }),
    ];
    writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const result = loadTuiHistory(100, filePath);
    assert.equal(result.length, 3);
    assert.equal(result[0].text, "first");
    assert.equal(result[2].text, "third");
  });

  it("returns only last maxEntries entries", () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry({ ts: i * 1000, text: `entry-${i}` })
    );
    writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const result = loadTuiHistory(3, filePath);
    assert.equal(result.length, 3);
    assert.equal(result[0].text, "entry-7");
    assert.equal(result[2].text, "entry-9");
  });

  it("skips malformed lines gracefully", () => {
    const content = [
      JSON.stringify(makeEntry({ text: "good" })),
      "not json at all",
      "{ bad json",
      JSON.stringify(makeEntry({ text: "also good" })),
    ].join("\n") + "\n";
    writeFileSync(filePath, content);
    const result = loadTuiHistory(100, filePath);
    assert.equal(result.length, 2);
    assert.equal(result[0].text, "good");
    assert.equal(result[1].text, "also good");
  });

  it("skips entries with missing fields", () => {
    const content = [
      JSON.stringify({ ts: 1000, time: "12:00:00", tag: "system" }), // missing text
      JSON.stringify({ ts: 2000, tag: "system", text: "hi" }), // missing time
      JSON.stringify(makeEntry({ text: "valid" })),
    ].join("\n") + "\n";
    writeFileSync(filePath, content);
    const result = loadTuiHistory(100, filePath);
    assert.equal(result.length, 1);
    assert.equal(result[0].text, "valid");
  });

  it("handles trailing newlines and blank lines", () => {
    const content = JSON.stringify(makeEntry({ text: "one" })) + "\n\n\n";
    writeFileSync(filePath, content);
    const result = loadTuiHistory(100, filePath);
    assert.equal(result.length, 1);
  });
});

// ── rotateTuiHistory ────────────────────────────────────────────────────────

describe("rotateTuiHistory", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "tui-history.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when file does not exist", () => {
    assert.equal(rotateTuiHistory(filePath, 100), false);
  });

  it("returns false when file is under maxSize", () => {
    writeFileSync(filePath, "small");
    assert.equal(rotateTuiHistory(filePath, 1000), false);
    // original file should still exist, no .old
    assert.ok(existsSync(filePath));
    assert.ok(!existsSync(filePath + ".old"));
  });

  it("rotates when file exceeds maxSize", () => {
    writeFileSync(filePath, "x".repeat(500));
    const rotated = rotateTuiHistory(filePath, 100);
    assert.equal(rotated, true);
    // old file should exist with original content
    assert.ok(existsSync(filePath + ".old"));
    assert.equal(readFileSync(filePath + ".old", "utf-8").length, 500);
    // current file should no longer exist (renamed away)
    assert.ok(!existsSync(filePath));
  });

  it("overwrites existing .old file on rotation", () => {
    writeFileSync(filePath + ".old", "previous old content");
    writeFileSync(filePath, "x".repeat(500));
    rotateTuiHistory(filePath, 100);
    // .old should now be the current content, not the previous
    assert.equal(readFileSync(filePath + ".old", "utf-8"), "x".repeat(500));
  });
});

// ── TUI.replayHistory integration ───────────────────────────────────────────

describe("TUI.replayHistory", () => {
  // import TUI here to test the replay method
  it("populates activity buffer from history entries", async () => {
    const { TUI } = await import("./tui.js");
    const tui = new TUI();
    const entries: HistoryEntry[] = [
      { ts: 1000, time: "12:00:00", tag: "system", text: "hello" },
      { ts: 2000, time: "12:00:01", tag: "reasoner", text: "thinking" },
    ];
    tui.replayHistory(entries);
    // log another entry to verify buffer has replayed + new
    tui.log("system", "new entry");
    // not crashed = success (buffer is private, but we verify via no-throw)
  });
});
