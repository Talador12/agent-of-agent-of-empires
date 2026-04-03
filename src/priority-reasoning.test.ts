import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { filterByPriority, computeSavings, formatPriorityFilter } from "./priority-reasoning.js";
import type { Observation, SessionSnapshot, AoeSession } from "./types.js";
import type { PrioritizedSession } from "./session-priority.js";

function makeSnap(title: string): SessionSnapshot {
  const session: AoeSession = { id: `id-${title}`, title, path: "/tmp", tool: "opencode", status: "working", tmux_name: `aoe_${title}` };
  return { session, output: "test output", outputHash: "hash", capturedAt: Date.now() };
}

function makeObs(titles: string[]): Observation {
  return {
    timestamp: Date.now(),
    sessions: titles.map(makeSnap),
    changes: titles.map((t) => ({ sessionId: `id-${t}`, title: t, tool: "opencode", status: "working" as const, newLines: "" })),
  };
}

function makeRanked(titles: string[], priorities: number[]): PrioritizedSession[] {
  return titles.map((t, i) => ({ sessionTitle: t, priority: priorities[i], reason: "test" }));
}

describe("filterByPriority", () => {
  it("includes high-priority sessions", () => {
    const obs = makeObs(["high", "low", "mid"]);
    const ranked = makeRanked(["high", "mid", "low"], [100, 50, 5]);
    const { filtered, included, excluded } = filterByPriority(obs, ranked, new Set(), { maxSessionsPerCall: 2, alwaysIncludeChanged: false });
    assert.equal(included.length, 2);
    assert.ok(included.includes("high"));
    assert.ok(included.includes("mid"));
    assert.ok(excluded.includes("low"));
  });

  it("always includes changed sessions when configured", () => {
    const obs = makeObs(["changed", "unchanged"]);
    const ranked = makeRanked(["unchanged", "changed"], [100, 1]);
    const { included } = filterByPriority(obs, ranked, new Set(["changed"]), { maxSessionsPerCall: 1, alwaysIncludeChanged: true });
    assert.ok(included.includes("changed"));
  });

  it("filters out low-priority sessions below minPriority", () => {
    const obs = makeObs(["high", "low"]);
    const ranked = makeRanked(["high", "low"], [50, 2]);
    const { excluded } = filterByPriority(obs, ranked, new Set(), { minPriority: 10, alwaysIncludeChanged: false });
    assert.ok(excluded.includes("low"));
  });

  it("respects maxSessionsPerCall", () => {
    const obs = makeObs(["a", "b", "c", "d", "e"]);
    const ranked = makeRanked(["a", "b", "c", "d", "e"], [50, 40, 30, 20, 10]);
    const { included } = filterByPriority(obs, ranked, new Set(), { maxSessionsPerCall: 3, alwaysIncludeChanged: false });
    assert.equal(included.length, 3);
  });
});

describe("computeSavings", () => {
  it("computes correct savings", () => {
    const original = makeObs(["a", "b", "c"]);
    const filtered = makeObs(["a"]);
    const savings = computeSavings(original, filtered);
    assert.equal(savings.sessionsSaved, 2);
    assert.equal(savings.changesSaved, 2);
    assert.ok(savings.estimatedTokensSaved > 0);
  });

  it("returns zero savings when nothing filtered", () => {
    const obs = makeObs(["a"]);
    const savings = computeSavings(obs, obs);
    assert.equal(savings.sessionsSaved, 0);
  });
});

describe("formatPriorityFilter", () => {
  it("formats included and excluded", () => {
    const lines = formatPriorityFilter(["a", "b"], ["c"], { sessionsSaved: 1, estimatedTokensSaved: 500 });
    assert.ok(lines.some((l) => l.includes("2 included")));
    assert.ok(lines.some((l) => l.includes("1 excluded")));
    assert.ok(lines.some((l) => l.includes("500 tokens")));
  });
});
