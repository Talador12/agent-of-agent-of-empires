import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { EscalationManager } from "./notify-escalation.js";

describe("EscalationManager", () => {
  it("starts at normal level", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 3, criticalAfterCount: 6, cooldownMs: 0 });
    const result = mgr.recordStuck("test");
    assert.ok(result);
    assert.equal(result.level, "normal");
    assert.equal(result.webhookUrl, null); // normal uses default
  });

  it("escalates to elevated after N notifications", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 3, criticalAfterCount: 6, cooldownMs: 0, elevatedWebhookUrl: "https://example.com/dm" });
    mgr.recordStuck("test");
    mgr.recordStuck("test");
    const r3 = mgr.recordStuck("test"); // 3rd = elevated
    assert.ok(r3);
    assert.equal(r3.level, "elevated");
    assert.equal(r3.webhookUrl, "https://example.com/dm");
  });

  it("escalates to critical after more notifications", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 2, criticalAfterCount: 4, cooldownMs: 0, criticalWebhookUrl: "https://example.com/sms" });
    for (let i = 0; i < 3; i++) mgr.recordStuck("test");
    const r4 = mgr.recordStuck("test"); // 4th = critical
    assert.ok(r4);
    assert.equal(r4.level, "critical");
    assert.equal(r4.webhookUrl, "https://example.com/sms");
  });

  it("respects cooldown", () => {
    const mgr = new EscalationManager({ cooldownMs: 60_000 });
    const now = Date.now();
    const r1 = mgr.recordStuck("test", now);
    assert.ok(r1);
    const r2 = mgr.recordStuck("test", now + 30_000); // 30s later, still in cooldown
    assert.equal(r2, null);
    const r3 = mgr.recordStuck("test", now + 61_000); // after cooldown
    assert.ok(r3);
  });

  it("clears escalation state", () => {
    const mgr = new EscalationManager({ cooldownMs: 0 });
    mgr.recordStuck("test");
    mgr.recordStuck("test");
    assert.ok(mgr.getState("test"));
    mgr.clearSession("test");
    assert.equal(mgr.getState("test"), undefined);
  });

  it("tracks multiple sessions independently", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 2, cooldownMs: 0 });
    mgr.recordStuck("a");
    mgr.recordStuck("a");
    mgr.recordStuck("b");
    assert.equal(mgr.getState("a")?.level, "elevated");
    assert.equal(mgr.getState("b")?.level, "normal");
  });

  it("getAllStates returns all active escalations", () => {
    const mgr = new EscalationManager({ cooldownMs: 0 });
    mgr.recordStuck("a");
    mgr.recordStuck("b");
    assert.equal(mgr.getAllStates().length, 2);
  });

  it("formatAll shows escalation info", () => {
    const mgr = new EscalationManager({ cooldownMs: 0 });
    mgr.recordStuck("adventure");
    const lines = mgr.formatAll();
    assert.ok(lines.some((l) => l.includes("adventure")));
    assert.ok(lines.some((l) => l.includes("normal")));
  });

  it("formatAll handles empty state", () => {
    const mgr = new EscalationManager();
    const lines = mgr.formatAll();
    assert.ok(lines[0].includes("no active escalations"));
  });

  it("critical message includes session name", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 1, criticalAfterCount: 2, cooldownMs: 0 });
    mgr.recordStuck("stuck-session");
    const r = mgr.recordStuck("stuck-session");
    assert.ok(r);
    assert.ok(r.message.includes("stuck-session"));
    assert.ok(r.message.includes("CRITICAL"));
  });

  it("falls back to elevated webhook when critical not set", () => {
    const mgr = new EscalationManager({ elevateAfterCount: 1, criticalAfterCount: 2, cooldownMs: 0, elevatedWebhookUrl: "https://dm.url" });
    mgr.recordStuck("test");
    const r = mgr.recordStuck("test"); // critical
    assert.ok(r);
    assert.equal(r.webhookUrl, "https://dm.url"); // falls back to elevated
  });
});
