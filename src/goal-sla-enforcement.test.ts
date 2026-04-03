import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { createSlaState, registerGoalSla, removeGoalSla, checkGoalSlas, getBreachedSlas, formatSlaChecks } from "./goal-sla-enforcement.js";

describe("createSlaState", () => {
  it("starts empty", () => { assert.equal(createSlaState().goals.length, 0); });
});

describe("registerGoalSla", () => {
  it("registers a goal SLA", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "build auth", 4, 80, 1000);
    assert.equal(s.goals.length, 1);
    assert.equal(s.goals[0].slaHours, 4);
  });
  it("replaces existing SLA for same session", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "old", 2);
    registerGoalSla(s, "alpha", "new", 4);
    assert.equal(s.goals.length, 1);
    assert.equal(s.goals[0].goal, "new");
  });
});

describe("removeGoalSla", () => {
  it("removes a goal SLA", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "g", 4);
    assert.ok(removeGoalSla(s, "alpha"));
    assert.equal(s.goals.length, 0);
  });
  it("returns false for nonexistent", () => {
    assert.ok(!removeGoalSla(createSlaState(), "ghost"));
  });
});

describe("checkGoalSlas", () => {
  it("returns ok for fresh goals", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "g", 4, 80, 1000);
    const checks = checkGoalSlas(s, 2000); // 1s elapsed, 4h SLA
    assert.equal(checks[0].status, "ok");
  });
  it("returns warning near SLA", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "g", 4, 80, 0);
    const checks = checkGoalSlas(s, 3.5 * 3_600_000); // 3.5h of 4h = 87.5%
    assert.equal(checks[0].status, "warning");
  });
  it("returns breached past SLA", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "g", 2, 80, 0);
    const checks = checkGoalSlas(s, 3 * 3_600_000); // 3h of 2h SLA
    assert.equal(checks[0].status, "breached");
  });
  it("sorts by pctUsed descending", () => {
    const s = createSlaState();
    registerGoalSla(s, "fast", "g", 10, 80, 0);
    registerGoalSla(s, "slow", "g", 1, 80, 0);
    const checks = checkGoalSlas(s, 2 * 3_600_000);
    assert.equal(checks[0].sessionTitle, "slow"); // 200% used
  });
});

describe("getBreachedSlas", () => {
  it("returns only breached", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "g", 1, 80, 0);
    registerGoalSla(s, "beta", "g", 10, 80, 0);
    const breached = getBreachedSlas(s, 2 * 3_600_000);
    assert.equal(breached.length, 1);
    assert.equal(breached[0].sessionTitle, "alpha");
  });
});

describe("formatSlaChecks", () => {
  it("shows no-SLAs message", () => {
    const lines = formatSlaChecks([]);
    assert.ok(lines[0].includes("no SLAs"));
  });
  it("shows SLA checks", () => {
    const s = createSlaState();
    registerGoalSla(s, "alpha", "build", 4, 80, 0);
    const checks = checkGoalSlas(s, 3 * 3_600_000);
    const lines = formatSlaChecks(checks);
    assert.ok(lines[0].includes("Goal SLA"));
    assert.ok(lines.some((l) => l.includes("alpha")));
  });
});
