import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { composeAnd, composeOr, parseComposedCondition, formatComposedCondition } from "./alert-composer.js";
import type { AlertContext } from "./alert-rules.js";

const ctx = (overrides: Partial<AlertContext> = {}): AlertContext => ({
  fleetHealth: 80, activeSessions: 5, errorSessions: 0, totalCostUsd: 10, hourlyCostRate: 1, stuckSessions: 0, idleMinutes: new Map(), ...overrides,
});

describe("composeAnd", () => {
  it("requires all conditions true", () => {
    const fn = composeAnd(["fleetHealth < 50", "errorSessions > 2"]);
    assert.ok(fn);
    assert.equal(fn!(ctx({ fleetHealth: 30, errorSessions: 5 })), true);
    assert.equal(fn!(ctx({ fleetHealth: 30, errorSessions: 0 })), false);
    assert.equal(fn!(ctx({ fleetHealth: 80, errorSessions: 5 })), false);
  });
  it("returns null for invalid condition", () => {
    assert.equal(composeAnd(["fleetHealth < 50", "bogus stuff"]), null);
  });
});

describe("composeOr", () => {
  it("requires any condition true", () => {
    const fn = composeOr(["fleetHealth < 20", "errorSessions > 3"]);
    assert.ok(fn);
    assert.equal(fn!(ctx({ fleetHealth: 10 })), true);
    assert.equal(fn!(ctx({ errorSessions: 5 })), true);
    assert.equal(fn!(ctx({ fleetHealth: 80, errorSessions: 0 })), false);
  });
});

describe("parseComposedCondition", () => {
  it("parses plain string", () => {
    const fn = parseComposedCondition("fleetHealth < 50");
    assert.ok(fn);
    assert.equal(fn!(ctx({ fleetHealth: 30 })), true);
  });
  it("parses AND", () => {
    const fn = parseComposedCondition({ and: ["fleetHealth < 50", "stuckSessions > 0"] });
    assert.ok(fn);
  });
  it("parses OR", () => {
    const fn = parseComposedCondition({ or: ["fleetHealth < 20", "errorSessions > 3"] });
    assert.ok(fn);
  });
});

describe("formatComposedCondition", () => {
  it("formats string", () => { assert.equal(formatComposedCondition("x < 5"), "x < 5"); });
  it("formats AND", () => { assert.equal(formatComposedCondition({ and: ["a < 1", "b > 2"] }), "a < 1 AND b > 2"); });
  it("formats OR", () => { assert.equal(formatComposedCondition({ or: ["a < 1", "b > 2"] }), "a < 1 OR b > 2"); });
});
