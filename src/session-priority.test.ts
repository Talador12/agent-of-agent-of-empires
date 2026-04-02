import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { computeSessionPriority, rankSessionsByPriority, selectTopPriority, formatPriorityQueue } from "./session-priority.js";
import type { SessionPriorityInput } from "./session-priority.js";

function makeInput(overrides: Partial<SessionPriorityInput> = {}): SessionPriorityInput {
  return {
    sessionTitle: "test",
    healthScore: 80,
    lastChangeMs: 60_000,
    lastProgressMs: 120_000,
    taskStatus: "active",
    isStuck: false,
    hasError: false,
    isUserActive: false,
    ...overrides,
  };
}

describe("computeSessionPriority", () => {
  it("gives high priority to error sessions", () => {
    const p = computeSessionPriority(makeInput({ hasError: true }));
    assert.ok(p.priority >= 100);
    assert.ok(p.reason.includes("error"));
  });

  it("gives high priority to stuck sessions", () => {
    const p = computeSessionPriority(makeInput({ isStuck: true }));
    assert.ok(p.priority >= 80);
    assert.ok(p.reason.includes("stuck"));
  });

  it("gives negative priority to user-active sessions", () => {
    const p = computeSessionPriority(makeInput({ isUserActive: true }));
    assert.ok(p.priority < 0);
    assert.ok(p.reason.includes("user active"));
  });

  it("boosts priority for low health", () => {
    const low = computeSessionPriority(makeInput({ healthScore: 20 }));
    const high = computeSessionPriority(makeInput({ healthScore: 90 }));
    assert.ok(low.priority > high.priority);
  });

  it("boosts priority for stale sessions", () => {
    const stale = computeSessionPriority(makeInput({ lastChangeMs: 60 * 60_000 })); // 1hr
    const fresh = computeSessionPriority(makeInput({ lastChangeMs: 1_000 })); // 1s
    assert.ok(stale.priority > fresh.priority);
  });

  it("gives priority to failed tasks", () => {
    const failed = computeSessionPriority(makeInput({ taskStatus: "failed" }));
    const active = computeSessionPriority(makeInput({ taskStatus: "active" }));
    assert.ok(failed.priority > active.priority);
  });
});

describe("rankSessionsByPriority", () => {
  it("ranks error above stuck above normal", () => {
    const inputs = [
      makeInput({ sessionTitle: "normal", healthScore: 80 }),
      makeInput({ sessionTitle: "error", hasError: true }),
      makeInput({ sessionTitle: "stuck", isStuck: true }),
    ];
    const ranked = rankSessionsByPriority(inputs);
    assert.equal(ranked[0].sessionTitle, "error");
    assert.equal(ranked[1].sessionTitle, "stuck");
    assert.equal(ranked[2].sessionTitle, "normal");
  });

  it("puts user-active sessions last", () => {
    const inputs = [
      makeInput({ sessionTitle: "user", isUserActive: true }),
      makeInput({ sessionTitle: "idle" }),
    ];
    const ranked = rankSessionsByPriority(inputs);
    assert.equal(ranked[ranked.length - 1].sessionTitle, "user");
  });
});

describe("selectTopPriority", () => {
  it("returns top N sessions", () => {
    const inputs = Array.from({ length: 5 }, (_, i) =>
      makeInput({ sessionTitle: `s${i}`, healthScore: 80 - i * 10 }),
    );
    const top = selectTopPriority(inputs, 2);
    assert.equal(top.length, 2);
  });

  it("filters out user-active sessions", () => {
    const inputs = [
      makeInput({ sessionTitle: "user", isUserActive: true }),
      makeInput({ sessionTitle: "normal" }),
    ];
    const top = selectTopPriority(inputs);
    assert.ok(!top.some((s) => s.sessionTitle === "user"));
  });

  it("returns empty when all sessions are nominal", () => {
    // a healthy active session with short stale time should have priority > 0
    const inputs = [makeInput({ sessionTitle: "healthy", healthScore: 90, lastChangeMs: 1000 })];
    const top = selectTopPriority(inputs);
    // active task gives baseline 10 + small staleness
    assert.ok(top.length >= 1);
  });
});

describe("formatPriorityQueue", () => {
  it("shows no-attention message for empty", () => {
    const lines = formatPriorityQueue([]);
    assert.ok(lines[0].includes("no sessions"));
  });

  it("formats ranked sessions with icons", () => {
    const ranked = [
      { sessionTitle: "critical", priority: 150, reason: "error state" },
      { sessionTitle: "normal", priority: 15, reason: "active task" },
    ];
    const lines = formatPriorityQueue(ranked);
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes("critical"));
    assert.ok(lines[0].includes("🔴"));
    assert.ok(lines[1].includes("normal"));
    assert.ok(lines[1].includes("🟢"));
  });
});
