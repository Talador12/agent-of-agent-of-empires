import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeAllocation, formatAllocation } from "./difficulty-allocator.js";
import type { DifficultyScore } from "./difficulty-scorer.js";

function makeScore(title: string, score: number): DifficultyScore {
  return { sessionTitle: title, score, label: "moderate", factors: [], estimatedHours: score * 0.5 };
}

describe("computeAllocation", () => {
  it("handles empty scores", () => {
    assert.deepEqual(computeAllocation([], 5), []);
  });

  it("allocates proportionally to difficulty", () => {
    const scores = [makeScore("hard", 8), makeScore("easy", 2)];
    const results = computeAllocation(scores, 10);
    const hard = results.find((r) => r.sessionTitle === "hard")!;
    const easy = results.find((r) => r.sessionTitle === "easy")!;
    assert.ok(hard.allocationWeight > easy.allocationWeight);
    assert.ok(hard.recommendedSlots > easy.recommendedSlots);
  });

  it("ensures minimum 1 slot per task", () => {
    const scores = [makeScore("big", 9), makeScore("tiny", 1)];
    const results = computeAllocation(scores, 2);
    assert.ok(results.every((r) => r.recommendedSlots >= 1));
  });

  it("marks high-difficulty as prioritize", () => {
    const scores = [makeScore("hard", 9), makeScore("normal", 3), makeScore("easy", 1)];
    const results = computeAllocation(scores, 5);
    assert.equal(results.find((r) => r.sessionTitle === "hard")?.action, "prioritize");
  });

  it("marks low-difficulty as deprioritize", () => {
    const scores = [makeScore("hard", 9), makeScore("normal", 5), makeScore("trivial", 1)];
    const results = computeAllocation(scores, 5);
    assert.equal(results.find((r) => r.sessionTitle === "trivial")?.action, "deprioritize");
  });

  it("handles uniform difficulty", () => {
    const scores = [makeScore("a", 5), makeScore("b", 5), makeScore("c", 5)];
    const results = computeAllocation(scores, 9);
    // all should get roughly equal weight
    for (const r of results) {
      assert.ok(Math.abs(r.allocationWeight - 1 / 3) < 0.01);
    }
  });

  it("sorts by weight descending", () => {
    const scores = [makeScore("low", 1), makeScore("high", 9), makeScore("mid", 5)];
    const results = computeAllocation(scores, 10);
    assert.equal(results[0].sessionTitle, "high");
    assert.equal(results[results.length - 1].sessionTitle, "low");
  });
});

describe("formatAllocation", () => {
  it("handles empty", () => {
    const lines = formatAllocation([]);
    assert.ok(lines[0].includes("no tasks"));
  });

  it("shows allocation details", () => {
    const scores = [makeScore("adventure", 7), makeScore("code-music", 3)];
    const results = computeAllocation(scores, 5);
    const lines = formatAllocation(results);
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("code-music")));
    assert.ok(lines.some((l) => l.includes("slot")));
  });
});
