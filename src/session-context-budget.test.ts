import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  estimateTokens, scoreFileRelevance, allocateContextBudget, formatContextBudget,
} from "./session-context-budget.js";
import type { ContextFile } from "./session-context-budget.js";

function makeFile(overrides: Partial<ContextFile> = {}): ContextFile {
  return { path: "src/module.ts", sizeBytes: 2000, lastModifiedMs: Date.now() - 3_600_000, ...overrides };
}

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    assert.equal(estimateTokens(400), 100);
    assert.equal(estimateTokens(1000), 250);
  });
});

describe("scoreFileRelevance", () => {
  it("scores recent files higher", () => {
    const recent = makeFile({ lastModifiedMs: Date.now() - 60_000 }); // 1m ago
    const old = makeFile({ lastModifiedMs: Date.now() - 7 * 86_400_000 }); // 1 week
    assert.ok(scoreFileRelevance(recent, "build") > scoreFileRelevance(old, "build"));
  });

  it("boosts files matching goal keywords", () => {
    const match = makeFile({ path: "src/auth.ts" });
    const noMatch = makeFile({ path: "src/utils.ts" });
    assert.ok(scoreFileRelevance(match, "fix auth login") > scoreFileRelevance(noMatch, "fix auth login"));
  });

  it("boosts important files", () => {
    const agents = makeFile({ path: "AGENTS.md", lastModifiedMs: Date.now() - 86_400_000 });
    const random = makeFile({ path: "src/foo.ts", lastModifiedMs: Date.now() - 86_400_000 });
    assert.ok(scoreFileRelevance(agents, "build feature") > scoreFileRelevance(random, "build feature"));
  });

  it("penalizes very large files", () => {
    const small = makeFile({ sizeBytes: 1000 });
    const huge = makeFile({ sizeBytes: 50_000 });
    assert.ok(scoreFileRelevance(small, "build") >= scoreFileRelevance(huge, "build"));
  });

  it("returns 0-100 range", () => {
    const score = scoreFileRelevance(makeFile(), "build");
    assert.ok(score >= 0 && score <= 100);
  });
});

describe("allocateContextBudget", () => {
  it("selects files within budget", () => {
    const files = [
      makeFile({ path: "a.ts", sizeBytes: 1000 }),
      makeFile({ path: "b.ts", sizeBytes: 1000 }),
      makeFile({ path: "c.ts", sizeBytes: 1000 }),
    ];
    const alloc = allocateContextBudget(files, "build", 600); // room for ~2 files
    assert.ok(alloc.selectedFiles.length <= 3);
    assert.ok(alloc.totalTokens <= 600);
  });

  it("drops low-relevance files first", () => {
    const files = [
      makeFile({ path: "agents.md", sizeBytes: 2000, lastModifiedMs: Date.now() }),
      makeFile({ path: "random.ts", sizeBytes: 2000, lastModifiedMs: Date.now() - 30 * 86_400_000 }),
    ];
    const alloc = allocateContextBudget(files, "build", 600); // only room for 1
    assert.equal(alloc.selectedFiles.length, 1);
    assert.ok(alloc.selectedFiles[0].path.includes("agents"));
    assert.equal(alloc.droppedFiles.length, 1);
  });

  it("handles empty file list", () => {
    const alloc = allocateContextBudget([], "build", 1000);
    assert.equal(alloc.selectedFiles.length, 0);
    assert.equal(alloc.totalTokens, 0);
  });

  it("computes utilization percentage", () => {
    const files = [makeFile({ sizeBytes: 400 })]; // 100 tokens
    const alloc = allocateContextBudget(files, "build", 1000);
    assert.equal(alloc.utilizationPct, 10);
  });
});

describe("formatContextBudget", () => {
  it("shows budget utilization", () => {
    const alloc = allocateContextBudget([makeFile()], "build", 5000);
    const lines = formatContextBudget(alloc);
    assert.ok(lines[0].includes("Context Budget"));
    assert.ok(lines[0].includes("utilized"));
  });

  it("shows dropped files", () => {
    const files = [makeFile({ sizeBytes: 10_000 }), makeFile({ path: "big.ts", sizeBytes: 10_000 })];
    const alloc = allocateContextBudget(files, "build", 500);
    const lines = formatContextBudget(alloc);
    assert.ok(lines.some((l) => l.includes("Dropped")));
  });
});
