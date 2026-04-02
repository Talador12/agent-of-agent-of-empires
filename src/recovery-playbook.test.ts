import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { RecoveryPlaybookManager, defaultPlaybook } from "./recovery-playbook.js";

describe("defaultPlaybook", () => {
  it("returns 4 steps", () => {
    const steps = defaultPlaybook();
    assert.equal(steps.length, 4);
  });

  it("steps are ordered from least to most aggressive", () => {
    const steps = defaultPlaybook();
    assert.equal(steps[0].action, "nudge");
    assert.equal(steps[3].action, "escalate");
  });
});

describe("RecoveryPlaybookManager", () => {
  it("returns no actions for healthy session", () => {
    const mgr = new RecoveryPlaybookManager();
    const actions = mgr.evaluate("test", 80);
    assert.equal(actions.length, 0);
  });

  it("triggers nudge when health drops below 60", () => {
    const mgr = new RecoveryPlaybookManager();
    const actions = mgr.evaluate("test", 55);
    assert.ok(actions.some((a) => a.action === "nudge"));
  });

  it("triggers restart when health drops below 40", () => {
    const mgr = new RecoveryPlaybookManager();
    const actions = mgr.evaluate("test", 35);
    assert.ok(actions.some((a) => a.action === "restart"));
  });

  it("triggers pause when health drops below 20", () => {
    const mgr = new RecoveryPlaybookManager();
    const actions = mgr.evaluate("test", 15);
    assert.ok(actions.some((a) => a.action === "pause"));
  });

  it("triggers escalate at critical health", () => {
    const mgr = new RecoveryPlaybookManager();
    const actions = mgr.evaluate("test", 5);
    assert.ok(actions.some((a) => a.action === "escalate"));
  });

  it("does not re-trigger same step without recovery", () => {
    const mgr = new RecoveryPlaybookManager();
    const a1 = mgr.evaluate("test", 55); // triggers nudge
    assert.ok(a1.length > 0);
    const a2 = mgr.evaluate("test", 55); // already triggered
    assert.equal(a2.length, 0);
  });

  it("resets trigger when health recovers", () => {
    const mgr = new RecoveryPlaybookManager();
    mgr.evaluate("test", 55); // triggers nudge
    mgr.evaluate("test", 75); // health recovers
    const a3 = mgr.evaluate("test", 55); // should re-trigger
    assert.ok(a3.some((a) => a.action === "nudge"));
  });

  it("respects maxRetries", () => {
    const mgr = new RecoveryPlaybookManager([
      { condition: "low", action: "nudge", detail: "check", minHealthScore: 60, maxRetries: 2 },
    ]);
    mgr.evaluate("test", 50); // attempt 1
    mgr.evaluate("test", 70); // recover
    mgr.evaluate("test", 50); // attempt 2
    mgr.evaluate("test", 70); // recover
    const a = mgr.evaluate("test", 50); // attempt 3 — should be blocked (maxRetries=2)
    assert.equal(a.length, 0);
  });

  it("clearSession removes plan", () => {
    const mgr = new RecoveryPlaybookManager();
    mgr.evaluate("test", 50);
    assert.ok(mgr.getPlan("test"));
    mgr.clearSession("test");
    assert.equal(mgr.getPlan("test"), undefined);
  });

  it("tracks sessions independently", () => {
    const mgr = new RecoveryPlaybookManager();
    const a = mgr.evaluate("healthy", 80);
    const b = mgr.evaluate("sick", 30);
    assert.equal(a.length, 0);
    assert.ok(b.length > 0);
  });

  it("formatAll handles empty", () => {
    const mgr = new RecoveryPlaybookManager();
    const lines = mgr.formatAll();
    assert.ok(lines[0].includes("no recovery plans"));
  });

  it("formatAll shows triggered steps", () => {
    const mgr = new RecoveryPlaybookManager();
    mgr.evaluate("sick-session", 30);
    const lines = mgr.formatAll();
    assert.ok(lines.some((l) => l.includes("sick-session")));
  });

  it("accepts custom playbook", () => {
    const mgr = new RecoveryPlaybookManager([
      { condition: "custom", action: "custom", detail: "do custom thing", minHealthScore: 90, maxRetries: 1 },
    ]);
    const actions = mgr.evaluate("test", 85);
    assert.ok(actions.some((a) => a.action === "custom"));
  });
});
