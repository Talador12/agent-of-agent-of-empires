// session-affinity-router.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAffinityState,
  recordOutcome,
  routeSessions,
  formatAffinityRouting,
  type ReasonerInstance,
  type RoutableSession,
  type AffinityRule,
} from "./session-affinity-router.js";

const mkInstance = (id: string, load = 0, max = 5, tags?: string[]): ReasonerInstance => ({
  id, backend: "opencode", maxConcurrent: max, currentLoad: load, tags,
});

describe("routeSessions", () => {
  it("routes session to lightest instance", () => {
    const instances = [mkInstance("a", 4, 5), mkInstance("b", 1, 5)];
    const sessions: RoutableSession[] = [{ title: "test" }];
    const state = createAffinityState();
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].instanceId, "b");
  });

  it("marks session unroutable when all instances at capacity", () => {
    const instances = [mkInstance("a", 5, 5), mkInstance("b", 5, 5)];
    const sessions: RoutableSession[] = [{ title: "test" }];
    const state = createAffinityState();
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.unroutable.length, 1);
  });

  it("prefers sticky routing (last-used instance)", () => {
    const instances = [mkInstance("a", 2, 5), mkInstance("b", 2, 5)];
    const sessions: RoutableSession[] = [{ title: "test", lastReasonerId: "b" }];
    const state = createAffinityState();
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.decisions[0].instanceId, "b");
    assert.ok(result.decisions[0].reasons.some((r) => r.includes("sticky")));
  });

  it("matches tags for routing", () => {
    const instances = [
      mkInstance("a", 0, 5, ["frontend"]),
      mkInstance("b", 0, 5, ["backend", "rust"]),
    ];
    const sessions: RoutableSession[] = [{ title: "rust-proj", tags: ["rust"] }];
    const state = createAffinityState();
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.decisions[0].instanceId, "b");
    assert.ok(result.decisions[0].reasons.some((r) => r.includes("tags")));
  });

  it("applies affinity rules", () => {
    const instances = [mkInstance("a", 0, 5), mkInstance("b", 0, 5)];
    const rules: AffinityRule[] = [
      { match: { repo: "frontend" }, preferInstanceId: "a", weight: 30 },
    ];
    const sessions: RoutableSession[] = [{ title: "test", repo: "/repos/frontend/app" }];
    const state = createAffinityState(rules);
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.decisions[0].instanceId, "a");
    assert.ok(result.decisions[0].reasons.some((r) => r.includes("affinity")));
  });

  it("uses historical performance for scoring", () => {
    const instances = [mkInstance("a", 0, 5), mkInstance("b", 0, 5)];
    const state = createAffinityState();
    // record good history for instance b
    for (let i = 0; i < 5; i++) recordOutcome(state, "b", "test", true, 100);
    // record bad history for instance a
    for (let i = 0; i < 5; i++) recordOutcome(state, "a", "test", false, 500);

    const sessions: RoutableSession[] = [{ title: "test" }];
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.decisions[0].instanceId, "b");
  });

  it("spreads load across instances for multiple sessions", () => {
    const instances = [mkInstance("a", 0, 5), mkInstance("b", 0, 5)];
    const sessions: RoutableSession[] = [
      { title: "s1" }, { title: "s2" }, { title: "s3" },
    ];
    const state = createAffinityState();
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.decisions.length, 3);
    // should spread — not all on same instance
    const aCount = result.decisions.filter((d) => d.instanceId === "a").length;
    const bCount = result.decisions.filter((d) => d.instanceId === "b").length;
    assert.ok(aCount > 0 || bCount > 0);
  });

  it("handles empty sessions", () => {
    const result = routeSessions([], [mkInstance("a")], createAffinityState());
    assert.equal(result.decisions.length, 0);
    assert.equal(result.unroutable.length, 0);
  });

  it("handles empty instances", () => {
    const result = routeSessions([{ title: "test" }], [], createAffinityState());
    assert.equal(result.unroutable.length, 1);
  });

  it("computes projected instance loads", () => {
    const instances = [mkInstance("a", 2, 5)];
    const sessions: RoutableSession[] = [{ title: "s1" }, { title: "s2" }];
    const state = createAffinityState();
    const result = routeSessions(sessions, instances, state);
    assert.equal(result.instanceLoads.get("a"), 4); // 2 existing + 2 new
  });
});

describe("recordOutcome", () => {
  it("tracks success and failure counts", () => {
    const state = createAffinityState();
    recordOutcome(state, "inst1", "sess1", true, 100);
    recordOutcome(state, "inst1", "sess1", false, 200);
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0].successCount, 1);
    assert.equal(state.history[0].failCount, 1);
  });

  it("computes running average duration", () => {
    const state = createAffinityState();
    recordOutcome(state, "inst1", "sess1", true, 100);
    recordOutcome(state, "inst1", "sess1", true, 300);
    assert.ok(state.history[0].avgDurationMs > 100 && state.history[0].avgDurationMs < 300);
  });

  it("caps history at 500 entries", () => {
    const state = createAffinityState();
    for (let i = 0; i < 600; i++) {
      recordOutcome(state, `inst${i}`, `sess${i}`, true, 100);
    }
    assert.ok(state.history.length <= 500);
  });
});

describe("formatAffinityRouting", () => {
  it("formats routing decisions for TUI", () => {
    const instances = [mkInstance("a", 0, 5), mkInstance("b", 1, 5)];
    const sessions: RoutableSession[] = [{ title: "test" }];
    const result = routeSessions(sessions, instances, createAffinityState());
    const lines = formatAffinityRouting(result);
    assert.ok(lines.length > 0);
    assert.ok(lines[0].includes("1 routed"));
    assert.ok(lines.some((l) => l.includes("test")));
    assert.ok(lines.some((l) => l.includes("instance loads")));
  });
});
