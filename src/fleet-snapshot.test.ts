import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { captureFleetSnapshot, formatFleetSnapshot, diffFleetSnapshots, shouldTakeSnapshot } from "./fleet-snapshot.js";
import type { DaemonSessionState, TaskState } from "./types.js";

function makeSessions(): DaemonSessionState[] {
  return [
    { id: "id-1", title: "adventure", tool: "opencode", status: "working", costStr: "$3.42", contextTokens: "50,000 / 200,000 tokens" },
    { id: "id-2", title: "code-music", tool: "opencode", status: "idle", costStr: "$1.20" },
  ];
}

function makeTasks(): TaskState[] {
  return [
    { repo: "github/adventure", sessionTitle: "adventure", sessionMode: "auto", tool: "opencode", goal: "implement auth", status: "active", progress: [{ at: Date.now(), summary: "started" }], lastProgressAt: Date.now() },
    { repo: "github/code-music", sessionTitle: "code-music", sessionMode: "auto", tool: "opencode", goal: "add synth", status: "completed", progress: [] },
  ];
}

describe("captureFleetSnapshot", () => {
  it("captures all sessions and tasks", () => {
    const snap = captureFleetSnapshot(makeSessions(), makeTasks(), new Map(), new Map());
    assert.equal(snap.sessions.length, 2);
    assert.equal(snap.tasks.length, 2);
    assert.ok(snap.timestamp);
    assert.ok(snap.epochMs > 0);
  });

  it("computes total cost from session costStr", () => {
    const snap = captureFleetSnapshot(makeSessions(), [], new Map(), new Map());
    assert.ok(Math.abs(snap.totalCostUsd - 4.62) < 0.01);
  });

  it("computes fleet health from scores", () => {
    const scores = new Map([["adventure", 80], ["code-music", 60]]);
    const snap = captureFleetSnapshot(makeSessions(), [], new Map(), scores);
    assert.equal(snap.fleetHealth, 70);
  });

  it("includes activity summaries", () => {
    const summaries = new Map([["adventure", "editing src/auth.ts"]]);
    const snap = captureFleetSnapshot(makeSessions(), [], summaries, new Map());
    assert.equal(snap.sessions[0].activity, "editing src/auth.ts");
    assert.equal(snap.sessions[1].activity, undefined);
  });

  it("truncates long goals", () => {
    const tasks: TaskState[] = [{
      repo: "x", sessionTitle: "x", sessionMode: "auto", tool: "opencode",
      goal: "a".repeat(200), status: "active", progress: [],
    }];
    const snap = captureFleetSnapshot([], tasks, new Map(), new Map());
    assert.ok(snap.tasks[0].goal.length <= 103);
  });

  it("handles zero health scores", () => {
    const snap = captureFleetSnapshot([], [], new Map(), new Map());
    assert.equal(snap.fleetHealth, 0);
  });
});

describe("formatFleetSnapshot", () => {
  it("formats a snapshot with sessions and tasks", () => {
    const snap = captureFleetSnapshot(makeSessions(), makeTasks(), new Map(), new Map());
    const lines = formatFleetSnapshot(snap);
    assert.ok(lines.length >= 4);
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("code-music")));
  });

  it("includes health and cost in header", () => {
    const snap = captureFleetSnapshot(makeSessions(), [], new Map(), new Map([["a", 80]]));
    snap.fleetHealth = 80;
    const lines = formatFleetSnapshot(snap);
    assert.ok(lines.some((l) => l.includes("80/100")));
    assert.ok(lines.some((l) => l.includes("$4.62")));
  });
});

describe("diffFleetSnapshots", () => {
  it("shows health and cost deltas", () => {
    const older = captureFleetSnapshot(makeSessions(), [], new Map(), new Map(), Date.now() - 600_000);
    older.fleetHealth = 60;
    older.totalCostUsd = 2.0;
    const newer = captureFleetSnapshot(makeSessions(), [], new Map(), new Map());
    newer.fleetHealth = 80;
    newer.totalCostUsd = 4.62;

    const diff = diffFleetSnapshots(older, newer);
    assert.ok(diff.some((l) => l.includes("60") && l.includes("80")));
    assert.ok(diff.some((l) => l.includes("$2.00") && l.includes("$4.62")));
  });

  it("detects new sessions", () => {
    const older = captureFleetSnapshot([makeSessions()[0]], [], new Map(), new Map(), Date.now() - 300_000);
    const newer = captureFleetSnapshot(makeSessions(), [], new Map(), new Map());

    const diff = diffFleetSnapshots(older, newer);
    assert.ok(diff.some((l) => l.includes("code-music") && l.includes("new session")));
  });

  it("detects removed sessions", () => {
    const older = captureFleetSnapshot(makeSessions(), [], new Map(), new Map(), Date.now() - 300_000);
    const newer = captureFleetSnapshot([makeSessions()[0]], [], new Map(), new Map());

    const diff = diffFleetSnapshots(older, newer);
    assert.ok(diff.some((l) => l.includes("code-music") && l.includes("removed")));
  });

  it("detects status changes", () => {
    const sessions1 = makeSessions();
    sessions1[0].status = "working";
    const older = captureFleetSnapshot(sessions1, [], new Map(), new Map(), Date.now() - 300_000);

    const sessions2 = makeSessions();
    sessions2[0].status = "error";
    const newer = captureFleetSnapshot(sessions2, [], new Map(), new Map());

    const diff = diffFleetSnapshots(older, newer);
    assert.ok(diff.some((l) => l.includes("adventure") && l.includes("working") && l.includes("error")));
  });
});

describe("shouldTakeSnapshot", () => {
  it("returns true on first poll", () => {
    assert.equal(shouldTakeSnapshot(1), true);
  });

  it("returns true on interval boundary", () => {
    assert.equal(shouldTakeSnapshot(60), true);
    assert.equal(shouldTakeSnapshot(120), true);
  });

  it("returns false between boundaries", () => {
    assert.equal(shouldTakeSnapshot(30), false);
    assert.equal(shouldTakeSnapshot(59), false);
  });

  it("returns false for invalid poll count", () => {
    assert.equal(shouldTakeSnapshot(0), false);
    assert.equal(shouldTakeSnapshot(-1), false);
  });

  it("respects custom interval", () => {
    assert.equal(shouldTakeSnapshot(10, 10), true);
    assert.equal(shouldTakeSnapshot(5, 10), false);
  });
});
