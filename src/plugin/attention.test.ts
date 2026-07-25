import { test } from "node:test";
import assert from "node:assert/strict";
import { rankSessions, historyToJson, historyFromJson, formatDuration, ESCALATION_CAP, type StatusHistoryEntry } from "./attention.js";
import type { HostSession } from "./host.js";

function session(overrides: Partial<HostSession>): HostSession {
  return {
    id: "s1",
    title: "session",
    project_path: "/p",
    tool: "claude",
    status: "Running",
    archived: false,
    snoozed: false,
    ...overrides,
  };
}

test("error and waiting sessions outrank running ones", () => {
  const history = new Map<string, StatusHistoryEntry>();
  const rows = rankSessions(
    [
      session({ id: "run", title: "run", status: "Running" }),
      session({ id: "err", title: "err", status: "Error" }),
      session({ id: "wait", title: "wait", status: "Waiting" }),
    ],
    history,
    new Set(),
    1_000_000
  );
  assert.deepEqual(rows.map((r) => r.sessionId), ["err", "wait", "run"]);
  assert.ok(rows[0].attentionScore > rows[1].attentionScore);
  assert.equal(rows[2].attentionScore, 0);
});

test("lingering in waiting escalates the score over time, capped", () => {
  const history = new Map<string, StatusHistoryEntry>();
  const t0 = 1_000_000;
  rankSessions([session({ status: "Waiting" })], history, new Set(), t0);
  const after10m = rankSessions([session({ status: "Waiting" })], history, new Set(), t0 + 10 * 60_000)[0];
  assert.equal(after10m.attentionScore, 60 + 15); // 1.5/min * 10min
  const after10h = rankSessions([session({ status: "Waiting" })], history, new Set(), t0 + 600 * 60_000)[0];
  assert.equal(after10h.attentionScore, 60 + ESCALATION_CAP);
});

test("status change resets the escalation clock", () => {
  const history = new Map<string, StatusHistoryEntry>();
  const t0 = 1_000_000;
  rankSessions([session({ status: "Waiting" })], history, new Set(), t0);
  rankSessions([session({ status: "Running" })], history, new Set(), t0 + 5 * 60_000);
  const row = rankSessions([session({ status: "Waiting" })], history, new Set(), t0 + 6 * 60_000)[0];
  assert.equal(row.inStatusForMs, 0);
});

test("snoozed and archived sessions are excluded; stale history is pruned", () => {
  const history = new Map<string, StatusHistoryEntry>();
  history.set("gone", { status: "Error", since: 0 });
  const rows = rankSessions(
    [session({ id: "a", snoozed: true }), session({ id: "b", archived: true }), session({ id: "c" })],
    history,
    new Set(),
    1_000_000
  );
  assert.deepEqual(rows.map((r) => r.sessionId), ["c"]);
  assert.equal(history.has("gone"), false);
});

test("plugin-owned sessions are flagged in reasons", () => {
  const history = new Map<string, StatusHistoryEntry>();
  const rows = rankSessions([session({ id: "mine", status: "Waiting" })], history, new Set(["mine"]), 1);
  assert.equal(rows[0].pluginOwned, true);
  assert.ok(rows[0].reasons.includes("orchestrator-owned"));
});

test("unknown host statuses rank mid rather than disappearing", () => {
  const history = new Map<string, StatusHistoryEntry>();
  const rows = rankSessions([session({ status: "SomethingNew" })], history, new Set(), 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].attentionScore, 30);
});

test("history serialization round-trips and rejects malformed entries", () => {
  const history = new Map<string, StatusHistoryEntry>([
    ["a", { status: "Waiting", since: 123 }],
  ]);
  const restored = historyFromJson(historyToJson(history));
  assert.deepEqual(restored, history);
  const dirty = historyFromJson({ ok: { status: "Idle", since: 1 }, bad: { status: 5 }, worse: null });
  assert.deepEqual([...dirty.keys()], ["ok"]);
});

test("formatDuration renders humane buckets", () => {
  assert.equal(formatDuration(30_000), "<1m");
  assert.equal(formatDuration(5 * 60_000), "5m");
  assert.equal(formatDuration(90 * 60_000), "1h 30m");
  assert.equal(formatDuration(26 * 3_600_000), "1d 2h");
});
