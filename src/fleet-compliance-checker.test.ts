import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  checkCompliance, checkFleetCompliance, formatComplianceReport,
} from "./fleet-compliance-checker.js";
import type { SessionForCompliance } from "./fleet-compliance-checker.js";

function makeSession(overrides: Partial<SessionForCompliance> = {}): SessionForCompliance {
  return {
    title: "adventure-fix",
    goal: "Fix the authentication bug",
    repo: "github/adventure",
    costUsd: 5.0,
    tags: new Map([["team", "platform"]]),
    idleMinutes: 5,
    ...overrides,
  };
}

describe("checkCompliance", () => {
  it("passes for a compliant session", () => {
    const v = checkCompliance(makeSession());
    assert.equal(v.length, 0);
  });

  it("flags bad naming", () => {
    const v = checkCompliance(makeSession({ title: "Bad Name With Spaces!!" }));
    assert.ok(v.some((x) => x.rule === "naming-convention"));
  });

  it("flags missing required tags", () => {
    const v = checkCompliance(makeSession({ tags: new Map() }), { requiredTags: ["team", "project"] });
    const tagViolations = v.filter((x) => x.rule === "required-tag");
    assert.equal(tagViolations.length, 2);
  });

  it("flags budget exceeded", () => {
    const v = checkCompliance(makeSession({ costUsd: 100 }), { maxBudgetUsd: 50 });
    assert.ok(v.some((x) => x.rule === "budget-exceeded" && x.severity === "error"));
  });

  it("flags excessive idle", () => {
    const v = checkCompliance(makeSession({ idleMinutes: 60 }), { maxIdleMinutes: 30 });
    assert.ok(v.some((x) => x.rule === "max-idle"));
  });

  it("flags missing goal", () => {
    const v = checkCompliance(makeSession({ goal: "" }), { requireGoal: true });
    assert.ok(v.some((x) => x.rule === "require-goal"));
  });

  it("flags missing repo", () => {
    const v = checkCompliance(makeSession({ repo: "" }), { requireRepo: true });
    assert.ok(v.some((x) => x.rule === "require-repo"));
  });

  it("flags banned patterns in goals", () => {
    const v = checkCompliance(
      makeSession({ goal: "delete all production data" }),
      { bannedPatterns: [{ pattern: /delete.*production/i, reason: "destructive operation" }] },
    );
    assert.ok(v.some((x) => x.rule === "banned-pattern"));
  });

  it("does not flag when within limits", () => {
    const v = checkCompliance(makeSession({ costUsd: 10 }), { maxBudgetUsd: 50 });
    assert.ok(!v.some((x) => x.rule === "budget-exceeded"));
  });
});

describe("checkFleetCompliance", () => {
  it("checks all sessions", () => {
    const sessions = [makeSession(), makeSession({ title: "BAD NAME", goal: "" })];
    const v = checkFleetCompliance(sessions);
    assert.ok(v.length > 0);
  });

  it("sorts errors before warnings", () => {
    const sessions = [
      makeSession({ title: "bad name!", goal: "" }), // error (goal) + warning (naming)
    ];
    const v = checkFleetCompliance(sessions);
    if (v.length >= 2) {
      const sevIdx = { error: 0, warning: 1, info: 2 };
      assert.ok(sevIdx[v[0].severity] <= sevIdx[v[1].severity]);
    }
  });

  it("returns empty for compliant fleet", () => {
    const v = checkFleetCompliance([makeSession()]);
    assert.equal(v.length, 0);
  });
});

describe("formatComplianceReport", () => {
  it("shows COMPLIANT for clean fleet", () => {
    const lines = formatComplianceReport([], 3);
    assert.ok(lines[0].includes("COMPLIANT"));
  });

  it("shows NON-COMPLIANT with errors", () => {
    const v = checkFleetCompliance([makeSession({ goal: "", costUsd: 200 })]);
    const lines = formatComplianceReport(v, 1);
    assert.ok(lines[0].includes("NON-COMPLIANT"));
  });

  it("shows violation details", () => {
    const v = checkCompliance(makeSession({ title: "BAD!" }));
    const lines = formatComplianceReport(v, 1);
    assert.ok(lines.some((l) => l.includes("naming")));
  });
});
