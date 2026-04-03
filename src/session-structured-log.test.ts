import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseLine, parseOutputLines, filterRecognized, eventTypeCounts, formatStructuredLog } from "./session-structured-log.js";

describe("parseLine", () => {
  it("detects test pass results", () => {
    const e = parseLine("alpha", "42 tests passed");
    assert.equal(e.type, "test-result");
    assert.equal(e.parsed.passed, 42);
  });

  it("detects test fail results", () => {
    const e = parseLine("alpha", "3 tests failed");
    assert.equal(e.type, "test-result");
    assert.equal(e.parsed.failed, 3);
  });

  it("detects build success", () => {
    const e = parseLine("alpha", "Build succeeded");
    assert.equal(e.type, "build-result");
    assert.equal(e.parsed.status, "pass");
  });

  it("detects build failure", () => {
    const e = parseLine("alpha", "Build failed with errors");
    assert.equal(e.type, "build-result");
    assert.equal(e.parsed.status, "fail");
  });

  it("detects git operations", () => {
    const e = parseLine("alpha", "commit abc123: fix auth bug");
    assert.equal(e.type, "git-operation");
  });

  it("detects errors", () => {
    const e = parseLine("alpha", "ERROR: compilation failed");
    assert.equal(e.type, "error");
    assert.equal(e.parsed.level, "ERROR");
  });

  it("detects cost updates", () => {
    const e = parseLine("alpha", "Total cost: $12.50");
    assert.equal(e.type, "cost-update");
    assert.equal(e.parsed.costUsd, 12.5);
  });

  it("detects progress steps", () => {
    const e = parseLine("alpha", "Step 3: configure database");
    assert.equal(e.type, "progress");
    assert.equal(e.parsed.step, 3);
  });

  it("detects prompts", () => {
    const e = parseLine("alpha", "? Allow access to filesystem");
    assert.equal(e.type, "prompt");
  });

  it("returns unknown for unrecognized lines", () => {
    const e = parseLine("alpha", "just some random text");
    assert.equal(e.type, "unknown");
  });

  it("strips ANSI codes", () => {
    const e = parseLine("alpha", "\x1b[31mERROR: bad\x1b[0m");
    assert.equal(e.type, "error");
    assert.ok(!e.rawLine.includes("\x1b"));
  });
});

describe("parseOutputLines", () => {
  it("parses multiple lines", () => {
    const entries = parseOutputLines("alpha", ["42 tests passed", "Build succeeded", "random"]);
    assert.equal(entries.length, 3);
  });
});

describe("filterRecognized", () => {
  it("removes unknown entries", () => {
    const entries = parseOutputLines("a", ["42 tests passed", "random text"]);
    assert.equal(filterRecognized(entries).length, 1);
  });
});

describe("eventTypeCounts", () => {
  it("counts by type", () => {
    const entries = parseOutputLines("a", ["42 tests passed", "Build succeeded", "ERROR: bad"]);
    const counts = eventTypeCounts(entries);
    assert.equal(counts.get("test-result"), 1);
    assert.equal(counts.get("build-result"), 1);
    assert.equal(counts.get("error"), 1);
  });
});

describe("formatStructuredLog", () => {
  it("shows no-patterns message for unrecognized output", () => {
    const entries = parseOutputLines("a", ["random line"]);
    const lines = formatStructuredLog(entries);
    assert.ok(lines[0].includes("no recognized"));
  });

  it("shows recognized events", () => {
    const entries = parseOutputLines("a", ["42 tests passed", "Build succeeded"]);
    const lines = formatStructuredLog(entries);
    assert.ok(lines[0].includes("Structured Log"));
    assert.ok(lines.some((l) => l.includes("test-result")));
  });
});
