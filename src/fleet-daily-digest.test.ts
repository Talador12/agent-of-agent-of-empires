import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildDailyDigest, formatDigestMarkdown, formatDigestTui } from "./fleet-daily-digest.js";
import type { DigestInput } from "./fleet-daily-digest.js";

function makeInput(overrides: Partial<DigestInput> = {}): DigestInput {
  return {
    periodLabel: "2026-04-03", completedGoals: ["alpha: build auth", "beta: fix bug"],
    failedGoals: ["gamma: deploy"], activeGoals: ["delta: refactor"], totalCostUsd: 25.50,
    avgHealthPct: 78, incidentCount: 2, topBurnSession: "alpha", topBurnRatePerHr: 3.5,
    nudgesSent: 8, reasonerCalls: 42, uptimeHours: 23.5, ...overrides,
  };
}

describe("buildDailyDigest", () => {
  it("builds digest with summary", () => {
    const d = buildDailyDigest(makeInput());
    assert.ok(d.summary.includes("2 completed"));
    assert.ok(d.summary.includes("1 failed"));
  });

  it("includes overview section", () => {
    const d = buildDailyDigest(makeInput());
    assert.ok(d.sections.some((s) => s.title === "Overview"));
  });

  it("includes completed section", () => {
    const d = buildDailyDigest(makeInput());
    assert.ok(d.sections.some((s) => s.title === "Completed"));
  });

  it("includes failed section", () => {
    const d = buildDailyDigest(makeInput());
    assert.ok(d.sections.some((s) => s.title === "Failed"));
  });

  it("skips empty sections", () => {
    const d = buildDailyDigest(makeInput({ completedGoals: [], failedGoals: [] }));
    assert.ok(!d.sections.some((s) => s.title === "Completed"));
    assert.ok(!d.sections.some((s) => s.title === "Failed"));
  });

  it("includes health warning when low", () => {
    const d = buildDailyDigest(makeInput({ avgHealthPct: 40 }));
    assert.ok(d.sections.some((s) => s.title === "Health Warning"));
  });

  it("includes cost highlight", () => {
    const d = buildDailyDigest(makeInput());
    assert.ok(d.sections.some((s) => s.title === "Cost"));
  });
});

describe("formatDigestMarkdown", () => {
  it("produces valid markdown", () => {
    const d = buildDailyDigest(makeInput());
    const md = formatDigestMarkdown(d);
    assert.ok(md.startsWith("# Fleet Daily Digest"));
    assert.ok(md.includes("## Overview"));
  });
});

describe("formatDigestTui", () => {
  it("shows digest header", () => {
    const d = buildDailyDigest(makeInput());
    const lines = formatDigestTui(d);
    assert.ok(lines[0].includes("Daily Digest"));
  });
});
