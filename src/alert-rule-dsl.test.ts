import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseCondition, parseAlertRuleConfigs, validateCondition } from "./alert-rule-dsl.js";

describe("parseCondition", () => {
  it("parses 'fleetHealth < 40'", () => {
    const fn = parseCondition("fleetHealth < 40");
    assert.ok(fn);
    assert.equal(fn!({ fleetHealth: 30 } as any), true);
    assert.equal(fn!({ fleetHealth: 50 } as any), false);
  });
  it("parses >=", () => {
    const fn = parseCondition("errorSessions >= 3");
    assert.ok(fn);
    assert.equal(fn!({ errorSessions: 3 } as any), true);
    assert.equal(fn!({ errorSessions: 2 } as any), false);
  });
  it("parses ==", () => {
    const fn = parseCondition("activeSessions == 0");
    assert.ok(fn);
    assert.equal(fn!({ activeSessions: 0 } as any), true);
  });
  it("rejects invalid field", () => { assert.equal(parseCondition("bogusField < 5"), null); });
  it("rejects invalid operator", () => { assert.equal(parseCondition("fleetHealth ~~ 5"), null); });
  it("rejects garbage", () => { assert.equal(parseCondition("not a condition"), null); });
});

describe("parseAlertRuleConfigs", () => {
  it("parses valid configs", () => {
    const { rules, errors } = parseAlertRuleConfigs([
      { name: "test", severity: "warning", condition: "fleetHealth < 40", cooldownMin: 5 },
    ]);
    assert.equal(rules.length, 1);
    assert.equal(errors.length, 0);
    assert.equal(rules[0].name, "test");
  });
  it("reports errors for invalid conditions", () => {
    const { rules, errors } = parseAlertRuleConfigs([
      { name: "bad", severity: "critical", condition: "invalid stuff", cooldownMin: 1 },
    ]);
    assert.equal(rules.length, 0);
    assert.equal(errors.length, 1);
  });
});

describe("validateCondition", () => {
  it("validates correct condition", () => { assert.equal(validateCondition("fleetHealth < 50").valid, true); });
  it("rejects bad field", () => { assert.equal(validateCondition("badField > 1").valid, false); });
  it("rejects bad format", () => { assert.equal(validateCondition("hello world").valid, false); });
});
