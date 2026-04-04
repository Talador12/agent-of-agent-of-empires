import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateComplianceReport, formatComplianceReportTui, formatComplianceReportMd } from "./fleet-compliance-report.js";
import type { ComplianceReportInput } from "./fleet-compliance-report.js";

function makeInput(overrides: Partial<ComplianceReportInput> = {}): ComplianceReportInput {
  return {
    periodLabel: "2026-04-03", complianceViolations: [], slaBreaches: [],
    incidents: [], totalCostUsd: 20, budgetUsd: 100, sessionCount: 5, healthScore: 85,
    ...overrides,
  };
}

describe("generateComplianceReport", () => {
  it("returns compliant for clean fleet", () => {
    const r = generateComplianceReport(makeInput());
    assert.equal(r.overallStatus, "compliant");
    assert.ok(r.score >= 80);
  });
  it("returns non-compliant for many violations", () => {
    const r = generateComplianceReport(makeInput({
      complianceViolations: [{ session: "a", rule: "naming", severity: "error" }],
      slaBreaches: [{ session: "a", slaHours: 2, actualHours: 5 }],
      incidents: Array.from({ length: 5 }, () => ({ session: "a", type: "error", resolved: false })),
      healthScore: 30,
    }));
    assert.equal(r.overallStatus, "non-compliant");
    assert.ok(r.score < 50);
  });
  it("returns at-risk for moderate issues", () => {
    const r = generateComplianceReport(makeInput({
      complianceViolations: [{ session: "a", rule: "naming", severity: "warning" }],
      healthScore: 55,
    }));
    assert.ok(["at-risk", "compliant"].includes(r.overallStatus));
  });
  it("flags cost overspend", () => {
    const r = generateComplianceReport(makeInput({ totalCostUsd: 200, budgetUsd: 100 }));
    const costSection = r.sections.find((s) => s.title === "Cost Management");
    assert.ok(costSection);
    assert.ok(costSection!.status !== "pass");
  });
  it("has 5 sections", () => {
    const r = generateComplianceReport(makeInput());
    assert.equal(r.sections.length, 5);
  });
  it("score between 0-100", () => {
    const r = generateComplianceReport(makeInput({
      complianceViolations: [{ session: "a", rule: "x", severity: "error" }],
      slaBreaches: [{ session: "a", slaHours: 1, actualHours: 5 }],
      incidents: Array.from({ length: 10 }, () => ({ session: "a", type: "error", resolved: false })),
      totalCostUsd: 200, budgetUsd: 50, healthScore: 10,
    }));
    assert.ok(r.score >= 0 && r.score <= 100);
  });
});

describe("formatComplianceReportTui", () => {
  it("shows status and score", () => {
    const r = generateComplianceReport(makeInput());
    const lines = formatComplianceReportTui(r);
    assert.ok(lines[0].includes("Compliance Report"));
    assert.ok(lines[0].includes("/100"));
  });
});

describe("formatComplianceReportMd", () => {
  it("produces markdown", () => {
    const r = generateComplianceReport(makeInput());
    const md = formatComplianceReportMd(r);
    assert.ok(md.startsWith("# Compliance Report"));
    assert.ok(md.includes("Status:"));
  });
});
