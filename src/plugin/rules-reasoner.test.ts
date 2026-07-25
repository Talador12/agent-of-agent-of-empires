import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesReasoner } from "./rules-reasoner.js";
import type { Observation, SessionSnapshot } from "../types.js";

function snap(id: string, status: SessionSnapshot["session"]["status"]): SessionSnapshot {
  return {
    session: { id, title: `t-${id}`, path: "/p", tool: "claude", status, tmux_name: "" },
    output: "",
    outputHash: "",
    capturedAt: 0,
  };
}

function observation(sessions: SessionSnapshot[], now = 1_000_000): Observation {
  return { timestamp: now, sessions, changes: [] };
}

function reasoner(owned: string[], since: Record<string, number>) {
  return new RulesReasoner({
    ownedSessionIds: new Set(owned),
    maxIdleBeforeNudgeMs: 120_000,
    statusSince: (id) => since[id],
  });
}

test("healthy fleet yields a single wait action", async () => {
  const r = reasoner([], {});
  const result = await r.decide(observation([snap("a", "running")]));
  assert.deepEqual(result.actions, [{ action: "wait", reason: "all sessions healthy" }]);
});

test("owned session stuck waiting past threshold gets a nudge", async () => {
  const now = 1_000_000;
  const r = reasoner(["a"], { a: now - 180_000 });
  const result = await r.decide(observation([snap("a", "waiting")], now));
  assert.equal(result.actions[0].action, "send_input");
  assert.equal((result.actions[0] as { session: string }).session, "a");
});

test("foreign session stuck waiting becomes advice, never an action", async () => {
  const now = 1_000_000;
  const r = reasoner([], { a: now - 180_000 });
  const result = await r.decide(observation([snap("a", "waiting")], now));
  assert.equal(result.actions[0].action, "wait");
  assert.match(result.reasoning ?? "", /consider checking in/);
});

test("waiting under the threshold is left alone", async () => {
  const now = 1_000_000;
  const r = reasoner(["a"], { a: now - 60_000 });
  const result = await r.decide(observation([snap("a", "waiting")], now));
  assert.equal(result.actions[0].action, "wait");
});

test("error sessions produce a recommendation, not a restart", async () => {
  const r = reasoner(["a"], { a: 0 });
  const result = await r.decide(observation([snap("a", "error")]));
  assert.equal(result.actions[0].action, "wait");
  assert.match(result.reasoning ?? "", /needs a human/);
});
