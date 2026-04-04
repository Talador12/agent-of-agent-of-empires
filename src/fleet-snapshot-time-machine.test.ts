import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createTimeMachine, takeSnapshot, getSnapshot, latestSnapshot, compareSnapshots, snapshotsInRange, formatTimeMachine, formatSnapshotDiff } from "./fleet-snapshot-time-machine.js";

describe("createTimeMachine", () => {
  it("starts empty", () => { assert.equal(createTimeMachine().snapshots.length, 0); });
});

describe("takeSnapshot", () => {
  it("takes a snapshot with incremental ID", () => {
    const s = createTimeMachine();
    const snap = takeSnapshot(s, { timestamp: 1000, sessionCount: 3, activeSessions: ["a", "b", "c"], healthScore: 80, totalCostUsd: 15 });
    assert.equal(snap.id, 1);
    assert.equal(s.snapshots.length, 1);
  });
  it("enforces max snapshots", () => {
    const s = createTimeMachine(3);
    for (let i = 0; i < 5; i++) takeSnapshot(s, { timestamp: i, sessionCount: 1, activeSessions: ["a"], healthScore: 50, totalCostUsd: i });
    assert.equal(s.snapshots.length, 3);
  });
});

describe("getSnapshot", () => {
  it("finds by ID", () => {
    const s = createTimeMachine();
    takeSnapshot(s, { timestamp: 1000, sessionCount: 1, activeSessions: ["a"], healthScore: 80, totalCostUsd: 5 });
    assert.ok(getSnapshot(s, 1));
  });
  it("returns null for invalid ID", () => {
    assert.equal(getSnapshot(createTimeMachine(), 999), null);
  });
});

describe("latestSnapshot", () => {
  it("returns most recent", () => {
    const s = createTimeMachine();
    takeSnapshot(s, { timestamp: 1000, sessionCount: 1, activeSessions: ["a"], healthScore: 80, totalCostUsd: 5 });
    takeSnapshot(s, { timestamp: 2000, sessionCount: 2, activeSessions: ["a", "b"], healthScore: 90, totalCostUsd: 10 });
    assert.equal(latestSnapshot(s)!.id, 2);
  });
});

describe("compareSnapshots", () => {
  it("detects added/removed sessions", () => {
    const a = { id: 1, timestamp: 1000, sessionCount: 2, activeSessions: ["a", "b"], healthScore: 80, totalCostUsd: 10 };
    const b = { id: 2, timestamp: 2000, sessionCount: 2, activeSessions: ["b", "c"], healthScore: 90, totalCostUsd: 15 };
    const diff = compareSnapshots(a, b);
    assert.ok(diff.addedSessions.includes("c"));
    assert.ok(diff.removedSessions.includes("a"));
    assert.equal(diff.healthDelta, 10);
    assert.equal(diff.costDelta, 5);
  });
});

describe("snapshotsInRange", () => {
  it("filters by time range", () => {
    const s = createTimeMachine();
    takeSnapshot(s, { timestamp: 0, sessionCount: 1, activeSessions: [], healthScore: 50, totalCostUsd: 0 }, 1000);
    takeSnapshot(s, { timestamp: 0, sessionCount: 1, activeSessions: [], healthScore: 50, totalCostUsd: 0 }, 2000);
    takeSnapshot(s, { timestamp: 0, sessionCount: 1, activeSessions: [], healthScore: 50, totalCostUsd: 0 }, 3000);
    assert.equal(snapshotsInRange(s, 1500, 2500).length, 1);
  });
});

describe("formatTimeMachine", () => {
  it("shows empty message", () => {
    const lines = formatTimeMachine(createTimeMachine());
    assert.ok(lines.some((l) => l.includes("No snapshots")));
  });
  it("shows recent snapshots", () => {
    const s = createTimeMachine();
    takeSnapshot(s, { timestamp: Date.now(), sessionCount: 3, activeSessions: ["a"], healthScore: 85, totalCostUsd: 12 });
    const lines = formatTimeMachine(s);
    assert.ok(lines[0].includes("Time Machine"));
  });
});

describe("formatSnapshotDiff", () => {
  it("shows diff details", () => {
    const diff = { addedSessions: ["c"], removedSessions: ["a"], healthDelta: 10, costDelta: 5, sessionCountDelta: 0 };
    const lines = formatSnapshotDiff(diff);
    assert.ok(lines.some((l) => l.includes("Added")));
    assert.ok(lines.some((l) => l.includes("Removed")));
  });
});
