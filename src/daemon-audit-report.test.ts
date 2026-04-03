import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { generateAuditReport, formatAuditReportMarkdown, formatAuditReportTui } from "./daemon-audit-report.js";
import type { AuditReportInput } from "./daemon-audit-report.js";

function makeInput(overrides: Partial<AuditReportInput> = {}): AuditReportInput {
  return {
    periodLabel: "2026-04-03",
    actions: [
      { type: "send_input", session: "alpha", timestamp: 1000, success: true },
      { type: "send_input", session: "beta", timestamp: 2000, success: true },
      { type: "restart", session: "alpha", timestamp: 3000, success: false },
    ],
    approvals: [{ session: "alpha", status: "approved" }],
    escalations: 1, errors: 1, totalCostUsd: 15.50, reasonerCalls: 42,
    ...overrides,
  };
}

describe("generateAuditReport", () => {
  it("computes summary stats", () => {
    const r = generateAuditReport(makeInput());
    assert.equal(r.summary.totalActions, 3);
    assert.equal(r.summary.successRate, 67); // 2/3
    assert.equal(r.summary.errors, 1);
    assert.equal(r.summary.costUsd, 15.50);
  });
  it("builds action breakdown", () => {
    const r = generateAuditReport(makeInput());
    assert.equal(r.actionBreakdown.get("send_input"), 2);
    assert.equal(r.actionBreakdown.get("restart"), 1);
  });
  it("builds session activity", () => {
    const r = generateAuditReport(makeInput());
    assert.equal(r.sessionActivity.get("alpha"), 2);
    assert.equal(r.sessionActivity.get("beta"), 1);
  });
  it("marks pass for clean reports", () => {
    const r = generateAuditReport(makeInput({ errors: 0, escalations: 0, actions: [{ type: "wait", session: "a", timestamp: 1, success: true }] }));
    assert.equal(r.complianceStatus, "pass");
  });
  it("marks fail for high errors", () => {
    const r = generateAuditReport(makeInput({ errors: 15 }));
    assert.equal(r.complianceStatus, "fail");
  });
  it("marks review-needed for moderate issues", () => {
    const r = generateAuditReport(makeInput({
      errors: 5, escalations: 6,
      actions: Array.from({ length: 20 }, (_, i) => ({ type: "send_input", session: "a", timestamp: i, success: true })),
    }));
    assert.equal(r.complianceStatus, "review-needed");
  });
});

describe("formatAuditReportMarkdown", () => {
  it("produces markdown with header", () => {
    const r = generateAuditReport(makeInput());
    const md = formatAuditReportMarkdown(r);
    assert.ok(md.startsWith("# Audit Report"));
    assert.ok(md.includes("Compliance"));
  });
});

describe("formatAuditReportTui", () => {
  it("shows report with compliance status", () => {
    const r = generateAuditReport(makeInput());
    const lines = formatAuditReportTui(r);
    assert.ok(lines[0].includes("Audit Report"));
    assert.ok(lines.some((l) => l.includes("success")));
  });
});
