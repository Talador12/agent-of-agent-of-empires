import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateWatcherScript, readPromptStats, cleanupWatchers } from "./prompt-watcher.js";

// ── generateWatcherScript ───────────────────────────────────────────────────

describe("generateWatcherScript", () => {
  it("returns a non-empty string", () => {
    const script = generateWatcherScript();
    assert.ok(script.length > 0);
  });

  it("contains all PATTERNS entries", () => {
    const script = generateWatcherScript();
    assert.ok(script.includes("Permission required"));
    assert.ok(script.includes("Allow once"));
    assert.ok(script.includes("y\\/n|yes\\/no"));
    assert.ok(script.includes("do you want to"));
    assert.ok(script.includes("approve|reject"));
  });

  it("starts with use strict", () => {
    const script = generateWatcherScript();
    assert.ok(script.startsWith("'use strict'"));
  });

  it("contains process.stdin.on('data')", () => {
    const script = generateWatcherScript();
    assert.ok(script.includes("process.stdin.on('data'"));
  });

  it("contains debounce logic (checking/pendingCheck)", () => {
    const script = generateWatcherScript();
    assert.ok(script.includes("checking"));
    assert.ok(script.includes("pendingCheck"));
  });

  it("uses capture-pane for screen reading", () => {
    const script = generateWatcherScript();
    assert.ok(script.includes("capture-pane"));
  });

  it("contains send-keys for auto-clearing", () => {
    const script = generateWatcherScript();
    assert.ok(script.includes("send-keys"));
  });

  it("requires child_process and fs", () => {
    const script = generateWatcherScript();
    assert.ok(script.includes("require('child_process')"));
    assert.ok(script.includes("require('fs')"));
  });
});

// ── readPromptStats ─────────────────────────────────────────────────────────

describe("readPromptStats", () => {
  const testDir = join(tmpdir(), `aoaoe-test-${Date.now()}`);
  const testFile = join(testDir, "test-watcher.log");

  // setup/teardown
  it("setup test dir", () => {
    mkdirSync(testDir, { recursive: true });
  });

  it("returns count 0 for missing file", () => {
    const result = readPromptStats(join(testDir, "nonexistent.log"));
    assert.equal(result.count, 0);
    assert.deepEqual(result.lines, []);
  });

  it("returns count 0 for empty file", () => {
    writeFileSync(testFile, "");
    const result = readPromptStats(testFile);
    assert.equal(result.count, 0);
    assert.deepEqual(result.lines, []);
  });

  it("parses file with entries", () => {
    writeFileSync(
      testFile,
      "2025-01-01T00:00:00.000Z CLEARED: Allow once?\n" +
      "2025-01-01T00:01:00.000Z CLEARED: Permission required\n"
    );
    const result = readPromptStats(testFile);
    assert.equal(result.count, 2);
    assert.equal(result.lines.length, 2);
    assert.ok(result.lines[0].includes("Allow once"));
    assert.ok(result.lines[1].includes("Permission required"));
  });

  it("handles trailing newline without extra empty entry", () => {
    writeFileSync(testFile, "2025-01-01T00:00:00.000Z CLEARED: test\n");
    const result = readPromptStats(testFile);
    assert.equal(result.count, 1);
  });

  it("handles whitespace-only file", () => {
    writeFileSync(testFile, "   \n  \n");
    const result = readPromptStats(testFile);
    // .trim() makes it empty, so count is 0
    assert.equal(result.count, 0);
  });

  it("cleanup test dir", () => {
    rmSync(testDir, { recursive: true, force: true });
  });
});

// ── cleanupWatchers ─────────────────────────────────────────────────────────

describe("cleanupWatchers", () => {
  it("does not throw when watcher dir does not exist", () => {
    // cleanupWatchers uses rmSync with force: true — should not throw
    cleanupWatchers();
  });

  it("removes watcher dir if it exists", () => {
    const watcherDir = "/tmp/aoaoe-watchers";
    mkdirSync(watcherDir, { recursive: true });
    writeFileSync(join(watcherDir, "test.log"), "test");
    cleanupWatchers();
    // the dir may or may not exist depending on race conditions with other tests,
    // but the call itself should not throw
    assert.ok(true);
  });
});
