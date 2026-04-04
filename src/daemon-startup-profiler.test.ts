import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DaemonStartupProfiler, formatStartupProfile } from "./daemon-startup-profiler.js";

describe("DaemonStartupProfiler", () => {
  it("starts with no timings", () => {
    const p = new DaemonStartupProfiler();
    assert.equal(p.getProfile().moduleCount, 0);
  });
  it("records module init timings", () => {
    const p = new DaemonStartupProfiler();
    p.begin(0);
    p.startModule("poller", 10);
    p.endModule("poller", 30);
    p.startModule("reasoner", 30);
    p.endModule("reasoner", 80);
    const profile = p.getProfile(100);
    assert.equal(profile.moduleCount, 2);
    assert.equal(profile.timings[0].durationMs, 20);
    assert.equal(profile.timings[1].durationMs, 50);
  });
  it("identifies slowest module", () => {
    const p = new DaemonStartupProfiler();
    p.begin(0);
    p.startModule("fast", 0); p.endModule("fast", 5);
    p.startModule("slow", 5); p.endModule("slow", 100);
    assert.equal(p.getProfile().slowestModule, "slow");
  });
  it("filters slow modules by threshold", () => {
    const p = new DaemonStartupProfiler();
    p.begin(0);
    p.startModule("fast", 0); p.endModule("fast", 5);
    p.startModule("slow", 5); p.endModule("slow", 200);
    assert.equal(p.getSlowModules(50).length, 1);
    assert.equal(p.getSlowModules(50)[0].moduleName, "slow");
  });
  it("computes total init time", () => {
    const p = new DaemonStartupProfiler();
    p.begin(0);
    p.startModule("a", 0); p.endModule("a", 20);
    p.startModule("b", 20); p.endModule("b", 50);
    assert.equal(p.totalInitMs(), 50);
  });
  it("handles endModule without startModule", () => {
    const p = new DaemonStartupProfiler();
    p.begin(0);
    p.endModule("ghost", 100); // should be ignored
    assert.equal(p.getProfile().moduleCount, 0);
  });
  it("computes total elapsed time", () => {
    const p = new DaemonStartupProfiler();
    p.begin(100);
    const profile = p.getProfile(600);
    assert.equal(profile.totalMs, 500);
  });
});

describe("formatStartupProfile", () => {
  it("shows no-data message when empty", () => {
    const p = new DaemonStartupProfiler();
    const lines = formatStartupProfile(p);
    assert.ok(lines[0].includes("no timing data"));
  });
  it("shows slow modules and bottleneck", () => {
    const p = new DaemonStartupProfiler();
    p.begin(0);
    p.startModule("reasoner", 0); p.endModule("reasoner", 100);
    p.startModule("poller", 100); p.endModule("poller", 120);
    const lines = formatStartupProfile(p);
    assert.ok(lines[0].includes("Startup Profile"));
    assert.ok(lines.some((l) => l.includes("reasoner")));
    assert.ok(lines.some((l) => l.includes("Bottleneck")));
  });
});
