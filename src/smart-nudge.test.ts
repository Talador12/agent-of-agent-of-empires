import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateNudge, formatNudgePreview } from "./smart-nudge.js";
import type { NudgeContext } from "./smart-nudge.js";

function makeContext(overrides: Partial<NudgeContext> = {}): NudgeContext {
  return {
    sessionTitle: "test",
    goal: "implement the authentication system",
    errorPatterns: [],
    successPatterns: [],
    idleMinutes: 15,
    ...overrides,
  };
}

describe("generateNudge", () => {
  it("includes goal in nudge", () => {
    const nudge = generateNudge(makeContext());
    assert.ok(nudge.includes("authentication"));
  });

  it("references last progress when available", () => {
    const nudge = generateNudge(makeContext({ lastProgressSummary: "set up database schema" }));
    assert.ok(nudge.includes("database schema"));
  });

  it("references recent activity", () => {
    const nudge = generateNudge(makeContext({ recentActivity: "editing src/auth.ts" }));
    assert.ok(nudge.includes("editing src/auth.ts"));
  });

  it("includes error pattern from memory", () => {
    const nudge = generateNudge(makeContext({ errorPatterns: ["SQLite lock timeout after 30s"] }));
    assert.ok(nudge.includes("SQLite lock"));
  });

  it("includes success pattern from memory", () => {
    const nudge = generateNudge(makeContext({ successPatterns: ["retry with exponential backoff resolved the issue"] }));
    assert.ok(nudge.includes("retry"));
  });

  it("mentions idle time when > 30min", () => {
    const nudge = generateNudge(makeContext({ idleMinutes: 45 }));
    assert.ok(nudge.includes("45m"));
  });

  it("does not mention idle when < 30min", () => {
    const nudge = generateNudge(makeContext({ idleMinutes: 10 }));
    assert.ok(!nudge.includes("10m since"));
  });

  it("falls back to generic when no context", () => {
    const nudge = generateNudge(makeContext());
    assert.ok(nudge.includes("goal") || nudge.includes("Checking in"));
  });

  it("truncates long goals", () => {
    const nudge = generateNudge(makeContext({ goal: "x".repeat(200) }));
    assert.ok(nudge.length < 400);
  });
});

describe("formatNudgePreview", () => {
  it("wraps nudge with session title", () => {
    const lines = formatNudgePreview("adventure", "Are you making progress?");
    assert.ok(lines[0].includes("adventure"));
    assert.ok(lines[1].includes("Are you making"));
  });
});
