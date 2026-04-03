import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { celebrate, formatCelebration, formatCelebrations } from "./goal-celebration.js";
import type { CelebrationInput } from "./goal-celebration.js";

function makeInput(overrides: Partial<CelebrationInput> = {}): CelebrationInput {
  return {
    sessionTitle: "alpha", goal: "build auth", repo: "github/app",
    startedAt: Date.now() - 3_600_000, completedAt: Date.now(),
    costUsd: 5.0, progressEntries: 3, taskCount: 1, errorCount: 0,
    ...overrides,
  };
}

describe("celebrate", () => {
  it("generates a celebration with badge", () => {
    const r = celebrate(makeInput());
    assert.ok(r.badge);
    assert.ok(r.title);
    assert.ok(r.stats.includes("$"));
  });

  it("awards Flawless Diamond for cheap zero-error", () => {
    const r = celebrate(makeInput({ costUsd: 0.50, errorCount: 0 }));
    assert.equal(r.badge, "💎");
    assert.equal(r.title, "Flawless Diamond");
  });

  it("awards Zero Errors badge", () => {
    const r = celebrate(makeInput({ costUsd: 10, errorCount: 0 }));
    assert.equal(r.badge, "🏆");
  });

  it("awards Speed Run for under 30m", () => {
    const r = celebrate(makeInput({
      startedAt: Date.now() - 900_000, completedAt: Date.now(),
      costUsd: 10, errorCount: 1,
    }));
    assert.equal(r.badge, "⚡");
  });

  it("awards Budget Hero for under $2", () => {
    const r = celebrate(makeInput({ costUsd: 1.5, errorCount: 1 }));
    assert.equal(r.badge, "💰");
  });

  it("always produces at least one highlight", () => {
    const r = celebrate(makeInput({ errorCount: 5, costUsd: 50 }));
    assert.ok(r.highlights.length >= 1);
  });

  it("includes duration in stats", () => {
    const r = celebrate(makeInput());
    assert.ok(r.durationStr.length > 0);
  });

  it("highlights zero errors", () => {
    const r = celebrate(makeInput({ errorCount: 0 }));
    assert.ok(r.highlights.some((h) => h.includes("Zero errors")));
  });
});

describe("formatCelebration", () => {
  it("shows badge and SHIPPED", () => {
    const r = celebrate(makeInput());
    const lines = formatCelebration(r);
    assert.ok(lines[0].includes("SHIPPED"));
    assert.ok(lines[0].includes(r.badge));
  });
});

describe("formatCelebrations", () => {
  it("shows no-completions message when empty", () => {
    const lines = formatCelebrations([]);
    assert.ok(lines[0].includes("no recently completed"));
  });

  it("shows multiple celebrations", () => {
    const results = [celebrate(makeInput()), celebrate(makeInput({ sessionTitle: "beta" }))];
    const lines = formatCelebrations(results);
    assert.ok(lines[0].includes("2 shipped"));
  });
});
