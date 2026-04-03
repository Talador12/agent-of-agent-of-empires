import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { GraduationManager } from "./session-graduation.js";

describe("GraduationManager", () => {
  it("starts sessions in confirm mode", () => {
    const mgr = new GraduationManager();
    mgr.recordSuccess("test");
    assert.equal(mgr.getState("test")?.currentMode, "confirm");
  });

  it("promotes to auto after enough successes + cooldown", () => {
    const mgr = new GraduationManager({ promoteThreshold: 0.9, minActionsForPromotion: 5, cooldownTicks: 0 });
    for (let i = 0; i < 10; i++) mgr.recordSuccess("test");
    const result = mgr.evaluate("test"); // should promote immediately with cooldown=0
    assert.equal(result.action, "promote");
    assert.equal(result.from, "confirm");
    assert.equal(result.to, "auto");
  });

  it("does not promote before cooldown", () => {
    const mgr = new GraduationManager({ promoteThreshold: 0.9, minActionsForPromotion: 5, cooldownTicks: 100 });
    for (let i = 0; i < 10; i++) mgr.recordSuccess("test");
    const result = mgr.evaluate("test");
    assert.equal(result.action, "none");
  });

  it("does not promote with insufficient actions", () => {
    const mgr = new GraduationManager({ minActionsForPromotion: 20, cooldownTicks: 0 });
    for (let i = 0; i < 5; i++) mgr.recordSuccess("test");
    const result = mgr.evaluate("test");
    assert.equal(result.action, "none");
  });

  it("demotes on low success rate", () => {
    const mgr = new GraduationManager({ demoteThreshold: 0.5, cooldownTicks: 0, minActionsForPromotion: 3 });
    // first promote to auto
    for (let i = 0; i < 10; i++) mgr.recordSuccess("test");
    mgr.evaluate("test"); // promote confirm→auto
    // now fail a lot
    for (let i = 0; i < 20; i++) mgr.recordFailure("test");
    const result = mgr.evaluate("test");
    assert.equal(result.action, "demote");
    assert.equal(result.to, "confirm");
  });

  it("does not demote below observe", () => {
    const mgr = new GraduationManager({ demoteThreshold: 0.5 });
    // start at confirm, force low success
    for (let i = 0; i < 10; i++) mgr.recordFailure("test");
    const r1 = mgr.evaluate("test"); // demote confirm→observe
    assert.equal(r1.to, "observe");
    for (let i = 0; i < 10; i++) mgr.recordFailure("test");
    const r2 = mgr.evaluate("test"); // already at observe, can't go lower
    assert.equal(r2.action, "none");
  });

  it("tracks promotion history", () => {
    const mgr = new GraduationManager({ promoteThreshold: 0.9, minActionsForPromotion: 3, cooldownTicks: 0 });
    for (let i = 0; i < 10; i++) mgr.recordSuccess("test");
    mgr.evaluate("test"); // confirm→auto
    const state = mgr.getState("test");
    assert.equal(state?.promotionHistory.length, 1);
    assert.equal(state?.promotionHistory[0].from, "confirm");
    assert.equal(state?.promotionHistory[0].to, "auto");
  });

  it("tracks sessions independently", () => {
    const mgr = new GraduationManager({ demoteThreshold: 0.5 });
    for (let i = 0; i < 10; i++) mgr.recordSuccess("good");
    for (let i = 0; i < 10; i++) mgr.recordFailure("bad");
    assert.ok(mgr.getState("good")!.successRate > 0.9);
    assert.ok(mgr.getState("bad")!.successRate < 0.1);
  });

  it("formatAll shows graduation info", () => {
    const mgr = new GraduationManager();
    mgr.recordSuccess("adventure");
    const lines = mgr.formatAll();
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("confirm")));
  });

  it("formatAll handles empty", () => {
    const mgr = new GraduationManager();
    const lines = mgr.formatAll();
    assert.ok(lines[0].includes("no graduation"));
  });
});
