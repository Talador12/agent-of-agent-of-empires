import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { deduplicateOutput, renderDeduped, dedupStats, formatDedup } from "./session-output-dedup.js";

describe("deduplicateOutput", () => {
  it("returns empty for no input", () => {
    const r = deduplicateOutput([]);
    assert.equal(r.originalLines, 0);
    assert.equal(r.output.length, 0);
  });

  it("keeps unique lines unchanged", () => {
    const r = deduplicateOutput(["a", "b", "c"]);
    assert.equal(r.deduplicatedLines, 3);
    assert.equal(r.collapsedRuns, 0);
  });

  it("collapses consecutive repeats", () => {
    const r = deduplicateOutput(["a", "a", "a", "b"]);
    assert.equal(r.collapsedRuns, 1);
    assert.equal(r.output[0].count, 3);
    assert.ok(r.output[0].collapsed);
  });

  it("handles multiple separate runs", () => {
    const r = deduplicateOutput(["a", "a", "b", "b", "b"]);
    assert.equal(r.collapsedRuns, 2);
    assert.equal(r.deduplicatedLines, 2);
  });

  it("respects minRepeat threshold", () => {
    const r = deduplicateOutput(["a", "a", "b"], 3);
    assert.equal(r.collapsedRuns, 0); // only 2 repeats, need 3
    assert.equal(r.deduplicatedLines, 3);
  });

  it("computes saved lines", () => {
    const r = deduplicateOutput(["x", "x", "x", "x", "y"]);
    assert.equal(r.savedLines, 3); // 5 original → 2 deduped
  });

  it("handles all-same input", () => {
    const r = deduplicateOutput(["z", "z", "z", "z", "z"]);
    assert.equal(r.deduplicatedLines, 1);
    assert.equal(r.output[0].count, 5);
  });

  it("handles single line", () => {
    const r = deduplicateOutput(["solo"]);
    assert.equal(r.deduplicatedLines, 1);
    assert.ok(!r.output[0].collapsed);
  });
});

describe("renderDeduped", () => {
  it("renders collapsed lines with count", () => {
    const r = deduplicateOutput(["a", "a", "a", "b"]);
    const rendered = renderDeduped(r);
    assert.ok(rendered[0].includes("×3"));
    assert.equal(rendered[1], "b");
  });
});

describe("dedupStats", () => {
  it("computes compression percentage", () => {
    const r = deduplicateOutput(["a", "a", "a", "a", "b"]);
    const stats = dedupStats(r);
    assert.equal(stats.compressionPct, 60); // saved 3/5
  });
});

describe("formatDedup", () => {
  it("shows no-repeats message when nothing collapsed", () => {
    const r = deduplicateOutput(["a", "b", "c"]);
    const lines = formatDedup(r);
    assert.ok(lines.some((l) => l.includes("No repeated")));
  });

  it("shows collapsed runs", () => {
    const r = deduplicateOutput(["spinner...", "spinner...", "spinner..."]);
    const lines = formatDedup(r);
    assert.ok(lines.some((l) => l.includes("×3")));
  });
});
