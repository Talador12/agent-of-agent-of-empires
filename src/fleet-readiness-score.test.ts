import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { evaluateReadiness, formatReadiness } from "./fleet-readiness-score.js";
import type { ReadinessInputs } from "./fleet-readiness-score.js";

const HEALTHY: ReadinessInputs = {
  configValid: true, reasonerConnected: true, sessionCount: 3,
  poolCapacity: 10, healthScore: 85, complianceViolations: 0,
  unresolvedIncidents: 0, watchdogEnabled: true, costBudgetSet: true,
  contextFilesLoaded: true,
};

describe("evaluateReadiness", () => {
  it("returns READY for healthy fleet", () => {
    const r = evaluateReadiness(HEALTHY);
    assert.equal(r.grade, "READY");
    assert.ok(r.score >= 80);
    assert.equal(r.passedCount, r.totalCount);
  });

  it("returns NOT READY when many checks fail", () => {
    const r = evaluateReadiness({
      configValid: false, reasonerConnected: false, sessionCount: 0,
      poolCapacity: 10, healthScore: 20, complianceViolations: 5,
      unresolvedIncidents: 3, watchdogEnabled: false, costBudgetSet: false,
      contextFilesLoaded: false,
    });
    assert.ok(r.score < 50);
    assert.equal(r.grade, "NOT READY");
  });

  it("returns CAUTION for moderate issues", () => {
    const r = evaluateReadiness({ ...HEALTHY, healthScore: 40, complianceViolations: 2 });
    assert.ok(["CAUTION", "READY"].includes(r.grade));
  });

  it("fails pool-capacity check when full", () => {
    const r = evaluateReadiness({ ...HEALTHY, sessionCount: 10, poolCapacity: 10 });
    const poolCheck = r.checks.find((c) => c.name === "pool-capacity");
    assert.ok(poolCheck && !poolCheck.passed);
  });

  it("fails config check", () => {
    const r = evaluateReadiness({ ...HEALTHY, configValid: false });
    const cfgCheck = r.checks.find((c) => c.name === "config-valid");
    assert.ok(cfgCheck && !cfgCheck.passed);
  });

  it("fails incidents check", () => {
    const r = evaluateReadiness({ ...HEALTHY, unresolvedIncidents: 3 });
    const incCheck = r.checks.find((c) => c.name === "incidents-clear");
    assert.ok(incCheck && !incCheck.passed);
  });

  it("has 10 checks", () => {
    const r = evaluateReadiness(HEALTHY);
    assert.equal(r.totalCount, 10);
  });

  it("score between 0-100", () => {
    const r = evaluateReadiness({
      configValid: false, reasonerConnected: false, sessionCount: 0,
      poolCapacity: 0, healthScore: 0, complianceViolations: 5,
      unresolvedIncidents: 5, watchdogEnabled: false, costBudgetSet: false,
      contextFilesLoaded: false,
    });
    assert.ok(r.score >= 0 && r.score <= 100);
  });
});

describe("formatReadiness", () => {
  it("shows READY status", () => {
    const r = evaluateReadiness(HEALTHY);
    const lines = formatReadiness(r);
    assert.ok(lines[0].includes("READY"));
  });

  it("shows check details", () => {
    const r = evaluateReadiness(HEALTHY);
    const lines = formatReadiness(r);
    assert.ok(lines.some((l) => l.includes("config-valid")));
    assert.ok(lines.some((l) => l.includes("✓")));
  });
});
