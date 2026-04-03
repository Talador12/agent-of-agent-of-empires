import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  createSupervisor, recordCrash, currentUptime,
  resetHistory, supervisorStats, formatSupervisor,
} from "./daemon-process-supervisor.js";

describe("createSupervisor", () => {
  it("starts with no restarts", () => {
    const s = createSupervisor();
    assert.equal(s.restarts.length, 0);
    assert.ok(s.enabled);
  });
});

describe("recordCrash", () => {
  it("allows restart on first crash", () => {
    const s = createSupervisor();
    const d = recordCrash(s, "SIGTERM", 1, 1000);
    assert.ok(d.shouldRestart);
    assert.ok(d.delayMs >= 0);
    assert.equal(d.restartCount, 1);
  });

  it("applies exponential backoff", () => {
    const s = createSupervisor(10, 1000, 60_000);
    const d1 = recordCrash(s, "crash 1", 1, 1000);
    const d2 = recordCrash(s, "crash 2", 1, 2000);
    assert.ok(d2.delayMs >= d1.delayMs);
  });

  it("refuses restart after max restarts in window", () => {
    const s = createSupervisor(3, 1000);
    const now = 10_000;
    recordCrash(s, "c1", 1, now);
    recordCrash(s, "c2", 1, now + 100);
    recordCrash(s, "c3", 1, now + 200);
    const d = recordCrash(s, "c4", 1, now + 300);
    assert.ok(!d.shouldRestart);
    assert.ok(d.inCooldown);
  });

  it("does not restart when disabled", () => {
    const s = createSupervisor();
    s.enabled = false;
    const d = recordCrash(s, "crash", 1);
    assert.ok(!d.shouldRestart);
  });

  it("tracks longest uptime", () => {
    const s = createSupervisor();
    s.currentUptimeStartMs = 0;
    recordCrash(s, "crash", 1, 100_000);
    assert.ok(s.longestUptimeMs >= 100_000);
  });

  it("records exit code", () => {
    const s = createSupervisor();
    recordCrash(s, "OOM", 137);
    assert.equal(s.restarts[0].exitCode, 137);
  });
});

describe("currentUptime", () => {
  it("computes uptime from start", () => {
    const s = createSupervisor();
    s.currentUptimeStartMs = 1000;
    assert.ok(currentUptime(s, 5000) >= 4000);
  });
});

describe("resetHistory", () => {
  it("clears restart history", () => {
    const s = createSupervisor();
    recordCrash(s, "c1");
    recordCrash(s, "c2");
    resetHistory(s);
    assert.equal(s.restarts.length, 0);
  });
});

describe("supervisorStats", () => {
  it("computes correct stats", () => {
    const s = createSupervisor();
    const now = 100_000;
    s.currentUptimeStartMs = 50_000;
    recordCrash(s, "c1", 1, now - 1000);
    const stats = supervisorStats(s, now);
    assert.equal(stats.totalRestarts, 1);
    assert.ok(stats.currentUptimeMs >= 0);
  });
});

describe("formatSupervisor", () => {
  it("shows enabled status", () => {
    const s = createSupervisor();
    const lines = formatSupervisor(s);
    assert.ok(lines[0].includes("enabled"));
  });

  it("shows last restart info", () => {
    const s = createSupervisor();
    recordCrash(s, "SIGTERM", 15);
    const lines = formatSupervisor(s);
    assert.ok(lines.some((l) => l.includes("SIGTERM")));
  });
});
