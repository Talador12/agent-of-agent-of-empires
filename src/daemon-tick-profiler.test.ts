import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DaemonTickProfiler, formatTickProfiler } from "./daemon-tick-profiler.js";

describe("DaemonTickProfiler", () => {
  it("starts with no profiles", () => {
    const p = new DaemonTickProfiler();
    assert.equal(p.profileCount(), 0);
    assert.deepEqual(p.getStats(), []);
  });

  it("records a complete tick profile", () => {
    const p = new DaemonTickProfiler();
    p.startTick(1, 1000);
    p.startPhase("poll", 1000); p.endPhase("poll", 1050);
    p.startPhase("reason", 1050); p.endPhase("reason", 1200);
    p.startPhase("execute", 1200); p.endPhase("execute", 1230);
    const profile = p.endTick(1230);
    assert.ok(profile);
    assert.equal(profile!.phases.get("poll"), 50);
    assert.equal(profile!.phases.get("reason"), 150);
    assert.equal(profile!.phases.get("execute"), 30);
    assert.equal(profile!.phases.get("total"), 230);
  });

  it("computes per-phase stats", () => {
    const p = new DaemonTickProfiler();
    for (let i = 0; i < 5; i++) {
      p.startTick(i, i * 1000);
      p.startPhase("poll", i * 1000); p.endPhase("poll", i * 1000 + 50);
      p.startPhase("reason", i * 1000 + 50); p.endPhase("reason", i * 1000 + 200);
      p.endTick(i * 1000 + 200);
    }
    const stats = p.getStats();
    const pollStats = stats.find((s) => s.phase === "poll");
    assert.ok(pollStats);
    assert.equal(pollStats!.count, 5);
    assert.equal(pollStats!.avgMs, 50);
  });

  it("identifies bottleneck phase", () => {
    const p = new DaemonTickProfiler();
    p.startTick(1, 0);
    p.startPhase("poll", 0); p.endPhase("poll", 10);
    p.startPhase("reason", 10); p.endPhase("reason", 500);
    p.startPhase("execute", 510); p.endPhase("execute", 520);
    p.endTick(520);
    assert.equal(p.bottleneck(), "reason");
  });

  it("finds slowest tick", () => {
    const p = new DaemonTickProfiler();
    p.startTick(1, 0); p.startPhase("poll", 0); p.endPhase("poll", 50); p.endTick(50);
    p.startTick(2, 100); p.startPhase("poll", 100); p.endPhase("poll", 500); p.endTick(500);
    p.startTick(3, 600); p.startPhase("poll", 600); p.endPhase("poll", 620); p.endTick(620);
    const slowest = p.slowestTick();
    assert.ok(slowest);
    assert.equal(slowest!.tickNum, 2);
  });

  it("enforces max profiles", () => {
    const p = new DaemonTickProfiler(3);
    for (let i = 0; i < 10; i++) {
      p.startTick(i, i * 100);
      p.startPhase("poll", i * 100); p.endPhase("poll", i * 100 + 10);
      p.endTick(i * 100 + 10);
    }
    assert.equal(p.profileCount(), 3);
  });

  it("handles endTick without startTick", () => {
    const p = new DaemonTickProfiler();
    assert.equal(p.endTick(), null);
  });

  it("handles endPhase without startPhase", () => {
    const p = new DaemonTickProfiler();
    p.startTick(1, 0);
    p.endPhase("poll"); // no startPhase
    const profile = p.endTick();
    assert.ok(profile);
    assert.ok(!profile!.phases.has("poll") || profile!.phases.get("poll") === undefined);
  });

  it("returns null bottleneck with no data", () => {
    const p = new DaemonTickProfiler();
    assert.equal(p.bottleneck(), null);
  });
});

describe("formatTickProfiler", () => {
  it("shows no-data message when empty", () => {
    const p = new DaemonTickProfiler();
    const lines = formatTickProfiler(p);
    assert.ok(lines[0].includes("no data"));
  });

  it("shows phase stats table", () => {
    const p = new DaemonTickProfiler();
    p.startTick(1, 0);
    p.startPhase("poll", 0); p.endPhase("poll", 50);
    p.startPhase("reason", 50); p.endPhase("reason", 200);
    p.endTick(200);
    const lines = formatTickProfiler(p);
    assert.ok(lines[0].includes("Tick Profiler"));
    assert.ok(lines.some((l) => l.includes("poll")));
    assert.ok(lines.some((l) => l.includes("reason")));
  });
});
