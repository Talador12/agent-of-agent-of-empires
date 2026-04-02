import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { compressObservation, summarizeLines, estimateTokens, compressToTokenBudget, formatCompressionStats } from "./context-compressor.js";

describe("compressObservation", () => {
  it("returns uncompressed for short output", () => {
    const lines = ["line 1", "line 2", "line 3"];
    const result = compressObservation(lines, 10);
    assert.equal(result.compressionRatio, 1);
    assert.equal(result.originalLineCount, 3);
  });

  it("compresses long output keeping recent lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const result = compressObservation(lines, 20, 5);
    assert.ok(result.compressedLineCount < 100);
    // recent 20 lines should be intact
    assert.ok(result.text.includes("line 99"));
    assert.ok(result.text.includes("line 80"));
    // should have compression marker
    assert.ok(result.text.includes("compressed"));
  });

  it("includes summary of old lines", () => {
    const lines = [
      "error: module not found",
      "Edit src/index.ts",
      "random noise line",
      ...Array.from({ length: 30 }, (_, i) => `recent ${i}`),
    ];
    const result = compressObservation(lines, 25, 5);
    // error should be in summary (high priority)
    assert.ok(result.text.includes("error"));
  });
});

describe("summarizeLines", () => {
  it("prioritizes error lines", () => {
    const lines = ["normal line", "error: bad thing happened", "another line"];
    const summary = summarizeLines(lines, 1);
    assert.ok(summary[0].includes("error"));
  });

  it("prioritizes git operations", () => {
    const lines = ["random", "[main abc1234] feat: something", "noise"];
    const summary = summarizeLines(lines, 1);
    assert.ok(summary[0].includes("abc1234"));
  });

  it("respects maxLines limit", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `error: problem ${i}`);
    const summary = summarizeLines(lines, 5);
    assert.equal(summary.length, 5);
  });

  it("skips box-drawing characters", () => {
    const lines = ["├──────┤", "│ content │", "error: real issue"];
    const summary = summarizeLines(lines, 10);
    assert.ok(!summary.some((l) => l.includes("├──────┤")));
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(summarizeLines([], 5), []);
  });
});

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    assert.equal(estimateTokens("abcd"), 1);
    assert.equal(estimateTokens("abcdefgh"), 2);
  });

  it("returns 0 for empty string", () => {
    assert.equal(estimateTokens(""), 0);
  });
});

describe("compressToTokenBudget", () => {
  it("compresses progressively to fit budget", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i} with some content here padding`);
    const result = compressToTokenBudget(lines, 500); // very tight budget
    assert.ok(estimateTokens(result.text) <= 500 || result.compressedLineCount <= 20);
  });

  it("returns uncompressed when budget is ample", () => {
    const lines = ["short", "text"];
    const result = compressToTokenBudget(lines, 100_000);
    assert.equal(result.compressionRatio, 1);
  });
});

describe("formatCompressionStats", () => {
  it("includes line counts and ratio", () => {
    const stats = compressObservation(Array.from({ length: 50 }, (_, i) => `line ${i}`), 10);
    const formatted = formatCompressionStats(stats);
    assert.ok(formatted.includes("50"));
    assert.ok(formatted.includes("tokens"));
  });
});
